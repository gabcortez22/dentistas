import { Alert, buttonClass, Card, Field, secondaryButtonClass } from "@/app/_components/ui";
import { listMembers } from "@/server/clinics";
import { requireSession, userActor } from "@/server/session";
import { addMemberAction, toggleMemberAction } from "./actions";

const ROLE_LABEL = { admin: "Administrador", dentist: "Dentista", assistant: "Asistente" } as const;

export default async function EquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await requireSession();
  const members = await listMembers(userActor(ctx));
  const isAdmin = ctx.role === "admin";
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-brand">Equipo</h1>
      {error ? <Alert>{error}</Alert> : null}
      <Card>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Miembros del equipo</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2">
                Nombre
              </th>
              <th scope="col">Rol</th>
              <th scope="col">Estado</th>
              {isAdmin ? <th scope="col">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line">
                <td className="py-3">{m.displayName}</td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td>{m.active ? "Activo" : "Inactivo"}</td>
                {isAdmin ? (
                  <td>
                    <form action={toggleMemberAction}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <input type="hidden" name="active" value={String(!m.active)} />
                      <button type="submit" className={secondaryButtonClass}>
                        {m.active ? "Desactivar" : "Activar"}
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {isAdmin ? (
        <Card title="Agregar miembro">
          <form action={addMemberAction} className="grid max-w-md gap-4">
            <Field label="Nombre" name="displayName" required />
            <Field
              label="Correo electrónico"
              name="email"
              type="email"
              required
              autoComplete="off"
            />
            <Field
              label="Contraseña inicial (mínimo 10 caracteres)"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
            <div>
              <label htmlFor="role" className="block text-sm font-medium">
                Rol
              </label>
              <select
                id="role"
                name="role"
                className="mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3"
              >
                <option value="dentist">Dentista</option>
                <option value="assistant">Asistente</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <button type="submit" className={buttonClass}>
              Agregar
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
