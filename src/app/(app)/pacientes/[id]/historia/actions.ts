"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { addEntry, addOdontogramMark, correctEntry, type EntryKind } from "@/server/clinical";
import { requireSession, userActor } from "@/server/session";

const val = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? undefined : v;
};

function bodyFor(kind: EntryKind, f: FormData): unknown {
  switch (kind) {
    case "anamnesis":
      return {
        motivoConsulta: val(f, "motivoConsulta"),
        informante: val(f, "informante"),
        tiempoEnfermedad: val(f, "tiempoEnfermedad"),
        signosSintomas: val(f, "signosSintomas"),
        relatoCronologico: val(f, "relatoCronologico"),
        funcionesBiologicas: val(f, "funcionesBiologicas"),
        enfermedadActual: val(f, "enfermedadActual"),
        antecedentesPersonales: val(f, "antecedentesPersonales"),
        antecedentesFamiliares: val(f, "antecedentesFamiliares"),
        alergias: val(f, "alergias"),
        medicacionActual: val(f, "medicacionActual"),
      };
    case "examen":
      return {
        extraoral: val(f, "extraoral"),
        intraoral: val(f, "intraoral"),
        examenClinicoGeneral: val(f, "examenClinicoGeneral"),
        funcionesVitales: {
          presionArterial: val(f, "presionArterial"),
          pulso: val(f, "pulso"),
          temperatura: val(f, "temperatura"),
          frecuenciaCardiaca: val(f, "frecuenciaCardiaca"),
          frecuenciaRespiratoria: val(f, "frecuenciaRespiratoria"),
        },
      };
    case "diagnostico":
      return {
        items: [
          { descripcion: val(f, "descripcion"), cie10: val(f, "cie10"), tipo: val(f, "tipo") },
        ],
      };
    case "tratamiento": {
      const pieza = val(f, "pieza");
      return {
        items: [{ descripcion: val(f, "descripcion"), pieza: pieza ? Number(pieza) : undefined }],
        plan: val(f, "plan"),
      };
    }
    case "evolucion":
    case "alta":
      return { texto: val(f, "texto") };
    case "consentimiento":
      return {
        procedimiento: val(f, "procedimiento"),
        texto: val(f, "texto"),
        aceptadoPor: val(f, "aceptadoPor"),
        fecha: val(f, "fecha"),
      };
  }
}

function fail(patientId: string, error: unknown): never {
  const message =
    error instanceof ZodError
      ? `Revisa los datos: ${error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`
      : "No se pudo guardar. Intenta de nuevo.";
  redirect(`/pacientes/${patientId}/historia?error=${encodeURIComponent(message)}`);
}

export async function addEntryAction(formData: FormData) {
  const ctx = await requireSession();
  const patientId = String(formData.get("patientId"));
  const kind = String(formData.get("kind")) as EntryKind;
  try {
    await addEntry(userActor(ctx), patientId, kind, bodyFor(kind, formData));
  } catch (error) {
    fail(patientId, error);
  }
  revalidatePath(`/pacientes/${patientId}/historia`);
  redirect(`/pacientes/${patientId}/historia`);
}

export async function correctEntryAction(formData: FormData) {
  const ctx = await requireSession();
  const patientId = String(formData.get("patientId"));
  try {
    await correctEntry(
      userActor(ctx),
      String(formData.get("entryId")),
      String(formData.get("texto") ?? ""),
    );
  } catch (error) {
    fail(patientId, error);
  }
  redirect(`/pacientes/${patientId}/historia`);
}

export async function addMarkAction(formData: FormData) {
  const ctx = await requireSession();
  const patientId = String(formData.get("patientId"));
  try {
    await addOdontogramMark(userActor(ctx), patientId, {
      tooth: Number(formData.get("tooth")),
      surface: val(formData, "surface"),
      condition: val(formData, "condition"),
    });
  } catch (error) {
    fail(patientId, error);
  }
  redirect(`/pacientes/${patientId}/historia#odontograma`);
}
