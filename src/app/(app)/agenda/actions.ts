"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  bookAppointment,
  cancelAppointment,
  OutsideAvailabilityError,
  rescheduleAppointment,
  SlotTakenError,
} from "@/server/appointments";
import { requireSession, userActor } from "@/server/session";

const bookSchema = z.object({
  patientId: z.uuid(),
  dentistId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  minutes: z.coerce.number().int().min(5).max(480),
  reason: z.string().trim().max(500).optional(),
});

function message(error: unknown): string {
  if (error instanceof SlotTakenError) return "Ese horario acaba de ocuparse, elige otro.";
  if (error instanceof OutsideAvailabilityError) return "Ese horario no está disponible.";
  return "No se pudo guardar la cita.";
}

export async function bookAction(formData: FormData) {
  const ctx = await requireSession();
  const parsed = bookSchema.safeParse({
    patientId: formData.get("patientId"),
    dentistId: formData.get("dentistId"),
    startsAt: formData.get("startsAt"),
    minutes: formData.get("minutes"),
    reason: String(formData.get("reason") ?? "") || undefined,
  });
  if (!parsed.success)
    redirect(`/agenda/nueva?error=${encodeURIComponent("Elige paciente, dentista y horario.")}`);
  try {
    await bookAppointment(userActor(ctx), {
      patientId: parsed.data.patientId,
      membershipId: parsed.data.dentistId,
      startsAt: new Date(parsed.data.startsAt),
      durationMinutes: parsed.data.minutes,
      reason: parsed.data.reason,
      source: "web",
    });
  } catch (error) {
    redirect(`/agenda/nueva?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/agenda");
  redirect("/agenda");
}

export async function cancelAction(formData: FormData) {
  const ctx = await requireSession();
  await cancelAppointment(userActor(ctx), String(formData.get("id")));
  revalidatePath("/agenda");
  redirect("/agenda");
}

export async function rescheduleAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  const startsAt = String(formData.get("startsAt") ?? "");
  const minutes = Number(formData.get("minutes") ?? 30);
  try {
    await rescheduleAppointment(userActor(ctx), id, {
      startsAt: new Date(startsAt),
      durationMinutes: minutes,
    });
  } catch (error) {
    redirect(`/agenda/${id}/reprogramar?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath("/agenda");
  redirect("/agenda");
}
