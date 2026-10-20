import Link from "next/link";
import { safeNext } from "@/lib/auth-paths";
import { isRegistrationOpen } from "@/lib/registration";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">Ingresar</h1>
      {error ? (
        <p role="alert" className="mt-4 rounded-control border border-danger px-3 py-2 text-danger">
          Correo o contraseña incorrectos.
        </p>
      ) : null}
      <form action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeNext(next)} />
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Correo electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
          />
        </div>
        <button
          type="submit"
          className="min-h-11 w-full rounded-control bg-brand px-4 font-medium text-white hover:bg-brand-hover"
        >
          Ingresar
        </button>
      </form>
      {isRegistrationOpen() ? (
        <p className="mt-4 text-sm text-ink-muted">
          <Link href="/registro" className="text-brand underline">
            Registrar mi clínica
          </Link>
        </p>
      ) : null}
    </main>
  );
}
