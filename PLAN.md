# Support Operations Console - Implementation Plan

This plan is the working checklist for the assessment. A box is checked only after the item is implemented and verified. The build order prioritizes the two pass/fail requirements: database-level concurrency safety and code-enforced guardrails.

## 0. Architecture and scope

- [x] Choose a modular monolith: Next.js, TypeScript, PostgreSQL.
- [x] Define the agent boundary: the model requests actions; deterministic code authorizes them.
- [x] Require human approval for refunds.
- [x] Permit only narrowly safe, pre-fulfilment cancellations to execute automatically.
- [x] Choose an explicit, persisted tool-calling loop instead of a single completion call.
- [x] Choose PostgreSQL transactions, row locks, conditional writes, and unique constraints for concurrency safety.
- [x] Choose Vercel for Next.js and Neon for managed PostgreSQL.
- [x] Record the final decisions and alternatives in `ARCHITECTURE.md`.

## 1. Project foundation

- [x] Scaffold the Next.js App Router application with strict TypeScript.
- [x] Add Tailwind CSS and a minimal accessible component foundation.
- [x] Add Drizzle ORM, PostgreSQL driver, Zod, and the OpenAI SDK.
- [x] Add Vitest and Playwright test configuration.
- [x] Add environment validation and `.env.example`.
- [x] Add Docker Compose for local PostgreSQL.
- [x] Add a production Dockerfile.
- [x] Add lint, type-check, test, migration, and seed scripts.

## 2. Database and seeded scenarios

- [x] Define customers and reviewer identities.
- [x] Define orders and payments with integer minor-unit money fields.
- [x] Define support requests and their lifecycle states.
- [x] Define agent runs and persisted tool calls.
- [x] Define review tasks and review decisions.
- [x] Define action attempts and successful action executions.
- [x] Define refunds as successful financial facts.
- [x] Add foreign keys, checks, indexes, and timestamps.
- [x] Add one-refund-per-payment uniqueness at the database level.
- [x] Add one-execution-per-review uniqueness at the database level.
- [x] Add payment refunded-amount bounds at the database level.
- [x] Add order cancellation/shipping consistency constraints.
- [x] Create and apply the first migration.
- [x] Seed normal, pending, shipped, already-refunded, and ownership-mismatch scenarios.

## 3. Guarded domain commands

- [x] Implement a transaction-aware refund command.
- [x] Lock the relevant payment/order rows before refund validation.
- [x] Reject non-positive and over-payment refund amounts.
- [x] Reject already-refunded payments.
- [x] Enforce request-customer ownership inside the command.
- [x] Persist the refund and action execution atomically.
- [x] Implement an atomic conditional cancellation command.
- [x] Reject shipped, cancelled, refunded, or otherwise non-cancellable orders.
- [x] Persist cancellation and action execution atomically.
- [x] Return typed domain conflicts without leaking sensitive records.
- [x] Ensure no route or tool can bypass these commands.

## 4. Concurrency verification

- [x] Integration test: two simultaneous refunds create exactly one refund row.
- [x] Integration test: the losing refund fails with a safe conflict.
- [x] Integration test: two simultaneous approvals execute exactly one action.
- [x] Integration test: the losing approval receives the latest review state.
- [x] Integration test: over-refund fails even when the domain command is called directly.
- [x] Integration test: shipped cancellation fails even when called directly.
- [x] Integration test: another customer's order is never exposed or mutated.

## 5. Deterministic policy gateway

- [x] Implement policy results: execute, require approval, refuse, or escalate.
- [x] Route every refund proposal to human approval.
- [x] Allow automatic cancellation only for the documented pre-fulfilment state.
- [x] Escalate ambiguous, unsupported, or unsafe actions.
- [x] Re-run all guardrails at approval time using current locked rows.
- [x] Keep authorization decisions independent from model-provided flags or prose.

## 6. Real agent loop and traceability

- [x] Define strict schemas for `lookup_order`.
- [x] Define strict schemas for `propose_refund`.
- [x] Define strict schemas for `request_cancellation`.
- [x] Define strict schemas for `escalate_to_human`.
- [x] Inject customer identity server-side rather than accepting it from the model.
- [x] Implement the Responses API function-calling loop.
- [x] Let the model choose tools; do not hardcode a tool sequence.
- [x] Disable parallel mutation tool calls.
- [x] Add maximum-turn and timeout limits.
- [x] Persist each tool call before execution and its result afterward.
- [x] Persist model, prompt version, run status, timestamps, and final decision.
- [x] Persist concise reviewer-facing rationale, not hidden chain-of-thought.
- [x] Make duplicate provider call IDs idempotent.
- [x] Convert model/API failures into visible human escalations.
- [x] Provide a deterministic fake model adapter for tests only.

## 7. HTTP API

- [x] `POST /api/support-requests`: create and process a request.
- [x] `GET /api/support-requests`: list the review queue with filters.
- [x] `GET /api/support-requests/:id`: return the full trace.
- [x] `GET /api/reviews/:id`: return current review, order, and guardrail context.
- [x] `POST /api/reviews/:id/approve`: lock, revalidate, execute, and return current state.
- [x] `POST /api/reviews/:id/reject`: lock, record reviewer decision, and return current state.
- [x] Use `409 Conflict` with current state for stale or competing decisions.
- [x] Validate all inputs and use consistent error envelopes.
- [x] Do not expose an unrestricted refund or cancellation endpoint.

## 8. Human support console

- [x] Create a queue view with status filters.
- [x] Show the original request, agent decision, outcome, and escalation reason.
- [x] Create a request trace view with the tool-call timeline.
- [x] Create a review workspace with current order and payment facts.
- [x] Show proposed action and a deterministic guardrail checklist.
- [x] Add reviewer identity selection for the demo environment.
- [x] Add Approve and Reject actions with optional notes.
- [x] Never display success before the server transaction commits.
- [x] Poll or refetch current state across browser sessions.
- [x] On `409`, replace stale local state and explain who acted and when.
- [x] Add clear loading, empty, failure, and conflict states.

## 9. End-to-end quality gates

- [x] Unit-test policy decisions and validation schemas.
- [x] Test the agent loop with scripted tool-call responses.
- [ ] Test queue and review API contracts.
- [ ] Playwright test: submit a refund request and approve it.
- [x] Playwright test: two browser sessions approve the same review.
- [x] Verify only one refund and one successful execution exist afterward.
- [x] Run lint with zero errors.
- [x] Run TypeScript checks with zero errors.
- [x] Run all unit and integration tests.
- [x] Run the production build.
- [x] Run a live local OpenAI smoke test and verify persisted model-selected tool calls.

## 10. Documentation and deployment

- [x] Write `ARCHITECTURE.md` (1-3 pages).
- [x] Identify the exact policy, guardrail, locking, and unique-constraint code paths.
- [x] Document hallucinated IDs, over-refunds, ownership mismatch, stale state, and provider failures.
- [x] Document build-versus-buy choices for queues, frameworks, observability, logging, and infrastructure.
- [x] Write local setup, migration, seed, test, and run instructions in `README.md`.
- [x] Document demo users, seeded orders, and reviewer test scenarios.
- [ ] Push the repository to public GitHub.
- [ ] Import the GitHub repository into Vercel and provision the Neon integration.
- [ ] Configure `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and application secrets.
- [ ] Apply migrations and seed the deployed database.
- [ ] Run smoke and concurrency tests against the deployed URL.
- [ ] Record the public repository and deployment URLs.

## 11. Submission answers

- [x] Prepare the key engineering decisions summary.
- [x] Prepare the AI-tools usage disclosure.
- [x] Prepare reviewer notes, including deliberate scope limits.
- [ ] Submit the repository URL.
- [ ] Submit the live deployment URL.

## Definition of done

The project is complete only when all of the following are true:

- [ ] The deployed application uses a real LLM-selected tool-calling loop.
- [x] Unsafe operations are rejected by application code regardless of the prompt.
- [x] Two concurrent refund attempts produce exactly one refund.
- [x] Two concurrent approvals produce exactly one action execution.
- [x] A stale reviewer sees the authoritative updated state.
- [x] The database can reconstruct the request, run, tools, review, and final outcome.
- [x] A reviewer can run the project locally from the README without undocumented steps.
