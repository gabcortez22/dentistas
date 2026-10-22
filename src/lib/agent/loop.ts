import type { LlmBlock, LlmClient, LlmMessage } from "@/lib/agent/llm";
import { systemPrompt } from "@/lib/agent/prompt";
import { withService } from "@/lib/db";
import { executeTool, TOOL_DEFS } from "@/server/agent-tools";

export const FALLBACK_TEXT = "Un miembro de nuestro equipo le responderá en breve.";
export type AgentDeps = { llm: LlmClient; now?: () => Date };

const MAX_MODEL_CALLS = 8;
const TIMEOUT_MS = 25_000;
const HISTORY_TURNS = 20;

async function saveTurn(
  conversationId: string,
  role: "user" | "assistant",
  content: LlmBlock[],
  tokens?: { input: number; output: number },
) {
  await withService((client) =>
    client.query(
      `insert into agent_turns (conversation_id, clinic_id, role, content, input_tokens, output_tokens)
       select id, clinic_id, $2, $3, $4, $5 from agent_conversations where id = $1`,
      [
        conversationId,
        role,
        JSON.stringify(content),
        tokens?.input ?? null,
        tokens?.output ?? null,
      ],
    ),
  );
}

const handoff = (conversationId: string) =>
  withService((client) =>
    client.query("update agent_conversations set status = 'handoff' where id = $1", [
      conversationId,
    ]),
  );

async function loadHistory(conversationId: string): Promise<LlmMessage[]> {
  const rows = await withService(
    async (client) =>
      (
        await client.query(
          "select role, content from (select id, role, content from agent_turns where conversation_id = $1 order by id desc limit $2) t order by id",
          [conversationId, HISTORY_TURNS],
        )
      ).rows,
  );
  const messages: LlmMessage[] = rows.map((r) => ({
    role: r.role,
    content: r.content as LlmBlock[],
  }));
  // Never start in the middle of a tool exchange: begin at the first user turn that carries text.
  while (
    messages.length > 0 &&
    !(messages[0]?.role === "user" && messages[0].content.some((b) => b.type === "text"))
  ) {
    messages.shift();
  }
  return messages;
}

export async function runAgent(
  deps: AgentDeps,
  conversationId: string,
  userText: string,
): Promise<string | null> {
  const now = deps.now ?? (() => new Date());
  const convo = await withService(
    async (client) =>
      (
        await client.query(
          "select c.status, k.name, k.timezone from agent_conversations c join clinics k on k.id = c.clinic_id where c.id = $1",
          [conversationId],
        )
      ).rows[0],
  );
  if (convo?.status !== "active") return null;

  await saveTurn(conversationId, "user", [{ type: "text", text: userText }]);
  const messages = await loadHistory(conversationId);
  const system = systemPrompt({ name: convo.name, timezone: convo.timezone }, now());

  try {
    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      const response = await deps.llm.complete({
        system,
        messages,
        tools: TOOL_DEFS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const assistant: LlmMessage = { role: "assistant", content: response.blocks };
      messages.push(assistant);
      await saveTurn(conversationId, "assistant", response.blocks, {
        input: response.inputTokens,
        output: response.outputTokens,
      });
      const uses = response.blocks.filter(
        (b): b is Extract<LlmBlock, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (response.stopReason !== "tool_use" || uses.length === 0) {
        const text = response.blocks
          .filter((b): b is Extract<LlmBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return text || FALLBACK_TEXT;
      }
      const results: LlmBlock[] = [];
      for (const use of uses) {
        const result = await executeTool({ conversationId, now }, use.name, use.input);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: "user", content: results });
      await saveTurn(conversationId, "user", results);
    }
  } catch {
    // model error or timeout: fall through to the human handoff below
  }
  await handoff(conversationId);
  return FALLBACK_TEXT;
}
