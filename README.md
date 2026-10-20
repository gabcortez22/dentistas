# Dentistas

Software web para clínicas dentales del Perú: historias clínicas (formato del Colegio Odontológico del Perú y NTS 139-MINSA), agenda con recordatorios por WhatsApp, sincronización con Google Calendar, cotizaciones con PDF, registro de cobros, control de gastos y un agente de WhatsApp que atiende y agenda citas.

> **Prototipo.** Úsalo solo con datos ficticios hasta resolver la lista de lanzamiento de `blueprints/dentistas/blueprint.md` §20.1 (Ley 29733, norma MINSA, Meta, Google).

## Requisitos

- Node 22.12+ (24 recomendado, ver `.nvmrc`)
- pnpm 12.14.0: `npm install -g pnpm@12.14.0` (Corepack falla con pnpm 12)
- Docker (solo para la base de datos de pruebas)
- Un proyecto de Supabase (autenticación y base de datos de la app)

## Puesta en marcha

```bash
cp .env.example .env     # completa las variables; ver §10 del blueprint
pnpm install
pnpm db:up               # Postgres 16 local para pruebas (puerto 54329)
pnpm db:migrate          # aplica supabase/migrations/ a DATABASE_URL
pnpm db:seed             # clínica demo con datos ficticios (admin@demo.test)
pnpm dev                 # http://localhost:3000
```

## Probar el agente sin WhatsApp real

1. Deja `WHATSAPP_MODE=simulator` y define `ANTHROPIC_API_KEY`.
2. Entra como administrador y abre **/simulador**: escribe como si fueras un paciente.
3. El agente identifica al paciente, ofrece horarios, propone la cita y la agenda cuando confirmas.

## Pruebas

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:unit            # sin base de datos
pnpm db:up && pnpm test:db
```

Las pruebas `db` recrean el esquema `public` de la base `dentistas_test`; se niegan a correr contra cualquier base cuyo nombre no termine en `_test`.

## Tareas programadas

`.github/workflows/cron.yml` llama cada 5 minutos a `/api/cron/tick` (recordatorios), `/api/google/cron` y `/api/whatsapp/cron`. Define los secretos `CRON_SECRET` y `APP_URL` en el repositorio.

## Cuentas externas

Supabase, Vercel, GitHub, Anthropic y, para uso real, Meta (WhatsApp Business) y Google Cloud (OAuth). Detalle en `blueprints/dentistas/blueprint.md` §10.
