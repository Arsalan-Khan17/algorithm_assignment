import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import { agentRuns, supportRequests, toolCalls } from "@/src/db/schema";
import { createReviewTask } from "@/src/domain/reviews/review-service";
import type { AgentModel, AgentToolOutput } from "./model";
import { OpenAIResponsesModel } from "./model";
import { AGENT_PROMPT_VERSION, SUPPORT_AGENT_INSTRUCTIONS } from "./prompt";
import { agentToolDefinitions, executeAgentTool } from "./tools";

const MAX_AGENT_TURNS = 6;

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  return z.record(z.string(), z.unknown()).parse(parsed);
}

function liveModel(): AgentModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for live agent runs.");
  }
  return new OpenAIResponsesModel(apiKey, process.env.OPENAI_MODEL ?? "gpt-5-mini");
}

export async function processSupportRequest(
  supportRequestId: string,
  providedModel?: AgentModel,
) {
  const [request] = await db
    .select()
    .from(supportRequests)
    .where(eq(supportRequests.id, supportRequestId))
    .limit(1);

  if (!request) {
    throw new Error("Support request was not found.");
  }

  await db
    .update(supportRequests)
    .set({
      status: "running",
      updatedAt: new Date(),
      version: sql`${supportRequests.version} + 1`,
    })
    .where(and(eq(supportRequests.id, request.id), eq(supportRequests.status, "queued")));

  const [run] = await db
    .insert(agentRuns)
    .values({
      supportRequestId: request.id,
      model: providedModel?.modelName ?? process.env.OPENAI_MODEL ?? "gpt-5-mini",
      promptVersion: AGENT_PROMPT_VERSION,
    })
    .returning();

  let previousResponseId: string | undefined;
  let toolOutputs: AgentToolOutput[] | undefined;
  let sequence = 0;

  try {
    const model = providedModel ?? liveModel();
    for (let turnNumber = 0; turnNumber < MAX_AGENT_TURNS; turnNumber += 1) {
      const turn = await model.createTurn({
        instructions: SUPPORT_AGENT_INSTRUCTIONS,
        requestMessage: previousResponseId ? undefined : request.message,
        previousResponseId,
        toolOutputs,
        tools: agentToolDefinitions,
      });

      previousResponseId = turn.responseId;
      await db
        .update(agentRuns)
        .set({ providerResponseId: turn.responseId })
        .where(eq(agentRuns.id, run.id));

      if (turn.toolCalls.length === 0) {
        const finalDecision = {
          summary: turn.outputText || "Agent completed without a textual summary.",
          turns: turnNumber + 1,
        };
        await db
          .update(agentRuns)
          .set({ status: "completed", finalDecision, completedAt: sql`now()` })
          .where(eq(agentRuns.id, run.id));

        const [currentRequest] = await db
          .select({ status: supportRequests.status })
          .from(supportRequests)
          .where(eq(supportRequests.id, request.id));
        if (currentRequest.status === "running") {
          await db
            .update(supportRequests)
            .set({
              status: "completed",
              outcomeSummary: finalDecision.summary,
              updatedAt: new Date(),
              version: sql`${supportRequests.version} + 1`,
            })
            .where(eq(supportRequests.id, request.id));
        }

        return { runId: run.id, finalDecision };
      }

      toolOutputs = [];
      for (const toolCall of turn.toolCalls) {
        sequence += 1;
        const argumentsObject = parseToolArguments(toolCall.arguments);
        const [inserted] = await db
          .insert(toolCalls)
          .values({
            agentRunId: run.id,
            providerCallId: toolCall.callId,
            sequence,
            toolName: toolCall.name,
            arguments: argumentsObject,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await db
            .select({ result: toolCalls.result, status: toolCalls.status })
            .from(toolCalls)
            .where(
              and(
                eq(toolCalls.agentRunId, run.id),
                eq(toolCalls.providerCallId, toolCall.callId),
              ),
            );
          if (existing?.status === "succeeded" && existing.result) {
            toolOutputs.push({ callId: toolCall.callId, output: existing.result });
            continue;
          }
          throw new Error(`Duplicate incomplete tool call ${toolCall.callId}`);
        }

        try {
          const result = await executeAgentTool(
            {
              supportRequestId: request.id,
              customerId: request.customerId,
              agentRunId: run.id,
            },
            toolCall.name,
            argumentsObject,
          );
          await db
            .update(toolCalls)
            .set({ status: "succeeded", result, completedAt: new Date() })
            .where(eq(toolCalls.id, inserted.id));
          toolOutputs.push({ callId: toolCall.callId, output: result });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown tool failure";
          await db
            .update(toolCalls)
            .set({
              status: "failed",
              result: { ok: false, error: message },
              errorMessage: message,
              completedAt: new Date(),
            })
            .where(eq(toolCalls.id, inserted.id));
          toolOutputs.push({ callId: toolCall.callId, output: { ok: false, error: message } });
        }
      }
    }

    throw new Error(`Agent exceeded the ${MAX_AGENT_TURNS}-turn limit.`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown agent failure";
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        errorCode: "AGENT_RUN_FAILED",
        errorMessage: message,
        completedAt: sql`now()`,
      })
      .where(eq(agentRuns.id, run.id));

    await createReviewTask({
      supportRequestId: request.id,
      orderId: request.orderId ?? undefined,
      actionType: "manual_review",
      proposedPayload: { requestedAction: "manual_review" },
      rationale: "The automated agent could not complete a reliable decision.",
      evidence: { agentRunId: run.id, errorCode: "AGENT_RUN_FAILED" },
      escalationReason: "Agent failure; manual review required.",
    });

    throw error;
  }
}
