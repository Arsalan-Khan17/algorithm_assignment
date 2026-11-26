# Support Operations Console Architecture

## System overview

The application is a TypeScript modular monolith built with Next.js and PostgreSQL. Next.js serves the support dashboard and HTTP API. PostgreSQL is the source of truth for order state, payments, agent traces, reviews, and action execution. The AI model can request a tool call, but it cannot access the database or authorize its own write.

```text
Support request -> agent loop -> scoped tools -> policy gateway
                                             |-> guarded command -> PostgreSQL
                                             `-> review task -> reviewer -> guarded command
```

This is intentionally one deployable service. The domain, agent, persistence, and UI layers are separate modules, but splitting them into network services would add failure modes without improving the assessment's core guarantees.

## Agent boundary

The agent can autonomously retrieve a customer-scoped order, summarize relevant facts, create an escalation, and request an action. It can automatically cancel only an untouched `pending` order whose payment is still `authorized`. This operation voids the authorization and changes the order to `cancelled` in one transaction.

Every refund requires a human reviewer. A cancellation also requires review once fulfilment has started or funds have been captured. Shipped orders, over-refunds, duplicate refunds, ownership mismatches, and invalid states are refused.

This boundary is enforced outside the prompt in three layers:

1. `src/domain/policy/action-policy.ts` returns `execute`, `require_approval`, or `refuse` from trusted order facts. The model cannot supply this result.
2. `src/domain/actions/execute-refund.ts` and `execute-cancellation.ts` re-check ownership and current state inside a database transaction. The cancellation command additionally checks the actor type, so an agent cannot use the reviewer path.
3. `src/db/schema.ts` adds one-refund-per-payment and one-execution-per-review unique indexes, refunded-amount checks, and order-state checks.

Prompts improve model behavior but are not an authorization mechanism. There is no public unrestricted refund or cancellation endpoint.

Demo customer identity is selected in the UI and sent to the support-request API to make scenarios reproducible. The identity is then fixed on the request and injected into tools server-side; the model never supplies it. In production the same field would come from an authenticated customer session, not request JSON.

## Agent and tool design

`src/agent/run-agent.ts` implements an explicit Responses API loop. It sends the available tools, receives model-selected function calls, validates each argument, stores the call, executes application code, stores the result, and sends results back to the model. The loop stops on a final response, failure, timeout, or six-turn limit. Parallel tool calls are disabled to keep mutation ordering auditable.

Tools are deliberately narrow:

- `lookup_order(orderNumber)` returns a limited order/payment snapshot. Customer ID is injected from the persisted request. A foreign and missing order produce the same result.
- `propose_refund(orderNumber, amountCents, reason)` performs preflight policy checks and creates a review; it never moves money.
- `request_cancellation(orderNumber, reason)` lets policy decide between a safe automatic cancellation and review.
- `escalate_to_human(reason, summary, orderNumber)` creates a manual review when intent or support is insufficient.

The model sees order status, timestamps, captured/refunded minor-unit amounts, and currency. It does not see arbitrary customer records, payment credentials, provider tokens, reviewer records, or a database handle. Money is represented as integer cents.

The following trace is persisted: immutable customer request, model/prompt version, agent run status, provider response ID, every tool input/output, concise final summary, review proposal, reviewer decision, every action attempt, successful execution, and refund. Hidden model chain-of-thought is neither requested nor stored.

## Guardrails and concurrency

### Refund transaction

`executeRefundInTransaction` selects the customer-owned order and payment `FOR UPDATE`. It verifies a positive amount, captured payment, no prior refund, eligible order state, and amount no greater than the remaining captured funds. It then inserts the action execution and refund and updates payment/order state before commit.

`refunds_one_per_payment_unique` is the final duplicate defense. Even if a caller bypassed an earlier read or two application instances raced, PostgreSQL cannot commit two refund rows for one payment. `payments_refund_within_captured_amount` prevents the persisted refunded total from exceeding the captured amount.

### Reviewer transaction

`approveReview` locks the review row `FOR UPDATE`, verifies it is `pending` and matches the client's expected version, then invokes the guarded action using the same transaction. It records the decision and advances the review only after the action succeeds. `action_executions_review_task_unique` prevents a second execution for the same review.

If two reviewers approve simultaneously, one transaction locks and executes. The other waits, reads the newly committed `executed` state, and receives `409 Conflict`. The UI refetches the authoritative review and identifies who acted. It never renders success optimistically.

### Current-state honesty

Approval repeats all checks against locked current rows. The evidence shown by the agent is useful context, not a stale authorization snapshot. A newly shipped order or externally created refund causes the review to become conflicted rather than executing an unsafe action.

## Failure handling

- **Hallucinated order ID:** the customer-scoped lookup returns `ORDER_NOT_FOUND_OR_NOT_OWNED`; no mutation path receives a usable order.
- **Someone else's order:** every read and guarded command includes the persisted request customer ID. The response does not reveal whether the order exists for another customer.
- **Refund exceeds payment:** policy refuses it, and the transactional command independently raises `REFUND_EXCEEDS_PAYMENT`. A payment check constraint is the last defense.
- **Already refunded:** the locked payment state and refund row are checked; the unique index prevents a race.
- **Shipped cancellation:** the command rejects shipped/delivered states and non-null `shipped_at`; the conditional update repeats the predicate.
- **Stale reviewer:** expected version and row status return `409` with current state.
- **Model/API failure:** the run is stored as failed and the request becomes a visible manual review. The customer request is persisted before the model is called.
- **Repeated provider call ID:** `(agent_run_id, provider_call_id)` is unique. A completed result is replayed instead of executing again.
- **External payment failure:** this assessment uses a local financial ledger. A production provider call would use the action execution ID as its idempotency key and an outbox/reconciliation workflow.

## Build versus buy

What is built here: explicit agent loop, deterministic policy, PostgreSQL audit model, synchronous request processing, polling UI, structured HTTP errors, Docker local environment, and concurrency/integration tests. The assessment deployment uses Vercel for the Next.js application and Neon for managed PostgreSQL; the pooled database connection preserves the same transactional guardrails and unique constraints exercised locally.

At production scale I would add:

- A durable queue such as SQS or a managed workflow service so agent runs are retried independently of HTTP request lifetime.
- Managed PostgreSQL with connection pooling, automated backups, point-in-time recovery, and a read replica for analytics.
- Stripe or the store's payment provider with provider idempotency keys, a transactional outbox, webhooks, and reconciliation.
- OpenTelemetry traces and metrics, Sentry for application exceptions, and a searchable agent trace product such as Langfuse.
- Central structured logs with request, agent-run, review, and execution correlation IDs, with PII redaction and retention controls.
- Real customer and reviewer authentication with role-based authorization and immutable reviewer identity.
- A separate worker deployment once agent volume or provider latency makes synchronous processing unsuitable.

I would consider an agent SDK when the tool surface and handoffs become complex, but keep the policy gateway and domain commands independent of that framework. The small explicit loop is easier to audit for this product.

## Significant decisions

1. **PostgreSQL invariants over process locks.** In-memory mutexes and check-then-write code fail across instances. Row locks, conditional updates, and unique indexes make correctness a shared system property.
2. **Model proposes; code authorizes.** Giving the model a raw refund tool would make prompt quality a safety boundary. Narrow tools plus deterministic policy preserve useful autonomy without delegating authorization.
3. **Modular monolith over premature services.** Separate frontend, API, worker, and event services were rejected for this time-box. The current modules can be extracted later, while one container is easier to run, test, and deploy correctly.
