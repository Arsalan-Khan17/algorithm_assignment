import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AgentFunctionDefinition } from "./model";
import { db } from "@/src/db/client";
import { supportRequests } from "@/src/db/schema";
import { getOrderForCustomer } from "@/src/repositories/order-repository";
import {
  evaluateCancellationPolicy,
  evaluateRefundPolicy,
} from "@/src/domain/policy/action-policy";
import { createReviewTask } from "@/src/domain/reviews/review-service";
import { executeCancellation } from "@/src/domain/actions/execute-cancellation";

const lookupOrderInput = z.object({ orderNumber: z.number().int().positive() });
const refundInput = z.object({
  orderNumber: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});
const cancellationInput = z.object({
  orderNumber: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});
const escalationInput = z.object({
  reason: z.string().trim().min(3).max(500),
  summary: z.string().trim().min(3).max(1_000),
  orderNumber: z.number().int().positive().nullable(),
});
const informationInput = z.object({
  reason: z.string().trim().min(3).max(500),
  missingFields: z.array(z.enum(["order_number"])).min(1).max(1),
});
const refusalInput = z.object({
  code: z.enum(["OUT_OF_SCOPE", "UNSUPPORTED_REQUEST"]),
  reason: z.string().trim().min(3).max(500),
});

export const agentToolDefinitions: AgentFunctionDefinition[] = [
  {
    type: "function",
    name: "lookup_order",
    description: "Look up an order that belongs to the authenticated customer.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderNumber: { type: "integer", minimum: 1 } },
      required: ["orderNumber"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "propose_refund",
    description: "Request a guarded refund. The policy layer will require human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderNumber: { type: "integer", minimum: 1 },
        amountCents: { type: "integer", minimum: 1 },
        reason: { type: "string" },
      },
      required: ["orderNumber", "amountCents", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "request_cancellation",
    description: "Request a guarded order cancellation. Policy decides execution versus review.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        orderNumber: { type: "integer", minimum: 1 },
        reason: { type: "string" },
      },
      required: ["orderNumber", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "request_information",
    description:
      "Request missing or unambiguous information needed for a supported ecommerce action. Use this when an order number is absent or ambiguous.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        missingFields: {
          type: "array",
          items: { type: "string", enum: ["order_number"] },
          minItems: 1,
          maxItems: 1,
        },
      },
      required: ["reason", "missingFields"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "refuse_request",
    description:
      "Refuse an unrelated or unsupported request without answering it or creating a financial review.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", enum: ["OUT_OF_SCOPE", "UNSUPPORTED_REQUEST"] },
        reason: { type: "string" },
      },
      required: ["code", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "escalate_to_human",
    description:
      "Create a human review for an identified ecommerce case that cannot be resolved safely by another tool.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        summary: { type: "string" },
        orderNumber: { type: ["integer", "null"] },
      },
      required: ["reason", "summary", "orderNumber"],
      additionalProperties: false,
    },
  },
];

export type AgentToolContext = {
  supportRequestId: string;
  customerId: string;
  agentRunId: string;
};

async function linkOrderToRequest(supportRequestId: string, orderId: string) {
  await db
    .update(supportRequests)
    .set({ orderId, updatedAt: new Date(), version: sql`${supportRequests.version} + 1` })
    .where(eq(supportRequests.id, supportRequestId));
}

async function resolveWithoutAction(
  context: AgentToolContext,
  status: "needs_information" | "refused",
  outcomeSummary: string,
) {
  await db
    .update(supportRequests)
    .set({
      status,
      outcomeSummary,
      updatedAt: new Date(),
      version: sql`${supportRequests.version} + 1`,
    })
    .where(
      and(
        eq(supportRequests.id, context.supportRequestId),
        eq(supportRequests.status, "running"),
      ),
    );
}

async function refuseMissingOrder(context: AgentToolContext) {
  const reason = "No matching order was found for this customer. No action was taken.";
  await resolveWithoutAction(context, "refused", reason);
  return {
    accepted: false,
    outcome: "refused",
    code: "ORDER_NOT_FOUND_OR_NOT_OWNED",
    reason,
  };
}

async function findOrder(context: AgentToolContext, orderNumber: number) {
  const order = await getOrderForCustomer(context.customerId, orderNumber);
  if (order) {
    await linkOrderToRequest(context.supportRequestId, order.orderId);
  }
  return order;
}

export async function executeAgentTool(
  context: AgentToolContext,
  name: string,
  rawArguments: unknown,
): Promise<Record<string, unknown>> {
  const [currentRequest] = await db
    .select({ status: supportRequests.status, outcomeSummary: supportRequests.outcomeSummary })
    .from(supportRequests)
    .where(eq(supportRequests.id, context.supportRequestId))
    .limit(1);

  if (!currentRequest || currentRequest.status !== "running") {
    return {
      accepted: false,
      outcome: "already_resolved",
      status: currentRequest?.status ?? "missing",
      reason: currentRequest?.outcomeSummary ?? "The support request is no longer actionable.",
    };
  }

  if (name === "lookup_order") {
    const input = lookupOrderInput.parse(rawArguments);
    const order = await findOrder(context, input.orderNumber);
    return order ? { found: true, order } : { found: false, ...(await refuseMissingOrder(context)) };
  }

  if (name === "propose_refund") {
    const input = refundInput.parse(rawArguments);
    const order = await findOrder(context, input.orderNumber);
    if (!order) {
      return refuseMissingOrder(context);
    }

    const policy = evaluateRefundPolicy(order, input.amountCents);
    if (policy.outcome === "refuse") {
      await resolveWithoutAction(context, "refused", policy.reason);
      return { accepted: false, outcome: "refused", code: policy.code, reason: policy.reason };
    }

    const review = await createReviewTask({
      supportRequestId: context.supportRequestId,
      orderId: order.orderId,
      actionType: "refund",
      proposedPayload: {
        orderId: order.orderId,
        amountCents: input.amountCents,
        reason: input.reason,
      },
      rationale: "Customer requested a refund and the order/payment facts were verified.",
      evidence: { order },
      escalationReason: policy.reason,
    });
    return {
      accepted: true,
      outcome: "requires_human_approval",
      reviewTaskId: review.id,
      reason: policy.reason,
    };
  }

  if (name === "request_cancellation") {
    const input = cancellationInput.parse(rawArguments);
    const order = await findOrder(context, input.orderNumber);
    if (!order) {
      return refuseMissingOrder(context);
    }

    const policy = evaluateCancellationPolicy(order);
    if (policy.outcome === "refuse") {
      await resolveWithoutAction(context, "refused", policy.reason);
      return { accepted: false, outcome: "refused", code: policy.code, reason: policy.reason };
    }

    if (policy.outcome === "execute") {
      const result = await executeCancellation({
        customerId: context.customerId,
        supportRequestId: context.supportRequestId,
        orderId: order.orderId,
        idempotencyKey: `agent:${context.agentRunId}:cancel:${order.orderId}`,
        actorType: "agent",
        actorId: context.agentRunId,
        reason: input.reason,
      });
      await db
        .update(supportRequests)
        .set({
          status: "auto_executed",
          outcomeSummary: "Safe pre-fulfilment cancellation executed automatically.",
          updatedAt: new Date(),
          version: sql`${supportRequests.version} + 1`,
        })
        .where(eq(supportRequests.id, context.supportRequestId));
      return { accepted: true, outcome: "executed_automatically", result };
    }

    const review = await createReviewTask({
      supportRequestId: context.supportRequestId,
      orderId: order.orderId,
      actionType: "cancel",
      proposedPayload: { orderId: order.orderId, reason: input.reason },
      rationale: "Customer requested cancellation and the current order state was verified.",
      evidence: { order },
      escalationReason: policy.reason,
    });
    return {
      accepted: true,
      outcome: "requires_human_approval",
      reviewTaskId: review.id,
      reason: policy.reason,
    };
  }

  if (name === "request_information") {
    const input = informationInput.parse(rawArguments);
    await resolveWithoutAction(context, "needs_information", input.reason);
    return {
      accepted: true,
      outcome: "needs_information",
      missingFields: input.missingFields,
      reason: input.reason,
    };
  }

  if (name === "refuse_request") {
    const input = refusalInput.parse(rawArguments);
    await resolveWithoutAction(context, "refused", input.reason);
    return { accepted: true, outcome: "refused", code: input.code, reason: input.reason };
  }

  if (name === "escalate_to_human") {
    const input = escalationInput.parse(rawArguments);
    const order = input.orderNumber
      ? await findOrder(context, input.orderNumber)
      : null;
    const review = await createReviewTask({
      supportRequestId: context.supportRequestId,
      orderId: order?.orderId,
      actionType: "manual_review",
      proposedPayload: { requestedAction: "manual_review", orderNumber: input.orderNumber },
      rationale: input.summary,
      evidence: order ? { order } : {},
      escalationReason: input.reason,
    });
    return { accepted: true, outcome: "escalated", reviewTaskId: review.id };
  }

  throw new Error(`Unknown agent tool: ${name}`);
}
