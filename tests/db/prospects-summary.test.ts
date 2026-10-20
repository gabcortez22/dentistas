import { afterAll, describe, expect, it } from "vitest";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { createProspect, moveStage, prospectSummary } from "@/server/prospects";
import { closePool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function setup() {
  const a = await seedClinic();
  const actor: Actor = {
    kind: "user",
    userId: a.assistant.userId,
    clinicId: a.clinicId,
    membershipId: a.assistant.membershipId,
  };
  return { actor };
}

describe("prospectSummary", () => {
  it("returns null conversion when nothing is closed", async () => {
    const { actor } = await setup();
    await createProspect(actor, { name: "A" });
    const summary = await prospectSummary(actor);
    expect(summary.byStage.new).toBe(1);
    expect(summary.conversionRate).toBeNull();
  });

  it("counts every stage and computes won / (won + lost)", async () => {
    const { actor } = await setup();
    const names = ["A", "B", "C", "D", "E"];
    const ids = [];
    for (const name of names) ids.push((await createProspect(actor, { name })).prospect.id);
    await moveStage(actor, ids[0] as string, "won");
    await moveStage(actor, ids[1] as string, "won");
    await moveStage(actor, ids[2] as string, "won");
    await moveStage(actor, ids[3] as string, "lost", { lostReason: "precio" });
    const summary = await prospectSummary(actor);
    expect(summary.byStage).toEqual({
      new: 1,
      contacted: 0,
      appointment_booked: 0,
      quoted: 0,
      won: 3,
      lost: 1,
    });
    expect(summary.conversionRate).toBe(0.75);
  });

  it("only counts the clinic of the actor", async () => {
    const one = await setup();
    const two = await setup();
    await createProspect(one.actor, { name: "Solo mía" });
    expect((await prospectSummary(two.actor)).byStage.new).toBe(0);
  });
});
