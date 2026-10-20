import type { Metadata } from "next";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";

export const metadata: Metadata = { title: "Política de privacidad · Dentistas" };

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-semibold text-brand">Política de privacidad</h1>
      <p role="note" className="rounded-control border border-line px-3 py-2 text-ink-muted">
        Texto provisional (versión {PRIVACY_POLICY_VERSION}). Debe ser revisado por un abogado
        peruano antes de usar datos reales de pacientes.
      </p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Qué datos tratamos</h2>
        <p>
          La clínica registra datos de identificación y contacto, y datos de salud (historia
          clínica, odontograma, tratamientos, cotizaciones y cobros). Los datos de salud son datos
          personales sensibles según la Ley N° 29733, Ley de Protección de Datos Personales.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Para qué los usamos</h2>
        <p>
          Para brindar la atención odontológica, llevar la historia clínica conforme a la NTS
          139-MINSA, programar citas, enviar recordatorios por WhatsApp (solo con autorización
          expresa) y gestionar cotizaciones y cobros.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Quién accede</h2>
        <p>
          Solo el personal autorizado de la clínica. Cada apertura de una historia clínica queda
          registrada. Los asistentes no acceden a la historia clínica ni a las finanzas.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Transferencia a otros países</h2>
        <p>
          Para brindar el servicio, algunos de tus datos se envían a proveedores cuyos servidores
          están fuera del Perú. La clínica solo los usa para los fines indicados en esta política.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Supabase</strong> (Brasil): almacena la base de datos de la clínica, incluidos
            tus datos de identificación, contacto, historia clínica, citas, cotizaciones y cobros.
          </li>
          <li>
            <strong>Vercel</strong> (Estados Unidos) [confirmar la región configurada]: aloja la
            aplicación por la que el personal de la clínica accede a esos datos.
          </li>
          <li>
            <strong>Meta (WhatsApp)</strong> (Estados Unidos y otros países): transmite los
            recordatorios de cita y los mensajes con la clínica, que incluyen tu nombre y tu número
            de teléfono. Solo si lo autorizaste.
          </li>
          <li>
            <strong>Anthropic</strong> (Estados Unidos): procesa los mensajes que escribes al
            asistente automático de WhatsApp de la clínica para responderte y agendar citas. El
            asistente no accede a tu historia clínica.
          </li>
          <li>
            <strong>Google</strong> (Estados Unidos y otros países): sincroniza las citas con el
            calendario del dentista.
          </li>
        </ul>
        <p>
          Estos proveedores aplican medidas de seguridad y de confidencialidad, y la clínica
          restringe el acceso a su personal autorizado. [Abogado: confirmar que los contratos con
          cada proveedor ofrecen un nivel de protección adecuado y si corresponde informar este
          flujo a la Autoridad Nacional de Protección de Datos Personales.]
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Conservación</h2>
        <p>
          Las historias clínicas se conservan por el plazo que fija la NTS 139-MINSA. [Verificar el
          plazo y el procedimiento de archivo.]
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Tus derechos</h2>
        <p>
          Puedes ejercer tus derechos de acceso, rectificación, cancelación y oposición ante la
          clínica. Los registros clínicos no se eliminan: se corrigen agregando una nueva entrada, y
          la cancelación se evalúa según los plazos de conservación. [Completar con el medio de
          contacto de la clínica.]
        </p>
      </section>
    </main>
  );
}
