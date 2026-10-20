"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { parsePEN } from "@/lib/money";
import {
  OverpaymentError,
  QuoteNotAcceptedError,
  recordCharge,
  voidCharge,
} from "@/server/charges";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

const back = (error?: string): never =>
  redirect(error ? `/cobros?error=${encodeURIComponent(error)}` : "/cobros");

export async function recordChargeAction(formData: FormData) {
  const ctx = await requireSession();
  const amount = parsePEN(String(formData.get("amount") ?? ""));
  try {
    await recordCharge(userActor(ctx), {
      patientId: String(formData.get("patientId")),
      quoteId: String(formData.get("quoteId") ?? "") || undefined,
      amountCents: amount ?? 0,
      method: String(formData.get("method")) as "cash",
      concept: String(formData.get("concept") ?? ""),
    });
  } catch (error) {
    if (error instanceof OverpaymentError)
      back("El monto supera el saldo pendiente de la cotización.");
    if (error instanceof QuoteNotAcceptedError)
      back("La cotización debe estar aceptada para registrar cobros.");
    if (error instanceof ZodError)
      back("Revisa el paciente, el monto (mayor que cero) y el concepto.");
    back("No se pudo registrar el cobro.");
  }
  revalidatePath("/cobros");
  back();
}

export async function voidChargeAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await voidCharge(
      userActor(ctx),
      String(formData.get("id")),
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    if (error instanceof ForbiddenError) back("Solo la administración puede anular cobros.");
    back("No se pudo anular el cobro (indica el motivo).");
  }
  revalidatePath("/cobros");
  back();
}
