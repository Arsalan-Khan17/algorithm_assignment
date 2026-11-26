import "dotenv/config";
import { eq } from "drizzle-orm";
import { processSupportRequest } from "../src/agent/run-agent";
import { OpenAIResponsesModel } from "../src/agent/model";
import { db, sqlClient } from "../src/db/client";
import {
  agentRuns,
  reviewTasks,
  supportRequests,
  toolCalls,
} from "../src/db/schema";

const ALICE_ID = "00000000-0000-4000-8000-000000000001";
const modelName = process.env.OPENAI_MODEL ?? "gpt-5-mini";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY was not supplied to the smoke test.");
  }

  const [request] = await db
    .insert(supportRequests)
    .values({
      customerId: ALICE_ID,
      message: "I want a refund for order 1043.",
    })
    .returning({ id: supportRequests.id });

  const result = await processSupportRequest(
    request.id,
    new OpenAIResponsesModel(apiKey, modelName),
  );

  const [storedRequest] = await db
    .select({
      status: supportRequests.status,
      outcomeSummary: supportRequests.outcomeSummary,
    })
    .from(supportRequests)
    .where(eq(supportRequests.id, request.id));
  const [storedRun] = await db
    .select({ status: agentRuns.status, model: agentRuns.model })
    .from(agentRuns)
    .where(eq(agentRuns.id, result.runId));
  const storedToolCalls = await db
    .select({
      sequence: toolCalls.sequence,
      toolName: toolCalls.toolName,
      status: toolCalls.status,
    })
    .from(toolCalls)
    .where(eq(toolCalls.agentRunId, result.runId))
    .orderBy(toolCalls.sequence);
  const storedReviews = await db
    .select({ actionType: reviewTasks.actionType, status: reviewTasks.status })
    .from(reviewTasks)
    .where(eq(reviewTasks.supportRequestId, request.id));

  console.log(
    JSON.stringify({
      ok: true,
      requestId: request.id,
      request: storedRequest,
      run: storedRun,
      toolCalls: storedToolCalls,
      reviews: storedReviews,
      finalDecision: result.finalDecision,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.log(
      JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : "Unknown live agent failure.",
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
