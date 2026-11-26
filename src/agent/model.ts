import OpenAI from "openai";
import type { ResponseInputItem, Tool } from "openai/resources/responses/responses";

export type AgentFunctionDefinition = Extract<Tool, { type: "function" }>;

export type AgentToolCall = {
  callId: string;
  name: string;
  arguments: string;
};

export type AgentToolOutput = {
  callId: string;
  output: Record<string, unknown>;
};

export type AgentTurn = {
  responseId: string;
  outputText: string;
  toolCalls: AgentToolCall[];
};

export type AgentTurnInput = {
  instructions: string;
  requestMessage?: string;
  continuationMessage?: string;
  previousResponseId?: string;
  toolOutputs?: AgentToolOutput[];
  tools: AgentFunctionDefinition[];
};

export interface AgentModel {
  readonly modelName: string;
  createTurn(input: AgentTurnInput): Promise<AgentTurn>;
}

export class OpenAIResponsesModel implements AgentModel {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    public readonly modelName: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async createTurn(input: AgentTurnInput): Promise<AgentTurn> {
    const responseInput: string | ResponseInputItem[] = input.previousResponseId
      ? input.toolOutputs?.length
        ? input.toolOutputs.map((toolOutput) => ({
            type: "function_call_output" as const,
            call_id: toolOutput.callId,
            output: JSON.stringify(toolOutput.output),
          }))
        : (input.continuationMessage ?? "Continue to a verified terminal support outcome.")
      : (input.requestMessage ?? "");

    const response = await this.client.responses.create(
      {
        model: this.modelName,
        instructions: input.instructions,
        input: responseInput,
        tools: input.tools,
        tool_choice: "auto",
        parallel_tool_calls: false,
        previous_response_id: input.previousResponseId,
      },
      { signal: AbortSignal.timeout(30_000) },
    );

    return {
      responseId: response.id,
      outputText: response.output_text,
      toolCalls: response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          callId: item.call_id,
          name: item.name,
          arguments: item.arguments,
        })),
    };
  }
}

export class ScriptedAgentModel implements AgentModel {
  private cursor = 0;

  constructor(
    private readonly turns: AgentTurn[],
    public readonly modelName = "scripted-test-model",
  ) {}

  async createTurn(): Promise<AgentTurn> {
    const turn = this.turns[this.cursor];
    if (!turn) {
      throw new Error("Scripted model has no remaining turn.");
    }
    this.cursor += 1;
    return turn;
  }
}
