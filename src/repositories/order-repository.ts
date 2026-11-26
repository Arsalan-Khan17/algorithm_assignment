import { and, eq } from "drizzle-orm";
import { db, type DatabaseTransaction } from "@/src/db/client";
import { orders, payments, refunds } from "@/src/db/schema";

export type CustomerOrderSnapshot = {
  orderId: string;
  orderNumber: number;
  status: (typeof orders.$inferSelect)["status"];
  fulfillmentStartedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  version: number;
  payment: {
    id: string;
    status: (typeof payments.$inferSelect)["status"];
    amountCents: number;
    refundedAmountCents: number;
    currency: string;
    hasRefundRecord: boolean;
  };
};

export async function getOrderForCustomer(
  customerId: string,
  orderNumber: number,
  executor: typeof db | DatabaseTransaction = db,
): Promise<CustomerOrderSnapshot | null> {
  const [row] = await executor
    .select({
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
      refundId: refunds.id,
    })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .leftJoin(refunds, eq(refunds.paymentId, payments.id))
    .where(and(eq(orders.customerId, customerId), eq(orders.orderNumber, orderNumber)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    status: row.orderStatus,
    fulfillmentStartedAt: row.fulfillmentStartedAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    version: row.orderVersion,
    payment: {
      id: row.paymentId,
      status: row.paymentStatus,
      amountCents: row.amountCents,
      refundedAmountCents: row.refundedAmountCents,
      currency: row.currency,
      hasRefundRecord: row.refundId !== null,
    },
  };
}
