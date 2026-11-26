import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import {
  actionExecutions,
  orders,
  payments,
  refunds,
  reviewDecisions,
  reviewTasks,
  supportRequests,
} from "@/src/db/schema";

const ALICE_ID = "00000000-0000-4000-8000-000000000001";
const MAYA_ID = "00000000-0000-4000-8000-000000000101";
const THEO_ID = "00000000-0000-4000-8000-000000000102";

async function createPendingReview() {
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const supportRequestId = randomUUID();
  const reviewTaskId = randomUUID();
  const orderNumber = Math.floor(1_000_000 + Math.random() * 8_000_000);

  await db.insert(orders).values({
    id: orderId,
    orderNumber,
    customerId: ALICE_ID,
    status: "delivered",
    fulfillmentStartedAt: new Date(),
    deliveredAt: new Date(),
  });
  await db.insert(payments).values({
    id: paymentId,
    orderId,
    providerReference: `e2e_${paymentId}`,
    status: "captured",
    amountCents: 7_500,
    currency: "USD",
  });
  await db.insert(supportRequests).values({
    id: supportRequestId,
    customerId: ALICE_ID,
    orderId,
    message: `Please refund order ${orderNumber}.`,
    status: "needs_review",
  });
  await db.insert(reviewTasks).values({
    id: reviewTaskId,
    supportRequestId,
    orderId,
    actionType: "refund",
    proposedPayload: { orderId, amountCents: 7_500, reason: "E2E concurrent approval" },
    rationale: "The customer requested a full refund.",
    evidence: { paymentStatus: "captured", amountCents: 7_500 },
    escalationReason: "All refunds require human approval.",
  });

  return { orderId, paymentId, reviewTaskId };
}

test("two browser sessions execute a review exactly once", async ({ browser }) => {
  const fixture = await createPendingReview();
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  await Promise.all([
    firstPage.goto(`/reviews/${fixture.reviewTaskId}`),
    secondPage.goto(`/reviews/${fixture.reviewTaskId}`),
  ]);
  await firstPage.getByLabel("Reviewer").selectOption(MAYA_ID);
  await secondPage.getByLabel("Reviewer").selectOption(THEO_ID);

  await Promise.all([
    firstPage.getByRole("button", { name: "Approve & execute" }).click(),
    secondPage.getByRole("button", { name: "Approve & execute" }).click(),
  ]);

  await expect(firstPage.getByText(/Action committed|latest authoritative state/)).toBeVisible();
  await expect(secondPage.getByText(/Action committed|latest authoritative state/)).toBeVisible();

  const storedRefunds = await db
    .select()
    .from(refunds)
    .where(eq(refunds.paymentId, fixture.paymentId));
  const storedExecutions = await db
    .select()
    .from(actionExecutions)
    .where(eq(actionExecutions.reviewTaskId, fixture.reviewTaskId));
  const storedDecisions = await db
    .select()
    .from(reviewDecisions)
    .where(eq(reviewDecisions.reviewTaskId, fixture.reviewTaskId));

  expect(storedRefunds).toHaveLength(1);
  expect(storedExecutions).toHaveLength(1);
  expect(storedDecisions).toHaveLength(1);

  await firstContext.close();
  await secondContext.close();
});
