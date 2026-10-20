import Link from "next/link";
import { Alert, buttonClass, Field } from "@/app/_components/ui";
import { isRegistrationOpen } from "@/lib/registration";
import { register } from "./actions";

export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!isRegistrationOpen()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-3xl font-semibold text-brand">Registro cerrado</h1>
        <p className="mt-4 text-ink-muted">
          Las clínicas nuevas se crean por invitación. Si ya tienes cuenta, ingresa.
        </p>
        <p className="mt-4">
          <Link href="/login" className="text-brand underline">
            Ingresar
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">Registrar mi clínica</h1>
      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <form action={register} className="mt-6 space-y-4">
        <Field label="Código de invitación" name="inviteCode" type="password" required />
        <Field label="Nombre de la clínica" name="clinicName" required />
        <Field label="Tu nombre" name="adminName" required autoComplete="name" />
        <Field label="Correo electrónico" name="email" type="email" required autoComplete="email" />
        <Field
          label="Contraseña (mínimo 10 caracteres)"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
        <button type="submit" className={`${buttonClass} w-full`}>
          Crear clínica
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-brand underline">
          Ingresar
        </Link>
      </p>
    </main>
  );
}
