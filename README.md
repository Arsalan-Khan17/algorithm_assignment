# Support Operations Console

A human-centered support dashboard backed by a real AI tool-calling loop, deterministic action guardrails, and PostgreSQL concurrency controls.

## What it demonstrates

- The LLM chooses which order, information, refusal, refund, cancellation, or escalation tools to call over multiple turns.
- Missing identifiers become `needs_information`; unknown/unowned orders and deterministic policy failures become `refused`; neither creates an approval task.
- General-chat answers are not accepted as support outcomes; unsupported requests are refused by a constrained tool or caught by a code-enforced terminal-state boundary.
- Refunds always require human approval.
- Only untouched pending orders with authorized payments can be cancelled automatically.
- Guardrails are enforced in domain code and reinforced by database constraints.
- Concurrent refunds and concurrent reviewer approvals execute exactly once.
- Requests, agent runs, tool calls, reviews, attempts, executions, and refunds are auditable in PostgreSQL.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for boundaries, tradeoffs, and exact enforcement paths. Progress is tracked in [PLAN.md](./PLAN.md).

## Stack

- Next.js App Router, React, and TypeScript
- PostgreSQL 17, Drizzle ORM, and `postgres.js`
- OpenAI Responses API
- Zod validation
- Vitest integration tests and Playwright browser tests
- Docker Compose locally; Vercel plus Neon deployment

## Prerequisites

- Node.js 22 or newer
- Docker Desktop or another Docker Engine
- An OpenAI API key for live agent runs

## Local setup

1. Install dependencies.

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env` and set at least:

   ```dotenv
   DATABASE_URL=postgresql://support:support@localhost:5432/support_console
   OPENAI_API_KEY=your-key
   OPENAI_MODEL=your-tool-capable-model
   APP_URL=http://localhost:3000
   ```

   If `OPENAI_API_KEY` is absent, requests are still persisted and safely escalated as agent failures. Integration tests use a deterministic model adapter and do not require a key.

3. Start PostgreSQL, apply migrations, and seed demo records.

   ```bash
   docker compose up -d postgres
   npm run db:migrate
   npm run db:seed
   ```

4. Start the application.

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Seeded scenarios

Use the simulated customer selector as Alice unless noted.

| Order | Customer | State | Payment | Useful request |
|---|---|---|---|---|
| 1043 | Alice | Delivered | Captured, $129.99 | `I want a refund for order 1043.` |
| 1044 | Alice | Pending, untouched | Authorized, $45.99 | `Cancel order 1044.` |
| 1045 | Alice | Shipped | Captured, $89.99 | `Cancel order 1045.` |
| 1046 | Bob | Processing | Captured, $20.99 | Ask for 1046 while acting as Alice to test ownership |
| 1047 | Alice | Refunded | Refunded, $32.99 | `Refund order 1047 again.` |

Expected behavior:

- Order 1043 produces a human refund review.
- Order 1044 may be cancelled automatically; its authorization is voided atomically.
- Order 1045 cancellation is refused without creating an approval task.
- Alice cannot retrieve Bob's order 1046.
- Order 1047 cannot be refunded twice.

## Commands

```bash
npm run dev               # development server
npm run build             # production build
npm start                 # production server
npm run lint              # ESLint
npm run typecheck         # strict TypeScript
npm test                  # all Vitest tests
npm run test:integration  # PostgreSQL guardrail/concurrency tests
npm run test:e2e          # two-browser reviewer concurrency test
npm run db:generate       # generate migration after schema changes
npm run db:migrate        # apply migrations
npm run db:seed           # idempotently add demo scenarios
```

The integration and browser tests require the local PostgreSQL container and migrated schema. Install Playwright Chromium once with `npx playwright install chromium`.

## Concurrency tests

`tests/integration/action-guardrails.test.ts` sends two refund commands concurrently and asserts one fulfilled command, one safe conflict, one `refunds` row, and one `action_executions` row.

`tests/e2e/reviewer-concurrency.spec.ts` opens the same review in two independent browser contexts and approves simultaneously as different reviewers. It asserts exactly one decision, one execution, and one refund.

The guarantees do not depend on test timing:

- `SELECT ... FOR UPDATE` serializes changes to a payment or review.
- `refunds_one_per_payment_unique` prevents duplicate refunds.
- `action_executions_review_task_unique` prevents duplicate review execution.
- Approval re-runs all guardrails inside the locked transaction.

## API surface

- `POST /api/support-requests`
- `GET /api/support-requests`
- `GET /api/support-requests/:id`
- `GET /api/reviews/:id`
- `POST /api/reviews/:id/approve`
- `POST /api/reviews/:id/reject`

There is deliberately no unrestricted refund or cancellation endpoint.

## Demo identity limitation

The assessment UI uses seeded customer and reviewer selectors so scenarios are easy to reproduce. The selected customer is persisted on request creation and then injected into every agent tool and guarded command; the LLM cannot change it. A production deployment must replace the selector and request field with authenticated sessions and role-based reviewer authorization.

## Vercel deployment

1. Push the repository to GitHub.
2. Import it as a Vercel project; the framework preset should resolve to Next.js.
3. From the Vercel project, add the native Neon integration and connect it to all deployment environments. Confirm that its pooled connection string is available as `DATABASE_URL`.
4. Add `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5-mini`, and `APP_URL` in Vercel project settings. Set `APP_URL` to the production domain.
5. Set the Vercel build command to `npm run db:migrate && npm run build` so schema migrations run before each release.
6. Run `npm run db:seed` once with the production `DATABASE_URL` to add the assessment scenarios. The seed is idempotent.
7. Deploy and run the smoke, guardrail, and concurrency scenarios against the public domain.

The support-request route explicitly allows up to 240 seconds for the bounded synchronous agent loop. Fluid Compute must remain enabled. The current path normally completes in a few seconds; a production system should enqueue agent work and return immediately.

The provided Dockerfile remains a portable fallback and is also useful for self-hosting, but it is not required by Vercel.
