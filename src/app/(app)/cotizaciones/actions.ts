"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { InvalidDiscountError, parsePEN } from "@/lib/money";
import {
  createQuote,
  listTreatments,
  type QuoteItemInput,
  QuoteLockedError,
  saveTreatment,
  setQuoteStatus,
} from "@/server/quotes";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

export async function createQuoteAction(formData: FormData) {
  const ctx = await requireSession();
  const actor = userActor(ctx);
  const catalog = new Map(
    (await listTreatments(actor, { activeOnly: true })).map((t) => [t.id, t]),
  );
  const items: QuoteItemInput[] = [];
  for (let i = 0; i < 6; i++) {
    const treatmentId = String(formData.get(`treatment${i}`) ?? "") || undefined;
    const typed = String(formData.get(`description${i}`) ?? "").trim();
    const treatment = treatmentId ? catalog.get(treatmentId) : undefined;
    const description = typed || treatment?.name || "";
    if (!description) continue;
    const price = parsePEN(String(formData.get(`price${i}`) ?? "")) ?? treatment?.defaultPriceCents;
    const tooth = String(formData.get(`tooth${i}`) ?? "");
    items.push({
      treatmentId,
      description,
      toothFdi: tooth ? Number(tooth) : undefined,
      quantity: Number(formData.get(`qty${i}`) ?? 1) || 1,
      unitPriceCents: price ?? 0,
    });
  }
  let id: string;
  try {
    id = (
      await createQuote(actor, {
        patientId: String(formData.get("patientId")),
        validUntil: String(formData.get("validUntil") ?? "") || undefined,
        discountCents: parsePEN(String(formData.get("discount") ?? "")) ?? 0,
        notes: String(formData.get("notes") ?? "") || undefined,
        items,
      })
    ).id;
  } catch (error) {
    const message =
      error instanceof InvalidDiscountError
        ? "El descuento no puede superar el subtotal."
        : error instanceof ForbiddenError
          ? "Tu rol no puede crear cotizaciones."
          : error instanceof ZodError
            ? "Agrega al menos un ítem válido (descripción, cantidad y precio)."
            : "No se pudo crear la cotización.";
    redirect(`/cotizaciones/nueva?error=${encodeURIComponent(message)}`);
  }
  redirect(`/cotizaciones/${id}`);
}

export async function setStatusAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  try {
    await setQuoteStatus(
      userActor(ctx),
      id,
      String(formData.get("status")) as "sent" | "accepted" | "rejected" | "expired",
    );
  } catch (error) {
    const message =
      error instanceof QuoteLockedError
        ? "La cotización ya no se puede editar."
        : "Ese cambio de estado no es válido.";
    redirect(`/cotizaciones/${id}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/cotizaciones/${id}`);
  redirect(`/cotizaciones/${id}`);
}

export async function saveTreatmentAction(formData: FormData) {
  const ctx = await requireSession();
  const price = parsePEN(String(formData.get("price") ?? ""));
  try {
    await saveTreatment(userActor(ctx), {
      id: String(formData.get("id") ?? "") || undefined,
      name: String(formData.get("name") ?? ""),
      defaultPriceCents: price ?? -1,
      durationMinutes: Number(formData.get("minutes") ?? 30),
      active: formData.get("active") !== "off",
    });
  } catch (error) {
    const message =
      error instanceof ForbiddenError
        ? "Solo la administración gestiona el catálogo."
        : "Revisa nombre, precio y duración.";
    redirect(`/cotizaciones/catalogo?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/cotizaciones/catalogo");
  redirect("/cotizaciones/catalogo");
}
