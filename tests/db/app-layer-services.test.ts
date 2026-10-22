import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listQuoteBalances, recordCharge } from "@/server/charges";
import { getClinicName } from "@/server/clinics";
import { listGoogleConnections } from "@/server/google-connections";
import { createPatient } from "@/server/patients";
import { createQuote, setQuoteStatus } from "@/server/quotes";
import { ForbiddenError, type UserActor } from "@/server/session";
import { ensureSimulatorNumber, listSimulatorMessages } from "@/server/simulator";
import { addMember, closePool, createClinic, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
});

type Member = { userId: string; membershipId: string };
const actorOf = (clinicId: string, m: Member): UserActor => ({
  kind: "user",
  userId: m.userId,
  clinicId,
  membershipId: m.membershipId,
});

describe("getClinicName", () => {
  it("returns the name of the member's clinic", async () => {
    const clinicId = await createClinic("Clínica Sonrisa");
    const admin = await addMember(clinicId, "admin");
    expect(await getClinicName(actorOf(clinicId, admin))).toBe("Clínica Sonrisa");
  });

  it("returns nothing for a user asking about another clinic", async () => {
    const mine = await seedClinic();
    const other = await createClinic("Clínica ajena");
    expect(await getClinicName(actorOf(other, mine.admin))).toBe("");
  });
});

describe("listQuoteBalances", () => {
  async function setup() {
    const a = await seedClinic();
    const dentist = actorOf(a.clinicId, a.dentist);
    const assistant = actorOf(a.clinicId, a.assistant);
    const patient = await createPatient(assistant, {
      docNumber: String(Math.random()).slice(2, 10),
      lastName: "Soto",
      firstName: "Ana",
    });
    const quote = await createQuote(dentist, {
      patientId: patient.id,
      items: [{ description: "Limpieza", quantity: 2, unitPriceCents: 5000 }],
      discountCents: 1000,
    });
    const accept = async () => {
      await setQuoteStatus(dentist, quote.id, "sent");
      await setQuoteStatus(dentist, quote.id, "accepted");
    };
    return { a, dentist, assistant, patient, quote, accept };
  }

  it("lists nothing until the quote is accepted, then the amount owed", async () => {
    const { dentist, patient, quote, accept } = await setup();
    expect(await listQuoteBalances(dentist, patient.id)).toEqual([]);
    await accept();
    expect(await listQuoteBalances(dentist, patient.id)).toEqual([
      { quoteId: quote.id, number: expect.any(Number), balanceCents: 9000 },
    ]);
  });

  it("reduces the balance with payments and drops the quote once paid in full", async () => {
    const { dentist, assistant, patient, quote, accept } = await setup();
    await accept();
    const pay = (amountCents: number) =>
      recordCharge(assistant, {
        patientId: patient.id,
        quoteId: quote.id,
        amountCents,
        method: "cash",
        concept: "abono",
      });
    await pay(3000);
    expect((await listQuoteBalances(dentist, patient.id))[0]?.balanceCents).toBe(6000);
    await pay(6000);
    expect(await listQuoteBalances(dentist, patient.id)).toEqual([]);
  });

  it("does not show another clinic's quotes", async () => {
    const { patient, accept } = await setup();
    await accept();
    const stranger = await seedClinic();
    expect(await listQuoteBalances(actorOf(stranger.clinicId, stranger.admin), patient.id)).toEqual(
      [],
    );
  });
});

describe("listGoogleConnections", () => {
  async function setup() {
    const clinicId = await createClinic();
    const admin = await addMember(clinicId, "admin", "Admin");
    const ana = await addMember(clinicId, "dentist", "Ana");
    const beto = await addMember(clinicId, "dentist", "Beto");
    await pool.query(
      "insert into google_connections (clinic_id, membership_id, google_email, refresh_token_enc) values ($1, $2, 'ana@clinica.pe', 'x')",
      [clinicId, ana.membershipId],
    );
    return { clinicId, admin, ana, beto };
  }

  it("shows an admin every dentist with their link state", async () => {
    const { clinicId, admin } = await setup();
    expect(await listGoogleConnections(actorOf(clinicId, admin), "admin")).toEqual([
      { displayName: "Ana", googleEmail: "ana@clinica.pe", status: "active" },
      { displayName: "Beto", googleEmail: null, status: null },
    ]);
  });

  it("shows a dentist only their own link", async () => {
    const { clinicId, ana, beto } = await setup();
    expect(await listGoogleConnections(actorOf(clinicId, ana), "dentist")).toEqual([
      { displayName: "Ana", googleEmail: "ana@clinica.pe", status: "active" },
    ]);
    expect(await listGoogleConnections(actorOf(clinicId, beto), "dentist")).toEqual([
      { displayName: "Beto", googleEmail: null, status: null },
    ]);
  });
});

describe("simulator service", () => {
  const savedNumber = async (clinicId: string) =>
    (
      await pool.query<{ n: string | null }>(
        "select whatsapp_phone_number_id as n from clinics where id = $1",
        [clinicId],
      )
    ).rows[0]?.n;

  it("lets an admin assign the simulator number, and keeps it on a second call", async () => {
    const a = await seedClinic();
    const admin = actorOf(a.clinicId, a.admin);
    expect(await ensureSimulatorNumber(admin)).toBe(`SIMULADOR-${a.clinicId}`);
    expect(await ensureSimulatorNumber(admin)).toBe(`SIMULADOR-${a.clinicId}`);
    expect(await savedNumber(a.clinicId)).toBe(`SIMULADOR-${a.clinicId}`);
  });

  it("keeps a real number the clinic already has", async () => {
    const a = await seedClinic();
    const real = `real-${randomUUID()}`;
    await pool.query("update clinics set whatsapp_phone_number_id = $2 where id = $1", [
      a.clinicId,
      real,
    ]);
    expect(await ensureSimulatorNumber(actorOf(a.clinicId, a.admin))).toBe(real);
  });

  it("refuses a dentist, an assistant and an admin of another clinic", async () => {
    const a = await seedClinic();
    const stranger = await seedClinic();
    await expect(ensureSimulatorNumber(actorOf(a.clinicId, a.dentist))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(ensureSimulatorNumber(actorOf(a.clinicId, a.assistant))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(ensureSimulatorNumber(actorOf(a.clinicId, stranger.admin))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await savedNumber(a.clinicId)).toBeNull();
  });

  it("lists the conversation of one phone in order, scoped to the clinic", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const phone = "+51999111222";
    const add = (clinicId: string, direction: string, body: string, at: string, to = phone) =>
      pool.query(
        "insert into whatsapp_messages (clinic_id, direction, phone_e164, body, created_at) values ($1, $2, $3, $4, $5)",
        [clinicId, direction, to, body, at],
      );
    await add(a.clinicId, "out", "Hola, ¿en qué te ayudo?", "2026-10-20T10:00:05Z");
    await add(a.clinicId, "in", "Quiero una cita", "2026-10-20T10:00:00Z");
    await add(a.clinicId, "in", "Otro paciente", "2026-10-20T10:00:01Z", "+51988000111");
    await add(b.clinicId, "in", "Mensaje de otra clínica", "2026-10-20T10:00:02Z");

    const admin = actorOf(a.clinicId, a.admin);
    const messages = await listSimulatorMessages(admin, "51999111222");
    expect(messages.map((m) => [m.direction, m.body])).toEqual([
      ["in", "Quiero una cita"],
      ["out", "Hola, ¿en qué te ayudo?"],
    ]);
    expect(messages[0]?.createdAt).toBeInstanceOf(Date);
    expect(await listSimulatorMessages(admin, "51000000000")).toEqual([]);
  });

  it("returns nothing when asking about another clinic's conversation", async () => {
    const a = await seedClinic();
    const stranger = await seedClinic();
    await pool.query(
      "insert into whatsapp_messages (clinic_id, direction, phone_e164, body) values ($1, 'in', '+51977000333', 'privado')",
      [a.clinicId],
    );
    const forged = actorOf(a.clinicId, stranger.admin);
    expect(await listSimulatorMessages(forged, "51977000333")).toEqual([]);
  });
});
