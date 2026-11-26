# Outpost submission draft

## Public GitHub repository

`https://github.com/Arsalan-Khan17/algorithm_assignment`

## Public application URL

`https://algorithm-assignment-two.vercel.app`

## Key engineering decisions

I treated the LLM as a planner rather than an authorization boundary. The model chooses customer-scoped tools in a persisted multi-turn Responses API loop, while deterministic TypeScript policy decides whether an action can execute, requires approval, or must be refused. Refunds always require a reviewer; only untouched pending orders with authorized payments can be cancelled automatically.

Concurrency guarantees are enforced in PostgreSQL. Refund and approval paths use transactions and `SELECT ... FOR UPDATE`, supported by unique indexes allowing one refund per payment and one execution per review. Every approval revalidates current order and payment state inside the locked transaction. A competing reviewer receives `409 Conflict` and the UI replaces stale state with the authoritative result.

I chose a modular Next.js monolith for the time-box: UI, API, domain, agent, and persistence remain separate modules while one deployable service keeps local setup and deployment reliable. The database stores the original request, agent run, every tool call/result, review proposal/decision, action attempts, execution, and refund.

## How I used AI tools

I used ChatGPT/Codex as an implementation partner for architecture review, code generation, database and concurrency design, test construction, documentation, deployment assistance, and visual QA. I retained responsibility for the system boundary and verified generated work with strict TypeScript, ESLint, sixteen unit/integration tests, a real PostgreSQL concurrency suite, a two-browser Playwright race test, a production build, and a deployed OpenAI tool-call trace. The repository includes `PLAN.md` so completed work and optional follow-ups are explicit.

## Reviewer notes

The dashboard uses seeded customer/reviewer selectors for a reproducible public demo. In production these identities must come from authenticated customer sessions and reviewer RBAC. The selected customer is persisted before the agent runs and injected into every tool and guarded command; the model cannot choose or replace it.

The assessment uses an internal payment ledger. A production refund integration would use the action execution ID as the payment-provider idempotency key plus an outbox/webhook reconciliation flow. Agent processing is synchronous for the assessment; production would put runs on a durable queue.

Unsupported requests are expected to use the `escalate_to_human` tool. The backend also requires a verified persisted support outcome before accepting final model prose, so a tool-free general answer is converted into a manual review even if the model ignores its prompt.

The exact guardrail and concurrency enforcement paths are identified in `ARCHITECTURE.md`, and the concurrency tests are in `tests/integration/action-guardrails.test.ts` and `tests/e2e/reviewer-concurrency.spec.ts`.
