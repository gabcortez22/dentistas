import Link from "next/link";
import { buttonClass } from "@/app/_components/ui";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">Dentistas</h1>
      <p className="mt-3 text-ink-muted">
        Historias clínicas, agenda de citas, cotizaciones y cobros para tu clínica dental.
      </p>
      <Link href="/login" className={`${buttonClass} mt-6 inline-flex items-center`}>
        Iniciar sesión
      </Link>
      <p className="mt-8 text-sm text-ink-muted">
        <Link href="/privacidad" className="underline">
          Política de privacidad
        </Link>
      </p>
    </main>
  );
}
