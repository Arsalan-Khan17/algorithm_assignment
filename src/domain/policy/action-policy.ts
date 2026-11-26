import type { CustomerOrderSnapshot } from "@/src/repositories/order-repository";

export type PolicyDecision =
  | { outcome: "execute"; reason: string }
  | { outcome: "require_approval"; reason: string }
  | { outcome: "refuse"; code: string; reason: string };

export function evaluateRefundPolicy(
  order: CustomerOrderSnapshot,
  amountCents: number,
): PolicyDecision {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { outcome: "refuse", code: "REFUND_AMOUNT_INVALID", reason: "Amount must be positive." };
  }

  if (
    order.status === "refunded" ||
    order.payment.status === "refunded" ||
    order.payment.refundedAmountCents > 0 ||
    order.payment.hasRefundRecord
  ) {
    return {
      outcome: "refuse",
      code: "REFUND_ALREADY_EXISTS",
      reason: "The order already has a refund.",
    };
  }

  if (order.payment.status !== "captured") {
    return {
      outcome: "refuse",
      code: "PAYMENT_NOT_CAPTURED",
      reason: "The payment is not captured and cannot be refunded.",
    };
  }

  const remainingCents = order.payment.amountCents - order.payment.refundedAmountCents;
  if (amountCents > remainingCents) {
    return {
      outcome: "refuse",
      code: "REFUND_EXCEEDS_PAYMENT",
      reason: `The requested refund exceeds the remaining ${remainingCents} ${order.payment.currency} cents.`,
    };
  }

  return {
    outcome: "require_approval",
    reason: "All refunds require a human reviewer before money moves.",
  };
}

export function evaluateCancellationPolicy(order: CustomerOrderSnapshot): PolicyDecision {
  if (order.status === "cancelled") {
    return { outcome: "refuse", code: "ORDER_ALREADY_CANCELLED", reason: "Order is already cancelled." };
  }

  if (order.status === "refunded" || order.payment.status === "refunded") {
    return { outcome: "refuse", code: "ORDER_ALREADY_REFUNDED", reason: "Order is already refunded." };
  }

  if (order.shippedAt || order.status === "shipped" || order.status === "delivered") {
    return { outcome: "refuse", code: "ORDER_ALREADY_SHIPPED", reason: "Order has already shipped." };
  }

  if (order.status !== "pending" && order.status !== "processing") {
    return {
      outcome: "refuse",
      code: "ORDER_NOT_CANCELLABLE",
      reason: "Order is not in a cancellable state.",
    };
  }

  if (
    order.status === "pending" &&
    order.fulfillmentStartedAt === null &&
    order.payment.status === "authorized"
  ) {
    return {
      outcome: "execute",
      reason: "Order is untouched and its payment is only authorized, so cancellation is reversible.",
    };
  }

  return {
    outcome: "require_approval",
    reason: "Fulfilment or captured funds require human review before cancellation.",
  };
}
