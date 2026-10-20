"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { archivePatient, createPatient, DuplicatePatientError } from "@/server/patients";
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
    guardianName: optional(formData, "guardianName"),
    phone: optional(formData, "phone"),
    guardianPhone: optional(formData, "guardianPhone"),
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
  };
  let id: string;
  try {
    id = (await createPatient(userActor(ctx), input)).id;
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

export async function archivePatientAction(formData: FormData) {
  const ctx = await requireSession();
  await archivePatient(userActor(ctx), String(formData.get("id")));
  redirect("/pacientes");
}
