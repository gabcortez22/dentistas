import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function conversationWithTurn() {
  const a = await seedClinic();
  const convo = await pool.query<{ id: string }>(
    "insert into agent_conversations (clinic_id, phone_e164) values ($1, '+51999000111') returning id",
    [a.clinicId],
  );
  const conversationId = convo.rows[0]?.id as string;
  await pool.query(
    "insert into agent_turns (conversation_id, clinic_id, role, content) values ($1, $2, 'user', '[]')",
    [conversationId, a.clinicId],
  );
  return { a, conversationId };
}

const turnsSeenBy = (userId: string, conversationId: string) =>
  asUser(
    userId,
    async (client) =>
      (
        await client.query("select id from agent_turns where conversation_id = $1", [
          conversationId,
        ])
      ).rows,
  );

describe("agent_turns", () => {
  it("is visible to every role of its own clinic and to nobody else", async () => {
    const { a, conversationId } = await conversationWithTurn();
    const other = await seedClinic();
    for (const member of [a.admin, a.dentist, a.assistant]) {
      expect(await turnsSeenBy(member.userId, conversationId)).toHaveLength(1);
    }
    expect(await turnsSeenBy(other.admin.userId, conversationId)).toHaveLength(0);
  });

  it("cannot be written by a signed-in user, only by the server", async () => {
    const { a, conversationId } = await conversationWithTurn();
    await expect(
      asUser(a.admin.userId, (client) =>
        client.query(
          "insert into agent_turns (conversation_id, clinic_id, role, content) values ($1, $2, 'user', '[]')",
          [conversationId, a.clinicId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("must carry a clinic_id", async () => {
    const { conversationId } = await conversationWithTurn();
    await expect(
      pool.query(
        "insert into agent_turns (conversation_id, role, content) values ($1, 'user', '[]')",
        [conversationId],
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("cannot point at a conversation of another clinic", async () => {
    const { conversationId } = await conversationWithTurn();
    const other = await seedClinic();
    await expect(
      pool.query(
        "insert into agent_turns (conversation_id, clinic_id, role, content) values ($1, $2, 'user', '[]')",
        [conversationId, other.clinicId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
