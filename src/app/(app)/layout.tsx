import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/login/actions";
import { withService } from "@/lib/db";
import { requireSession } from "@/server/session";

// Everything under (app) depends on the session: never prerender it.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/pacientes", label: "Pacientes", roles: ["admin", "dentist", "assistant"] },
  { href: "/agenda", label: "Agenda", roles: ["admin", "dentist", "assistant"] },
  { href: "/cotizaciones", label: "Cotizaciones", roles: ["admin", "dentist"] },
  { href: "/cobros", label: "Cobros", roles: ["admin", "dentist", "assistant"] },
  { href: "/gastos", label: "Gastos", roles: ["admin"] },
  { href: "/resumen", label: "Resumen", roles: ["admin"] },
  {
    href: "/configuracion/equipo",
    label: "Configuración",
    roles: ["admin", "dentist", "assistant"],
  },
] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  const clinicName = await withService(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "select name from clinics where id = $1",
      [ctx.clinicId],
    );
    return rows[0]?.name ?? "";
  });
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-brand">{clinicName}</span>
          <nav aria-label="Principal" className="flex flex-1 flex-wrap gap-x-4 gap-y-1">
            {NAV.filter((item) => (item.roles as readonly string[]).includes(ctx.role)).map(
              (item) => (
                <Link key={item.href} href={item.href} className="min-h-11 py-2 hover:text-brand">
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <form action={signOut}>
            <button type="submit" className="min-h-11 text-sm text-ink-muted hover:text-brand">
              Cerrar sesión ({ctx.displayName})
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
