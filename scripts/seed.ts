import "dotenv/config";
import {
  actionExecutions,
  customers,
  orders,
  payments,
  refunds,
  reviewers,
  supportRequests,
} from "../src/db/schema";
import { db, sqlClient } from "../src/db/client";

const ids = {
  alice: "00000000-0000-4000-8000-000000000001",
  bob: "00000000-0000-4000-8000-000000000002",
  reviewerMaya: "00000000-0000-4000-8000-000000000101",
  reviewerTheo: "00000000-0000-4000-8000-000000000102",
  order1043: "00000000-0000-4000-8000-000000001043",
  order1044: "00000000-0000-4000-8000-000000001044",
  order1045: "00000000-0000-4000-8000-000000001045",
  order1046: "00000000-0000-4000-8000-000000001046",
  order1047: "00000000-0000-4000-8000-000000001047",
  payment1043: "00000000-0000-4000-8000-000000011043",
  payment1044: "00000000-0000-4000-8000-000000011044",
  payment1045: "00000000-0000-4000-8000-000000011045",
  payment1046: "00000000-0000-4000-8000-000000011046",
  payment1047: "00000000-0000-4000-8000-000000011047",
  priorRequest: "00000000-0000-4000-8000-000000020047",
  priorExecution: "00000000-0000-4000-8000-000000030047",
  priorRefund: "00000000-0000-4000-8000-000000040047",
} as const;

async function main() {
  await db
    .insert(customers)
    .values([
      { id: ids.alice, name: "Alice Morgan", email: "alice@example.com" },
      { id: ids.bob, name: "Bob Chen", email: "bob@example.com" },
    ])
    .onConflictDoNothing();

  await db
    .insert(reviewers)
    .values([
      { id: ids.reviewerMaya, name: "Maya Patel", email: "maya@store.example" },
      { id: ids.reviewerTheo, name: "Theo Martin", email: "theo@store.example" },
    ])
    .onConflictDoNothing();

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000);

  await db
    .insert(orders)
    .values([
      {
        id: ids.order1043,
        orderNumber: 1043,
        customerId: ids.alice,
        status: "delivered",
        fulfillmentStartedAt: threeDaysAgo,
        shippedAt: threeDaysAgo,
        deliveredAt: yesterday,
      },
      {
        id: ids.order1044,
        orderNumber: 1044,
        customerId: ids.alice,
        status: "pending",
      },
      {
        id: ids.order1045,
        orderNumber: 1045,
        customerId: ids.alice,
        status: "shipped",
        fulfillmentStartedAt: threeDaysAgo,
        shippedAt: yesterday,
      },
      {
        id: ids.order1046,
        orderNumber: 1046,
        customerId: ids.bob,
        status: "processing",
        fulfillmentStartedAt: yesterday,
      },
      {
        id: ids.order1047,
        orderNumber: 1047,
        customerId: ids.alice,
        status: "refunded",
        fulfillmentStartedAt: threeDaysAgo,
        shippedAt: threeDaysAgo,
        deliveredAt: yesterday,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(payments)
    .values([
      {
        id: ids.payment1043,
        orderId: ids.order1043,
        providerReference: "pay_demo_1043",
        status: "captured",
        amountCents: 12_999,
        currency: "USD",
      },
      {
        id: ids.payment1044,
        orderId: ids.order1044,
        providerReference: "pay_demo_1044",
        status: "authorized",
        amountCents: 4_599,
        currency: "USD",
      },
      {
        id: ids.payment1045,
        orderId: ids.order1045,
        providerReference: "pay_demo_1045",
        status: "captured",
        amountCents: 8_999,
        currency: "USD",
      },
      {
        id: ids.payment1046,
        orderId: ids.order1046,
        providerReference: "pay_demo_1046",
        status: "captured",
        amountCents: 2_099,
        currency: "USD",
      },
      {
        id: ids.payment1047,
        orderId: ids.order1047,
        providerReference: "pay_demo_1047",
        status: "refunded",
        amountCents: 3_299,
        refundedAmountCents: 3_299,
        currency: "USD",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(supportRequests)
    .values({
      id: ids.priorRequest,
      customerId: ids.alice,
      orderId: ids.order1047,
      message: "Please refund order 1047.",
      status: "completed",
      outcomeSummary: "Refund completed before this demo session.",
    })
    .onConflictDoNothing();

  await db
    .insert(actionExecutions)
    .values({
      id: ids.priorExecution,
      supportRequestId: ids.priorRequest,
      orderId: ids.order1047,
      actionType: "refund",
      actorType: "reviewer",
      actorId: ids.reviewerMaya,
      idempotencyKey: "seed-refund-order-1047",
      input: { amountCents: 3_299, reason: "Seeded previous refund" },
      result: { status: "refunded" },
    })
    .onConflictDoNothing();

  await db
    .insert(refunds)
    .values({
      id: ids.priorRefund,
      paymentId: ids.payment1047,
      orderId: ids.order1047,
      actionExecutionId: ids.priorExecution,
      amountCents: 3_299,
      currency: "USD",
      reason: "Seeded previous refund",
    })
    .onConflictDoNothing();

  console.log("Seeded customers, reviewers, and orders 1043-1047.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
