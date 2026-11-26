import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "@/src/db/client";
import {
  actionExecutions,
  agentRuns,
  customers,
  orders,
  payments,
  refunds,
  reviewDecisions,
  reviewers,
  reviewTasks,
  supportRequests,
  toolCalls,
} from "@/src/db/schema";
import { executeCancellation } from "@/src/domain/actions/execute-cancellation";
import { executeRefund } from "@/src/domain/actions/execute-refund";
import { approveReview } from "@/src/domain/reviews/review-service";
import { processSupportRequest } from "@/src/agent/run-agent";
import { ScriptedAgentModel } from "@/src/agent/model";

type FixtureOptions = {
  orderStatus?: "pending" | "processing" | "shipped" | "delivered";
  paymentStatus?: "authorized" | "captured";
  shippedAt?: Date | null;
  fulfillmentStartedAt?: Date | null;
  amountCents?: number;
  requestCount?: number;
};

async function createFixture(options: FixtureOptions = {}) {
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const orderNumber = Math.floor(100_000 + Math.random() * 800_000);

  await db.insert(customers).values([
    { id: customerId, name: "Test Customer", email: `${customerId}@example.test` },
    { id: otherCustomerId, name: "Other Customer", email: `${otherCustomerId}@example.test` },
  ]);

  await db.insert(orders).values({
    id: orderId,
    orderNumber,
    customerId,
    status: options.orderStatus ?? "delivered",
    fulfillmentStartedAt:
      options.fulfillmentStartedAt === undefined ? new Date() : options.fulfillmentStartedAt,
    shippedAt: options.shippedAt ?? null,
  });

  await db.insert(payments).values({
    id: paymentId,
    orderId,
    providerReference: `test_${paymentId}`,
    status: options.paymentStatus ?? "captured",
    amountCents: options.amountCents ?? 10_000,
    currency: "USD",
  });

  const requestIds = Array.from({ length: options.requestCount ?? 1 }, () => randomUUID());
  await db.insert(supportRequests).values(
    requestIds.map((id) => ({
      id,
      customerId,
      orderId,
      message: `Test request for order ${orderNumber}`,
      status: "running" as const,
    })),
  );

  return {
    customerId,
    otherCustomerId,
    orderId,
    paymentId,
    orderNumber,
    requestIds,
  };
}

afterAll(async () => {
  await sqlClient.end();
});

describe("guarded actions against PostgreSQL", () => {
  it("allows exactly one of two concurrent refunds", async () => {
    const fixture = await createFixture({ requestCount: 2 });

    const results = await Promise.allSettled([
      executeRefund({
        customerId: fixture.customerId,
        supportRequestId: fixture.requestIds[0],
        orderId: fixture.orderId,
        idempotencyKey: randomUUID(),
        actorType: "reviewer",
        amountCents: 10_000,
        reason: "Concurrent test A",
      }),
      executeRefund({
        customerId: fixture.customerId,
        supportRequestId: fixture.requestIds[1],
        orderId: fixture.orderId,
        idempotencyKey: randomUUID(),
        actorType: "reviewer",
        amountCents: 10_000,
        reason: "Concurrent test B",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const storedRefunds = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, fixture.paymentId));
    const storedExecutions = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.orderId, fixture.orderId));

    expect(storedRefunds).toHaveLength(1);
    expect(storedExecutions).toHaveLength(1);
  });

  it("rejects a refund larger than the captured payment", async () => {
    const fixture = await createFixture({ amountCents: 5_000 });

    await expect(
      executeRefund({
        customerId: fixture.customerId,
        supportRequestId: fixture.requestIds[0],
        orderId: fixture.orderId,
        idempotencyKey: randomUUID(),
        actorType: "reviewer",
        amountCents: 5_001,
        reason: "Unsafe amount test",
      }),
    ).rejects.toMatchObject({ code: "REFUND_EXCEEDS_PAYMENT" });

    const storedRefunds = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, fixture.paymentId));
    expect(storedRefunds).toHaveLength(0);
  });

  it("rejects cancellation after shipment", async () => {
    const fixture = await createFixture({ orderStatus: "shipped", shippedAt: new Date() });

    await expect(
      executeCancellation({
        customerId: fixture.customerId,
        supportRequestId: fixture.requestIds[0],
        orderId: fixture.orderId,
        idempotencyKey: randomUUID(),
        actorType: "reviewer",
        reason: "Too late",
      }),
    ).rejects.toMatchObject({ code: "ORDER_ALREADY_SHIPPED" });
  });

  it("does not reveal or mutate another customer's order", async () => {
    const fixture = await createFixture();

    await expect(
      executeRefund({
        customerId: fixture.otherCustomerId,
        supportRequestId: fixture.requestIds[0],
        orderId: fixture.orderId,
        idempotencyKey: randomUUID(),
        actorType: "reviewer",
        amountCents: 10_000,
        reason: "Ownership test",
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND_OR_NOT_OWNED" });

    const storedRefunds = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, fixture.paymentId));
    expect(storedRefunds).toHaveLength(0);
  });

  it("allows an agent to cancel only an untouched pending authorized order", async () => {
    const fixture = await createFixture({
      orderStatus: "pending",
      paymentStatus: "authorized",
      fulfillmentStartedAt: null,
    });

    const result = await executeCancellation({
      customerId: fixture.customerId,
      supportRequestId: fixture.requestIds[0],
      orderId: fixture.orderId,
      idempotencyKey: randomUUID(),
      actorType: "agent",
      reason: "Customer requested cancellation before fulfilment",
    });

    expect(result).toMatchObject({ orderStatus: "cancelled", paymentOutcome: "voided" });
  });

  it("executes exactly once when two reviewers approve the same task", async () => {
    const fixture = await createFixture();
    const reviewTaskId = randomUUID();
    const reviewerA = randomUUID();
    const reviewerB = randomUUID();

    await db.insert(reviewers).values([
      { id: reviewerA, name: "Reviewer A", email: `${reviewerA}@reviewer.test` },
      { id: reviewerB, name: "Reviewer B", email: `${reviewerB}@reviewer.test` },
    ]);
    await db.insert(reviewTasks).values({
      id: reviewTaskId,
      supportRequestId: fixture.requestIds[0],
      orderId: fixture.orderId,
      actionType: "refund",
      proposedPayload: {
        orderId: fixture.orderId,
        amountCents: 10_000,
        reason: "Approved concurrency test",
      },
      rationale: "Customer requested a full refund.",
      evidence: { paymentStatus: "captured" },
      escalationReason: "Refunds require human approval.",
    });

    const results = await Promise.allSettled([
      approveReview(reviewTaskId, { reviewerId: reviewerA, expectedVersion: 1 }),
      approveReview(reviewTaskId, { reviewerId: reviewerB, expectedVersion: 1 }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [storedReview] = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.id, reviewTaskId));
    const storedRefunds = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, fixture.paymentId));
    const storedExecutions = await db
      .select()
      .from(actionExecutions)
      .where(eq(actionExecutions.reviewTaskId, reviewTaskId));
    const storedDecisions = await db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.reviewTaskId, reviewTaskId));

    expect(storedReview.status).toBe("executed");
    expect(storedReview.version).toBe(2);
    expect(storedRefunds).toHaveLength(1);
    expect(storedExecutions).toHaveLength(1);
    expect(storedDecisions).toHaveLength(1);
  });

  it("persists a model-selected multi-turn tool loop and escalation", async () => {
    const fixture = await createFixture();
    const model = new ScriptedAgentModel([
      {
        responseId: "response_lookup",
        outputText: "",
        toolCalls: [
          {
            callId: "call_lookup",
            name: "lookup_order",
            arguments: JSON.stringify({ orderNumber: fixture.orderNumber }),
          },
        ],
      },
      {
        responseId: "response_refund",
        outputText: "",
        toolCalls: [
          {
            callId: "call_refund",
            name: "propose_refund",
            arguments: JSON.stringify({
              orderNumber: fixture.orderNumber,
              amountCents: 10_000,
              reason: "Customer requested a full refund",
            }),
          },
        ],
      },
      {
        responseId: "response_final",
        outputText: "Refund proposal verified and sent for human approval.",
        toolCalls: [],
      },
    ]);

    const result = await processSupportRequest(fixture.requestIds[0], model);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.agentRunId, result.runId));
    const [review] = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));

    expect(run.status).toBe("completed");
    expect(calls.map((call) => call.toolName)).toEqual(["lookup_order", "propose_refund"]);
    expect(calls.every((call) => call.status === "succeeded")).toBe(true);
    expect(review).toMatchObject({ actionType: "refund", status: "pending" });
    expect(request.status).toBe("needs_review");
  });

  it("requests information without creating an approval task when the order number is missing", async () => {
    const fixture = await createFixture();
    await db
      .update(supportRequests)
      .set({ message: "Please cancel my order." })
      .where(eq(supportRequests.id, fixture.requestIds[0]));

    const model = new ScriptedAgentModel([
      {
        responseId: "response_information",
        outputText: "",
        toolCalls: [
          {
            callId: "call_information",
            name: "request_information",
            arguments: JSON.stringify({
              reason: "Please provide the order number so the order can be verified.",
              missingFields: ["order_number"],
            }),
          },
        ],
      },
      {
        responseId: "response_information_final",
        outputText: "Please provide the order number so the cancellation can be checked.",
        toolCalls: [],
      },
    ]);

    await processSupportRequest(fixture.requestIds[0], model);
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));
    const reviews = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));

    expect(request).toMatchObject({
      status: "needs_information",
      outcomeSummary: "Please provide the order number so the order can be verified.",
    });
    expect(reviews).toHaveLength(0);
  });

  it("refuses an unknown or unowned order without creating an approval task", async () => {
    const fixture = await createFixture();
    const unknownOrderNumber = fixture.orderNumber + 10_000_000;
    await db
      .update(supportRequests)
      .set({ orderId: null, message: `Refund order ${unknownOrderNumber}` })
      .where(eq(supportRequests.id, fixture.requestIds[0]));
    const model = new ScriptedAgentModel([
      {
        responseId: "response_missing_order",
        outputText: "",
        toolCalls: [
          {
            callId: "call_missing_order",
            name: "lookup_order",
            arguments: JSON.stringify({ orderNumber: unknownOrderNumber }),
          },
        ],
      },
      {
        responseId: "response_missing_order_final",
        outputText: "No matching order was found for this customer. No action was taken.",
        toolCalls: [],
      },
    ]);

    await processSupportRequest(fixture.requestIds[0], model);
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));
    const reviews = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));

    expect(request.status).toBe("refused");
    expect(request.orderId).toBeNull();
    expect(reviews).toHaveLength(0);
  });

  it("refuses a policy-invalid cancellation without creating an approval task", async () => {
    const fixture = await createFixture({ orderStatus: "shipped", shippedAt: new Date() });
    const model = new ScriptedAgentModel([
      {
        responseId: "response_unsafe_cancel",
        outputText: "",
        toolCalls: [
          {
            callId: "call_unsafe_cancel",
            name: "request_cancellation",
            arguments: JSON.stringify({
              orderNumber: fixture.orderNumber,
              reason: "Customer requested cancellation",
            }),
          },
        ],
      },
      {
        responseId: "response_unsafe_cancel_final",
        outputText: "The order has already shipped and cannot be cancelled.",
        toolCalls: [],
      },
    ]);

    await processSupportRequest(fixture.requestIds[0], model);
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));
    const reviews = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));

    expect(request).toMatchObject({ status: "refused", outcomeSummary: "Order has already shipped." });
    expect(reviews).toHaveLength(0);
  });

  it("refuses an out-of-scope request without answering it or creating a review", async () => {
    const fixture = await createFixture();
    await db
      .update(supportRequests)
      .set({ message: "What is Python?" })
      .where(eq(supportRequests.id, fixture.requestIds[0]));

    const model = new ScriptedAgentModel([
      {
        responseId: "response_refusal",
        outputText: "",
        toolCalls: [
          {
            callId: "call_refusal",
            name: "refuse_request",
            arguments: JSON.stringify({
              code: "OUT_OF_SCOPE",
              reason: "This console only handles ecommerce order support requests.",
            }),
          },
        ],
      },
      {
        responseId: "response_refusal_final",
        outputText: "Python is a general-purpose programming language.",
        toolCalls: [],
      },
    ]);

    const result = await processSupportRequest(fixture.requestIds[0], model);
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    const reviews = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));

    expect(request).toMatchObject({
      status: "refused",
      outcomeSummary: "This console only handles ecommerce order support requests.",
    });
    expect(run.finalDecision).toMatchObject({
      summary: "This console only handles ecommerce order support requests.",
      rawOutput: "Python is a general-purpose programming language.",
    });
    expect(reviews).toHaveLength(0);
  });

  it("escalates a tool-free general answer instead of accepting it as an outcome", async () => {
    const fixture = await createFixture();
    await db
      .update(supportRequests)
      .set({ message: "What is Python?" })
      .where(eq(supportRequests.id, fixture.requestIds[0]));

    const model = new ScriptedAgentModel([
      {
        responseId: "response_general_knowledge",
        outputText: "Python is a general-purpose programming language.",
        toolCalls: [],
      },
    ]);

    const result = await processSupportRequest(fixture.requestIds[0], model);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, result.runId));
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.agentRunId, result.runId));
    const [review] = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.supportRequestId, fixture.requestIds[0]));
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, fixture.requestIds[0]));

    expect(calls).toHaveLength(0);
    expect(run.finalDecision).toMatchObject({
      summary: "Escalated because the agent did not select a verified support action.",
      rawOutput: "Python is a general-purpose programming language.",
      boundaryCode: "VERIFIED_SUPPORT_OUTCOME_REQUIRED",
    });
    expect(review).toMatchObject({
      actionType: "manual_review",
      status: "pending",
      escalationReason:
        "No verified ecommerce support outcome was selected; manual review is required.",
    });
    expect(request).toMatchObject({
      status: "needs_review",
      outcomeSummary:
        "No verified ecommerce support outcome was selected; manual review is required.",
    });
  });
});
