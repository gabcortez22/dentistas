"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { isValidInviteCode } from "@/lib/registration";
import { supabaseServer } from "@/lib/supabase/server";
import { registerClinic } from "@/server/clinics";

export async function register(formData: FormData) {
  const input = {
    clinicName: String(formData.get("clinicName") ?? ""),
    adminName: String(formData.get("adminName") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  if (!isValidInviteCode(String(formData.get("inviteCode") ?? ""))) {
    const message = "El código de invitación no es válido o el registro está cerrado.";
    redirect(`/registro?error=${encodeURIComponent(message)}`);
  }
  try {
    await registerClinic(input);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "Revisa los datos: la contraseña debe tener al menos 10 caracteres y el correo ser válido."
        : "No se pudo registrar la clínica. Es posible que el correo ya esté en uso.";
    redirect(`/registro?error=${encodeURIComponent(message)}`);
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error) redirect("/login");
  redirect("/pacientes");
}
