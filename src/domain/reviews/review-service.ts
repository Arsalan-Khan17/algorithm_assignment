import { eq, sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  actionAttempts,
  reviewDecisions,
  reviewers,
  reviewTasks,
  supportRequests,
} from "@/src/db/schema";
import { executeCancellationInTransaction } from "../actions/execute-cancellation";
import { executeRefundInTransaction } from "../actions/execute-refund";
import { DomainError, isDomainError } from "../errors";
import {
  cancellationProposalSchema,
  refundProposalSchema,
  reviewDecisionSchema,
} from "@/src/validation/actions";

export type ReviewConflictCode = "REVIEW_NOT_FOUND" | "REVIEW_ALREADY_DECIDED" | "STALE_VERSION";

export class ReviewConflict extends Error {
  constructor(
    public readonly code: ReviewConflictCode,
    message: string,
    public readonly current: typeof reviewTasks.$inferSelect | null,
  ) {
    super(message);
    this.name = "ReviewConflict";
  }
}

export async function createReviewTask(input: {
  supportRequestId: string;
  orderId?: string;
  actionType: "refund" | "cancel" | "manual_review";
  proposedPayload: Record<string, unknown>;
  rationale: string;
  evidence: Record<string, unknown>;
  escalationReason: string;
}) {
  const [review] = await db
    .insert(reviewTasks)
    .values({
      supportRequestId: input.supportRequestId,
      orderId: input.orderId ?? null,
      actionType: input.actionType,
      proposedPayload: input.proposedPayload,
      rationale: input.rationale,
      evidence: input.evidence,
      escalationReason: input.escalationReason,
    })
    .onConflictDoUpdate({
      target: reviewTasks.supportRequestId,
      set: {
        proposedPayload: input.proposedPayload,
        rationale: input.rationale,
        evidence: input.evidence,
        escalationReason: input.escalationReason,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db
    .update(supportRequests)
    .set({
      status: "needs_review",
      outcomeSummary: input.escalationReason,
      updatedAt: new Date(),
      version: sql`${supportRequests.version} + 1`,
    })
    .where(eq(supportRequests.id, input.supportRequestId));

  return review;
}

async function verifyReviewer(reviewerId: string) {
  const [reviewer] = await db
    .select({ id: reviewers.id })
    .from(reviewers)
    .where(eq(reviewers.id, reviewerId))
    .limit(1);
  return reviewer !== undefined;
}

export async function approveReview(reviewTaskId: string, rawDecision: unknown) {
  const decision = reviewDecisionSchema.parse(rawDecision);
  if (!(await verifyReviewer(decision.reviewerId))) {
    throw new ReviewConflict("REVIEW_NOT_FOUND", "Reviewer identity is not valid.", null);
  }

  let attempted:
    | {
        task: typeof reviewTasks.$inferSelect;
        request: typeof supportRequests.$inferSelect;
      }
    | undefined;

  try {
    return await db.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(reviewTasks)
        .where(eq(reviewTasks.id, reviewTaskId))
        .for("update");

      if (!task) {
        throw new ReviewConflict("REVIEW_NOT_FOUND", "Review task was not found.", null);
      }

      if (task.status !== "pending") {
        throw new ReviewConflict(
          "REVIEW_ALREADY_DECIDED",
          "Another reviewer already handled this task.",
          task,
        );
      }

      if (task.version !== decision.expectedVersion) {
        throw new ReviewConflict("STALE_VERSION", "Review state is stale.", task);
      }

      const [request] = await tx
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, task.supportRequestId))
        .limit(1);

      if (!request || !task.orderId) {
        throw new DomainError(
          "ORDER_NOT_FOUND_OR_NOT_OWNED",
          "The proposed action does not have a valid order.",
        );
      }

      attempted = { task, request };
      const idempotencyKey = `review:${task.id}`;
      let actionResult: Record<string, unknown>;

      if (task.actionType === "refund") {
        const proposal = refundProposalSchema.parse(task.proposedPayload);
        actionResult = await executeRefundInTransaction(tx, {
          customerId: request.customerId,
          supportRequestId: request.id,
          reviewTaskId: task.id,
          orderId: proposal.orderId,
          idempotencyKey,
          actorType: "reviewer",
          actorId: decision.reviewerId,
          amountCents: proposal.amountCents,
          reason: proposal.reason,
        });
      } else if (task.actionType === "cancel") {
        const proposal = cancellationProposalSchema.parse(task.proposedPayload);
        actionResult = await executeCancellationInTransaction(tx, {
          customerId: request.customerId,
          supportRequestId: request.id,
          reviewTaskId: task.id,
          orderId: proposal.orderId,
          idempotencyKey,
          actorType: "reviewer",
          actorId: decision.reviewerId,
          reason: proposal.reason,
        });
      } else {
        throw new DomainError(
          "ORDER_NOT_CANCELLABLE",
          "Manual-only escalations cannot be approved as an automated action.",
        );
      }

      await tx.insert(reviewDecisions).values({
        reviewTaskId: task.id,
        reviewerId: decision.reviewerId,
        decision: "approved",
        note: decision.note ?? null,
      });

      const now = new Date();
      const [updated] = await tx
        .update(reviewTasks)
        .set({
          status: "executed",
          version: sql`${reviewTasks.version} + 1`,
          decidedByReviewerId: decision.reviewerId,
          decidedAt: now,
          decisionNote: decision.note ?? null,
          updatedAt: now,
        })
        .where(eq(reviewTasks.id, task.id))
        .returning();

      await tx
        .update(supportRequests)
        .set({
          status: "completed",
          outcomeSummary: `${task.actionType} approved and executed`,
          version: sql`${supportRequests.version} + 1`,
          updatedAt: now,
        })
        .where(eq(supportRequests.id, request.id));

      return { review: updated, actionResult };
    });
  } catch (error: unknown) {
    if (!isDomainError(error) || !attempted) {
      throw error;
    }

    const { task, request } = attempted;
    const [current] = await db.transaction(async (tx) => {
      const [lockedTask] = await tx
        .select()
        .from(reviewTasks)
        .where(eq(reviewTasks.id, task.id))
        .for("update");

      if (!lockedTask || lockedTask.status !== "pending") {
        return [lockedTask];
      }

      await tx.insert(actionAttempts).values({
        supportRequestId: request.id,
        reviewTaskId: task.id,
        orderId: task.orderId!,
        actionType: task.actionType,
        actorType: "reviewer",
        actorId: decision.reviewerId,
        input: task.proposedPayload,
        outcome: error.isConflict ? "conflict" : "refused",
        outcomeCode: error.code,
        message: error.message,
      });

      return tx
        .update(reviewTasks)
        .set({
          status: "conflicted",
          version: sql`${reviewTasks.version} + 1`,
          decidedByReviewerId: decision.reviewerId,
          decidedAt: new Date(),
          decisionNote: error.message,
          updatedAt: new Date(),
        })
        .where(eq(reviewTasks.id, task.id))
        .returning();
    });

    throw new ReviewConflict("REVIEW_ALREADY_DECIDED", error.message, current ?? null);
  }
}

export async function rejectReview(reviewTaskId: string, rawDecision: unknown) {
  const decision = reviewDecisionSchema.parse(rawDecision);
  if (!(await verifyReviewer(decision.reviewerId))) {
    throw new ReviewConflict("REVIEW_NOT_FOUND", "Reviewer identity is not valid.", null);
  }

  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.id, reviewTaskId))
      .for("update");

    if (!task) {
      throw new ReviewConflict("REVIEW_NOT_FOUND", "Review task was not found.", null);
    }

    if (task.status !== "pending") {
      throw new ReviewConflict(
        "REVIEW_ALREADY_DECIDED",
        "Another reviewer already handled this task.",
        task,
      );
    }

    if (task.version !== decision.expectedVersion) {
      throw new ReviewConflict("STALE_VERSION", "Review state is stale.", task);
    }

    await tx.insert(reviewDecisions).values({
      reviewTaskId: task.id,
      reviewerId: decision.reviewerId,
      decision: "rejected",
      note: decision.note ?? null,
    });

    const now = new Date();
    const [updated] = await tx
      .update(reviewTasks)
      .set({
        status: "rejected",
        version: sql`${reviewTasks.version} + 1`,
        decidedByReviewerId: decision.reviewerId,
        decidedAt: now,
        decisionNote: decision.note ?? null,
        updatedAt: now,
      })
      .where(eq(reviewTasks.id, task.id))
      .returning();

    await tx
      .update(supportRequests)
      .set({
        status: "completed",
        outcomeSummary: "Proposed action rejected by reviewer",
        version: sql`${supportRequests.version} + 1`,
        updatedAt: now,
      })
      .where(eq(supportRequests.id, task.supportRequestId));

    return updated;
  });
}
