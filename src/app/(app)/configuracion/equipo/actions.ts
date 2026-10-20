"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { addMember, LastAdminError, setMemberActive } from "@/server/clinics";
import { ForbiddenError, requireSession, userActor } from "@/server/session";

function back(error?: string): never {
  redirect(
    error ? `/configuracion/equipo?error=${encodeURIComponent(error)}` : "/configuracion/equipo",
  );
}

export async function addMemberAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await addMember(userActor(ctx), ctx.role, {
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "assistant") as "admin" | "dentist" | "assistant",
    });
  } catch (error) {
    if (error instanceof ForbiddenError) back("Solo la administración puede agregar miembros.");
    if (error instanceof ZodError)
      back("Revisa los datos: contraseña de al menos 10 caracteres y correo válido.");
    back("No se pudo agregar al miembro. Es posible que el correo ya esté en uso.");
  }
  revalidatePath("/configuracion/equipo");
  back();
}

export async function toggleMemberAction(formData: FormData) {
  const ctx = await requireSession();
  try {
    await setMemberActive(
      userActor(ctx),
      ctx.role,
      String(formData.get("membershipId")),
      formData.get("active") === "true",
    );
  } catch (error) {
    if (error instanceof LastAdminError)
      back("No puedes desactivar al último administrador activo.");
    if (error instanceof ForbiddenError)
      back("Solo la administración puede cambiar el estado de un miembro.");
    back("No se pudo actualizar al miembro.");
  }
  revalidatePath("/configuracion/equipo");
  back();
}
