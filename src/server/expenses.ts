import type { PoolClient } from "pg";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import type { PaymentMethod } from "@/server/charges";
import { ForbiddenError, type UserActor } from "@/server/session";

export type ExpenseCategory =
  | "insumos"
  | "laboratorio"
  | "alquiler"
  | "sueldos"
  | "servicios"
  | "marketing"
  | "otros";

export type Expense = {
  id: string;
  category: ExpenseCategory;
  supplier: string | null;
  description: string;
  amountCents: number;
  method: PaymentMethod;
  incurredOn: string;
  receiptNote: string | null;
  voided: boolean;
  voidReason: string | null;
};

const expenseSchema = z.object({
  category: z.enum([
    "insumos",
    "laboratorio",
    "alquiler",
    "sueldos",
    "servicios",
    "marketing",
    "otros",
  ]),
  supplier: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  amountCents: z.number().int().positive(),
  method: z.enum(["cash", "yape", "plin", "card", "transfer"]),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptNote: z.string().trim().min(1).optional(),
});

async function assertAdmin(client: PoolClient, actor: UserActor) {
  const { rows } = await client.query<{ role: string }>(
    "select role from memberships where id = $1 and clinic_id = $2 and active",
    [actor.membershipId, actor.clinicId],
  );
  if (rows[0]?.role !== "admin") throw new ForbiddenError();
}

export async function recordExpense(
  actor: UserActor,
  input: z.input<typeof expenseSchema>,
): Promise<{ id: string }> {
  const d = expenseSchema.parse(input);
  return withTenant(actor.userId, async (client) => {
    await assertAdmin(client, actor);
    const { rows } = await client.query<{ id: string }>(
      `insert into expenses (clinic_id, category, supplier, description, amount_cents, method, incurred_on, receipt_note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        actor.clinicId,
        d.category,
        d.supplier ?? null,
        d.description,
        d.amountCents,
        d.method,
        d.incurredOn,
        d.receiptNote ?? null,
        actor.membershipId,
      ],
    );
    return { id: rows[0]?.id as string };
  });
}

export async function voidExpense(
  actor: UserActor,
  expenseId: string,
  reason: string,
): Promise<void> {
  const why = z.string().trim().min(1).parse(reason);
  await withTenant(actor.userId, async (client) => {
    await assertAdmin(client, actor);
    const found = await client.query("select 1 from expenses where id = $1 and clinic_id = $2", [
      expenseId,
      actor.clinicId,
    ]);
    if (!found.rowCount) throw new Error("expense not found");
    try {
      await client.query(
        "insert into expense_voids (expense_id, clinic_id, reason, voided_by) values ($1, $2, $3, $4)",
        [expenseId, actor.clinicId, why, actor.membershipId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("expense already voided");
      throw error;
    }
  });
}

export async function listExpenses(
  actor: UserActor,
  opts: { month?: string } = {},
): Promise<Expense[]> {
  const month = opts.month
    ? z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .parse(opts.month)
    : null;
  return withTenant(actor.userId, async (client) => {
    await assertAdmin(client, actor);
    const { rows } = await client.query(
      `select e.*, e.incurred_on::text as incurred_text, v.reason as void_reason, v.expense_id is not null as voided
         from expenses e left join expense_voids v on v.expense_id = e.id
        where e.clinic_id = $1 and ($2::text is null or to_char(e.incurred_on, 'YYYY-MM') = $2)
        order by e.incurred_on desc, e.created_at desc limit 500`,
      [actor.clinicId, month],
    );
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      supplier: r.supplier,
      description: r.description,
      amountCents: r.amount_cents,
      method: r.method,
      incurredOn: r.incurred_text,
      receiptNote: r.receipt_note,
      voided: r.voided,
      voidReason: r.void_reason,
    }));
  });
}

export async function monthlySummary(
  actor: UserActor,
  opts: { months?: number } = {},
): Promise<Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>> {
  const months = z
    .number()
    .int()
    .min(1)
    .max(60)
    .parse(opts.months ?? 12);
  return withTenant(actor.userId, async (client) => {
    await assertAdmin(client, actor);
    const { rows } = await client.query(
      `select month::text as month, income_cents, expense_cents, net_cents
         from monthly_summary where clinic_id = $1 order by month desc limit $2`,
      [actor.clinicId, months],
    );
    return rows.map((r) => ({
      month: String(r.month).slice(0, 7),
      incomeCents: Number(r.income_cents),
      expenseCents: Number(r.expense_cents),
      netCents: Number(r.net_cents),
    }));
  });
}
