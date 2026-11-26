import { and, eq, sql } from "drizzle-orm";
import { db, type DatabaseTransaction } from "@/src/db/client";
import {
  actionAttempts,
  actionExecutions,
  orders,
  payments,
  refunds,
} from "@/src/db/schema";
import { DomainError, isDomainError, postgresErrorCode } from "../errors";
import { recordFailedActionAttempt } from "./audit";
import type { RefundCommand, RefundResult } from "./types";

export async function executeRefundInTransaction(
  tx: DatabaseTransaction,
  command: RefundCommand,
): Promise<RefundResult> {
  if (!Number.isInteger(command.amountCents) || command.amountCents <= 0) {
    throw new DomainError("REFUND_AMOUNT_INVALID", "Refund amount must be a positive integer.");
  }

  const [locked] = await tx
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      paymentId: payments.id,
      paymentStatus: payments.status,
      amountCents: payments.amountCents,
      refundedAmountCents: payments.refundedAmountCents,
      currency: payments.currency,
    })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.id, command.orderId), eq(orders.customerId, command.customerId)))
    .for("update");

  if (!locked) {
    throw new DomainError(
      "ORDER_NOT_FOUND_OR_NOT_OWNED",
      "The order was not found for this customer.",
    );
  }

  const [priorExecution] = await tx
    .select({ id: actionExecutions.id })
    .from(actionExecutions)
    .where(eq(actionExecutions.idempotencyKey, command.idempotencyKey))
    .limit(1);

  if (priorExecution) {
    const [priorRefund] = await tx
      .select({ id: refunds.id, amountCents: refunds.amountCents, currency: refunds.currency })
      .from(refunds)
      .where(eq(refunds.actionExecutionId, priorExecution.id))
      .limit(1);

    if (priorRefund) {
      return {
        actionExecutionId: priorExecution.id,
        refundId: priorRefund.id,
        orderId: locked.orderId,
        amountCents: priorRefund.amountCents,
        currency: priorRefund.currency,
        idempotentReplay: true,
      };
    }

    throw new DomainError("ACTION_ALREADY_EXECUTED", "This action was already executed.");
  }

  const [existingRefund] = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.paymentId, locked.paymentId))
    .limit(1);

  if (existingRefund || locked.refundedAmountCents > 0 || locked.paymentStatus === "refunded") {
    throw new DomainError("REFUND_ALREADY_EXISTS", "This payment has already been refunded.");
  }

  if (locked.paymentStatus !== "captured") {
    throw new DomainError("PAYMENT_NOT_CAPTURED", "Only a captured payment can be refunded.");
  }

  if (locked.orderStatus === "cancelled") {
    throw new DomainError("ORDER_ALREADY_CANCELLED", "A cancelled order cannot be refunded here.");
  }

  if (locked.orderStatus === "refunded") {
    throw new DomainError("ORDER_ALREADY_REFUNDED", "This order is already marked as refunded.");
  }

  const remainingCents = locked.amountCents - locked.refundedAmountCents;
  if (command.amountCents > remainingCents) {
    throw new DomainError("REFUND_EXCEEDS_PAYMENT", "Refund amount exceeds the captured payment.", {
      requestedCents: command.amountCents,
      remainingCents,
    });
  }

  const [execution] = await tx
    .insert(actionExecutions)
    .values({
      supportRequestId: command.supportRequestId,
      reviewTaskId: command.reviewTaskId ?? null,
      orderId: command.orderId,
      actionType: "refund",
      actorType: command.actorType,
      actorId: command.actorId ?? null,
      idempotencyKey: command.idempotencyKey,
      input: { amountCents: command.amountCents, reason: command.reason },
      result: { status: "refunded", amountCents: command.amountCents },
    })
    .returning({ id: actionExecutions.id });

  const [refund] = await tx
    .insert(refunds)
    .values({
      paymentId: locked.paymentId,
      orderId: command.orderId,
      actionExecutionId: execution.id,
      amountCents: command.amountCents,
      currency: locked.currency,
      reason: command.reason,
    })
    .returning({ id: refunds.id });

  const isFullRefund = command.amountCents === remainingCents;
  await tx
    .update(payments)
    .set({
      refundedAmountCents: locked.refundedAmountCents + command.amountCents,
      status: isFullRefund ? "refunded" : "captured",
      updatedAt: new Date(),
    })
    .where(eq(payments.id, locked.paymentId));

  if (isFullRefund) {
    await tx
      .update(orders)
      .set({ status: "refunded", version: sql`${orders.version} + 1`, updatedAt: new Date() })
      .where(eq(orders.id, command.orderId));
  }

  await tx.insert(actionAttempts).values({
    supportRequestId: command.supportRequestId,
    reviewTaskId: command.reviewTaskId ?? null,
    orderId: command.orderId,
    actionType: "refund",
    actorType: command.actorType,
    actorId: command.actorId ?? null,
    input: { amountCents: command.amountCents, reason: command.reason },
    outcome: "succeeded",
    outcomeCode: "REFUND_EXECUTED",
    message: "Refund executed successfully.",
  });

  return {
    actionExecutionId: execution.id,
    refundId: refund.id,
    orderId: locked.orderId,
    amountCents: command.amountCents,
    currency: locked.currency,
    idempotentReplay: false,
  };
}

export async function executeRefund(command: RefundCommand): Promise<RefundResult> {
  try {
    return await db.transaction((tx) => executeRefundInTransaction(tx, command));
  } catch (error: unknown) {
    let normalized = error;
    if (!isDomainError(error) && postgresErrorCode(error) === "23505") {
      normalized = new DomainError("REFUND_ALREADY_EXISTS", "This payment has already been refunded.");
    }

    await recordFailedActionAttempt("refund", command, normalized);
    throw normalized;
  }
}
