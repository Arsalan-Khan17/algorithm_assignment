import { desc, eq, notLike } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  actionAttempts,
  actionExecutions,
  agentRuns,
  customers,
  orders,
  payments,
  refunds,
  reviewers,
  reviewTasks,
  supportRequests,
  toolCalls,
} from "@/src/db/schema";

export async function listSupportRequests() {
  return db
    .select({
      id: supportRequests.id,
      message: supportRequests.message,
      status: supportRequests.status,
      outcomeSummary: supportRequests.outcomeSummary,
      version: supportRequests.version,
      createdAt: supportRequests.createdAt,
      updatedAt: supportRequests.updatedAt,
      customerId: customers.id,
      customerName: customers.name,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      reviewId: reviewTasks.id,
      reviewStatus: reviewTasks.status,
      escalationReason: reviewTasks.escalationReason,
      actionType: reviewTasks.actionType,
    })
    .from(supportRequests)
    .innerJoin(customers, eq(customers.id, supportRequests.customerId))
    .leftJoin(orders, eq(orders.id, supportRequests.orderId))
    .leftJoin(reviewTasks, eq(reviewTasks.supportRequestId, supportRequests.id))
    .where(notLike(customers.email, "%@example.test"))
    .orderBy(desc(supportRequests.createdAt));
}

export async function getSupportRequestDetail(id: string) {
  const [request] = await db
    .select({
      id: supportRequests.id,
      message: supportRequests.message,
      status: supportRequests.status,
      outcomeSummary: supportRequests.outcomeSummary,
      version: supportRequests.version,
      createdAt: supportRequests.createdAt,
      updatedAt: supportRequests.updatedAt,
      customerId: customers.id,
      customerName: customers.name,
      customerEmail: customers.email,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      fulfillmentStartedAt: orders.fulfillmentStartedAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      orderVersion: orders.version,
      paymentId: payments.id,
      paymentStatus: payments.status,
      amountCents: payments.amountCents,
      refundedAmountCents: payments.refundedAmountCents,
      currency: payments.currency,
    })
    .from(supportRequests)
    .innerJoin(customers, eq(customers.id, supportRequests.customerId))
    .leftJoin(orders, eq(orders.id, supportRequests.orderId))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(supportRequests.id, id))
    .limit(1);

  if (!request) {
    return null;
  }

  const [runs, review, attempts, executions, storedRefunds] = await Promise.all([
    db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.supportRequestId, id))
      .orderBy(desc(agentRuns.createdAt)),
    db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(actionAttempts)
      .where(eq(actionAttempts.supportRequestId, id))
      .orderBy(actionAttempts.createdAt),
    db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.supportRequestId, id))
      .orderBy(actionExecutions.createdAt),
    request.orderId
      ? db.select().from(refunds).where(eq(refunds.orderId, request.orderId))
      : Promise.resolve([]),
  ]);

  const calls = runs.length
    ? await db
        .select()
        .from(toolCalls)
        .where(eq(toolCalls.agentRunId, runs[0].id))
        .orderBy(toolCalls.sequence)
    : [];

  return { request, agentRuns: runs, toolCalls: calls, review, attempts, executions, refunds: storedRefunds };
}

export async function getReviewDetail(reviewId: string) {
  const [review] = await db
    .select()
    .from(reviewTasks)
    .where(eq(reviewTasks.id, reviewId))
    .limit(1);
  if (!review) {
    return null;
  }

  const detail = await getSupportRequestDetail(review.supportRequestId);
  if (!detail) {
    return null;
  }

  let decidedBy: { id: string; name: string; email: string } | null = null;
  if (review.decidedByReviewerId) {
    const [row] = await db
      .select({ id: reviewers.id, name: reviewers.name, email: reviewers.email })
      .from(reviewers)
      .where(eq(reviewers.id, review.decidedByReviewerId));
    decidedBy = row ?? null;
  }

  return { ...detail, review, decidedBy };
}

export async function listDemoIdentities() {
  const [customerRows, reviewerRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, email: customers.email })
      .from(customers)
      .where(notLike(customers.email, "%@example.test"))
      .orderBy(customers.name),
    db
      .select({ id: reviewers.id, name: reviewers.name, email: reviewers.email })
      .from(reviewers)
      .where(notLike(reviewers.email, "%@reviewer.test"))
      .orderBy(reviewers.name),
  ]);
  return { customers: customerRows, reviewers: reviewerRows };
}
