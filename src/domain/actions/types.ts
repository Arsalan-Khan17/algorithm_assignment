export type ActionActor = {
  actorType: "agent" | "reviewer" | "system";
  actorId?: string;
};

export type ActionContext = ActionActor & {
  customerId: string;
  supportRequestId: string;
  reviewTaskId?: string;
  orderId: string;
  idempotencyKey: string;
};

export type RefundCommand = ActionContext & {
  amountCents: number;
  reason: string;
};

export type CancellationCommand = ActionContext & {
  reason: string;
};

export type RefundResult = {
  actionExecutionId: string;
  refundId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  idempotentReplay: boolean;
};

export type CancellationResult = {
  actionExecutionId: string;
  orderId: string;
  orderStatus: "cancelled";
  paymentOutcome: "voided" | "refunded";
  refundId?: string;
  idempotentReplay: boolean;
};
