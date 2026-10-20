"use server";

import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { DuplicatePatientError } from "@/server/patients";
import {
  addNote,
  completeFollowup,
  convertToPatient,
  createProspect,
  moveStage,
  type Source,
  type Stage,
  scheduleFollowup,
} from "@/server/prospects";
import { requireSession, userActor } from "@/server/session";

const val = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || undefined;
function go(path: string, error?: string): never {
  redirect(
    error ? `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}` : path,
  );
}

export async function createProspectAction(formData: FormData) {
  const ctx = await requireSession();
  let id: string;
  try {
    const { prospect } = await createProspect(userActor(ctx), {
      name: String(formData.get("name") ?? ""),
      phone: val(formData, "phone"),
      email: val(formData, "email"),
      source: (val(formData, "source") ?? "other") as Source,
      interest: val(formData, "interest"),
      whatsappOptIn: formData.get("whatsappOptIn") === "on",
    });
    id = prospect.id;
  } catch (error) {
    go(
      "/prospectos",
      error instanceof ZodError
        ? `Revisa los datos: ${error.issues.map((i) => i.path.join(".")).join(", ")}`
        : "No se pudo crear el prospecto.",
    );
  }
  revalidatePath("/prospectos");
  redirect(`/prospectos/${id}`);
}

export async function moveStageAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  try {
    await moveStage(userActor(ctx), id, String(formData.get("stage")) as Stage, {
      lostReason: val(formData, "lostReason"),
    });
  } catch (error) {
    go(
      `/prospectos/${id}`,
      error instanceof ZodError
        ? "Indica el motivo para cerrar como perdido."
        : "No se pudo cambiar la etapa.",
    );
  }
  revalidatePath(`/prospectos/${id}`);
  redirect(`/prospectos/${id}`);
}

export async function addNoteAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  try {
    await addNote(userActor(ctx), id, String(formData.get("text") ?? ""));
  } catch {
    go(`/prospectos/${id}`, "Escribe una nota.");
  }
  revalidatePath(`/prospectos/${id}`);
  redirect(`/prospectos/${id}`);
}

export async function scheduleFollowupAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  const due = DateTime.fromISO(String(formData.get("dueAt") ?? ""), { zone: "America/Lima" });
  if (!due.isValid) go(`/prospectos/${id}`, "Elige fecha y hora del seguimiento.");
  try {
    await scheduleFollowup(userActor(ctx), id, {
      dueAt: due.toJSDate(),
      kind: (val(formData, "kind") ?? "call") as "call",
      note: val(formData, "note"),
    });
  } catch {
    go(`/prospectos/${id}`, "No se pudo programar el seguimiento.");
  }
  revalidatePath(`/prospectos/${id}`);
  redirect(`/prospectos/${id}`);
}

export async function completeFollowupAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await completeFollowup(userActor(ctx), String(formData.get("taskId")));
  } catch {
    go("/prospectos/seguimientos", "La tarea ya no está pendiente.");
  }
  revalidatePath("/prospectos/seguimientos");
  redirect("/prospectos/seguimientos");
}

export async function convertAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id"));
  let patientId: string;
  try {
    patientId = (
      await convertToPatient(userActor(ctx), id, {
        docType: val(formData, "docType") ?? "DNI",
        docNumber: String(formData.get("docNumber") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        firstName: String(formData.get("firstName") ?? ""),
      })
    ).id;
  } catch (error) {
    go(
      `/prospectos/${id}`,
      error instanceof DuplicatePatientError
        ? "Ya existe un paciente con ese documento en esta clínica."
        : error instanceof ZodError
          ? "Revisa el documento y los nombres."
          : "No se pudo convertir en paciente.",
    );
  }
  redirect(`/pacientes/${patientId}`);
}
