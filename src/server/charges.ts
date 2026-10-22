import type { PoolClient } from "pg";
import { z } from "zod";
import { withService, withTenant } from "@/lib/db";
import { ForbiddenError, type UserActor } from "@/server/session";

export class OverpaymentError extends Error {
  constructor() {
    super("the amount exceeds the remaining balance of the quote");
    this.name = "OverpaymentError";
  }
}
export class QuoteNotAcceptedError extends Error {
  constructor() {
    super("charges can only be recorded against accepted quotes");
    this.name = "QuoteNotAcceptedError";
  }
}

export type PaymentMethod = "cash" | "yape" | "plin" | "card" | "transfer";
export type Charge = {
  id: string;
  patientId: string;
  quoteId: string | null;
  appointmentId: string | null;
  amountCents: number;
  method: PaymentMethod;
  concept: string;
  paidAt: Date;
};

const chargeSchema = z.object({
  patientId: z.uuid(),
  quoteId: z.uuid().optional(),
  appointmentId: z.uuid().optional(),
  amountCents: z.number().int().positive(),
  method: z.enum(["cash", "yape", "plin", "card", "transfer"]),
  concept: z.string().trim().min(1),
  paidAt: z.date().optional(),
});

/** Charges are written with the owner role under explicit authorization: assistants record charges but cannot see quotes via RLS. */
async function assertMember(client: PoolClient, actor: UserActor, roles?: string[]) {
  const { rows } = await client.query<{ role: string }>(
    "select role from memberships where id = $1 and clinic_id = $2 and user_id = $3 and active",
    [actor.membershipId, actor.clinicId, actor.userId],
  );
  const role = rows[0]?.role;
  if (!role || (roles && !roles.includes(role))) throw new ForbiddenError();
}

export async function recordCharge(
  actor: UserActor,
  input: z.input<typeof chargeSchema>,
): Promise<{ id: string }> {
  const d = chargeSchema.parse(input);
  return withService(async (client) => {
    await assertMember(client, actor);
    const patient = await client.query("select 1 from patients where id = $1 and clinic_id = $2", [
      d.patientId,
      actor.clinicId,
    ]);
    if (!patient.rowCount) throw new Error("patient not found");
    if (d.quoteId) {
      const quote = await client.query<{ status: string; patient_id: string }>(
        "select status, patient_id from quotes where id = $1 and clinic_id = $2 for update",
        [d.quoteId, actor.clinicId],
      );
      const q = quote.rows[0];
      if (!q || q.patient_id !== d.patientId) throw new Error("quote not found for this patient");
      if (q.status !== "accepted") throw new QuoteNotAcceptedError();
      const balance = await client.query<{ balance_cents: string }>(
        "select balance_cents from quote_balances where quote_id = $1",
        [d.quoteId],
      );
      if (d.amountCents > Number(balance.rows[0]?.balance_cents ?? 0)) throw new OverpaymentError();
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into charges (clinic_id, patient_id, quote_id, appointment_id, amount_cents, method, concept, paid_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, now()), $9) returning id`,
      [
        actor.clinicId,
        d.patientId,
        d.quoteId ?? null,
        d.appointmentId ?? null,
        d.amountCents,
        d.method,
        d.concept,
        d.paidAt ?? null,
        actor.membershipId,
      ],
    );
    return { id: rows[0]?.id as string };
  });
}

export async function voidCharge(
  actor: UserActor,
  chargeId: string,
  reason: string,
): Promise<void> {
  const why = z.string().trim().min(1).parse(reason);
  await withService(async (client) => {
    await assertMember(client, actor, ["admin"]);
    const charge = await client.query("select 1 from charges where id = $1 and clinic_id = $2", [
      chargeId,
      actor.clinicId,
    ]);
    if (!charge.rowCount) throw new Error("charge not found");
    try {
      await client.query(
        "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, $3, $4)",
        [chargeId, actor.clinicId, why, actor.membershipId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("charge already voided");
      throw error;
    }
  });
}

export async function listCharges(
  actor: UserActor,
  opts: { patientId?: string; from?: Date; to?: Date } = {},
): Promise<Array<Charge & { voided: boolean; voidReason: string | null; patientName: string }>> {
  return withService(async (client) => {
    await assertMember(client, actor);
    const { rows } = await client.query(
      `select c.*, v.reason as void_reason, v.charge_id is not null as voided,
              p.last_name || ', ' || p.first_name as patient_name
         from charges c
         join patients p on p.id = c.patient_id
         left join charge_voids v on v.charge_id = c.id
        where c.clinic_id = $1 and ($2::uuid is null or c.patient_id = $2)
          and ($3::timestamptz is null or c.paid_at >= $3) and ($4::timestamptz is null or c.paid_at < $4)
        order by c.paid_at desc limit 200`,
      [actor.clinicId, opts.patientId ?? null, opts.from ?? null, opts.to ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      quoteId: r.quote_id,
      appointmentId: r.appointment_id,
      amountCents: r.amount_cents,
      method: r.method,
      concept: r.concept,
      paidAt: r.paid_at,
      voided: r.voided,
      voidReason: r.void_reason,
      patientName: r.patient_name,
    }));
  });
}

export async function patientBalance(
  actor: UserActor,
  patientId: string,
): Promise<{ totalCents: number; paidCents: number; balanceCents: number }> {
  return withService(async (client) => {
    await assertMember(client, actor);
    const { rows } = await client.query(
      `select coalesce(sum(total_cents), 0) as total, coalesce(sum(paid_cents), 0) as paid,
              coalesce(sum(balance_cents), 0) as balance
         from quote_balances where patient_id = $1 and clinic_id = $2`,
      [patientId, actor.clinicId],
    );
    return {
      totalCents: Number(rows[0].total),
      paidCents: Number(rows[0].paid),
      balanceCents: Number(rows[0].balance),
    };
  });
}

export type QuoteBalance = { quoteId: string; number: number; balanceCents: number };

/** Accepted quotes of the patient that still owe money, oldest number first. */
export async function listQuoteBalances(
  actor: UserActor,
  patientId: string,
): Promise<QuoteBalance[]> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query(
      `select quote_id, number, balance_cents from quote_balances
        where patient_id = $1 and clinic_id = $2 and balance_cents > 0 order by number`,
      [patientId, actor.clinicId],
    );
    return rows.map((r) => ({
      quoteId: r.quote_id,
      number: Number(r.number),
      balanceCents: Number(r.balance_cents),
    }));
  });
}
