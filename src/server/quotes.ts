import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import { z } from "zod";
import { type Actor, runAs, withService, withTenant } from "@/lib/db";
import { quoteTotals } from "@/lib/money";
import { ForbiddenError, type UserActor } from "@/server/session";

export class QuoteLockedError extends Error {
  constructor() {
    super("only draft quotes can be edited");
    this.name = "QuoteLockedError";
  }
}

export type QuoteItemInput = {
  treatmentId?: string;
  description: string;
  toothFdi?: number;
  quantity: number;
  unitPriceCents: number;
};
export type Treatment = {
  id: string;
  name: string;
  defaultPriceCents: number;
  durationMinutes: number;
  active: boolean;
};
export type Quote = {
  id: string;
  number: number;
  patientId: string;
  patientName: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  validUntil: string;
  discountCents: number;
  notes: string | null;
  createdAt: Date;
};
export type QuoteItem = QuoteItemInput & { id: string };

const ZONE = "America/Lima";
const todayLima = (now = new Date()) => DateTime.fromJSDate(now, { zone: ZONE }).startOf("day");

const itemSchema = z.object({
  treatmentId: z.uuid().optional(),
  description: z.string().trim().min(1),
  toothFdi: z.number().int().optional(),
  quantity: z.number().int().min(1).max(99),
  unitPriceCents: z.number().int().min(0),
});
const itemsSchema = z.array(itemSchema).min(1).max(50);

async function assertQuoteRole(client: PoolClient, actor: UserActor) {
  const { rows } = await client.query<{ role: string }>(
    "select role from memberships where id = $1 and clinic_id = $2 and active",
    [actor.membershipId, actor.clinicId],
  );
  if (rows[0]?.role !== "admin" && rows[0]?.role !== "dentist") throw new ForbiddenError();
}

const isRls = (e: unknown) => /row-level security/.test((e as Error).message ?? "");

export async function saveTreatment(
  actor: UserActor,
  input: {
    id?: string;
    name: string;
    defaultPriceCents: number;
    durationMinutes: number;
    active?: boolean;
  },
): Promise<{ id: string }> {
  const d = z
    .object({
      id: z.uuid().optional(),
      name: z.string().trim().min(1),
      defaultPriceCents: z.number().int().min(0),
      durationMinutes: z.number().int().min(5).max(480),
      active: z.boolean().default(true),
    })
    .parse(input);
  try {
    return await withTenant(actor.userId, async (client) => {
      if (d.id) {
        const { rows } = await client.query<{ id: string }>(
          `update treatments set name = $3, default_price_cents = $4, duration_minutes = $5, active = $6
            where id = $1 and clinic_id = $2 returning id`,
          [d.id, actor.clinicId, d.name, d.defaultPriceCents, d.durationMinutes, d.active],
        );
        if (!rows[0]) throw new ForbiddenError();
        return { id: rows[0].id };
      }
      const { rows } = await client.query<{ id: string }>(
        `insert into treatments (clinic_id, name, default_price_cents, duration_minutes, active)
         values ($1, $2, $3, $4, $5) returning id`,
        [actor.clinicId, d.name, d.defaultPriceCents, d.durationMinutes, d.active],
      );
      return { id: rows[0]?.id as string };
    });
  } catch (error) {
    if (isRls(error)) throw new ForbiddenError();
    throw error;
  }
}

export async function listTreatments(
  actor: Actor,
  opts: { activeOnly?: boolean } = {},
): Promise<Treatment[]> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      `select id, name, default_price_cents, duration_minutes, active from treatments
        where clinic_id = $1 and ($2::boolean is false or active) order by name`,
      [actor.clinicId, opts.activeOnly ?? false],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      defaultPriceCents: r.default_price_cents,
      durationMinutes: r.duration_minutes,
      active: r.active,
    }));
  });
}

export async function createQuote(
  actor: UserActor,
  input: {
    patientId: string;
    validUntil?: string;
    discountCents?: number;
    notes?: string;
    items: QuoteItemInput[];
  },
  opts: { now?: Date } = {},
): Promise<{ id: string; number: number }> {
  const items = itemsSchema.parse(input.items);
  const discount = z
    .number()
    .int()
    .min(0)
    .parse(input.discountCents ?? 0);
  quoteTotals(items, discount);
  const validUntil = input.validUntil ?? todayLima(opts.now).plus({ days: 30 }).toISODate();
  return withTenant(actor.userId, async (client) => {
    await assertQuoteRole(client, actor);
    const patient = await client.query("select 1 from patients where id = $1 and clinic_id = $2", [
      input.patientId,
      actor.clinicId,
    ]);
    if (!patient.rowCount) throw new Error("patient not found");
    const n = await client.query<{ n: number }>("select next_quote_number($1) as n", [
      actor.clinicId,
    ]);
    const number = n.rows[0]?.n as number;
    const quote = await client.query<{ id: string }>(
      `insert into quotes (clinic_id, patient_id, number, valid_until, discount_cents, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        actor.clinicId,
        input.patientId,
        number,
        validUntil,
        discount,
        input.notes ?? null,
        actor.membershipId,
      ],
    );
    const id = quote.rows[0]?.id as string;
    for (const item of items) {
      await client.query(
        `insert into quote_items (clinic_id, quote_id, treatment_id, description, tooth_fdi, quantity, unit_price_cents)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          actor.clinicId,
          id,
          item.treatmentId ?? null,
          item.description,
          item.toothFdi ?? null,
          item.quantity,
          item.unitPriceCents,
        ],
      );
    }
    return { id, number };
  });
}

export async function updateDraftQuote(
  actor: UserActor,
  id: string,
  patch: Partial<{
    validUntil: string;
    discountCents: number;
    notes: string;
    items: QuoteItemInput[];
  }>,
): Promise<void> {
  const items = patch.items ? itemsSchema.parse(patch.items) : undefined;
  // Authorization is explicit: the replacement of a draft's items needs the owner role (no DELETE for users).
  await withService(async (client) => {
    await assertQuoteRole(client, actor);
    const q = await client.query<{ status: string; discount_cents: number }>(
      "select status, discount_cents from quotes where id = $1 and clinic_id = $2 for update",
      [id, actor.clinicId],
    );
    const row = q.rows[0];
    if (!row) throw new Error("quote not found");
    if (row.status !== "draft") throw new QuoteLockedError();
    const discount = patch.discountCents ?? row.discount_cents;
    if (items) {
      quoteTotals(items, discount);
      await client.query("delete from quote_items where quote_id = $1 and clinic_id = $2", [
        id,
        actor.clinicId,
      ]);
      for (const item of items) {
        await client.query(
          `insert into quote_items (clinic_id, quote_id, treatment_id, description, tooth_fdi, quantity, unit_price_cents)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            actor.clinicId,
            id,
            item.treatmentId ?? null,
            item.description,
            item.toothFdi ?? null,
            item.quantity,
            item.unitPriceCents,
          ],
        );
      }
    }
    await client.query(
      `update quotes set valid_until = coalesce($3::date, valid_until), discount_cents = $4,
              notes = coalesce($5, notes) where id = $1 and clinic_id = $2`,
      [id, actor.clinicId, patch.validUntil ?? null, discount, patch.notes ?? null],
    );
  });
}

export async function setQuoteStatus(
  actor: UserActor,
  id: string,
  status: "sent" | "accepted" | "rejected" | "expired",
): Promise<void> {
  await withTenant(actor.userId, async (client) => {
    await assertQuoteRole(client, actor);
    try {
      const { rowCount } = await client.query(
        "update quotes set status = $3 where id = $1 and clinic_id = $2",
        [id, actor.clinicId, status],
      );
      if (!rowCount) throw new Error("quote not found");
    } catch (error) {
      if ((error as { code?: string }).code === "23514")
        throw new Error("invalid quote status change");
      throw error;
    }
  });
}

const toQuote = (r: Record<string, unknown>): Quote => ({
  id: r.id as string,
  number: r.number as number,
  patientId: r.patient_id as string,
  patientName: r.patient_name as string,
  status: r.status as Quote["status"],
  validUntil: String(r.valid_until_text),
  discountCents: r.discount_cents as number,
  notes: (r.notes as string) ?? null,
  createdAt: r.created_at as Date,
});

const SELECT = `select q.*, q.valid_until::text as valid_until_text, p.last_name || ', ' || p.first_name as patient_name
  from quotes q join patients p on p.id = q.patient_id`;

export async function getQuote(actor: UserActor, id: string) {
  return withTenant(actor.userId, async (client) => {
    await assertQuoteRole(client, actor);
    const q = await client.query(`${SELECT} where q.id = $1 and q.clinic_id = $2`, [
      id,
      actor.clinicId,
    ]);
    if (!q.rows[0]) return null;
    const items = await client.query(
      "select * from quote_items where quote_id = $1 and clinic_id = $2 order by id",
      [id, actor.clinicId],
    );
    const mapped: QuoteItem[] = items.rows.map((r) => ({
      id: r.id,
      treatmentId: r.treatment_id ?? undefined,
      description: r.description,
      toothFdi: r.tooth_fdi ?? undefined,
      quantity: r.quantity,
      unitPriceCents: r.unit_price_cents,
    }));
    const quote = toQuote(q.rows[0]);
    return { quote, items: mapped, totals: quoteTotals(mapped, quote.discountCents) };
  });
}

export async function listQuotes(
  actor: UserActor,
  opts: { patientId?: string; status?: string } = {},
): Promise<Quote[]> {
  return withTenant(actor.userId, async (client) => {
    await assertQuoteRole(client, actor);
    const { rows } = await client.query(
      `${SELECT} where q.clinic_id = $1 and ($2::uuid is null or q.patient_id = $2)
         and ($3::text is null or q.status::text = $3) order by q.created_at desc limit 200`,
      [actor.clinicId, opts.patientId ?? null, opts.status ?? null],
    );
    return rows.map(toQuote);
  });
}

export async function expireOverdueQuotes(opts: { now?: Date } = {}): Promise<number> {
  const today = todayLima(opts.now).toISODate();
  return withService(async (client) => {
    const { rowCount } = await client.query(
      "update quotes set status = 'expired' where status in ('draft', 'sent') and valid_until < $1::date",
      [today],
    );
    return rowCount ?? 0;
  });
}
