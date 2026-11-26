export type DomainErrorCode =
  | "ORDER_NOT_FOUND_OR_NOT_OWNED"
  | "ORDER_ALREADY_CANCELLED"
  | "ORDER_ALREADY_REFUNDED"
  | "ORDER_ALREADY_SHIPPED"
  | "ORDER_NOT_CANCELLABLE"
  | "PAYMENT_NOT_CAPTURED"
  | "PAYMENT_NOT_CANCELLABLE"
  | "REFUND_AMOUNT_INVALID"
  | "REFUND_EXCEEDS_PAYMENT"
  | "REFUND_ALREADY_EXISTS"
  | "ACTION_ALREADY_EXECUTED"
  | "HUMAN_APPROVAL_REQUIRED"
  | "CONCURRENT_STATE_CHANGE";

const conflictCodes = new Set<DomainErrorCode>([
  "ORDER_ALREADY_CANCELLED",
  "ORDER_ALREADY_REFUNDED",
  "ORDER_ALREADY_SHIPPED",
  "REFUND_ALREADY_EXISTS",
  "ACTION_ALREADY_EXECUTED",
  "CONCURRENT_STATE_CHANGE",
]);

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }

  get isConflict(): boolean {
    return conflictCodes.has(this.code);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}
