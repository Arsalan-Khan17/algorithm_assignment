import { describe, expect, it } from "vitest";
import {
  evaluateCancellationPolicy,
  evaluateRefundPolicy,
} from "@/src/domain/policy/action-policy";
import type { CustomerOrderSnapshot } from "@/src/repositories/order-repository";

function order(overrides: Partial<CustomerOrderSnapshot> = {}): CustomerOrderSnapshot {
  return {
    orderId: "00000000-0000-4000-8000-000000001043",
    orderNumber: 1043,
    status: "delivered",
    fulfillmentStartedAt: new Date(),
    shippedAt: new Date(),
    deliveredAt: new Date(),
    version: 1,
    payment: {
      id: "00000000-0000-4000-8000-000000011043",
      status: "captured",
      amountCents: 10_000,
      refundedAmountCents: 0,
      currency: "USD",
      hasRefundRecord: false,
    },
    ...overrides,
  };
}

describe("deterministic action policy", () => {
  it("always routes a valid refund to human approval", () => {
    expect(evaluateRefundPolicy(order(), 10_000)).toMatchObject({ outcome: "require_approval" });
  });

  it("refuses an over-refund before a review is created", () => {
    expect(evaluateRefundPolicy(order(), 10_001)).toMatchObject({
      outcome: "refuse",
      code: "REFUND_EXCEEDS_PAYMENT",
    });
  });

  it("permits autonomous cancellation only before fulfilment with authorized funds", () => {
    const safeOrder = order({
      status: "pending",
      fulfillmentStartedAt: null,
      shippedAt: null,
      deliveredAt: null,
      payment: {
        ...order().payment,
        status: "authorized",
      },
    });
    expect(evaluateCancellationPolicy(safeOrder)).toMatchObject({ outcome: "execute" });
  });

  it("refuses cancellation after shipping", () => {
    expect(evaluateCancellationPolicy(order({ status: "shipped" }))).toMatchObject({
      outcome: "refuse",
      code: "ORDER_ALREADY_SHIPPED",
    });
  });
});
