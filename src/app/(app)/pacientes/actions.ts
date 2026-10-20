"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { recordDataConsent } from "@/server/patient-consent";
import {
  archivePatient,
  createPatient,
  DuplicatePatientError,
  updatePatient,
} from "@/server/patients";
import { requireSession, userActor } from "@/server/session";

const optional = (formData: FormData, key: string) => {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? undefined : value;
};

export async function createPatientAction(formData: FormData) {
  const ctx = await requireSession();
  const input = {
    docType: optional(formData, "docType") ?? "DNI",
    docNumber: String(formData.get("docNumber") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    birthDate: optional(formData, "birthDate"),
    sex: optional(formData, "sex"),
    birthPlace: optional(formData, "birthPlace"),
    maritalStatus: optional(formData, "maritalStatus"),
    educationLevel: optional(formData, "educationLevel"),
    occupation: optional(formData, "occupation"),
    address: optional(formData, "address"),
    email: optional(formData, "email"),
    religion: optional(formData, "religion"),
    race: optional(formData, "race"),
    originPlace: optional(formData, "originPlace"),
    guardianName: optional(formData, "guardianName"),
    phone: optional(formData, "phone"),
    guardianPhone: optional(formData, "guardianPhone"),
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
  };
  if (formData.get("dataConsent") !== "on") {
    const message =
      "Debes confirmar que el paciente autorizó el tratamiento de sus datos personales.";
    redirect(`/pacientes/nuevo?error=${encodeURIComponent(message)}`);
  }
  let id: string;
  try {
    id = (await createPatient(userActor(ctx), input)).id;
    await recordDataConsent(userActor(ctx), id);
  } catch (error) {
    const message =
      error instanceof DuplicatePatientError
        ? "Ya existe un paciente con ese documento en esta clínica."
        : error instanceof ZodError
          ? `Revisa los datos: ${error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`
          : "No se pudo guardar al paciente.";
    redirect(`/pacientes/nuevo?error=${encodeURIComponent(message)}`);
  }
  redirect(`/pacientes/${id}`);
}

export async function updatePatientAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id") ?? "");
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const patch = {
    lastName: text("lastName"),
    firstName: text("firstName"),
    birthDate: text("birthDate"),
    sex: text("sex"),
    birthPlace: text("birthPlace"),
    maritalStatus: text("maritalStatus"),
    educationLevel: text("educationLevel"),
    occupation: text("occupation"),
    address: text("address"),
    email: text("email"),
    religion: text("religion"),
    race: text("race"),
    originPlace: text("originPlace"),
    guardianName: text("guardianName"),
    phone: text("phone"),
    guardianPhone: text("guardianPhone"),
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
  };
  if (patch.whatsappOptIn && !patch.phone) {
    redirect(
      `/pacientes/${id}/editar?error=${encodeURIComponent("El consentimiento de WhatsApp requiere un teléfono.")}`,
    );
  }
  try {
    await updatePatient(userActor(ctx), id, patch);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `Revisa los datos: ${error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`
        : "No se pudo guardar los cambios.";
    redirect(`/pacientes/${id}/editar?error=${encodeURIComponent(message)}`);
  }
  redirect(`/pacientes/${id}`);
}

export async function archivePatientAction(formData: FormData) {
  const ctx = await requireSession();
  await archivePatient(userActor(ctx), String(formData.get("id")));
  redirect("/pacientes");
}

export async function recordDataConsentAction(formData: FormData) {
  const ctx = await requireSession();
  const id = String(formData.get("id") ?? "");
  await recordDataConsent(userActor(ctx), id);
  redirect(`/pacientes/${id}`);
}
