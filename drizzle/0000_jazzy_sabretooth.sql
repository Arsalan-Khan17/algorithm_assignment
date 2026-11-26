CREATE TYPE "public"."action_attempt_outcome" AS ENUM('succeeded', 'refused', 'conflict', 'failed');--> statement-breakpoint
CREATE TYPE "public"."action_type" AS ENUM('refund', 'cancel', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('agent', 'reviewer', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('captured', 'refunded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."review_decision_type" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'executed', 'rejected', 'conflicted');--> statement-breakpoint
CREATE TYPE "public"."support_request_status" AS ENUM('queued', 'running', 'needs_review', 'auto_executed', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('requested', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "action_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"support_request_id" uuid NOT NULL,
	"review_task_id" uuid,
	"order_id" uuid NOT NULL,
	"action_type" "action_type" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"input" jsonb NOT NULL,
	"outcome" "action_attempt_outcome" NOT NULL,
	"outcome_code" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"support_request_id" uuid NOT NULL,
	"review_task_id" uuid,
	"order_id" uuid NOT NULL,
	"action_type" "action_type" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"idempotency_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"support_request_id" uuid NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider_response_id" text,
	"final_decision" jsonb,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"fulfillment_started_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_version_positive" CHECK ("orders"."version" > 0),
	CONSTRAINT "orders_cancelled_not_shipped" CHECK (NOT ("orders"."status" = 'cancelled' AND "orders"."shipped_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_cents" integer NOT NULL,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_refunded_non_negative" CHECK ("payments"."refunded_amount_cents" >= 0),
	CONSTRAINT "payments_refund_within_captured_amount" CHECK ("payments"."refunded_amount_cents" <= "payments"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"action_execution_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_task_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_decision_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"support_request_id" uuid NOT NULL,
	"order_id" uuid,
	"action_type" "action_type" NOT NULL,
	"proposed_payload" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"escalation_reason" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"decided_by_reviewer_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_tasks_version_positive" CHECK ("review_tasks"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"message" text NOT NULL,
	"status" "support_request_status" DEFAULT 'queued' NOT NULL,
	"outcome_summary" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_requests_message_not_blank" CHECK (length(trim("support_requests"."message")) > 0),
	CONSTRAINT "support_requests_version_positive" CHECK ("support_requests"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"provider_call_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"result" jsonb,
	"status" "tool_call_status" DEFAULT 'requested' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_support_request_id_support_requests_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."support_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_review_task_id_review_tasks_id_fk" FOREIGN KEY ("review_task_id") REFERENCES "public"."review_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_attempts" ADD CONSTRAINT "action_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_support_request_id_support_requests_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."support_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_review_task_id_review_tasks_id_fk" FOREIGN KEY ("review_task_id") REFERENCES "public"."review_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_support_request_id_support_requests_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_action_execution_id_action_executions_id_fk" FOREIGN KEY ("action_execution_id") REFERENCES "public"."action_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_review_task_id_review_tasks_id_fk" FOREIGN KEY ("review_task_id") REFERENCES "public"."review_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewer_id_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_support_request_id_support_requests_id_fk" FOREIGN KEY ("support_request_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_decided_by_reviewer_id_reviewers_id_fk" FOREIGN KEY ("decided_by_reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_attempts_request_idx" ON "action_attempts" USING btree ("support_request_id","created_at");--> statement-breakpoint
CREATE INDEX "action_attempts_review_idx" ON "action_attempts" USING btree ("review_task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_executions_review_task_unique" ON "action_executions" USING btree ("review_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_executions_idempotency_key_unique" ON "action_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "action_executions_request_idx" ON "action_executions" USING btree ("support_request_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_request_id_idx" ON "agent_runs" USING btree ("support_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_unique" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_id_unique" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_reference_unique" ON "payments" USING btree ("provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_per_payment_unique" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_action_execution_unique" ON "refunds" USING btree ("action_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_decisions_task_unique" ON "review_decisions" USING btree ("review_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_tasks_request_unique" ON "review_tasks" USING btree ("support_request_id");--> statement-breakpoint
CREATE INDEX "review_tasks_status_created_idx" ON "review_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviewers_email_unique" ON "reviewers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "support_requests_status_created_idx" ON "support_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_customer_id_idx" ON "support_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_run_provider_call_unique" ON "tool_calls" USING btree ("agent_run_id","provider_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_run_sequence_unique" ON "tool_calls" USING btree ("agent_run_id","sequence");