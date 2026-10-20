"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { parsePEN } from "@/lib/money";
import { recordExpense, voidExpense } from "@/server/expenses";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

const back = (error?: string): never =>
  redirect(error ? `/gastos?error=${encodeURIComponent(error)}` : "/gastos");

export async function recordExpenseAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await recordExpense(userActor(ctx), {
      category: String(formData.get("category")) as "otros",
      supplier: String(formData.get("supplier") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? ""),
      amountCents: parsePEN(String(formData.get("amount") ?? "")) ?? 0,
      method: String(formData.get("method")) as "cash",
      incurredOn: String(formData.get("incurredOn") ?? ""),
      receiptNote: String(formData.get("receiptNote") ?? "").trim() || undefined,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) back("Solo la administración puede registrar gastos.");
    if (error instanceof ZodError)
      back("Revisa la descripción, el monto (mayor que cero) y la fecha.");
    back("No se pudo registrar el gasto.");
  }
  revalidatePath("/gastos");
  back();
}

export async function voidExpenseAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await voidExpense(
      userActor(ctx),
      String(formData.get("id")),
      String(formData.get("reason") ?? ""),
    );
  } catch {
    back("No se pudo anular el gasto (indica el motivo).");
  }
  revalidatePath("/gastos");
  back();
}
