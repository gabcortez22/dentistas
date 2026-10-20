# Épica 04: Prospectos y seguimiento

> Existe un embudo de prospectos (nuevo → contactado → cita agendada → cotizado → ganado o perdido) con historial, tareas de seguimiento, seguimiento automático por WhatsApp con consentimiento, captura de prospectos por el agente y un tablero.

| | |
|---|---|
| **Id de la épica** | `04-prospectos` |
| **Tareas** | `E4-T1` … `E4-T3` (pasos 19 a 21) |
| **Depende de épicas** | `01-fundacion-pacientes-historia`, `02-agenda-recordatorios`, `03-finanzas-agente-entrega` |

## Diseño (autosuficiente)

**Datos (migración `20261020000013_prospects.sql`).** Toda tabla lleva `clinic_id` y RLS; nadie borra.
- `prospect_stage`: `new`, `contacted`, `appointment_booked`, `quoted`, `won`, `lost`. Fuente (`prospect_source`): `whatsapp`, `web`, `referral`, `walk_in`, `social`, `other`.
- `prospects`: id, clinic_id, `name`, `phone_e164` (E.164, opcional), `email`, `source`, `interest` (texto), `notes`, `stage`, `assigned_to` (membresía, opcional), `patient_id` (opcional, al convertir), `lost_reason`, `whatsapp_opt_in` (consentimiento explícito), `created_at`, `updated_at`. Único parcial `(clinic_id, phone_e164)` mientras la etapa sea `new`, `contacted`, `appointment_booked` o `quoted`.
- `prospect_events` (solo agregar, trigger `forbid_mutation`): `kind` (`created`, `stage_change`, `note`, `contact_attempt`, `converted`, `auto`), `body` (jsonb), `author_membership_id` (nulo si lo hizo el sistema o el agente).
- `followup_tasks`: `prospect_id`, `due_at`, `kind` (`call`, `whatsapp`, `other`), `note`, `status` (`pending`, `done`, `cancelled`), `done_at`, `assigned_to`, `auto_key` (texto, único por `prospect_id` cuando no es nulo: hace idempotente la generación automática).
- Triggers `security definer` que avanzan la etapa y registran un evento `auto`: cita insertada para el paciente enlazado ⇒ `appointment_booked`; cotización insertada ⇒ `quoted`; cotización que pasa a `accepted` ⇒ `won`.
- Permisos: admin, dentista y asistente leen y escriben prospectos, eventos (solo insertar) y tareas de su clínica.

**Servicios (`src/server/prospects.ts`).** `createProspect` (devuelve el existente si el teléfono ya es de un prospecto abierto), `listProspects`, `getProspect` (con eventos y tareas), `moveStage` (permite avanzar, retroceder a `contacted` y cerrar como `lost` con motivo obligatorio), `addNote`, `scheduleFollowup`, `completeFollowup`, `listDueFollowups`, `convertToPatient` (reusa `createPatient`; nunca duplica un documento) y `prospectSummary`.

**Seguimiento automático (`src/server/followups.ts`).** `generateAutoFollowups`: tarea "contactar" para prospectos abiertos en `new`/`contacted` sin eventos en 2 días; tarea "dar seguimiento a la cotización" para cotizaciones `sent` de más de 3 días (usa `auto_key`). `sendDueWhatsappFollowups`: solo si el prospecto dio consentimiento (`whatsapp_opt_in`), envía la plantilla `seguimiento_prospecto` (utility, es; parámetros: nombre, clínica) por el `WhatsAppSender`; sin consentimiento la tarea queda para una persona. Ruta `/api/prospects/cron` (bearer, pública para el proxy) llama a ambas; el programador de GitHub Actions la agrega.

**Agente.** Nueva herramienta `capture_prospect` ({ name, interest }): solo si el chat no tiene paciente identificado; crea un prospecto con el teléfono del chat y fuente `whatsapp` (sin consentimiento de recordatorios hasta que el paciente lo diga); idempotente por teléfono. La lista blanca pasa a **9** herramientas.

**Interfaz.** `/prospectos` (columnas por etapa con conteos y tasa de conversión), `/prospectos/[id]` (historial, notas, programar seguimiento, mover de etapa, convertir en paciente), `/prospectos/seguimientos` (tareas vencidas y de hoy, completar). Entrada "Prospectos" en la navegación para los tres roles. Textos en español; estados vacío, de carga y de error; todo operable por teclado.

**Fuera de alcance:** campañas masivas, importación de listas, puntuación automática de prospectos, integración con redes sociales o formularios web (se puede crear un prospecto a mano o por WhatsApp).

---

### E4-T1 — Step 19: Prospectos: etapas, historial y seguimientos

| | |
|---|---|
| **Depende de** | `E1-T5`, `E2-T2`, `E3-T1` |
| **Prioridad** | p1 |
| **Archivos** | `supabase/migrations/20261020000013_prospects.sql`, `src/server/prospects.ts`, `tests/db/prospects.test.ts`, `tests/db/prospects-service.test.ts` |
| **Etiqueta** | `step-19-prospects-data` |

**Acceptance**
- [ ] WHEN a prospect is created with a phone that already belongs to an open prospect of the same clinic THE SYSTEM SHALL return the existing prospect instead of creating a duplicate.
- [ ] WHEN `moveStage` moves a prospect THE SYSTEM SHALL append a `stage_change` event with the previous and new stage, and WHEN the new stage is `lost` without a reason THE SYSTEM SHALL throw a `ZodError` naming `lostReason`.
- [ ] WHEN an appointment is inserted for the patient linked to a prospect in stage `new` or `contacted` THE SYSTEM SHALL set the prospect to `appointment_booked`, and WHEN a quote is inserted THE SYSTEM SHALL set it to `quoted`, and WHEN that quote becomes `accepted` THE SYSTEM SHALL set it to `won`, each with an automatic event.
- [ ] WHEN `convertToPatient` receives valid patient data THE SYSTEM SHALL create the patient, link it to the prospect, and append a `converted` event; WHEN the document already exists THE SYSTEM SHALL throw `DuplicatePatientError` and leave the prospect unlinked.
- [ ] WHEN `scheduleFollowup` and `completeFollowup` run THE SYSTEM SHALL list the task in `listDueFollowups` only while it is pending and due, and mark it done with `done_at`.
- [ ] WHEN a user of another clinic queries prospects, events or follow-ups THE SYSTEM SHALL return no rows, and `prospect_events` SHALL reject UPDATE and DELETE.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/prospects.test.ts
pnpm test:db tests/db/prospects-service.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 19: prospects-data"
git tag step-19-prospects-data
```

---

### E4-T2 — Step 20: Seguimiento automático y captura por el agente

| | |
|---|---|
| **Depende de** | `E4-T1`, `E3-T6` |
| **Prioridad** | p1 |
| **Archivos** | `src/server/followups.ts`, `src/app/api/prospects/cron/route.ts`, `src/server/agent-tools.ts`, `src/lib/whatsapp/client.ts`, `tests/db/followups*.test.ts` |
| **Etiqueta** | `step-20-prospects-automation` |

**Acceptance**
- [ ] WHEN `generateAutoFollowups` runs THE SYSTEM SHALL create one pending task for each open prospect in stage `new` or `contacted` with no event in the last 2 days, and one for each `sent` quote older than 3 days, and WHEN it runs again THE SYSTEM SHALL create no duplicates.
- [ ] WHEN `sendDueWhatsappFollowups` runs for a due task whose prospect has WhatsApp consent THE SYSTEM SHALL send the template `seguimiento_prospecto` through the injected sender, append a `contact_attempt` event and mark the task done; WHEN the prospect has no consent THE SYSTEM SHALL leave the task pending for a person and send nothing.
- [ ] WHEN the scripted model calls `capture_prospect` on a conversation whose patient is not identified THE SYSTEM SHALL create a prospect with the chat phone and source `whatsapp`, and WHEN the same phone calls it again THE SYSTEM SHALL not create a second one.
- [ ] WHEN `capture_prospect` receives a conversation whose patient is already identified THE SYSTEM SHALL return an error result and create nothing, and the agent allow-list SHALL contain exactly the 9 documented tools.
- [ ] WHEN `POST /api/prospects/cron` receives a missing or wrong bearer token THE SYSTEM SHALL answer 401, and WHEN it receives the cron secret THE SYSTEM SHALL answer 200 with a JSON summary.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/followups.test.ts
pnpm test:db tests/db/agent-tools.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 20: prospects-automation"
git tag step-20-prospects-automation
```

---

### E4-T3 — Step 21: Prospectos: tablero, ficha y seguimientos del día

| | |
|---|---|
| **Depende de** | `E4-T2` |
| **Prioridad** | p1 |
| **Archivos** | `src/app/(app)/prospectos/**`, `src/app/(app)/layout.tsx`, `src/server/prospects.ts`, `tests/db/prospects-summary.test.ts` |
| **Etiqueta** | `step-21-prospects-ui` |

**Acceptance**
- [ ] WHEN `prospectSummary` runs THE SYSTEM SHALL return the count of prospects per stage and the conversion rate `won / (won + lost)` as a number or null when there is no closed prospect.
- [ ] WHEN `pnpm build` runs THE SYSTEM SHALL exit 0 and the route list SHALL include `/prospectos`, `/prospectos/[id]` and `/prospectos/seguimientos`.
- [ ] WHEN the navigation renders for an admin, dentist or assistant THE SYSTEM SHALL include the link `Prospectos`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/prospects-summary.test.ts
pnpm typecheck
pnpm lint
pnpm build > "${TMPDIR:-/tmp}/dentistas-build.log" 2>&1 && grep -q '/prospectos' "${TMPDIR:-/tmp}/dentistas-build.log"
```

**Checkpoint**
```bash
git add -A && git commit -m "step 21: prospects-ui"
git tag step-21-prospects-ui
```

## Aceptación de la épica
- [ ] `git rev-parse --verify step-19-prospects-data`, `step-20-prospects-automation` y `step-21-prospects-ui` salen 0.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` salen 0 sobre el árbol resultante.
