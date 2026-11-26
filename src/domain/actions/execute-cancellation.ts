import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
import type { CancellationCommand, CancellationResult } from "./types";

export async function executeCancellationInTransaction(
  tx: DatabaseTransaction,
  command: CancellationCommand,
): Promise<CancellationResult> {
  const [locked] = await tx
    .select({
      orderId: orders.id,
      orderStatus: orders.status,
      orderVersion: orders.version,
      fulfillmentStartedAt: orders.fulfillmentStartedAt,
      shippedAt: orders.shippedAt,
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
    .select({ id: actionExecutions.id, result: actionExecutions.result })
    .from(actionExecutions)
    .where(eq(actionExecutions.idempotencyKey, command.idempotencyKey))
    .limit(1);

  if (priorExecution) {
    const result = priorExecution.result as { paymentOutcome?: "voided" | "refunded" };
    return {
      actionExecutionId: priorExecution.id,
      orderId: locked.orderId,
      orderStatus: "cancelled",
      paymentOutcome: result.paymentOutcome ?? "voided",
      idempotentReplay: true,
    };
  }

  if (locked.orderStatus === "cancelled") {
    throw new DomainError("ORDER_ALREADY_CANCELLED", "This order is already cancelled.");
  }

  if (locked.orderStatus === "refunded") {
    throw new DomainError("ORDER_ALREADY_REFUNDED", "A refunded order cannot be cancelled.");
  }

  if (locked.shippedAt || locked.orderStatus === "shipped" || locked.orderStatus === "delivered") {
    throw new DomainError("ORDER_ALREADY_SHIPPED", "An order that has shipped cannot be cancelled.");
  }

  if (locked.orderStatus !== "pending" && locked.orderStatus !== "processing") {
    throw new DomainError("ORDER_NOT_CANCELLABLE", "The order is not in a cancellable state.");
  }

  if (
    command.actorType === "agent" &&
    (locked.orderStatus !== "pending" || locked.fulfillmentStartedAt !== null)
  ) {
    throw new DomainError(
      "HUMAN_APPROVAL_REQUIRED",
      "Only untouched pending orders may be cancelled autonomously.",
    );
  }

  if (locked.paymentStatus === "refunded" || locked.refundedAmountCents > 0) {
    throw new DomainError("ORDER_ALREADY_REFUNDED", "This order's payment is already refunded.");
  }

  if (locked.paymentStatus === "voided") {
    throw new DomainError("PAYMENT_NOT_CANCELLABLE", "This payment is already voided.");
  }

  if (command.actorType === "agent" && locked.paymentStatus !== "authorized") {
    throw new DomainError(
      "HUMAN_APPROVAL_REQUIRED",
      "A captured payment requires human approval before cancellation.",
    );
  }

  if (locked.paymentStatus !== "authorized" && locked.paymentStatus !== "captured") {
    throw new DomainError("PAYMENT_NOT_CANCELLABLE", "The payment cannot be cancelled safely.");
  }

  const paymentOutcome = locked.paymentStatus === "authorized" ? "voided" : "refunded";
  const [execution] = await tx
    .insert(actionExecutions)
    .values({
      supportRequestId: command.supportRequestId,
      reviewTaskId: command.reviewTaskId ?? null,
      orderId: command.orderId,
      actionType: "cancel",
      actorType: command.actorType,
      actorId: command.actorId ?? null,
      idempotencyKey: command.idempotencyKey,
      input: { reason: command.reason },
      result: { status: "cancelled", paymentOutcome },
    })
    .returning({ id: actionExecutions.id });

  const [updatedOrder] = await tx
    .update(orders)
    .set({
      status: "cancelled",
      version: sql`${orders.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, command.orderId),
        eq(orders.customerId, command.customerId),
        eq(orders.version, locked.orderVersion),
        inArray(orders.status, ["pending", "processing"]),
        isNull(orders.shippedAt),
      ),
    )
    .returning({ id: orders.id });

  if (!updatedOrder) {
    throw new DomainError(
      "CONCURRENT_STATE_CHANGE",
      "The order changed while cancellation was being processed.",
    );
  }

  let refundId: string | undefined;
  if (paymentOutcome === "voided") {
    await tx
      .update(payments)
      .set({ status: "voided", updatedAt: new Date() })
      .where(eq(payments.id, locked.paymentId));
  } else {
    const [existingRefund] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.paymentId, locked.paymentId))
      .limit(1);

    if (existingRefund) {
      throw new DomainError("REFUND_ALREADY_EXISTS", "This payment has already been refunded.");
    }

    await tx
      .update(payments)
      .set({
        status: "refunded",
        refundedAmountCents: locked.amountCents,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, locked.paymentId));

    const [refund] = await tx
      .insert(refunds)
      .values({
        paymentId: locked.paymentId,
        orderId: locked.orderId,
        actionExecutionId: execution.id,
        amountCents: locked.amountCents,
        currency: locked.currency,
        reason: `Cancellation: ${command.reason}`,
      })
      .returning({ id: refunds.id });
    refundId = refund.id;
  }

  await tx.insert(actionAttempts).values({
    supportRequestId: command.supportRequestId,
    reviewTaskId: command.reviewTaskId ?? null,
    orderId: command.orderId,
    actionType: "cancel",
    actorType: command.actorType,
    actorId: command.actorId ?? null,
    input: { reason: command.reason },
    outcome: "succeeded",
    outcomeCode: "CANCELLATION_EXECUTED",
    message: `Order cancelled and payment ${paymentOutcome}.`,
  });

  return {
    actionExecutionId: execution.id,
    orderId: locked.orderId,
    orderStatus: "cancelled",
    paymentOutcome,
    ...(refundId ? { refundId } : {}),
    idempotentReplay: false,
  };
}

export async function executeCancellation(
  command: CancellationCommand,
): Promise<CancellationResult> {
  try {
    return await db.transaction((tx) => executeCancellationInTransaction(tx, command));
  } catch (error: unknown) {
    let normalized = error;
    if (!isDomainError(error) && postgresErrorCode(error) === "23505") {
      normalized = new DomainError(
        "ACTION_ALREADY_EXECUTED",
        "This cancellation was already executed.",
      );
    }

    await recordFailedActionAttempt("cancel", command, normalized);
    throw normalized;
  }
}
