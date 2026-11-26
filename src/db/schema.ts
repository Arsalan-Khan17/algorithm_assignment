import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const orderStatus = pgEnum("order_status", [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const paymentStatus = pgEnum("payment_status", [
  "authorized",
  "captured",
  "refunded",
  "voided",
]);

export const supportRequestStatus = pgEnum("support_request_status", [
  "queued",
  "running",
  "needs_review",
  "auto_executed",
  "completed",
  "failed",
]);

export const agentRunStatus = pgEnum("agent_run_status", ["running", "completed", "failed"]);

export const toolCallStatus = pgEnum("tool_call_status", ["requested", "succeeded", "failed"]);

export const actionType = pgEnum("action_type", ["refund", "cancel", "manual_review"]);

export const reviewStatus = pgEnum("review_status", [
  "pending",
  "executed",
  "rejected",
  "conflicted",
]);

export const reviewDecisionType = pgEnum("review_decision_type", ["approved", "rejected"]);

export const actorType = pgEnum("actor_type", ["agent", "reviewer", "system"]);

export const actionAttemptOutcome = pgEnum("action_attempt_outcome", [
  "succeeded",
  "refused",
  "conflict",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("customers_email_unique").on(table.email)],
);

export const reviewers = pgTable(
  "reviewers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("reviewers_email_unique").on(table.email)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: integer("order_number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: orderStatus("status").notNull(),
    fulfillmentStartedAt: timestamp("fulfillment_started_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("orders_order_number_unique").on(table.orderNumber),
    index("orders_customer_id_idx").on(table.customerId),
    check("orders_version_positive", sql`${table.version} > 0`),
    check(
      "orders_cancelled_not_shipped",
      sql`NOT (${table.status} = 'cancelled' AND ${table.shippedAt} IS NOT NULL)`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    providerReference: text("provider_reference").notNull(),
    status: paymentStatus("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    refundedAmountCents: integer("refunded_amount_cents").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payments_order_id_unique").on(table.orderId),
    uniqueIndex("payments_provider_reference_unique").on(table.providerReference),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
    check("payments_refunded_non_negative", sql`${table.refundedAmountCents} >= 0`),
    check(
      "payments_refund_within_captured_amount",
      sql`${table.refundedAmountCents} <= ${table.amountCents}`,
    ),
  ],
);

export const supportRequests = pgTable(
  "support_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    status: supportRequestStatus("status").default("queued").notNull(),
    outcomeSummary: text("outcome_summary"),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("support_requests_status_created_idx").on(table.status, table.createdAt),
    index("support_requests_customer_id_idx").on(table.customerId),
    check("support_requests_message_not_blank", sql`length(trim(${table.message})) > 0`),
    check("support_requests_version_positive", sql`${table.version} > 0`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supportRequestId: uuid("support_request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "cascade" }),
    status: agentRunStatus("status").default("running").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    providerResponseId: text("provider_response_id"),
    finalDecision: jsonb("final_decision").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agent_runs_request_id_idx").on(table.supportRequestId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    providerCallId: text("provider_call_id").notNull(),
    sequence: integer("sequence").notNull(),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    status: toolCallStatus("status").default("requested").notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tool_calls_run_provider_call_unique").on(
      table.agentRunId,
      table.providerCallId,
    ),
    uniqueIndex("tool_calls_run_sequence_unique").on(table.agentRunId, table.sequence),
  ],
);

export const reviewTasks = pgTable(
  "review_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supportRequestId: uuid("support_request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    actionType: actionType("action_type").notNull(),
    proposedPayload: jsonb("proposed_payload").$type<Record<string, unknown>>().notNull(),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    escalationReason: text("escalation_reason").notNull(),
    status: reviewStatus("status").default("pending").notNull(),
    version: integer("version").default(1).notNull(),
    decidedByReviewerId: uuid("decided_by_reviewer_id").references(() => reviewers.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("review_tasks_request_unique").on(table.supportRequestId),
    index("review_tasks_status_created_idx").on(table.status, table.createdAt),
    check("review_tasks_version_positive", sql`${table.version} > 0`),
  ],
);

export const reviewDecisions = pgTable(
  "review_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewTaskId: uuid("review_task_id")
      .notNull()
      .references(() => reviewTasks.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => reviewers.id, { onDelete: "restrict" }),
    decision: reviewDecisionType("decision").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("review_decisions_task_unique").on(table.reviewTaskId)],
);

export const actionAttempts = pgTable(
  "action_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supportRequestId: uuid("support_request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "restrict" }),
    reviewTaskId: uuid("review_task_id").references(() => reviewTasks.id, {
      onDelete: "restrict",
    }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    actionType: actionType("action_type").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    outcome: actionAttemptOutcome("outcome").notNull(),
    outcomeCode: text("outcome_code").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("action_attempts_request_idx").on(table.supportRequestId, table.createdAt),
    index("action_attempts_review_idx").on(table.reviewTaskId, table.createdAt),
  ],
);

export const actionExecutions = pgTable(
  "action_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supportRequestId: uuid("support_request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "restrict" }),
    reviewTaskId: uuid("review_task_id").references(() => reviewTasks.id, {
      onDelete: "restrict",
    }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    actionType: actionType("action_type").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("action_executions_review_task_unique").on(table.reviewTaskId),
    uniqueIndex("action_executions_idempotency_key_unique").on(table.idempotencyKey),
    index("action_executions_request_idx").on(table.supportRequestId, table.createdAt),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    actionExecutionId: uuid("action_execution_id")
      .notNull()
      .references(() => actionExecutions.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("refunds_one_per_payment_unique").on(table.paymentId),
    uniqueIndex("refunds_action_execution_unique").on(table.actionExecutionId),
    check("refunds_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type SupportRequest = typeof supportRequests.$inferSelect;
export type ReviewTask = typeof reviewTasks.$inferSelect;
