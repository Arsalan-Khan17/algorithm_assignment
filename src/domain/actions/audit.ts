import { actionAttempts } from "@/src/db/schema";
import { db } from "@/src/db/client";
import { DomainError, isDomainError } from "../errors";
import type { CancellationCommand, RefundCommand } from "./types";

type FailedCommand = RefundCommand | CancellationCommand;

function actionInput(command: FailedCommand): Record<string, unknown> {
  return {
    idempotencyKey: command.idempotencyKey,
    reason: command.reason,
    ...(typeof (command as RefundCommand).amountCents === "number"
      ? { amountCents: (command as RefundCommand).amountCents }
      : {}),
  };
}

export async function recordFailedActionAttempt(
  action: "refund" | "cancel",
  command: FailedCommand,
  error: unknown,
): Promise<void> {
  const normalized = isDomainError(error)
    ? error
    : new DomainError("CONCURRENT_STATE_CHANGE", "The action failed safely.");

  try {
    await db.insert(actionAttempts).values({
      supportRequestId: command.supportRequestId,
      reviewTaskId: command.reviewTaskId ?? null,
      orderId: command.orderId,
      actionType: action,
      actorType: command.actorType,
      actorId: command.actorId ?? null,
      input: actionInput(command),
      outcome: normalized.isConflict ? "conflict" : "refused",
      outcomeCode: normalized.code,
      message: normalized.message,
    });
  } catch {
    // The original failure remains authoritative. Audit is best-effort when the
    // referenced order does not exist or the database itself is unavailable.
  }
}
