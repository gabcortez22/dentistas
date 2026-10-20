import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};
export type LlmBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type LlmMessage = { role: "user" | "assistant"; content: LlmBlock[] };
export type LlmResponse = {
  blocks: LlmBlock[];
  stopReason: "end_turn" | "tool_use" | "other";
  inputTokens: number;
  outputTokens: number;
};
export interface LlmClient {
  complete(req: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDef[];
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}

/** Anthropic implementation. Confirm parameter names and the model id with the claude-api skill before production. */
export function anthropicLlm(): LlmClient {
  const { ANTHROPIC_API_KEY, AGENT_MODEL } = getEnv("anthropic");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return {
    async complete({ system, messages, tools, signal }) {
      const response = await client.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: 1024,
          system,
          messages: messages as Anthropic.MessageParam[],
          tools: tools as Anthropic.Tool[],
        },
        { signal },
      );
      const blocks: LlmBlock[] = [];
      for (const block of response.content) {
        if (block.type === "text") blocks.push({ type: "text", text: block.text });
        if (block.type === "tool_use") {
          blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
      }
      const stopReason =
        response.stop_reason === "tool_use"
          ? "tool_use"
          : response.stop_reason === "end_turn"
            ? "end_turn"
            : "other";
      return {
        blocks,
        stopReason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
