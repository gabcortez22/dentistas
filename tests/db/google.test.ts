import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { decryptToken, encryptToken, signState, verifyState } from "@/lib/google/crypto";
import { connectGoogle, runGoogleSync } from "@/lib/google/sync";
import { loadSlots } from "@/server/availability";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.APP_URL = "http://localhost:3000";
});
afterAll(async () => {
  await closePool();
  await closeAppPool();
});

const jwt = (payload: object) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

type Call = { method: string; url: string };
function fakeGoogle(
  opts: { revoked?: boolean; busy?: Array<{ start: string; end: string }> } = {},
) {
  const calls: Call[] = [];
  let n = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "authorization_code") {
        return json({ refresh_token: "rt-1", id_token: jwt({ email: "dra@example.com" }) });
      }
      if (opts.revoked) return json({ error: "invalid_grant" }, 400);
      return json({ access_token: "at-1" });
    }
    if (url.endsWith("/freeBusy"))
      return json({ calendars: { primary: { busy: opts.busy ?? [] } } });
    if (method === "POST" && url.includes("/events")) return json({ id: `ev-${++n}` });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return json({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

async function setup() {
  const a = await seedClinic();
  const actor: Actor = { kind: "service", clinicId: a.clinicId };
  return { a, actor };
}
const confirmedAppointment = async (
  a: Awaited<ReturnType<typeof seedClinic>>,
  startsInHours = 48,
) => {
  const patientId = await createPatientRow(a.clinicId);
  const start = new Date(Date.now() + startsInHours * 3_600_000);
  const { rows } = await pool.query<{ id: string }>(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
    [a.clinicId, patientId, a.dentist.membershipId, start, new Date(start.getTime() + 1_800_000)],
  );
  return rows[0]?.id as string;
};

describe("token crypto and state", () => {
  it("encrypts to different v1 ciphertexts that both decrypt, and rejects tampering", () => {
    const one = encryptToken("refresh-token");
    const two = encryptToken("refresh-token");
    expect(one).not.toBe(two);
    expect(one.startsWith("v1:") && two.startsWith("v1:")).toBe(true);
    expect(decryptToken(one)).toBe("refresh-token");
    expect(decryptToken(two)).toBe("refresh-token");
    const parts = one.split(":");
    const bytes = Buffer.from(parts[3] as string, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    parts[3] = bytes.toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("signed state verifies within its lifetime and fails when expired or tampered", () => {
    const state = signState("membership-1", new Date("2027-03-01T10:00:00Z"));
    expect(verifyState(state, new Date("2027-03-01T10:05:00Z"))).toBe("membership-1");
    expect(() => verifyState(state, new Date("2027-03-01T10:11:00Z"))).toThrow(/expired/);
    expect(() => verifyState(state.replace("membership-1", "membership-2"))).toThrow();
  });

  it("authenticated cannot read refresh_token_enc, but the owner reads the other columns", async () => {
    const { a, actor } = await setup();
    const fake = fakeGoogle();
    await connectGoogle(actor, a.dentist.membershipId, "code", fake.impl);
    await expect(
      asUser(a.dentist.userId, (c) => c.query("select refresh_token_enc from google_connections")),
    ).rejects.toThrow(/permission denied/);
    const ok = await asUser(a.dentist.userId, (c) =>
      c.query("select google_email, status from google_connections"),
    );
    expect(ok.rows).toEqual([{ google_email: "dra@example.com", status: "active" }]);
  });
});

describe("runGoogleSync", () => {
  it("creates one event per confirmed unsynced appointment, and none on a second run", async () => {
    const { a, actor } = await setup();
    await connectGoogle(actor, a.dentist.membershipId, "code", fakeGoogle().impl);
    const id = await confirmedAppointment(a);
    const fake = fakeGoogle();
    const first = await runGoogleSync({ fetchImpl: fake.impl });
    expect(first.created).toBeGreaterThanOrEqual(1);
    const row = await pool.query("select google_event_id from appointments where id = $1", [id]);
    expect(row.rows[0].google_event_id).toMatch(/^ev-/);
    const second = fakeGoogle();
    await runGoogleSync({ fetchImpl: second.impl });
    expect(
      second.calls.filter((c) => c.method === "POST" && c.url.includes("/events")),
    ).toHaveLength(0);
  });

  it("deletes the event of a cancelled appointment and clears google_event_id", async () => {
    const { a, actor } = await setup();
    await connectGoogle(actor, a.dentist.membershipId, "code", fakeGoogle().impl);
    const id = await confirmedAppointment(a);
    await runGoogleSync({ fetchImpl: fakeGoogle().impl });
    await pool.query("update appointments set status = 'cancelled' where id = $1", [id]);
    const fake = fakeGoogle();
    const result = await runGoogleSync({ fetchImpl: fake.impl });
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(fake.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(
      (await pool.query("select google_event_id from appointments where id = $1", [id])).rows[0]
        .google_event_id,
    ).toBeNull();
  });

  it("replaces external busy blocks and slots stop being offered there", async () => {
    const { a, actor } = await setup();
    await pool.query(
      "insert into availability_rules (clinic_id, membership_id, weekday, start_time, end_time) select $1, $2, d, '00:00', '23:59' from generate_series(1, 7) d",
      [a.clinicId, a.dentist.membershipId],
    );
    await connectGoogle(actor, a.dentist.membershipId, "code", fakeGoogle().impl);
    const start = new Date(Date.now() + 5 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const q = {
      membershipId: a.dentist.membershipId,
      from: start,
      to: new Date(start.getTime() + 3_600_000),
      durationMinutes: 30,
    };
    const before = await loadSlots(actor, q);
    const busy = [
      { start: start.toISOString(), end: new Date(start.getTime() + 1_800_000).toISOString() },
    ];
    await runGoogleSync({ fetchImpl: fakeGoogle({ busy }).impl });
    await runGoogleSync({ fetchImpl: fakeGoogle({ busy }).impl });
    expect(
      (
        await pool.query("select count(*)::int as n from external_busy where membership_id = $1", [
          a.dentist.membershipId,
        ])
      ).rows[0].n,
    ).toBe(1);
    const after = await loadSlots(actor, q);
    expect(after.length).toBeLessThan(before.length);
  });

  it("marks the connection revoked on invalid_grant and keeps going", async () => {
    const { a, actor } = await setup();
    await connectGoogle(actor, a.dentist.membershipId, "code", fakeGoogle().impl);
    const result = await runGoogleSync({ fetchImpl: fakeGoogle({ revoked: true }).impl });
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    const row = await pool.query(
      "select status, last_error from google_connections where membership_id = $1",
      [a.dentist.membershipId],
    );
    expect(row.rows[0].status).toBe("revoked");
    expect(row.rows[0].last_error).toBeTruthy();
  });
});
