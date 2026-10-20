import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { loadSlots } from "@/server/availability";
import { addBlockException, getWeeklyRules, setWeeklyRules } from "@/server/schedules";
import { ForbiddenError, type SessionCtx, type UserActor } from "@/server/session";
import { closePool, pool, seedClinic } from "./helpers";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/session")>()),
  getSession: async () => session.current,
}));

afterAll(async () => {
  await closePool();
  await closeAppPool();
});
beforeEach(() => {
  session.current = null;
});

const NOW = new Date("2027-02-28T12:00:00Z");
const MON = [{ weekday: 1, startTime: "09:00", endTime: "12:00" }];
const actorOf = (clinicId: string, m: { userId: string; membershipId: string }): UserActor => ({
  kind: "user",
  userId: m.userId,
  clinicId,
  membershipId: m.membershipId,
});

describe("schedules", () => {
  it("replacing rules closes the old ones and inserts new ones, with no deletion and no gap", async () => {
    const a = await seedClinic();
    const admin = actorOf(a.clinicId, a.admin);
    await setWeeklyRules(admin, "admin", a.dentist.membershipId, MON, { now: NOW });
    await setWeeklyRules(
      admin,
      "admin",
      a.dentist.membershipId,
      [{ weekday: 2, startTime: "10:00", endTime: "11:00" }],
      {
        now: new Date("2027-03-02T12:00:00Z"),
      },
    );
    const all = await pool.query(
      "select weekday, valid_from::text, valid_until::text from availability_rules where membership_id = $1 order by created_at, id",
      [a.dentist.membershipId],
    );
    expect(all.rowCount).toBe(2);
    expect(
      await getWeeklyRules(admin, a.dentist.membershipId, {
        now: new Date("2027-03-03T12:00:00Z"),
      }),
    ).toEqual([{ weekday: 2, startTime: "10:00", endTime: "11:00" }]);
    expect(all.rows[0].valid_until).toBe("2027-03-01");
  });

  it("a dentist edits only their own rules, an admin anyone's, an assistant no one's", async () => {
    const a = await seedClinic();
    await expect(
      setWeeklyRules(actorOf(a.clinicId, a.dentist), "dentist", a.admin.membershipId, MON, {
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setWeeklyRules(actorOf(a.clinicId, a.dentist), "dentist", a.dentist.membershipId, MON, {
      now: NOW,
    });
    await expect(
      setWeeklyRules(actorOf(a.clinicId, a.assistant), "assistant", a.dentist.membershipId, MON, {
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setWeeklyRules(actorOf(a.clinicId, a.admin), "admin", a.dentist.membershipId, MON, {
      now: NOW,
    });
  });

  it("a block exception removes slots from that day", async () => {
    const a = await seedClinic();
    const admin = actorOf(a.clinicId, a.admin);
    await setWeeklyRules(admin, "admin", a.dentist.membershipId, MON, { now: NOW });
    const q = {
      membershipId: a.dentist.membershipId,
      from: new Date("2027-03-01T05:00:00Z"),
      to: new Date("2027-03-02T05:00:00Z"),
      durationMinutes: 30,
    };
    const before = await loadSlots(admin as Actor, q, { now: NOW });
    await addBlockException(admin, "admin", a.dentist.membershipId, {
      startsAt: new Date("2027-03-01T14:00:00Z"),
      endsAt: new Date("2027-03-01T15:00:00Z"),
      reason: "Vacaciones",
    });
    const after = await loadSlots(admin as Actor, q, { now: NOW });
    expect(before.length - after.length).toBe(2);
  });

  it("GET /api/availability answers 200 with slots for a valid session and parameters", async () => {
    const a = await seedClinic();
    await setWeeklyRules(
      actorOf(a.clinicId, a.admin),
      "admin",
      a.dentist.membershipId,
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: "00:00", endTime: "23:59" })),
    );
    session.current = {
      userId: a.assistant.userId,
      clinicId: a.clinicId,
      membershipId: a.assistant.membershipId,
      role: "assistant",
      displayName: "x",
    } satisfies SessionCtx;
    const { GET } = await import("@/app/api/availability/route");
    const from = new Date(Date.now() + 3 * 86_400_000);
    const to = new Date(from.getTime() + 3 * 3_600_000);
    const url = `http://x/api/availability?dentist=${a.dentist.membershipId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&minutes=30`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { slots: Array<{ startsAt: string; endsAt: string }> };
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0]?.startsAt).toMatch(/Z$/);
  });

  it("GET /api/availability answers 401 without a session and 400 for bad minutes", async () => {
    const { GET } = await import("@/app/api/availability/route");
    expect((await GET(new Request("http://x/api/availability"))).status).toBe(401);
    const a = await seedClinic();
    session.current = {
      userId: a.admin.userId,
      clinicId: a.clinicId,
      membershipId: a.admin.membershipId,
      role: "admin",
      displayName: "x",
    };
    const bad = `http://x/api/availability?dentist=${a.dentist.membershipId}&from=2027-03-01T00:00:00Z&to=2027-03-02T00:00:00Z&minutes=2`;
    expect((await GET(new Request(bad))).status).toBe(400);
    expect((await GET(new Request(bad.replace("minutes=2", "minutes=999")))).status).toBe(400);
  });
});
