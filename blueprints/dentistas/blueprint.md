# Dentistas — Blueprint

> Generado por The Architect el 2026-10-20
> Forma: `saas-webapp` (+ capacidades: motor de disponibilidad, agente de IA, pagos registrados) · `knowledge/shapes/saas-webapp.md`
> Pista de ejecución: TypeScript / Node · `knowledge/runtime-tracks/ts-node.md`
> Modo de emisión: bundle (18 pasos)
> Versión del blueprint: 2 (estado tras el despliegue en Supabase, 2026-10-20: 15 migraciones, 21 pasos hechos; desviaciones en `BUILD-NOTES.md`)
> Versiones verificadas por última vez: 2026-10-20 — procedencia por paquete en §11

---


---

## 1. Resumen del proyecto y no-objetivos

### Visión
**Dentistas** es un software web para clínicas dentales del Perú. Reúne en un solo lugar la **historia clínica** de cada paciente (siguiendo la NTS 139-MINSA/2018/DGAIN), la **agenda de citas** con recordatorios por WhatsApp y sincronización con Google Calendar, las **cotizaciones** al paciente, el **registro de cobros**, el **control de gastos** y un **agente de WhatsApp** que responde, agenda y reprograma citas. Sin él, la clínica lleva todo en papel, hojas de cálculo y chats sueltos: citas olvidadas, historias incompletas y cobros sin control.

### Usuarios
- **Dentista:** atiende pacientes, lee y escribe la historia clínica, arma cotizaciones, ve su agenda.
- **Asistente:** registra pacientes y citas y cobros; **no** ve historias clínicas, cotizaciones ni finanzas.
- **Administrador de la clínica:** todo lo anterior más equipo, horarios, catálogo de tratamientos, anulaciones, gastos y resumen financiero.
- **Paciente:** no inicia sesión; interactúa solo por WhatsApp (agente y recordatorios).
Escala del prototipo: 1 clínica de prueba, 1 a 5 dentistas, cientos de pacientes. El diseño es multi-clínica desde el primer día (cada fila lleva `clinic_id`), pero un usuario pertenece a una sola clínica.

### Objetivos — alcance de v1 (prototipo para un cliente que espera probarlo)
1. Clínicas con varios dentistas, roles `admin` / `dentist` / `assistant` y datos aislados por clínica (RLS).
2. Pacientes con filiación completa, búsqueda y archivo (nunca borrado).
3. Historia clínica de solo agregar (anamnesis, examen, diagnóstico, tratamiento, evolución, consentimiento, odontograma) con registro de accesos.
4. Agenda por dentista, sin doble reserva, con horarios, bloqueos y zona horaria `America/Lima`.
5. Recordatorios 24 h y 2 h antes por WhatsApp (plantilla aprobada) con modo simulador.
6. Sincronización con Google Calendar del dentista (publicar citas, leer ocupado).
7. Catálogo de tratamientos, cotizaciones con PDF, registro de cobros con abonos y saldos.
8. Control de gastos y resumen mensual de ingresos menos gastos (solo admin).
9. Agente de WhatsApp (identifica, ofrece horarios, propone y agenda con confirmación, cancela, informa saldo, deriva a una persona) y simulador para demostrarlo sin Meta.

**Corte de entrega por tandas** (cada tanda termina en algo que el cliente puede probar): tras el paso 9 (pacientes, historia, agenda); tras el 11 (recordatorios y Google); tras el 15 (cotizaciones, cobros, gastos); tras el 17 (agente de WhatsApp). Si el tiempo aprieta, se recortan primero los pasos `p1` (11, 13, 18) y se entrega lo demás.

### Non-Goals — fuera de v1
| Fuera de alcance | Por qué | Vuelve cuando |
|---|---|---|
| Boletas y facturas electrónicas SUNAT | Obligación tributaria propia; las cotizaciones y cobros son internos | el cliente pase a producción y su contador lo exija |
| Pasarela de pago en línea (tarjeta/Yape dentro de la app) | Los cobros se **registran**, no se procesan | haya volumen de cobros a distancia |
| App móvil nativa | La web responsive basta para el prototipo | los dentistas pidan uso sin conexión |
| Inicio de sesión del paciente / portal del paciente | El paciente usa WhatsApp | haya demanda de ver historial en línea |
| Un usuario en varias clínicas | `memberships.user_id` es único; simplifica RLS | un dentista trabaje en dos clínicas |
| Imágenes y radiografías, subida de archivos | Requiere almacenamiento, antivirus y retención | el cliente lo pida |
| Mensajes de audio e imágenes en el agente | El agente responde solo a texto | uso real lo muestre necesario |
| Envío de PDF de cotización por WhatsApp | Requiere subida de medios a Meta | tras validar el agente |
| Pruebas E2E automatizadas | El prototipo se valida con gates de servicio y un checklist manual | antes de producción con pacientes reales |
| SSO, auditoría empresarial, exportación para auditoría MINSA | Más allá de un prototipo | clínicas con más de una sede |
| Recordatorios por correo o SMS | Un canal (WhatsApp) basta | pacientes sin WhatsApp |

### Métricas de éxito
- El cliente de prueba completa, sin ayuda, el flujo: registrar paciente → abrir historia → agendar cita → ver el recordatorio en el simulador → cotizar → registrar un abono.
- 0 dobles reservas: la prueba de concurrencia (50 solicitudes, 1 éxito) pasa en cada ejecución.
- El agente agenda correctamente una cita de punta a punta en el simulador en menos de 6 mensajes.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` en verde en una copia limpia.

---

## 2. Stack técnico

| Capa | Elección | Por qué |
|---|---|---|
| Runtime | Node.js 24 LTS (`.nvmrc`; funciona desde 22.12) | LTS vigente a 2026-10-20; es lo que exige Vitest 5 (`^22.12 \|\| ^24 \|\| >=26`) |
| Gestor de paquetes | pnpm 12.14.0 (instalado con `npm install -g`; Corepack falla con pnpm 12) | Instalaciones estrictas y reproducibles; verificado en el arranque |
| Framework | Next.js 16 (App Router) + React 19 | Una sola base de código para UI, Server Actions y webhooks; `after()` para procesar WhatsApp sin bloquear |
| Lenguaje | TypeScript 6.0 (estricto, `noUncheckedIndexedAccess`) | Un lenguaje de punta a punta |
| Estilos | Tailwind CSS 4 con tokens en `@theme` | Tokens de §7 como única fuente; sin librería de componentes (menos piezas que fallan en el prototipo) |
| Base de datos | PostgreSQL 16 en Supabase | RLS por clínica y la restricción de exclusión (`btree_gist`) que impide el doble agendado |
| Acceso a datos | `pg` directo, SQL explícito, sin ORM | Un ORM esconde la restricción de exclusión y las políticas RLS que son el corazón del diseño; con `pg` los tests corren sobre Postgres plano |
| Autenticación | Supabase Auth (correo + contraseña) vía `@supabase/ssr` | Un solo proveedor de identidad; solo autentica, los datos no pasan por PostgREST |
| Validación | zod 4 | En cada frontera (formularios, rutas, herramientas del agente) |
| Fechas y zonas | luxon (IANA) | Reglas en hora de pared local, instantes en UTC |
| PDF | @react-pdf/renderer | Renderiza en Node sin navegador |
| Agente | `@anthropic-ai/sdk` con herramientas | El bucle de decisión es el producto; salvaguardas en el servidor |
| WhatsApp | API oficial Cloud API de Meta (+ simulador) | Cumple la política de plantillas y consentimiento; el simulador evita depender de Meta |
| Calendario | Google Calendar REST con `fetch` | Dos endpoints y OAuth: `googleapis` sería una dependencia enorme |
| Lint/formato | Biome 2 | Una herramienta; `tailwindDirectives` activado |
| Pruebas | Vitest 5 (proyectos `unit` y `db`) | Rápido; `db` corre sobre Postgres 16 local |
| Hosting | Vercel (web) + Supabase (base y auth) + GitHub Actions (cron de 5 min) | Despliegue sin servidores propios |

### Versiones fijadas
Todas las versiones de abajo son **exactas** (sin `^`) y salen del registro de npm consultado el 2026-10-20; la procedencia de cada una está en §11.

| Paquete | Versión | Tipo | Para qué |
|---|---|---|---|
| `next` | 16.4.2 | runtime | Framework full-stack (App Router, Server Actions, `proxy.ts`) |
| `react` | 19.3.1 | runtime | UI |
| `react-dom` | 19.3.1 | runtime | UI |
| `pg` | 8.23.1 | runtime | Acceso directo a Postgres con RLS |
| `@supabase/supabase-js` | 2.118.0 | runtime | Cliente de Supabase Auth (administración de usuarios) |
| `@supabase/ssr` | 0.12.7 | runtime | Sesión de Supabase Auth con cookies en Next.js |
| `zod` | 4.6.7 | runtime | Validación de entradas (formularios, rutas, herramientas del agente) |
| `luxon` | 3.7.2 | runtime | Zonas horarias (IANA) para la agenda |
| `@anthropic-ai/sdk` | 0.135.0 | runtime | Modelo del agente de WhatsApp |
| `@react-pdf/renderer` | 4.9.0 | runtime | PDF de cotizaciones |
| `typescript` | 6.0.3 | dev | Lenguaje (línea 6.x; la 7.0.2 existe pero se deja fuera: sin API de compilador estable) |
| `tailwindcss` | 4.3.3 | dev | Estilos |
| `@tailwindcss/postcss` | 4.3.3 | dev | Integración de Tailwind con PostCSS |
| `@biomejs/biome` | 2.5.15 | dev | Lint + formato |
| `vitest` | 5.0.5 | dev | Pruebas (proyectos `unit` y `db`) |
| `tsx` | 4.23.15 | dev | Scripts (`migrate`, `seed`) |
| `@types/node` | 24.19.2 | dev | Tipos de Node 24 |
| `@types/react` | 19.3.0 | dev | Tipos |
| `@types/react-dom` | 19.3.0 | dev | Tipos |
| `@types/pg` | 8.23.1 | dev | Tipos |
| `@types/luxon` | 3.7.6 | dev | Tipos |

### Compatibility check
Revisado contra `knowledge/stack-compatibility.md` de The Architect: ninguna de sus filas "known-bad" aplica. Esta es una afirmación sobre esa tabla, no sobre todo el stack.
- *Dos proveedores de identidad:* no aplica; solo Supabase Auth.
- *Linter con parser CSS propio + Tailwind 4:* resuelto en `biome.json` (`css.parser.tailwindDirectives: true`) y comprobado ejecutando `pnpm lint` sobre el esqueleto.
- *Driver TCP + runtime sin sockets:* no aplica; todo corre en el runtime de Node (no Edge). `proxy.ts` solo usa `@supabase/ssr`.
- *Conexiones por solicitud + Postgres sin pooler:* la app usa el *transaction pooler* de Supabase; `pg` no usa sentencias preparadas con nombre y `set local` ocurre dentro de la transacción, que es compatible con ese modo.
- *Diseño de proceso largo + host por solicitud:* no hay planificador en proceso; recordatorios, sincronización y barrido se disparan por HTTP desde GitHub Actions.
- Desviación respecto de la fila "Default SaaS" del Architect: Supabase Auth en lugar de Clerk (fila "Lean SaaS"), porque el prototipo no necesita organizaciones ni invitaciones de un proveedor externo.

---

## 3. Estructura de directorios

```
.
├── blueprints/dentistas/             # este bundle (no se compila ni se lintea; ver §19.6)
├── supabase/migrations/              # SQL en orden de nombre; lo escriben los pasos 2, 5, 6, 8, 10, 11, 12, 14, 15, 16
├── scripts/
│   ├── migrate.ts                    # aplica migraciones (workspace)
│   ├── serve-check.sh                # arranca el servidor de producción y prueba /api/health (workspace)
│   └── seed.ts                       # datos de demostración (paso 18)
├── src/
│   ├── proxy.ts                      # sesión Supabase + redirección a /login (paso 3)
│   ├── app/
│   │   ├── layout.tsx · page.tsx · globals.css       # paso 1
│   │   ├── (auth)/login · registro/                  # pasos 3 y 4
│   │   ├── (app)/                                     # área autenticada
│   │   │   ├── layout.tsx                             # navegación por rol (paso 4)
│   │   │   ├── pacientes/ · pacientes/[id]/historia/  # pasos 5 y 6
│   │   │   ├── agenda/ · configuracion/{equipo,horarios,google}/  # pasos 4, 9, 11
│   │   │   ├── cotizaciones/ · cobros/ · gastos/ · resumen/       # pasos 12, 14, 15
│   │   │   └── simulador/                             # paso 17 (solo admin)
│   │   └── api/
│   │       ├── health/ · availability/                # pasos 1 y 9
│   │       ├── cron/{auth.ts,tick/}                   # paso 10
│   │       ├── google/{oauth/start,oauth/callback,cron}/   # paso 11
│   │       ├── quotes/[id]/pdf/                       # paso 13
│   │       └── whatsapp/{webhook,cron}/               # paso 17
│   ├── lib/
│   │   ├── env.ts · db.ts · auth-paths.ts · phone.ts · money.ts
│   │   ├── supabase/server.ts
│   │   ├── availability/generate-slots.ts            # función pura (paso 7)
│   │   ├── whatsapp/client.ts · google/ · pdf/ · agent/
│   └── server/                       # servicios: session, clinics, patients, clinical, availability, appointments,
│                                     # schedules, reminders, quotes, charges, expenses, agent-tools, inbound
├── tests/
│   ├── unit/                         # sin base de datos
│   └── db/                           # con Postgres: global-setup.ts y helpers.ts vienen en el workspace
├── .github/workflows/{ci.yml,cron.yml}               # paso 18
├── CLAUDE.md · AGENTS.md · .claude/                  # workspace
└── package.json · tsconfig.json · biome.json · vitest.config.ts · docker-compose.yml · .env.example · …
```

---

## 4. Modelo de datos

Todo el SQL exacto está en los pasos que lo crean (§9); esta sección es el mapa. **Reglas transversales:** cada tabla de negocio lleva `clinic_id` y RLS; `authenticated` no puede `DELETE` ni `TRUNCATE` en ninguna; el dinero son céntimos enteros de PEN; los instantes son `timestamptz` (UTC) y las fechas locales son `date`.

### Entidades
| Entidad (tabla) | Migración / paso | Qué guarda | Notas |
|---|---|---|---|
| `clinics` | foundation · 2 | Clínica, zona horaria (`America/Lima`), moneda PEN, `whatsapp_phone_number_id` | |
| `memberships` | foundation · 2 | Usuario ↔ clínica, rol, nombre visible, activo | `user_id` único: una clínica por usuario |
| `patients` | patients · 5 | Filiación, documento, teléfono E.164, consentimiento WhatsApp | `hc_number = doc_number`; archivo, no borrado |
| `clinical_entries` | clinical · 6 | Entradas de historia clínica por tipo, `body jsonb` | solo agregar; correcciones apuntan a la original |
| `odontogram_marks` | clinical · 6 | Marca por pieza FDI y superficie | solo agregar; estado actual = última marca |
| `record_access_log` | clinical · 6 | Quién abrió qué historia y cuándo | solo agregar; lo lee el admin |
| `availability_rules` / `availability_exceptions` | scheduling · 8 | Horario semanal local y bloqueos/aperturas | reglas en hora de pared local |
| `appointments` | scheduling · 8 | Citas por dentista | restricción de exclusión anti doble reserva |
| `external_busy` | scheduling · 8 | Caché de ocupado de Google | solo orientativa |
| `reminders` / `whatsapp_messages` | reminders · 10 | Recordatorios y bitácora de mensajes | trigger mantiene recordatorios |
| `google_connections` | google · 11 | Conexión OAuth por dentista | token cifrado; el navegador no lo lee |
| `treatments` / `quote_counters` / `quotes` / `quote_items` | quotes · 12 | Catálogo y cotizaciones | numeración por clínica; estados solo hacia adelante |
| `charges` / `charge_voids` + vista `quote_balances` | charges · 14 | Cobros inmutables y anulaciones | saldo = ítems − descuento − cobros no anulados |
| `expenses` / `expense_voids` + vista `monthly_summary` | expenses · 15 | Gastos inmutables y resumen mensual | solo admin |
| `agent_conversations` / `agent_turns` / `appointment_proposals` | agent · 16 | Estado del agente y propuestas de cita | agendar exige propuesta previa |

### Relaciones
- `clinics` 1—N `memberships`, `patients`, `treatments`, `quotes`, `charges`, `expenses`, `appointments`, `agent_conversations`.
- `patients` 1—N `clinical_entries`, `odontogram_marks`, `appointments`, `quotes`, `charges`.
- `memberships` (dentista) 1—N `availability_rules`, `availability_exceptions`, `appointments`, `external_busy`; 1—1 `google_connections`.
- `quotes` 1—N `quote_items`; `quotes` 1—N `charges`; `charges` 1—0..1 `charge_voids`.
- `appointments` 1—N `reminders`; `agent_conversations` 1—N `agent_turns` y `appointment_proposals`.
- Todas las claves foráneas son `on delete restrict`: nada se borra en cascada.

### Índices
Ver el SQL de cada paso. Los críticos: `appointments_no_overlap` (GiST de exclusión, único autoritativo contra el doble agendado), `patients (clinic_id, doc_type, doc_number)` y `(clinic_id, hc_number)` únicos, `reminders_due_idx` parcial sobre `pending`, `whatsapp_messages.wa_message_id` único (idempotencia del webhook) y `agent_conversations_open_idx` parcial (una conversación abierta por clínica y teléfono).

### Esquema
SQL literal por migración: foundation (§9 paso 2), patients (5), clinical (6), scheduling (8), reminders (10), google (11), quotes (12), charges (14), expenses (15), agent (16). Se aplican en orden de nombre de archivo con `pnpm db:migrate`; se verificó que las diez corren de principio a fin sobre PostgreSQL 16.

### Migraciones
`scripts/migrate.ts` (en el workspace) aplica los `.sql` de `supabase/migrations/` ordenados, cada uno en una transacción, y registra el nombre en `public._migrations`. Es idempotente. **Nunca se edita una migración ya aplicada**: se agrega otra. Las funciones y políticas usan `auth.uid()`; en pruebas lo provee un stub (§19.6), en Supabase es el real.

### Datos de prueba (seed)
`scripts/seed.ts` (paso 18): una clínica demo con 1 admin, 2 dentistas, 1 asistente, 8 pacientes **ficticios** (DNI `00000001`–`00000008`), horarios y 5 tratamientos. Idempotente.

---

## 5. Diseño de API

### Convenciones
- La mayoría de las mutaciones son **Server Actions** (`"use server"`) que llaman a `src/server/*`; no hay API REST pública.
- Las rutas HTTP son solo para integraciones y descargas: salud, disponibilidad (JSON para la UI), PDF, OAuth de Google, webhook de WhatsApp y tareas programadas.
- Errores de rutas: `{ "error": "<código>" }` con el estado HTTP correcto (401 sin sesión, 403 sin permiso, 404 no encontrado o de otra clínica, 400 parámetros inválidos).
- Fechas en ISO 8601 UTC; importes en céntimos enteros.
- Los servicios lanzan errores con nombre (`ForbiddenError`, `SlotTakenError`, `DuplicatePatientError`, `OverpaymentError`…) que las acciones traducen a mensajes en español.

### Rutas
| Método y ruta | Auth | Paso | Qué hace |
|---|---|---|---|
| `GET /api/health` | pública | 1 | `{"status":"ok"}` |
| `GET /api/availability?dentist&from&to&minutes` | sesión | 9 | slots libres de un dentista |
| `GET|POST /api/cron/tick` | bearer `CRON_SECRET` | 10 | envía recordatorios vencidos |
| `GET /api/google/oauth/start` | sesión | 11 | redirige a Google con `state` firmado |
| `GET /api/google/oauth/callback` | `state` firmado | 11 | guarda la conexión |
| `GET|POST /api/google/cron` | bearer | 11 | sincroniza Google Calendar |
| `GET /api/quotes/[id]/pdf` | sesión (admin/dentista) | 13 | PDF de la cotización |
| `GET|POST /api/whatsapp/webhook` | token de verificación / firma HMAC | 17 | entrada de mensajes |
| `GET|POST /api/whatsapp/cron` | bearer | 17 | procesa mensajes pendientes |

### Endpoints críticos — detalle
**`POST /api/whatsapp/webhook`** — solicitud: cuerpo de Meta (`entry[].changes[].value.messages[]`) y cabecera `X-Hub-Signature-256: sha256=<hex>`. Respuestas: 200 siempre que la firma sea válida (aunque el mensaje se ignore, para no revelar qué números existen), 401 firma inválida en modo `cloud`, 403 en el `GET` de verificación con token incorrecto. Idempotencia por `wa_message_id`. El procesamiento ocurre después de responder (`after()`) y un barrido (`/api/whatsapp/cron`) recoge lo que quedó en `received` más de 60 s.

**`GET /api/availability`** — parámetros: `dentist` (uuid de membresía), `from`, `to` (ISO), `minutes` (5–480). Respuesta 200: `{ "slots": [{ "startsAt": "2027-03-01T14:00:00.000Z", "endsAt": "2027-03-01T14:30:00.000Z" }] }`. Orientativa: la reserva revalida.

**Rutas de cron** — `Authorization: Bearer <CRON_SECRET>`; 401 sin token o con token distinto; 200 con un resumen JSON.

---

## 6. Arquitectura del frontend

### Rutas
| Ruta | Rol | Contenido |
|---|---|---|
| `/`, `/login`, `/registro` | pública | portada, ingreso, alta de clínica |
| `/pacientes`, `/pacientes/nuevo`, `/pacientes/[id]` | todos | buscador, alta, ficha |
| `/pacientes/[id]/historia` | admin, dentista | historia clínica y odontograma |
| `/agenda` | todos | semana por dentista, nueva cita, cancelar/reprogramar |
| `/cotizaciones`, `/cotizaciones/nueva`, `/cotizaciones/[id]`, `/cotizaciones/catalogo` | admin, dentista (catálogo: admin) | cotizaciones |
| `/cobros` | todos (anular: admin) | registro de cobros |
| `/gastos`, `/resumen` | admin | gastos y resumen mensual |
| `/configuracion/equipo`, `/horarios`, `/google` | admin (horarios/google: cada dentista los suyos) | ajustes |
| `/simulador` | admin | probar el agente sin Meta |

### Estrategia de renderizado
Server Components por defecto; las páginas leen datos en el servidor con los servicios. `"use client"` solo para interacciones (selector de horarios, odontograma, formularios con validación en vivo). Mutaciones con Server Actions. Todas las páginas de `(app)` son dinámicas (dependen de la sesión).

### Jerarquía de componentes
`RootLayout` → `(app)/layout` (barra de navegación por rol) → página → secciones. Componentes compartidos mínimos y propios (botón, campo con etiqueta, tabla, aviso `role="alert"`, tarjeta) en `src/app/_components/`, creados por el primer paso que los necesite.

### Gestión de estado
Sin librería de estado global. El estado vive en el servidor (base de datos) y en la URL (`searchParams`: filtros, semana visible). Estado local de React solo dentro de componentes cliente.

### Estados de carga, vacío y error
Cada lista tiene estado vacío con texto útil ("Aún no hay pacientes"), `loading.tsx` donde la consulta es lenta y `error.tsx` por segmento; los errores de formulario se muestran en `role="alert"` en español.

---

## 7. Sistema de diseño

**Dirección:** limpio y clínico, solo tema claro, color principal verde azulado, mucho aire, alto contraste. Los valores viven en `src/app/globals.css` (`@theme`, paso 1); ningún componente usa hex sueltos.

### Colores
| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `brand` | `#0f766e` | acciones primarias, enlaces, encabezados | 5.5:1 sobre blanco |
| `brand-hover` | `#115e59` | hover/activo | 7.6:1 |
| `brand-soft` | `#ccfbf1` | fondos suaves, selección | — |
| `canvas` | `#f8fafc` | fondo de página | — |
| `surface` | `#ffffff` | tarjetas | — |
| `line` | `#e2e8f0` | bordes | — |
| `ink` | `#0f172a` | texto principal | 17:1 sobre canvas |
| `ink-muted` | `#475569` | texto secundario | 7.2:1 sobre canvas |
| `ok` / `warn` / `danger` / `info` | `#15803d` / `#b45309` / `#b91c1c` / `#1d4ed8` | estados | ≥ 4.5:1 sobre blanco |

### Tipografía
Pila del sistema (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`): cero descargas de red y cero fallos de build sin Internet. Escala: 14 px para tablas y metadatos, 16 px cuerpo, 20 px subtítulos, 30 px título de página (`text-3xl font-semibold text-brand`). Interlineado cómodo (1.5 en cuerpo).

### Espaciado, radio y elevación
Base de 4 px (escala de Tailwind). Contenedor `max-w-6xl` con gutter de 16 px en móvil. Radios: `--radius-card: 0.75rem`, `--radius-control: 0.5rem`. Elevación mínima: bordes `line` en lugar de sombras; sombra suave solo en menús.

### Movimiento
Sin animaciones decorativas. Transiciones de 150 ms en hover/foco. Respeta `prefers-reduced-motion`.

### Estilo de componentes
Botón primario: fondo `brand`, texto blanco, radio de control, altura mínima 44 px. Campos con `<label>` visible, borde `line`, foco con el anillo `:focus-visible` global. Tablas con encabezado fijo y filas de al menos 44 px. Avisos con texto, nunca solo color.

---

## 8. Autenticación y autorización

### Proveedor y justificación
**Supabase Auth** (correo + contraseña), sin proveedores sociales ni enlaces mágicos en v1. Solo autentica: la sesión viaja en cookies (`@supabase/ssr`) y los datos se leen con `pg` bajo RLS. Descartado Clerk: agrega un servicio y un webhook de sincronización que el prototipo no necesita.

### Flujos
- **Registro de clínica:** `/registro` → `registerClinic` crea el usuario (confirmado) con la API de administración, la clínica y la membresía admin en una transacción; si la transacción falla borra el usuario; luego inicia sesión.
- **Ingreso:** `/login` → `signInWithPassword` → `safeNext(next)` (nunca redirige a otro sitio).
- **Equipo:** el admin agrega miembros con correo y contraseña inicial; puede desactivarlos (nunca borrarlos); no puede desactivar al último admin.

### Protección de rutas
`src/proxy.ts` refresca la sesión y redirige a `/login?next=…`; falla cerrado si falta la configuración. Cada página privada vuelve a comprobar con `requireSession()` y `requireRole()`; el proxy no es la única barrera. Públicas: `/`, `/login`, `/registro`, `/api/health`, `/api/whatsapp/*`, `/api/cron/*`, `/api/google/cron`, `/api/google/oauth/callback` (las de integración se autentican solas).

### Roles y permisos
| Recurso | admin | dentist | assistant |
|---|---|---|---|
| Pacientes (ver, crear, editar, archivar) | sí | sí | sí |
| Historia clínica y odontograma | leer y escribir | leer y escribir | **no** |
| Registro de accesos a historias | leer | no | no |
| Agenda (ver, agendar, cancelar, reprogramar) | sí | sí | sí |
| Horarios y bloqueos | de cualquiera | solo los propios | no |
| Google Calendar | todos | el propio | no |
| Catálogo de tratamientos | gestionar | leer | leer |
| Cotizaciones | sí | sí | **no** |
| Cobros: registrar | sí | sí | sí |
| Cobros: anular | sí | no | no |
| Gastos y resumen financiero | sí | **no** | **no** |
| Equipo y simulador | sí | no | no |

### Sesiones
Cookies HTTP-only gestionadas por `@supabase/ssr`; el proxy las refresca en cada solicitud. Cierre de sesión con `signOut`.

### Multi-tenencia y aislamiento por fila
Cada tabla de negocio tiene `clinic_id` y políticas RLS basadas en `current_clinic_ids()` y `current_role_in()` (funciones `security definer` con `search_path` fijo). Las solicitudes de usuario corren como el rol `authenticated` con `auth.uid()` fijado dentro de la transacción (`withTenant`); los procesos sin usuario (webhook, cron, agente) usan `withService` y **filtran siempre por `clinic_id`**. Los tests demuestran que otra clínica no ve nada y que cada rol solo ve lo suyo.

---

## 9. ORDEN DE CONSTRUCCIÓN

**18 pasos, 3 épicas** (6 + 5 + 7). Este bundle trae `tasks.json` (el estado) y `epics/` (cada épica se puede ejecutar sin abrir este archivo). Un paso de §9 = una tarea de `tasks.json` = un bloque de tarea en su épica.

### Reglas de un paso
1. **Un paso cabe en una sentada:** como máximo 5 archivos (los directorios con `**` cuentan como uno) y entre 2 y 6 criterios de aceptación.
2. Cada paso tiene **Do**, **Done when**, **Verify** y **Checkpoint**. El Checkpoint es un bloque de shell: confirma y etiqueta `step-NN-slug`; esa etiqueta es el punto de retorno del paso siguiente.
3. Las condiciones de **Done when** son observables y automatizables (formato EARS: WHEN … THE SYSTEM SHALL …).
4. **Verify** es shell literal, se ejecuta desde la **raíz del proyecto** y cada línea sale 0 cuando el paso está correcto.
5. Un paso no está hecho hasta que sus verificaciones pasan **y** las de los pasos anteriores siguen pasando.
6. Si un paso falla dos veces: `git reset --hard` a la etiqueta del paso anterior y reintentar; no se depura hacia adelante sobre un punto de control roto.
7. No se salta ningún paso. Si el paso N está bloqueado, se detiene y se informa.
8. Los pasos con base de datos empiezan con `pnpm db:up` (idempotente) y usan Postgres 16 en el puerto 54329.
9. El Bootstrap de §10 ya creó el repositorio, instaló dependencias y copió `workspace/`; **no** es un paso.

### Mapa de pasos
| # | Paso | Depende de | Toca | Compuerta |
|---|---|---|---|---|
| 1 | Esqueleto de la app y endpoint de salud | — | 5 archivos | `pnpm typecheck` |
| 2 | Base de datos: clínicas, membresías, RLS y capa de acceso | 1 | 5 archivos | `pnpm test:unit tests/unit/env.test.ts` |
| 3 | Autenticación: proxy, sesión y pantalla de ingreso | 2 | 5 archivos | `pnpm test:unit tests/unit/auth-paths.test.ts` |
| 4 | Registro de clínica, equipo y roles | 3 | 5 archivos | `pnpm test:db tests/db/clinics.test.ts` |
| 5 | Pacientes: alta, búsqueda y archivo | 4 | 5 archivos | `pnpm test:db tests/db/patients.test.ts` |
| 6 | Historia clínica y odontograma (solo se agrega) | 5 | 5 archivos | `pnpm test:db tests/db/clinical.test.ts` |
| 7 | Motor de disponibilidad (función pura) | 1 | 2 archivos | `pnpm test:unit tests/unit/generate-slots.test.ts` |
| 8 | Citas: reservas sin doble reserva y servicio de agenda | 2, 5, 7 | 5 archivos | `pnpm test:db tests/db/booking.test.ts` |
| 9 | Agenda: horarios del dentista y pantalla de citas | 8, 4 | 5 archivos | `pnpm test:db tests/db/schedules.test.ts` |
| 10 | Recordatorios por WhatsApp (con simulador) y cron | 8, 5 | 5 archivos | `pnpm test:db tests/db/reminders.test.ts` |
| 11 | Google Calendar: conexión, publicación de citas y bloqueos | 8, 10 | 5 archivos | `pnpm test:db tests/db/google.test.ts` |
| 12 | Catálogo de tratamientos y cotizaciones | 5, 4 | 5 archivos | `pnpm test:db tests/db/quotes.test.ts` |
| 13 | PDF de la cotización | 12 | 4 archivos | `pnpm test:unit tests/unit/quote-pdf.test.ts` |
| 14 | Registro de cobros y saldos | 12, 8 | 4 archivos | `pnpm test:db tests/db/charges.test.ts` |
| 15 | Control de gastos y resumen mensual | 14 | 5 archivos | `pnpm test:db tests/db/expenses.test.ts` |
| 16 | Agente de WhatsApp: herramientas, bucle y salvaguardas | 8, 14, 10 | 4 archivos | `pnpm test:db tests/db/agent-tools.test.ts` |
| 17 | WhatsApp entrante: webhook, simulador y derivación | 16 | 4 archivos | `pnpm test:db tests/db/inbound.test.ts` |
| 18 | CI, datos de demostración y entrega | 17, 15, 11, 13, 9 | 5 archivos | `pnpm test:db tests/db/seed.test.ts` |

### Épicas
- `epics/01-fundacion-pacientes-historia.md` — Fundación, pacientes e historia clínica: pasos 1 a 6.
- `epics/02-agenda-recordatorios.md` — Agenda, recordatorios y Google Calendar: pasos 7 a 11.
- `epics/03-finanzas-agente-entrega.md` — Finanzas, agente de WhatsApp y entrega: pasos 12 a 18.

---

#### Step 1 — Esqueleto de la app y endpoint de salud

**Do**
El proyecto ya existe: §10 (Bootstrap) copió `workspace/` a la raíz, instaló dependencias y creó el repositorio. Este paso escribe el esqueleto de la aplicación y el endpoint de salud que más adelante sirve de prueba de humo del servidor de producción. Crea exactamente estos archivos (tokens de diseño de §7 en `globals.css`; el idioma de la interfaz es español peruano):

`src/app/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-brand: #0f766e;
  --color-brand-hover: #115e59;
  --color-brand-soft: #ccfbf1;
  --color-canvas: #f8fafc;
  --color-surface: #ffffff;
  --color-line: #e2e8f0;
  --color-ink: #0f172a;
  --color-ink-muted: #475569;
  --color-ok: #15803d;
  --color-warn: #b45309;
  --color-danger: #b91c1c;
  --color-info: #1d4ed8;
  --font-sans:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --radius-card: 0.75rem;
  --radius-control: 0.5rem;
}

html {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
```

`src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dentistas",
  description: "Gestión de clínicas dentales: historias clínicas, citas, cotizaciones y cobros.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE">
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">Dentistas</h1>
      <p className="mt-3 text-ink-muted">
        Historias clínicas, agenda de citas, cotizaciones y cobros para tu clínica dental.
      </p>
    </main>
  );
}
```

`src/app/api/health/route.ts`

```ts
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
```

`tests/unit/health.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("answers 200 with { status: 'ok' }", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
```

El `scripts/serve-check.sh` que usa el último comando de verificación ya viene en `workspace/` (§19.6).

**Done when**
- [ ] WHEN `pnpm install --frozen-lockfile` runs THE SYSTEM SHALL exit 0 and leave `pnpm-lock.yaml` unchanged.
- [ ] WHEN `pnpm typecheck` and `pnpm lint` run with the `blueprints/` directory present in the tree THE SYSTEM SHALL exit 0 with zero errors and zero warnings.
- [ ] WHEN `pnpm test:unit tests/unit/health.test.ts` runs THE SYSTEM SHALL pass a test asserting that the health handler answers status 200 with the JSON body `{ "status": "ok" }`.
- [ ] WHEN `pnpm build` has completed and `bash scripts/serve-check.sh` runs THE SYSTEM SHALL start the production server, receive exactly `{"status":"ok"}` from `/api/health`, and stop the server.

**Verify**
```bash
pnpm install --frozen-lockfile
git diff --quiet -- pnpm-lock.yaml
pnpm typecheck
pnpm lint
pnpm test:unit tests/unit/health.test.ts
pnpm build
bash scripts/serve-check.sh
```

**Checkpoint**
```bash
git add -A && git commit -m "step 1: scaffold"
git tag step-01-scaffold
git rev-parse --verify step-01-scaffold   # expect: a commit id, exit 0
```

---

#### Step 2 — Base de datos: clínicas, membresías, RLS y capa de acceso

**Do**
Capa de datos y tenencia (multi-clínica). Decisiones que este paso fija para todo el proyecto: (1) **cada tabla de negocio lleva `clinic_id` y RLS**; (2) **nadie borra**: `authenticated` no tiene `DELETE`/`TRUNCATE` en ningún lado; (3) el servidor accede a Postgres directamente con `pg` (no PostgREST), dentro de una transacción que fija `auth.uid()` y el rol `authenticated`, de modo que las mismas políticas RLS protegen la web y los tests; (4) un usuario pertenece a una sola clínica en v1 (`memberships.user_id` único).

Crea la migración (SQL exacto), la validación de entorno por grupos y el acceso a base de datos, más los tests. Las variables se validan **al usarlas**, no al importar, para no romper los gates de pasos anteriores (§10, columna "Requerida desde el paso").

`supabase/migrations/20261020000001_foundation.sql`

```sql
-- supabase/migrations/20261020000001_foundation.sql
-- Tenancy foundation: clinics, memberships, helper functions, RLS, grants.
create extension if not exists btree_gist;

-- Authenticated users may read/insert/update but NEVER delete or truncate: no hard deletes anywhere.
alter default privileges in schema public grant select, insert, update on tables to authenticated;
alter default privileges in schema public revoke delete, truncate on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant usage, select on sequences to authenticated;
grant usage on schema public to authenticated;

create type member_role as enum ('admin', 'dentist', 'assistant');

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Lima',
  currency text not null default 'PEN' check (currency = 'PEN'),
  whatsapp_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  user_id uuid not null unique references auth.users (id) on delete restrict,
  role member_role not null,
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index memberships_clinic_idx on memberships (clinic_id);

create function current_clinic_ids() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select clinic_id from public.memberships where user_id = auth.uid() and active
$$;

create function current_role_in(p_clinic uuid) returns member_role
language sql stable security definer set search_path = public, auth as $$
  select role from public.memberships
  where user_id = auth.uid() and clinic_id = p_clinic and active
$$;

create function is_clinic_admin(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.current_role_in(p_clinic) = 'admin', false)
$$;

alter table clinics enable row level security;
alter table memberships enable row level security;

create policy clinics_select on clinics for select to authenticated
  using (id in (select current_clinic_ids()));
create policy clinics_update on clinics for update to authenticated
  using (is_clinic_admin(id)) with check (is_clinic_admin(id));

create policy memberships_select on memberships for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy memberships_admin_insert on memberships for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy memberships_admin_update on memberships for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
```

`src/lib/env.ts`

```ts
import { z } from "zod";

// Variables are validated per group, when the code that needs them first runs, never at import time.
// That keeps every earlier build step's gate green before the secret for a later step exists.
const groups = {
  core: z.object({ DATABASE_URL: z.string().min(1) }),
  supabase: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  }),
  supabaseAdmin: z.object({ SUPABASE_SECRET_KEY: z.string().min(1) }),
  app: z.object({ APP_URL: z.url() }),
  cron: z.object({ CRON_SECRET: z.string().min(16) }),
  crypto: z.object({
    TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "must be 32 bytes, base64-encoded",
    }),
  }),
  google: z.object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
  }),
  whatsapp: z
    .object({
      WHATSAPP_MODE: z.enum(["simulator", "cloud"]).default("simulator"),
      WHATSAPP_ACCESS_TOKEN: z.string().optional(),
      WHATSAPP_APP_SECRET: z.string().optional(),
      WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.WHATSAPP_MODE !== "cloud") return;
      for (const key of [
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when WHATSAPP_MODE=cloud",
          });
      }
    }),
  anthropic: z.object({
    ANTHROPIC_API_KEY: z.string().min(1),
    AGENT_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  }),
} as const;

export type EnvGroup = keyof typeof groups;

export function getEnv<G extends EnvGroup>(group: G): z.infer<(typeof groups)[G]> {
  const result = groups[group].safeParse(process.env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables for "${group}": ${names}`);
  }
  return result.data as z.infer<(typeof groups)[G]>;
}
```

`src/lib/db.ts`

```ts
import { Pool, type PoolClient } from "pg";
import { getEnv } from "@/lib/env";

const globalForPool = globalThis as unknown as { __dentistasPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__dentistasPool) {
    const { DATABASE_URL } = getEnv("core");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
    globalForPool.__dentistasPool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPool.__dentistasPool;
}

export async function closePool(): Promise<void> {
  await globalForPool.__dentistasPool?.end();
  globalForPool.__dentistasPool = undefined;
}

async function inTransaction<T>(
  setup: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs fn as the signed-in user: same role and auth.uid() a PostgREST request would have, so RLS applies. */
export function withTenant<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  }, fn);
}

/** Runs fn as the database owner, bypassing RLS. Only for webhooks, cron and the agent: always scope by clinic_id. */
export function withService<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async () => {}, fn);
}

/**
 * Who is acting. Services take an Actor and always filter by actor.clinicId, even when RLS would
 * already do it: a user actor runs under RLS, a service actor (webhook, cron, agent) bypasses it.
 */
export type Actor =
  | { kind: "user"; userId: string; clinicId: string; membershipId: string }
  | { kind: "service"; clinicId: string };

export function runAs<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return actor.kind === "user" ? withTenant(actor.userId, fn) : withService(fn);
}
```

`tests/unit/env.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("getEnv", () => {
  it("names the missing variable and the group", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv("core")).toThrow(/"core".*DATABASE_URL/);
  });

  it("does not require a later step's variables", () => {
    process.env.DATABASE_URL = "postgres://x";
    expect(getEnv("core").DATABASE_URL).toBe("postgres://x");
  });

  it("defaults WHATSAPP_MODE to simulator and demands tokens only in cloud mode", () => {
    delete process.env.WHATSAPP_MODE;
    expect(getEnv("whatsapp").WHATSAPP_MODE).toBe("simulator");
    process.env.WHATSAPP_MODE = "cloud";
    expect(() => getEnv("whatsapp")).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("rejects a TOKEN_ENC_KEY that is not 32 bytes", () => {
    process.env.TOKEN_ENC_KEY = Buffer.from("short").toString("base64");
    expect(() => getEnv("crypto")).toThrow(/TOKEN_ENC_KEY/);
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(getEnv("crypto").TOKEN_ENC_KEY).toHaveLength(44);
  });
});
```

`tests/db/foundation.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool, runAs, withService, withTenant } from "@/lib/db";
import {
  addMember,
  asUser,
  closePool,
  createClinic,
  createUser,
  pool,
  seedClinic,
} from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

describe("tenancy foundation", () => {
  it("a member sees only their own clinic and its memberships", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const clinics = await asUser(a.admin.userId, (c) => c.query("select id from clinics"));
    expect(clinics.rows).toEqual([{ id: a.clinicId }]);
    const members = await asUser(a.assistant.userId, (c) =>
      c.query("select clinic_id from memberships"),
    );
    expect(members.rows.every((r) => r.clinic_id === a.clinicId)).toBe(true);
    expect(members.rowCount).toBe(3);
    const other = await asUser(b.admin.userId, (c) =>
      c.query("select id from clinics where id = $1", [a.clinicId]),
    );
    expect(other.rowCount).toBe(0);
  });

  it("only an admin can add memberships to a clinic", async () => {
    const a = await seedClinic();
    const newUser = await createUser();
    const insert = (userId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'assistant', 'Nueva')",
          [a.clinicId, newUser],
        ),
      );
    await expect(insert(a.dentist.userId)).rejects.toThrow(/row-level security/);
    await insert(a.admin.userId);
  });

  it("a user belongs to at most one clinic", async () => {
    const a = await seedClinic();
    const b = await createClinic();
    await expect(
      pool.query(
        "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'dentist', 'Doble')",
        [b, a.dentist.userId],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("authenticated can never delete or truncate, and anon has no access", async () => {
    const privilege = async (role: string, table: string, op: string) =>
      (await pool.query("select has_table_privilege($1, $2, $3) as ok", [role, table, op])).rows[0]
        .ok as boolean;
    expect(await privilege("authenticated", "clinics", "DELETE")).toBe(false);
    expect(await privilege("authenticated", "memberships", "TRUNCATE")).toBe(false);
    expect(await privilege("anon", "clinics", "SELECT")).toBe(false);
    const a = await seedClinic();
    await expect(
      asUser(a.admin.userId, (c) =>
        c.query("delete from memberships where clinic_id = $1", [a.clinicId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("withTenant applies RLS and withService bypasses it", async () => {
    const a = await seedClinic();
    await seedClinic();
    const tenant = await withTenant(a.dentist.userId, (c) => c.query("select id from clinics"));
    expect(tenant.rowCount).toBe(1);
    const service = await withService((c) => c.query("select count(*)::int as n from clinics"));
    expect(service.rows[0].n).toBeGreaterThan(1);
  });

  it("addMember helper creates one membership per role", async () => {
    const clinicId = await createClinic();
    const { membershipId } = await addMember(clinicId, "dentist");
    expect(membershipId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runAs picks RLS for a user actor and bypasses it for a service actor", async () => {
    const a = await seedClinic();
    await seedClinic();
    const user = await runAs(
      {
        kind: "user",
        userId: a.assistant.userId,
        clinicId: a.clinicId,
        membershipId: a.assistant.membershipId,
      },
      (c) => c.query("select id from clinics"),
    );
    expect(user.rowCount).toBe(1);
    const service = await runAs({ kind: "service", clinicId: a.clinicId }, (c) =>
      c.query("select id from clinics"),
    );
    expect(service.rowCount).toBeGreaterThan(1);
  });
});
```

Notas: `withTenant` ejecuta como el usuario (RLS activo); `withService` ejecuta como propietario y solo se usa en webhooks, cron y el agente, **siempre filtrando por `clinic_id`**. `Actor`/`runAs` son el tipo que reciben todos los servicios de pasos posteriores.

**Done when**
- [ ] WHEN `pnpm test:db tests/db/foundation.test.ts` runs against an empty `dentistas_test` database THE SYSTEM SHALL apply the foundation migration and pass all 7 tests in that file.
- [ ] WHEN a user of clinic A queries `clinics` or `memberships` under the `authenticated` role THE SYSTEM SHALL return only clinic A rows, and WHEN a non-admin inserts a membership THE SYSTEM SHALL reject it with a row-level-security error.
- [ ] WHEN `authenticated` attempts `DELETE` or `TRUNCATE` on any table THE SYSTEM SHALL refuse with `permission denied`, and `anon` SHALL have no `SELECT` on `clinics`.
- [ ] WHEN `getEnv('core')` runs without `DATABASE_URL` THE SYSTEM SHALL throw an error naming the group `core` and the variable, and WHEN no later-step variable is set THE SYSTEM SHALL still load `core` successfully.
- [ ] WHEN `pnpm db:migrate` runs a second time against an already-migrated database THE SYSTEM SHALL exit 0 and print `up to date`.

**Verify**
```bash
pnpm db:up
pnpm test:unit tests/unit/env.test.ts
pnpm test:db tests/db/foundation.test.ts
DATABASE_URL=postgres://postgres:postgres@localhost:54329/dentistas_test pnpm db:migrate | grep -qx 'up to date'
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 2: tenancy-db"
git tag step-02-tenancy-db
git rev-parse --verify step-02-tenancy-db   # expect: a commit id, exit 0
```

---

#### Step 3 — Autenticación: proxy, sesión y pantalla de ingreso

**Do**
Autenticación con **Supabase Auth (correo + contraseña)**. Supabase solo autentica; los datos van por `src/lib/db.ts`. En Next.js 16 el antiguo `middleware.ts` se llama **`src/proxy.ts`** y exporta `proxy` (verificado: el build lo lista como `Proxy (Middleware)`). Falla **cerrado**: sin configuración de auth, nada privado se sirve.

`src/lib/auth-paths.ts`

```ts
const PUBLIC_PREFIXES = [
  "/login",
  "/registro",
  "/api/health",
  "/api/whatsapp",
  "/api/cron",
  "/api/google/cron",
  "/api/google/oauth/callback",
];

/** Paths that answer without a session. Webhook and cron routes authenticate themselves (signature / bearer secret). */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Only same-site absolute paths are valid post-login targets; anything else falls back. */
export function safeNext(next: string | null | undefined, fallback = "/pacientes"): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
```

`src/proxy.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "@/lib/auth-paths";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Fail closed: without auth configuration nothing private may be served.
    return isPublicPath(pathname)
      ? NextResponse.next()
      : new NextResponse("Authentication is not configured", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the session with Supabase and refreshes the cookies when needed.
  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

`src/lib/supabase/server.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

/** Supabase client bound to the request's cookies. Used for authentication only; data goes through src/lib/db.ts. */
export async function supabaseServer() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } =
    getEnv("supabase");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies: proxy.ts refreshes the session.
        }
      },
    },
  });
}
```

`tests/unit/auth-paths.test.ts`

```ts
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicPath, safeNext } from "@/lib/auth-paths";
import { proxy } from "@/proxy";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/login",
    "/registro",
    "/api/health",
    "/api/whatsapp/webhook",
    "/api/whatsapp/cron",
    "/api/cron/tick",
    "/api/google/cron",
    "/api/google/oauth/callback",
  ])("%s is public", (path) => expect(isPublicPath(path)).toBe(true));
  it.each([
    "/pacientes",
    "/agenda",
    "/api/availability",
    "/loginx",
    "/api/cronjob",
    "/api/google/oauth/start",
    "/api/whatsappx",
  ])("%s is private", (path) => expect(isPublicPath(path)).toBe(false));
});

describe("safeNext", () => {
  it("keeps same-site paths and rejects everything else", () => {
    expect(safeNext("/agenda?dia=1")).toBe("/agenda?dia=1");
    expect(safeNext("//evil.com")).toBe("/pacientes");
    expect(safeNext("https://evil.com")).toBe("/pacientes");
    expect(safeNext("/\\evil.com")).toBe("/pacientes");
    expect(safeNext(null)).toBe("/pacientes");
  });
});

describe("proxy without auth configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails closed on private paths and serves public ones", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect((await proxy(new NextRequest("http://localhost/pacientes"))).status).toBe(503);
    expect((await proxy(new NextRequest("http://localhost/api/health"))).status).toBe(200);
  });
});
```

Pantalla de ingreso, en `src/app/(auth)/login/`:
- `actions.ts` (`"use server"`): `signIn(formData)` lee `email`, `password` y `next`; llama `supabase.auth.signInWithPassword`; si falla, `redirect("/login?error=1&next=<next codificado>")`; si no, `redirect(safeNext(next))`. `signOut()` llama `supabase.auth.signOut()` y redirige a `/login`.
- `page.tsx`: formulario accesible (etiquetas `<label>` asociadas, `autocomplete="email"` / `"current-password"`, botón primario). En Next.js 16 `searchParams` es una **Promise**: `const { error, next } = await searchParams`. Si `error` está presente muestra, en un `role="alert"`: "Correo o contraseña incorrectos." Estilo según §7. Enlace a `/registro` ("Registrar mi clínica").

**Done when**
- [ ] WHEN `isPublicPath` is called with `/`, `/login`, `/registro`, `/api/health`, `/api/whatsapp/webhook` or `/api/cron/tick` THE SYSTEM SHALL return true, and WHEN called with `/pacientes`, `/api/availability`, `/loginx` or `/api/cronjob` THE SYSTEM SHALL return false.
- [ ] WHEN `safeNext` receives `//evil.com`, `https://evil.com`, `/\evil.com` or null THE SYSTEM SHALL return the fallback `/pacientes`, and WHEN it receives `/agenda?dia=1` THE SYSTEM SHALL return it unchanged.
- [ ] WHEN the proxy runs without `NEXT_PUBLIC_SUPABASE_URL` and a request targets a private path THE SYSTEM SHALL answer 503 (fail closed), and WHEN the path is public THE SYSTEM SHALL answer 200.
- [ ] WHEN `pnpm build` runs THE SYSTEM SHALL exit 0 and the route list SHALL include `/login`.

**Verify**
```bash
pnpm test:unit tests/unit/auth-paths.test.ts
pnpm typecheck
pnpm lint
pnpm build > "${TMPDIR:-/tmp}/dentistas-build.log" 2>&1 && grep -q '/login' "${TMPDIR:-/tmp}/dentistas-build.log"
```

**Checkpoint**
```bash
git add -A && git commit -m "step 3: auth-session"
git tag step-03-auth-session
git rev-parse --verify step-03-auth-session   # expect: a commit id, exit 0
```

---

#### Step 4 — Registro de clínica, equipo y roles

**Do**
Registro de la primera clínica, gestión del equipo y el contexto de sesión que usan todos los servicios.

**`src/server/session.ts`** — superficie exacta:

```ts
// src/server/session.ts — exact exported surface
export type Role = "admin" | "dentist" | "assistant";
export type SessionCtx = { userId: string; clinicId: string; membershipId: string; role: Role; displayName: string };
export class ForbiddenError extends Error {}                       // message: "forbidden"
export function membershipForUser(userId: string): Promise<SessionCtx | null>; // withService; null when no ACTIVE membership
export function getSession(): Promise<SessionCtx | null>;           // supabaseServer().auth.getUser() -> membershipForUser
export function requireSession(): Promise<SessionCtx>;              // redirect("/login") when null
export function requireRole(ctx: SessionCtx, ...roles: Role[]): void; // throws ForbiddenError when ctx.role is not listed
export function userActor(ctx: SessionCtx): Extract<Actor, { kind: "user" }>; // { kind: "user", userId, clinicId, membershipId }
```

**`src/server/clinics.ts`**:
```ts
export type AuthAdmin = {
  createUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteUser(id: string): Promise<void>;
};
export const supabaseAuthAdmin: AuthAdmin; // usa @supabase/supabase-js con getEnv("supabase") + getEnv("supabaseAdmin") (SUPABASE_SECRET_KEY); createUser con email_confirm: true
export class LastAdminError extends Error {}
export function registerClinic(
  input: { clinicName: string; adminName: string; email: string; password: string },
  auth?: AuthAdmin,                                  // por defecto supabaseAuthAdmin; los tests inyectan uno falso
): Promise<{ clinicId: string; userId: string; membershipId: string }>;
export function addMember(
  actor: Extract<Actor, { kind: "user" }>, role: Role, // el rol del actor se verifica consultando memberships; solo admin
  input: { displayName: string; email: string; password: string; role: Role },
  auth?: AuthAdmin,
): Promise<{ membershipId: string; userId: string }>;
export function listMembers(actor: Extract<Actor, { kind: "user" }>): Promise<Array<{ id: string; displayName: string; role: Role; active: boolean }>>;
export function setMemberActive(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, active: boolean): Promise<void>; // LastAdminError si deja la clínica sin admin activo
```
Reglas: validar con zod (contraseña ≥ 10 caracteres, correo válido, nombres no vacíos). `registerClinic`: crea el usuario de auth, luego en **una** transacción `withService` inserta clínica + membresía admin; si la transacción falla, `auth.deleteUser(userId)` y relanza. `addMember`/`setMemberActive`: el parámetro `role` es el rol del que llama (viene de `SessionCtx.role`); si no es `admin` lanzan `ForbiddenError` **antes** de tocar `auth`. Para `setMemberActive(false)` sobre un admin: contar admins activos de la clínica con `select ... for update` y lanzar `LastAdminError` si fuera el último.

**Tests** (`tests/db/clinics.test.ts`): usa un `AuthAdmin` falso que inserta en `auth.users` (el stub de §19.6) y devuelve el id; cubre los 6 criterios de aceptación. Para el criterio 2, haz que `createUser` devuelva el id de un usuario que ya tiene membresía (viola `unique(user_id)`) y comprueba que `deleteUser` fue llamado con ese id.

**Interfaz**:
- `src/app/(auth)/registro/`: `page.tsx` + `actions.ts`; formulario (nombre de la clínica, tu nombre, correo, contraseña); la acción llama `registerClinic`, luego `supabase.auth.signInWithPassword` y `redirect("/pacientes")`. Errores de validación se muestran en `role="alert"`.
- `src/app/(app)/layout.tsx`: `requireSession()`; cabecera con el nombre de la clínica, navegación (Pacientes, Agenda, Cotizaciones, Cobros; **Gastos** y **Resumen** solo si `role === "admin"`; Configuración) y botón "Cerrar sesión" (`signOut`). Contenedor de página `max-w-6xl`.
- `src/app/(app)/configuracion/equipo/page.tsx` + `actions.ts`: lista del equipo; solo admin ve el formulario "Agregar miembro" y el botón activar/desactivar; muestra el error de `LastAdminError` en español.

**Done when**
- [ ] WHEN `registerClinic` runs with valid input and a fake `AuthAdmin` THE SYSTEM SHALL create one `clinics` row and one `memberships` row with role `admin` for the new user, and return `{ clinicId, userId, membershipId }`.
- [ ] WHEN the database transaction of `registerClinic` fails after the auth user was created THE SYSTEM SHALL call `AuthAdmin.deleteUser` with that user's id and rethrow the original error.
- [ ] WHEN a non-admin calls `addMember` THE SYSTEM SHALL throw `ForbiddenError` and SHALL NOT call `AuthAdmin.createUser`.
- [ ] WHEN the only active admin of a clinic is deactivated THE SYSTEM SHALL throw `LastAdminError` and leave `memberships.active = true`.
- [ ] WHEN `membershipForUser` runs for a user whose membership is inactive THE SYSTEM SHALL return null.
- [ ] WHEN `registerClinic` receives a password shorter than 10 characters THE SYSTEM SHALL throw a `ZodError` naming `password` and create nothing.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/clinics.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 4: clinics-members"
git tag step-04-clinics-members
git rev-parse --verify step-04-clinics-members   # expect: a commit id, exit 0
```

---

#### Step 5 — Pacientes: alta, búsqueda y archivo

**Do**
Registro de pacientes (filiación). **Decisión de dominio (a verificar contra NTS 139-MINSA/2018/DGAIN, ver §20.2):** el N° de historia clínica es el número de documento del paciente (`hc_number = doc_number`).

`supabase/migrations/20261020000002_patients.sql`

```sql
-- supabase/migrations/20261020000002_patients.sql
create type doc_type as enum ('DNI', 'CE', 'PASAPORTE', 'OTRO');
create type sex as enum ('F', 'M');

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  hc_number text not null,
  doc_type doc_type not null default 'DNI',
  doc_number text not null check (length(trim(doc_number)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  first_name text not null check (length(trim(first_name)) > 0),
  birth_date date,
  birth_place text,
  sex sex,
  marital_status text,
  education_level text,
  occupation text,
  address text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  guardian_name text,
  guardian_phone_e164 text check (guardian_phone_e164 is null or guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  archived_at timestamptz,
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, doc_type, doc_number),
  unique (clinic_id, hc_number),
  check (not whatsapp_opt_in or (phone_e164 is not null and whatsapp_opt_in_at is not null))
);
create index patients_clinic_name_idx on patients (clinic_id, last_name, first_name);
create index patients_clinic_phone_idx on patients (clinic_id, phone_e164);

alter table patients enable row level security;
create policy patients_select on patients for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy patients_insert on patients for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy patients_update on patients for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
```

**`src/lib/phone.ts`**: `normalizePhonePE(raw: string): string | null`. Quita espacios, guiones y paréntesis; si empieza con `+` y el resto son 8 a 14 dígitos, devuélvelo; si son 9 dígitos que empiezan con 9, antepón `+51`; si son 11 dígitos que empiezan con `51`, antepón `+`; en otro caso `null`.

**`src/server/patients.ts`** (todas las funciones reciben `actor: Actor` y filtran por `actor.clinicId`; usan `runAs`):
```ts
export const patientInput: z.ZodType<PatientInput>; // zod
// docType: "DNI" | "CE" | "PASAPORTE" | "OTRO"; docNumber: DNI => /^\d{8}$/, CE => 9-12 alfanuméricos, otros => no vacío
// lastName, firstName: no vacíos (trim); birthDate?: "YYYY-MM-DD"; sex?: "F" | "M"; birthPlace?, maritalStatus?, educationLevel?,
// occupation?, address?, email?, guardianName?; phone?, guardianPhone?: string (se normaliza con normalizePhonePE; inválido => error de zod en ese campo);
// whatsappOptIn: boolean (default false) => requiere phone
export class DuplicatePatientError extends Error {}   // SQLSTATE 23505 sobre unique (clinic_id, doc_type, doc_number)
export function createPatient(actor: Actor, input: unknown): Promise<Patient>;     // hc_number = docNumber; created_by = membershipId si el actor es de usuario
export function updatePatient(actor: Actor, id: string, patch: unknown): Promise<Patient>; // misma validación parcial; no cambia doc ni hc
export function archivePatient(actor: Actor, id: string): Promise<void>;
export function getPatient(actor: Actor, id: string): Promise<Patient | null>;
export function searchPatients(actor: Actor, opts?: { q?: string; includeArchived?: boolean; limit?: number }): Promise<Patient[]>; // ILIKE %q% en last_name, first_name, doc_number; orden last_name, first_name; limit 25
```
`Patient` es el tipo camelCase del registro (id, clinicId, hcNumber, docType, docNumber, lastName, firstName, birthDate, sex, phoneE164, email, whatsappOptIn, archivedAt, …).

**Tests** (`tests/db/patients.test.ts`): los 7 criterios de aceptación, con `seedClinic()` y `runAs({ kind: "user", ... })`; el criterio de `normalizePhonePE` como tabla con `it.each`.

**Interfaz** (`src/app/(app)/pacientes/`): `page.tsx` con buscador (`<input type="search">` con etiqueta) y tabla (HC, apellidos y nombres, teléfono, acciones); `nuevo/page.tsx` con el formulario de filiación (agrupado en secciones "Identificación", "Contacto", "Datos personales", casilla "Acepta recordatorios por WhatsApp"); `[id]/page.tsx` con la ficha y botón "Archivar". `params` es una Promise en Next.js 16. Estados: vacío ("Aún no hay pacientes"), carga y error con `role="alert"`.

**Done when**
- [ ] WHEN `createPatient` receives document type DNI, number `12345678` and the phone `987 654 321`, `+51 987-654-321` or `51987654321` THE SYSTEM SHALL store `phone_e164 = '+51987654321'` and `hc_number = '12345678'`, and WHEN the phone is `12345` THE SYSTEM SHALL throw a `ZodError` naming `phone`.
- [ ] WHEN a DNI is not exactly 8 digits THE SYSTEM SHALL throw a `ZodError` naming `docNumber` and insert no row.
- [ ] WHEN `createPatient` is called twice with the same document type and number in one clinic THE SYSTEM SHALL throw `DuplicatePatientError`, and WHEN the same document is registered in another clinic THE SYSTEM SHALL succeed.
- [ ] WHEN `whatsappOptIn` is true without a phone THE SYSTEM SHALL reject with a `ZodError`, and WHEN it is true with a phone THE SYSTEM SHALL set `whatsapp_opt_in_at` to the current time.
- [ ] WHEN `searchPatients` receives the text `pere` THE SYSTEM SHALL return patients whose last name, first name or document number contains it (case-insensitive), only from the actor's clinic.
- [ ] WHEN `archivePatient` runs THE SYSTEM SHALL set `archived_at`, exclude that patient from the default search, and keep the row.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/patients.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 5: patients"
git tag step-05-patients
git rev-parse --verify step-05-patients   # expect: a commit id, exit 0
```

---

#### Step 6 — Historia clínica y odontograma (solo se agrega)

**Do**
Historia clínica. **Regla central: es de solo agregar.** Un trigger prohíbe `UPDATE`/`DELETE` incluso al rol propietario; las correcciones son filas nuevas (`nota_correccion`) que apuntan a la corregida. Cada apertura de una historia queda registrada en `record_access_log` (quién y cuándo). Los asistentes **no** leen la historia clínica; dentistas y admin sí.

`supabase/migrations/20261020000003_clinical.sql`

```sql
-- supabase/migrations/20261020000003_clinical.sql
-- Clinical record: append-only. Corrections are new rows that point at the row they correct.
create type clinical_entry_kind as enum
  ('anamnesis', 'examen', 'diagnostico', 'tratamiento', 'evolucion', 'consentimiento', 'nota_correccion');

create table clinical_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  kind clinical_entry_kind not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  author_membership_id uuid not null references memberships (id),
  corrects_entry_id uuid references clinical_entries (id),
  created_at timestamptz not null default now(),
  check ((kind = 'nota_correccion') = (corrects_entry_id is not null))
);
create index clinical_entries_patient_idx on clinical_entries (patient_id, created_at);

create table odontogram_marks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  tooth_fdi smallint not null check (
    tooth_fdi between 11 and 18 or tooth_fdi between 21 and 28 or
    tooth_fdi between 31 and 38 or tooth_fdi between 41 and 48 or
    tooth_fdi between 51 and 55 or tooth_fdi between 61 and 65 or
    tooth_fdi between 71 and 75 or tooth_fdi between 81 and 85
  ),
  surface text check (surface is null or surface in ('M', 'D', 'O', 'V', 'L', 'P', 'I')),
  condition text not null check (length(trim(condition)) > 0),
  note text,
  author_membership_id uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index odontogram_patient_idx on odontogram_marks (patient_id, tooth_fdi, created_at);

create table record_access_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id),
  accessed_at timestamptz not null default now()
);
create index record_access_patient_idx on record_access_log (patient_id, accessed_at);

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end $$;

create trigger clinical_entries_append_only before update or delete on clinical_entries
  for each row execute function forbid_mutation();
create trigger odontogram_marks_append_only before update or delete on odontogram_marks
  for each row execute function forbid_mutation();
create trigger record_access_log_append_only before update or delete on record_access_log
  for each row execute function forbid_mutation();

revoke update on clinical_entries, odontogram_marks, record_access_log from authenticated;

alter table clinical_entries enable row level security;
alter table odontogram_marks enable row level security;
alter table record_access_log enable row level security;

-- Assistants may read patients but not the clinical record; dentists and admins may read and write it.
create policy clinical_entries_select on clinical_entries for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy clinical_entries_insert on clinical_entries for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_select on odontogram_marks for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_insert on odontogram_marks for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy access_log_select on record_access_log for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy access_log_insert on record_access_log for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
```

`tests/db/clinical.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const entry = (clinicId: string, patientId: string, authorId: string, kind = "evolucion") =>
  pool.query<{ id: string }>(
    'insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id) values ($1, $2, $3, \'{"texto":"x"}\', $4) returning id',
    [clinicId, patientId, kind, authorId],
  );

describe("clinical record", () => {
  it("assistants cannot read it; dentists and admins can", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await entry(a.clinicId, patientId, a.dentist.membershipId);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from clinical_entries")))
        .rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
  });

  it("another clinic's dentist sees nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await entry(a.clinicId, await createPatientRow(a.clinicId), a.dentist.membershipId);
    expect(
      (await asUser(b.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(0);
  });

  it("entries are append-only: update and delete are refused, even for the owner role", async () => {
    const a = await seedClinic();
    const { rows } = await entry(
      a.clinicId,
      await createPatientRow(a.clinicId),
      a.dentist.membershipId,
    );
    const id = rows[0]?.id;
    await expect(
      pool.query("update clinical_entries set body = '{}' where id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from clinical_entries where id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
  });

  it("a correction note must point at the entry it corrects, and nothing else may", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await entry(a.clinicId, patientId, a.dentist.membershipId);
    await expect(
      entry(a.clinicId, patientId, a.dentist.membershipId, "nota_correccion"),
    ).rejects.toThrow(/check constraint/);
    await pool.query(
      "insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id, corrects_entry_id) values ($1, $2, 'nota_correccion', '{\"texto\":\"fe de erratas\"}', $3, $4)",
      [a.clinicId, patientId, a.dentist.membershipId, rows[0]?.id],
    );
  });

  it("odontogram marks accept only valid FDI teeth and surfaces", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const mark = (tooth: number, surface: string | null) =>
      pool.query(
        "insert into odontogram_marks (clinic_id, patient_id, tooth_fdi, surface, condition, author_membership_id) values ($1, $2, $3, $4, 'caries', $5)",
        [a.clinicId, patientId, tooth, surface, a.dentist.membershipId],
      );
    await mark(18, "O");
    await mark(85, null);
    await expect(mark(19, "O")).rejects.toThrow(/check constraint/);
    await expect(mark(11, "X")).rejects.toThrow(/check constraint/);
  });

  it("the access log is append-only and visible to admins only", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await asUser(a.dentist.userId, (c) =>
      c.query(
        "insert into record_access_log (clinic_id, patient_id, membership_id) values ($1, $2, $3)",
        [a.clinicId, patientId, a.dentist.membershipId],
      ),
    );
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(1);
    await expect(pool.query("delete from record_access_log")).rejects.toThrow(/append-only/);
  });
});
```

**`src/server/clinical.ts`** (solo actores de usuario: `Extract<Actor, { kind: "user" }>`; el servicio consulta el rol de la membresía y lanza `ForbiddenError` —de `src/server/session.ts`— para `assistant` **antes** de escribir nada):
```ts
export const ENTRY_KINDS = ["anamnesis","examen","diagnostico","tratamiento","evolucion","consentimiento"] as const;
// Esquemas zod por tipo de entrada (todos los campos de texto: trim, máx. 4000 caracteres):
//  anamnesis:      { motivoConsulta: string (requerido), enfermedadActual?, antecedentesPersonales?, antecedentesFamiliares?, alergias?, medicacionActual? }
//  examen:         { extraoral?, intraoral?, funcionesVitales?: { presionArterial?: string, pulso?: string, temperatura?: string } }  (al menos un campo)
//  diagnostico:    { items: [{ descripcion: string, cie10?: string }] (1..20) }
//  tratamiento:    { items: [{ descripcion: string, pieza?: number (FDI) }] (1..20), plan?: string }
//  evolucion:      { texto: string }
//  consentimiento: { procedimiento: string, texto: string, aceptadoPor: string, fecha: "YYYY-MM-DD" }
export function addEntry(actor: UserActor, patientId: string, kind: (typeof ENTRY_KINDS)[number], body: unknown): Promise<{ id: string }>;
export function correctEntry(actor: UserActor, entryId: string, texto: string): Promise<{ id: string }>; // inserta kind='nota_correccion', corrects_entry_id=entryId, body {texto}
export function openRecord(actor: UserActor, patientId: string): Promise<{ patient: Patient; entries: Entry[]; odontogram: OdontogramMark[] }>; // 1 fila en record_access_log por llamada; entries ordenadas por created_at asc
export function addOdontogramMark(actor: UserActor, patientId: string, mark: { tooth: number; surface?: "M"|"D"|"O"|"V"|"L"|"P"|"I"; condition: string; note?: string }): Promise<{ id: string }>;
export function currentOdontogram(actor: UserActor, patientId: string): Promise<OdontogramMark[]>; // distinct on (tooth_fdi, surface) por created_at desc
```
`UserActor = Extract<Actor, { kind: "user" }>`. El rol se obtiene con `select role from memberships where id = $actor.membershipId`.

**Tests de servicio** (`tests/db/clinical-service.test.ts`): los criterios 2 a 6 de aceptación con `seedClinic()` y un paciente creado con `createPatient` (paso 5).

**Interfaz** (`src/app/(app)/pacientes/[id]/historia/`): `page.tsx` (llama `openRecord`; si `ForbiddenError`, muestra "Tu rol no tiene acceso a la historia clínica"); línea de tiempo de entradas con su tipo, autor, fecha y hora de Lima, y las notas de corrección **debajo** de la entrada corregida; formularios por tipo (`actions.ts`); odontograma como cuadrícula FDI (16 dientes superiores, 16 inferiores) con la última condición por pieza, accesible por teclado (cada pieza es un `<button>` con `aria-label="Pieza 18, caries"`).

**Done when**
- [ ] WHEN `pnpm test:db tests/db/clinical.test.ts` runs THE SYSTEM SHALL pass all 6 tests, proving that assistants cannot read clinical entries, that updating or deleting an entry is refused with `append-only`, and that invalid FDI teeth are rejected.
- [ ] WHEN `addEntry` receives a valid `anamnesis` body THE SYSTEM SHALL insert one `clinical_entries` row authored by the actor's membership, and WHEN the body fails its zod schema THE SYSTEM SHALL throw a `ZodError` and insert nothing.
- [ ] WHEN `openRecord` runs THE SYSTEM SHALL insert exactly one `record_access_log` row for the actor's membership and that patient, per call.
- [ ] WHEN an actor with role `assistant` calls `openRecord` or `addEntry` THE SYSTEM SHALL throw `ForbiddenError` and write no log row.
- [ ] WHEN `correctEntry` runs THE SYSTEM SHALL insert a `nota_correccion` row whose `corrects_entry_id` is the original entry, and the original row SHALL remain byte-identical.
- [ ] WHEN `currentOdontogram` runs after two marks on the same tooth and surface THE SYSTEM SHALL return only the later mark for that tooth and surface.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/clinical.test.ts
pnpm test:db tests/db/clinical-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 6: clinical-record"
git tag step-06-clinical-record
git rev-parse --verify step-06-clinical-record   # expect: a commit id, exit 0
```

---

#### Step 7 — Motor de disponibilidad (función pura)

**Do**
Núcleo de la agenda. **Es una función pura**: `(reglas, excepciones, reservas, bloqueos externos, now) → slots`. Nunca se guardan slots; se calculan al leer. Las reglas son **hora de pared local** en la zona de la clínica (`America/Lima`, sin horario de verano), los instantes son UTC. La grilla de inicios de slot se ancla al comienzo de cada ventana de trabajo, de modo que un hueco de primavera (hora inexistente) no produce slots y una hora repetida de otoño produce cada hora real una sola vez. Es el código que más hay que probar: los tests cubren cuatro zonas y los dos cambios de horario.

`src/lib/availability/generate-slots.ts`

```ts
import { DateTime } from "luxon";

export type Rule = {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** Wall-clock local times, "HH:mm" or "HH:mm:ss". */
  startTime: string;
  endTime: string;
  /** Local dates, "YYYY-MM-DD". */
  validFrom: string;
  validUntil: string | null;
};
export type Span = { startsAt: Date; endsAt: Date };
export type Exception = Span & { type: "block" | "open" };

export type SlotInput = {
  /** IANA zone of the dentist's clinic, e.g. "America/Lima". Rules are wall-clock in this zone. */
  zone: string;
  rules: Rule[];
  exceptions: Exception[];
  booked: Span[];
  externalBusy: Span[];
  now: Date;
  from: Date;
  to: Date;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

type Interval = [number, number];

const MIN = 60_000;

function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function localInstant(date: string, time: string, zone: string): number | null {
  const [h = "0", m = "0"] = time.split(":");
  const local = DateTime.fromISO(date, { zone }).set({
    hour: Number(h),
    minute: Number(m),
    second: 0,
    millisecond: 0,
  });
  // Luxon moves a non-existent wall-clock time (spring-forward gap) forward; the window then starts there.
  return local.isValid ? local.toMillis() : null;
}

/**
 * Pure function: free appointment slots for one dentist.
 * (rules, exceptions, booked, externalBusy, now) in, sorted UTC slots out. Reads no clock, no database.
 * Slot starts sit on a grid of `slotIntervalMinutes` anchored at the start instant of each working window
 * (rules and "open" exceptions, merged), so the grid is made of real instants: a spring-forward gap yields
 * no slot inside the gap, and a fall-back repeated hour yields each real hour exactly once. A slot is
 * offered only if it overlaps no booking, no external busy block and no "block" exception.
 */
export function generateSlots(input: SlotInput): Span[] {
  const windowStart = Math.max(
    input.from.getTime(),
    input.now.getTime() + input.minNoticeMinutes * MIN,
  );
  const windowEnd = Math.min(
    input.to.getTime(),
    input.now.getTime() + input.maxAdvanceDays * 24 * 60 * MIN,
  );
  if (windowEnd <= windowStart) return [];

  const open: Interval[] = [];
  const firstDay = DateTime.fromMillis(windowStart, { zone: input.zone })
    .startOf("day")
    .minus({ days: 1 });
  const lastDay = DateTime.fromMillis(windowEnd, { zone: input.zone })
    .startOf("day")
    .plus({ days: 1 });
  for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 })) {
    const date = day.toISODate();
    if (!date) continue;
    for (const rule of input.rules) {
      if (rule.weekday !== day.weekday) continue;
      if (rule.validFrom > date || (rule.validUntil !== null && rule.validUntil < date)) continue;
      const start = localInstant(date, rule.startTime, input.zone);
      const end = localInstant(date, rule.endTime, input.zone);
      if (start !== null && end !== null && end > start) open.push([start, end]);
    }
  }
  for (const e of input.exceptions) {
    if (e.type === "open") open.push([e.startsAt.getTime(), e.endsAt.getTime()]);
  }

  const cuts = merge(
    [
      ...input.exceptions.filter((e) => e.type === "block"),
      ...input.booked,
      ...input.externalBusy,
    ].map((span): Interval => [span.startsAt.getTime(), span.endsAt.getTime()]),
  );
  const duration = input.durationMinutes * MIN;
  const step = input.slotIntervalMinutes * MIN;
  const slots: Span[] = [];
  for (const [start, end] of merge(open)) {
    for (let t = start; t + duration <= end; t += step) {
      if (t < windowStart || t > windowEnd) continue;
      if (cuts.some(([cutStart, cutEnd]) => cutStart < t + duration && cutEnd > t)) continue;
      slots.push({ startsAt: new Date(t), endsAt: new Date(t + duration) });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

`tests/unit/generate-slots.test.ts`

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { generateSlots, type Rule, type SlotInput } from "@/lib/availability/generate-slots";

const weekdays = (startTime: string, endTime: string, days = [1, 2, 3, 4, 5]): Rule[] =>
  days.map((weekday) => ({
    weekday,
    startTime,
    endTime,
    validFrom: "2020-01-01",
    validUntil: null,
  }));

function base(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    zone: "America/Lima",
    rules: weekdays("09:00", "12:00"),
    exceptions: [],
    booked: [],
    externalBusy: [],
    now: new Date("2027-03-01T00:00:00Z"),
    from: new Date("2027-03-01T00:00:00Z"),
    to: new Date("2027-03-08T00:00:00Z"),
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 60,
    ...overrides,
  };
}

const local = (slot: { startsAt: Date }, zone: string) =>
  DateTime.fromJSDate(slot.startsAt, { zone }).toFormat("yyyy-MM-dd HH:mm");

describe("generateSlots", () => {
  it("expands wall-clock rules in the clinic zone (Lima, UTC-5, no DST)", () => {
    const slots = generateSlots(
      base({ from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    // Monday 2027-03-01 local 09:00-12:00 => 14:00Z-17:00Z, six 30-minute slots
    expect(slots).toHaveLength(6);
    expect(slots[0]?.startsAt.toISOString()).toBe("2027-03-01T14:00:00.000Z");
    expect(slots[5]?.endsAt.toISOString()).toBe("2027-03-01T17:00:00.000Z");
  });

  it("removes slots overlapping a booking, an external busy block and a block exception", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-01T00:00:00Z"),
        to: new Date("2027-03-02T00:00:00Z"),
        booked: [
          { startsAt: new Date("2027-03-01T14:00:00Z"), endsAt: new Date("2027-03-01T14:30:00Z") },
        ],
        externalBusy: [
          { startsAt: new Date("2027-03-01T14:45:00Z"), endsAt: new Date("2027-03-01T15:15:00Z") },
        ],
        exceptions: [
          {
            type: "block",
            startsAt: new Date("2027-03-01T16:00:00Z"),
            endsAt: new Date("2027-03-01T17:00:00Z"),
          },
        ],
      }),
    );
    expect(slots.map((s) => s.startsAt.toISOString().slice(11, 16))).toEqual(["15:30"]);
  });

  it("an open exception adds hours outside the rules", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-06T00:00:00Z"), // Saturday local, no rule
        to: new Date("2027-03-07T12:00:00Z"),
        exceptions: [
          {
            type: "open",
            startsAt: new Date("2027-03-06T15:00:00Z"),
            endsAt: new Date("2027-03-06T16:00:00Z"),
          },
        ],
      }),
    );
    expect(slots).toHaveLength(2);
  });

  it("honours minimum notice and maximum advance", () => {
    const now = new Date("2027-03-01T14:10:00Z");
    const noticed = generateSlots(
      base({ now, from: now, minNoticeMinutes: 60, to: new Date("2027-03-02T00:00:00Z") }),
    );
    expect(noticed[0]?.startsAt.toISOString()).toBe("2027-03-01T15:30:00.000Z");
    const far = generateSlots(base({ maxAdvanceDays: 2, to: new Date("2027-03-20T00:00:00Z") }));
    expect(
      far.every((s) => s.startsAt.getTime() <= new Date("2027-03-03T00:00:00Z").getTime()),
    ).toBe(true);
  });

  it("respects validFrom / validUntil", () => {
    const rules: Rule[] = [
      {
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        validFrom: "2027-03-08",
        validUntil: null,
      },
    ];
    const slots = generateSlots(
      base({ rules, from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-15T00:00:00Z") }),
    );
    expect(slots.map((s) => local(s, "America/Lima"))).toEqual([
      "2027-03-08 09:00",
      "2027-03-08 09:30",
    ]);
  });

  it.each([
    ["America/Lima", "2027-03-01T14:00:00.000Z"],
    ["Asia/Kolkata", "2027-03-01T03:30:00.000Z"], // UTC+5:30
    ["America/Santiago", "2027-03-01T12:00:00.000Z"], // southern-hemisphere DST (UTC-3 in March)
    ["UTC", "2027-03-01T09:00:00.000Z"],
  ])("first Monday slot for %s starts at local 09:00", (zone, expectedUtc) => {
    const slots = generateSlots(
      base({ zone, from: new Date("2027-02-28T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    const first = slots.find(
      (s) => DateTime.fromJSDate(s.startsAt, { zone }).toISODate() === "2027-03-01",
    );
    expect(first?.startsAt.toISOString()).toBe(expectedUtc);
    expect(local(first as { startsAt: Date }, zone)).toBe("2027-03-01 09:00");
  });

  it("keeps wall-clock 09:00 across a DST change (Santiago, DST ends 2027-04-03/04)", () => {
    const rules = weekdays("09:00", "09:30", [1, 2, 3, 4, 5, 6, 7]);
    const slots = generateSlots(
      base({
        zone: "America/Santiago",
        rules,
        from: new Date("2027-04-01T00:00:00Z"),
        to: new Date("2027-04-07T00:00:00Z"),
      }),
    );
    expect(
      new Set(
        slots.map((s) =>
          DateTime.fromJSDate(s.startsAt, { zone: "America/Santiago" }).toFormat("HH:mm"),
        ),
      ),
    ).toEqual(new Set(["09:00"]));
    expect(new Set(slots.map((s) => s.startsAt.getUTCHours())).size).toBe(2); // the UTC hour moved
  });

  it("emits no slot inside a spring-forward gap (Madrid 2027-03-28, 02:00-03:00 does not exist)", () => {
    const rules = weekdays("01:00", "05:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        from: new Date("2027-03-27T00:00:00Z"),
        to: new Date("2027-03-29T00:00:00Z"),
      }),
    );
    expect(slots.map((s) => local(s, "Europe/Madrid"))).toEqual([
      "2027-03-28 01:00",
      "2027-03-28 03:00",
      "2027-03-28 04:00",
    ]);
  });

  it("emits each real hour once on a fall-back day (Madrid 2027-10-31, 02:00-03:00 occurs twice)", () => {
    const rules = weekdays("01:00", "04:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        now: new Date("2027-10-01T00:00:00Z"),
        from: new Date("2027-10-30T00:00:00Z"),
        to: new Date("2027-11-01T00:00:00Z"),
      }),
    );
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(4);
  });

  it("is pure: does not mutate its input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    generateSlots(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
```

**Done when**
- [ ] WHEN `generateSlots` expands a Monday 09:00-12:00 rule for `America/Lima` with 30-minute slots THE SYSTEM SHALL return 6 slots, the first starting at `2027-03-01T14:00:00.000Z`.
- [ ] WHEN a booking, an external busy block or a `block` exception overlaps a slot THE SYSTEM SHALL omit that slot, and WHEN an `open` exception adds hours outside the rules THE SYSTEM SHALL offer slots inside them.
- [ ] WHEN `minNoticeMinutes`, `maxAdvanceDays` or a rule's `validFrom`/`validUntil` exclude a time THE SYSTEM SHALL not offer it.
- [ ] WHEN the zone is `America/Lima`, `Asia/Kolkata`, `America/Santiago` or `UTC` THE SYSTEM SHALL start the first Monday slot at local 09:00 in that zone, and across the Santiago DST change THE SYSTEM SHALL keep wall-clock 09:00 while the UTC hour changes.
- [ ] WHEN a working window spans the Madrid spring-forward gap (2027-03-28) THE SYSTEM SHALL offer no slot inside the non-existent hour, and WHEN it spans the fall-back repeated hour (2027-10-31) THE SYSTEM SHALL offer each real hour exactly once.
- [ ] WHEN `generateSlots` is called THE SYSTEM SHALL not mutate its input and SHALL not read the clock (the caller passes `now`).

**Verify**
```bash
pnpm test:unit tests/unit/generate-slots.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 7: availability-engine"
git tag step-07-availability-engine
git rev-parse --verify step-07-availability-engine   # expect: a commit id, exit 0
```

---

#### Step 8 — Citas: reservas sin doble reserva y servicio de agenda

**Do**
Reservas. **La consulta de disponibilidad es orientativa; la escritura es la autoridad.** La restricción de exclusión de Postgres (`appointments_no_overlap`, `EXCLUDE USING gist` sobre `membership_id` y el rango de la cita, solo para estados `held`/`confirmed`) impide el doble agendado bajo concurrencia; el servicio traduce el error `23P01` a `SlotTakenError`. Nunca "revisar y luego insertar" sin esa restricción.

`supabase/migrations/20261020000004_scheduling.sql`

```sql
-- supabase/migrations/20261020000004_scheduling.sql
create type appointment_status as enum ('held', 'confirmed', 'completed', 'cancelled', 'no_show');
create type appointment_source as enum ('web', 'whatsapp', 'google');

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday ... 7 = Sunday
  start_time time not null,
  end_time time not null,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_until is null or valid_until >= valid_from)
);
create index availability_rules_member_idx on availability_rules (membership_id, weekday);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type text not null check (type in ('block', 'open')),
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_exceptions_member_idx on availability_exceptions (membership_id, starts_at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict, -- the dentist
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocking_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status appointment_status not null default 'confirmed',
  source appointment_source not null default 'web',
  reason text,
  google_event_id text,
  rescheduled_from_id uuid references appointments (id),
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_no_overlap exclude using gist (
    membership_id with =, blocking_range with &&
  ) where (status in ('held', 'confirmed'))
);
-- Cache of busy blocks from a connected Google Calendar. Advisory only.
create table external_busy (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index external_busy_member_idx on external_busy (membership_id, starts_at);

create index appointments_clinic_start_idx on appointments (clinic_id, starts_at);
create index appointments_patient_idx on appointments (patient_id, starts_at);

alter table availability_rules enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments enable row level security;
alter table external_busy enable row level security;

create policy rules_select on availability_rules for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy rules_write on availability_rules for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy rules_update on availability_rules for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy exceptions_select on availability_exceptions for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy exceptions_write on availability_exceptions for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy exceptions_update on availability_exceptions for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy external_busy_select on external_busy for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

create policy appointments_select on appointments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy appointments_insert on appointments for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy appointments_update on appointments for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
```

`tests/db/booking.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const insertAppointment = (
  a: Awaited<ReturnType<typeof seedClinic>>,
  patientId: string,
  start: string,
  end: string,
  status = "confirmed",
) =>
  pool.query(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at, status) values ($1, $2, $3, $4, $5, $6) returning id",
    [a.clinicId, patientId, a.dentist.membershipId, start, end, status],
  );

describe("appointments", () => {
  it("50 concurrent bookings of one slot: exactly one succeeds, 49 fail with exclusion_violation", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        insertAppointment(a, patientId, "2027-03-01T15:00:00Z", "2027-03-01T15:30:00Z"),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures).toHaveLength(49);
    expect(failures.every((f) => f.reason.code === "23P01")).toBe(true);
    const { rows } = await pool.query(
      "select count(*)::int as n from appointments where clinic_id = $1",
      [a.clinicId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("overlapping ranges conflict, back-to-back ranges do not, cancelled ones free the slot", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const first = await insertAppointment(
      a,
      patientId,
      "2027-03-02T15:00:00Z",
      "2027-03-02T15:30:00Z",
    );
    await expect(
      insertAppointment(a, patientId, "2027-03-02T15:15:00Z", "2027-03-02T15:45:00Z"),
    ).rejects.toThrow(/appointments_no_overlap/);
    await insertAppointment(a, patientId, "2027-03-02T15:30:00Z", "2027-03-02T16:00:00Z");
    await pool.query("update appointments set status = 'cancelled' where id = $1", [
      first.rows[0].id,
    ]);
    await insertAppointment(a, patientId, "2027-03-02T15:00:00Z", "2027-03-02T15:30:00Z");
  });

  it("the same time with a different dentist is allowed", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await insertAppointment(a, patientId, "2027-03-03T15:00:00Z", "2027-03-03T15:30:00Z");
    await pool.query(
      "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, '2027-03-03T15:00:00Z', '2027-03-03T15:30:00Z')",
      [a.clinicId, patientId, a.admin.membershipId],
    );
  });

  it("RLS keeps appointments inside the clinic", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await insertAppointment(
      a,
      await createPatientRow(a.clinicId),
      "2027-03-04T15:00:00Z",
      "2027-03-04T15:30:00Z",
    );
    expect(
      (await asUser(b.admin.userId, (c) => c.query("select id from appointments"))).rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from appointments"))).rowCount,
    ).toBe(1);
  });
});
```

**`src/server/availability.ts`**:
```ts
export type SlotQuery = { membershipId: string; from: Date; to: Date; durationMinutes: number };
export type SlotOffer = { startsAt: Date; endsAt: Date };
export const SLOT_DEFAULTS = { slotIntervalMinutes: 30, minNoticeMinutes: 60, maxAdvanceDays: 60 } as const;
export function loadSlots(actor: Actor, q: SlotQuery, opts?: { now?: Date }): Promise<SlotOffer[]>;
// Lee, filtrando por actor.clinicId: clinics.timezone, availability_rules y availability_exceptions del dentista,
// appointments en estado held/confirmed del dentista que intersecten [from, to), y external_busy del dentista.
// Convierte filas a los tipos de generateSlots (weekday, startTime "HH:mm:ss", validFrom/validUntil "YYYY-MM-DD") y la llama con now = opts.now ?? new Date().
```

**`src/server/appointments.ts`**:
```ts
export class SlotTakenError extends Error {}            // 23P01 del constraint appointments_no_overlap
export class OutsideAvailabilityError extends Error {}  // el inicio+duración no coincide con un slot de loadSlots
export type Appointment = { id: string; clinicId: string; patientId: string; membershipId: string; startsAt: Date; endsAt: Date; status: "held"|"confirmed"|"completed"|"cancelled"|"no_show"; source: "web"|"whatsapp"|"google"; reason: string | null };
export function bookAppointment(actor: Actor, input: { patientId: string; membershipId: string; startsAt: Date; durationMinutes: number; reason?: string; source?: "web"|"whatsapp" }, opts?: { now?: Date }): Promise<Appointment>;
// 1) Recalcula loadSlots para [startsAt, startsAt + duration) y exige un slot con ese inicio exacto, si no: OutsideAvailabilityError.
// 2) INSERT con status 'confirmed'. Sin transacciones largas: nada de red ni correo dentro.
// 3) Captura code 23P01 => SlotTakenError. Verifica que patient y dentista pertenezcan a actor.clinicId.
export function cancelAppointment(actor: Actor, appointmentId: string): Promise<void>;   // status = 'cancelled'
export function rescheduleAppointment(actor: Actor, appointmentId: string, input: { startsAt: Date; durationMinutes: number }, opts?: { now?: Date }): Promise<Appointment>;
// En UNA transacción: cancela la antigua e inserta la nueva (rescheduled_from_id). Si la nueva choca: SlotTakenError y la antigua sigue 'confirmed' (rollback).
export function listAppointments(actor: Actor, q: { from: Date; to: Date; membershipId?: string }): Promise<Array<Appointment & { patientName: string; dentistName: string }>>;
```
**Tests de servicio** (`tests/db/appointments-service.test.ts`): los criterios 2 a 6, insertando la regla del dentista con SQL directo (`availability_rules`: weekday 1, 09:00-12:00, `valid_from` en el pasado) y fijando `now` con `opts.now` a un domingo conocido para que "el próximo lunes" sea determinista. La concurrencia (criterio 5) usa `Promise.allSettled` sobre 20 llamadas.

**Done when**
- [ ] WHEN `pnpm test:db tests/db/booking.test.ts` runs THE SYSTEM SHALL pass, including the test in which 50 concurrent inserts of one slot for one dentist yield exactly 1 success and 49 `exclusion_violation` (SQLSTATE 23P01) failures.
- [ ] WHEN `loadSlots` runs for a dentist with a Monday 09:00-12:00 rule, no bookings, and a 30-minute duration THE SYSTEM SHALL return 6 slots for the next Monday in `America/Lima`.
- [ ] WHEN `bookAppointment` receives a slot returned by `loadSlots` THE SYSTEM SHALL insert one `confirmed` appointment and that slot SHALL no longer appear in `loadSlots`.
- [ ] WHEN `bookAppointment` receives a time outside the dentist's working hours THE SYSTEM SHALL throw `OutsideAvailabilityError` and insert nothing.
- [ ] WHEN 20 `bookAppointment` calls for the same slot run concurrently THE SYSTEM SHALL resolve exactly one and reject the other 19 with `SlotTakenError`.
- [ ] WHEN `rescheduleAppointment` targets a free slot THE SYSTEM SHALL cancel the old row and insert a new `confirmed` row with `rescheduled_from_id` set, and WHEN the new slot is taken THE SYSTEM SHALL throw `SlotTakenError` and leave the old appointment `confirmed`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/booking.test.ts
pnpm test:db tests/db/appointments-service.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 8: appointments"
git tag step-08-appointments
git rev-parse --verify step-08-appointments   # expect: a commit id, exit 0
```

---

#### Step 9 — Agenda: horarios del dentista y pantalla de citas

**Do**
Interfaz de la agenda y horarios.

**`src/server/schedules.ts`**:
```ts
export type WeeklyRule = { weekday: number /* 1=lunes..7=domingo */; startTime: string /* "HH:mm" */; endTime: string };
export function getWeeklyRules(actor: Actor, membershipId: string): Promise<WeeklyRule[]>;     // reglas vigentes hoy
export function setWeeklyRules(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, rules: WeeklyRule[]): Promise<void>;
// Permiso: admin sobre cualquier dentista/miembro de su clínica; dentist solo sobre sí mismo (membershipId === actor.membershipId); assistant nunca => ForbiddenError.
// Validación zod: weekday 1..7, HH:mm, endTime > startTime, sin solapamientos dentro del mismo día.
// Reemplazo en UNA transacción: UPDATE availability_rules SET valid_until = (hoy de Lima - 1 día) WHERE membership_id = $1 AND (valid_until IS NULL OR valid_until >= hoy); luego INSERT de las nuevas con valid_from = hoy de Lima.
export function addBlockException(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, input: { startsAt: Date; endsAt: Date; reason?: string }): Promise<{ id: string }>; // mismos permisos
```
`role` es `SessionCtx.role`. `ForbiddenError` viene de `src/server/session.ts`.

**`src/app/api/availability/route.ts`**: `export async function GET(request: Request)`. `getSession()` nulo ⇒ `Response.json({ error: "unauthorized" }, { status: 401 })`. Parámetros `dentist` (uuid), `from`, `to` (ISO), `minutes` (entero 5–480), validados con zod ⇒ 400 si fallan. Llama `loadSlots(userActor(ctx), …)` y responde `{ slots: [{ startsAt, endsAt }] }`.

**Tests** (`tests/db/schedules.test.ts`): los 5 criterios; el 4 y el 5 invocan `GET` con `vi.mock("@/server/session")` para fijar `getSession`.

**Interfaz**:
- `src/app/(app)/configuracion/horarios/`: tabla semanal por dentista (7 filas, una o dos franjas por día), guardar con `setWeeklyRules`; formulario "Bloquear horario" (vacaciones, permisos).
- `src/app/(app)/agenda/`: vista de **semana** (columnas = días, filtro por dentista) con las citas de `listAppointments`; formulario "Nueva cita": buscar paciente (reusa `searchPatients`), elegir dentista y duración, listar horarios libres de `loadSlots` como botones, confirmar con `bookAppointment` (muestra "Ese horario acaba de ocuparse, elige otro" ante `SlotTakenError`); cada cita permite **Cancelar** y **Reprogramar**. Todas las horas se muestran en la zona de la clínica con etiqueta ("09:00 hora de Lima").

**Done when**
- [ ] WHEN `setWeeklyRules` replaces a dentist's rules THE SYSTEM SHALL, in one transaction, set `valid_until` on the open rules to the day before today and insert the new rules with `valid_from` today, leaving no gap and no deletion.
- [ ] WHEN a dentist calls `setWeeklyRules` for another dentist THE SYSTEM SHALL throw `ForbiddenError`, and WHEN an admin does THE SYSTEM SHALL succeed, and WHEN an assistant does THE SYSTEM SHALL throw `ForbiddenError`.
- [ ] WHEN `addBlockException` covers part of a working day THE SYSTEM SHALL make `loadSlots` return fewer slots for that day.
- [ ] WHEN `GET /api/availability` is called with a valid session and `dentist`, `from`, `to` and `minutes` THE SYSTEM SHALL answer 200 with `{ slots: [{ startsAt, endsAt }] }` in ISO UTC strings.
- [ ] WHEN `GET /api/availability` is called without a session THE SYSTEM SHALL answer 401, and WHEN `minutes` is missing or not between 5 and 480 THE SYSTEM SHALL answer 400.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/schedules.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 9: agenda-ui"
git tag step-09-agenda-ui
git rev-parse --verify step-09-agenda-ui   # expect: a commit id, exit 0
```

---

#### Step 10 — Recordatorios por WhatsApp (con simulador) y cron

**Do**
Recordatorios 24 h y 2 h antes de cada cita. Los recordatorios los crea y mantiene **un trigger en la base de datos**, en la misma transacción que la cita (reprogramar los mueve, cancelar los omite); un proceso los envía.

`supabase/migrations/20261020000005_reminders.sql`

```sql
-- supabase/migrations/20261020000005_reminders.sql
create type reminder_kind as enum ('h24', 'h2');
create type reminder_status as enum ('pending', 'sent', 'failed', 'skipped');

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid references patients (id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text unique,
  phone_e164 text not null,
  body text not null,
  template_name text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index whatsapp_messages_phone_idx on whatsapp_messages (clinic_id, phone_e164, created_at);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  appointment_id uuid not null references appointments (id) on delete restrict,
  kind reminder_kind not null,
  due_at timestamptz not null,
  status reminder_status not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  sent_at timestamptz,
  message_id uuid references whatsapp_messages (id),
  created_at timestamptz not null default now(),
  unique (appointment_id, kind)
);
create index reminders_due_idx on reminders (due_at) where status = 'pending';

alter table whatsapp_messages enable row level security;
alter table reminders enable row level security;
create policy whatsapp_messages_select on whatsapp_messages for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy reminders_select on reminders for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

-- Keep reminders in step with the appointment, inside the same transaction as the booking write.
-- SECURITY DEFINER: the booking user has no INSERT policy on reminders; the trigger writes on their behalf.
create function sync_appointment_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' then
    insert into reminders (clinic_id, appointment_id, kind, due_at)
    select new.clinic_id, new.id, k.kind, new.starts_at - k.lead
    from (values ('h24'::reminder_kind, interval '24 hours'), ('h2'::reminder_kind, interval '2 hours'))
      as k (kind, lead)
    where new.starts_at - k.lead > now()
    on conflict (appointment_id, kind) do update
      set due_at = excluded.due_at, status = 'pending', attempts = 0, last_error = null
      where reminders.status in ('pending', 'skipped')
        and reminders.due_at is distinct from excluded.due_at;
  else
    update reminders set status = 'skipped'
    where appointment_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger appointments_sync_reminders
  after insert or update of status, starts_at on appointments
  for each row execute function sync_appointment_reminders();
```

`tests/db/reminders.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function book(startsInHours: number) {
  const a = await seedClinic();
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
    [
      a.clinicId,
      patientId,
      a.dentist.membershipId,
      hours(startsInHours),
      hours(startsInHours + 0.5),
    ],
  );
  return { a, id: rows[0]?.id as string };
}
const reminders = async (id: string) =>
  (
    await pool.query(
      "select kind, status, due_at from reminders where appointment_id = $1 order by kind",
      [id],
    )
  ).rows;

describe("reminders", () => {
  it("a confirmed appointment 72h away gets pending h24 and h2 reminders at the right times", async () => {
    const { id } = await book(72);
    const rows = await reminders(id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["h24", "pending"],
      ["h2", "pending"],
    ]);
    const start = Date.now() + 72 * 3_600_000;
    expect(Math.abs(new Date(rows[0].due_at).getTime() - (start - 24 * 3_600_000))).toBeLessThan(
      5_000,
    );
  });

  it("an appointment under 24h away gets only the h2 reminder; under 2h away, none", async () => {
    expect((await reminders((await book(10)).id)).map((r) => r.kind)).toEqual(["h2"]);
    expect(await reminders((await book(1)).id)).toEqual([]);
  });

  it("cancelling skips pending reminders; rescheduling moves their due time", async () => {
    const { id } = await book(72);
    await pool.query("update appointments set starts_at = $2, ends_at = $3 where id = $1", [
      id,
      hours(96),
      hours(96.5),
    ]);
    const moved = await reminders(id);
    const start = Date.now() + 96 * 3_600_000;
    expect(Math.abs(new Date(moved[0].due_at).getTime() - (start - 24 * 3_600_000))).toBeLessThan(
      5_000,
    );
    await pool.query("update appointments set status = 'cancelled' where id = $1", [id]);
    expect((await reminders(id)).every((r) => r.status === "skipped")).toBe(true);
  });

  it("an already-sent reminder is not reset when the appointment is touched", async () => {
    const { id } = await book(72);
    await pool.query(
      "update reminders set status = 'sent', sent_at = now() where appointment_id = $1 and kind = 'h24'",
      [id],
    );
    await pool.query("update appointments set starts_at = starts_at where id = $1", [id]);
    expect((await reminders(id)).find((r) => r.kind === "h24")?.status).toBe("sent");
  });

  it("works when a signed-in user books under RLS: the trigger writes reminders on their behalf", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await asUser(a.assistant.userId, (c) =>
      c.query<{ id: string }>(
        "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
        [a.clinicId, patientId, a.dentist.membershipId, hours(72), hours(72.5)],
      ),
    );
    const id = rows[0]?.id as string;
    expect((await reminders(id)).map((r) => r.kind)).toEqual(["h24", "h2"]);
    await asUser(a.assistant.userId, (c) =>
      c.query("update appointments set status = 'cancelled' where id = $1", [id]),
    );
    expect((await reminders(id)).every((r) => r.status === "skipped")).toBe(true);
  });
});
```

**`src/lib/whatsapp/client.ts`**:
```ts
export const GRAPH_API_VERSION = "v23.0"; // UNVERIFIED: ejemplo en la documentación de Meta; confirmar la versión vigente antes de producción (§20.2)
export type TemplateMessage = { to: string /* E.164 */; template: "recordatorio_cita"; language: "es"; params: string[] };
export type TextMessage = { to: string; body: string };
export interface WhatsAppSender {
  sendTemplate(phoneNumberId: string, message: TemplateMessage): Promise<{ id: string }>;
  sendText(phoneNumberId: string, message: TextMessage): Promise<{ id: string }>;
}
export class SimulatorSender implements WhatsAppSender { readonly sent: Array<{ kind: "template" | "text"; to: string; payload: unknown }>; /* ids "sim-1", "sim-2"… */ }
export class CloudApiSender implements WhatsAppSender {
  constructor(accessToken: string, fetchImpl?: typeof fetch);
  // POST https://graph.facebook.com/{GRAPH_API_VERSION}/{phoneNumberId}/messages con Authorization: Bearer; cuerpo { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: "es" }, components: [{ type: "body", parameters: params.map(text => ({ type: "text", text })) }] } } (o type "text" con text.body);
  // respuesta no 2xx => Error con el status y el cuerpo; éxito => { id: json.messages[0].id }
}
export function getSender(): WhatsAppSender; // getEnv("whatsapp"): "cloud" => CloudApiSender(token); "simulator" => una instancia SimulatorSender compartida por proceso
```
**Plantilla de WhatsApp** (se registra en Meta; categoría *utility*, idioma `es`), nombre `recordatorio_cita`, cuerpo exacto:
```
Hola {{1}}, le recordamos su cita en {{2}} el {{3}} a las {{4}} con {{5}}. Responda 1 para confirmar o 2 para reprogramar.
```
Parámetros: nombre del paciente, nombre de la clínica, fecha `dd/MM/yyyy`, hora `HH:mm` (zona de la clínica), nombre del dentista.

**`src/server/reminders.ts`**:
```ts
export function runDueReminders(opts?: { now?: Date; sender?: WhatsAppSender; limit?: number }): Promise<{ sent: number; failed: number; skipped: number }>;
// En una transacción por lote (withService): SELECT … FROM reminders WHERE status='pending' AND due_at <= now ORDER BY due_at LIMIT limit FOR UPDATE SKIP LOCKED.
// Por recordatorio: cargar cita, paciente, clínica (whatsapp_phone_number_id), dentista.
//  - cita no 'confirmed', o starts_at <= now, o paciente sin teléfono/opt-in, o clínica sin whatsapp_phone_number_id (y modo cloud) => status 'skipped'.
//  - si no: sender.sendTemplate(...) con los 5 parámetros; insertar whatsapp_messages {direction:'out', template_name, status:'sent', wa_message_id}; reminder => 'sent', sent_at, message_id.
//  - si el sender lanza: attempts += 1; last_error = mensaje; si attempts >= 3 => 'failed', si no se queda 'pending'.
```
**`src/app/api/cron/auth.ts`**: `export function assertCron(request: Request): Response | null` — compara `Authorization: Bearer <CRON_SECRET>` (`getEnv("cron")`) en tiempo constante (`crypto.timingSafeEqual` sobre buffers del mismo largo; largo distinto ⇒ no autorizado); devuelve `Response.json({ error: "unauthorized" }, { status: 401 })` si no coincide y `null` si sí. Lo reutilizan las demás rutas de cron.

**`src/app/api/cron/tick/route.ts`**: `export async function POST(request: Request)` (y `GET` igual, para pruebas manuales): si `assertCron` devuelve respuesta ⇒ la devuelve sin procesar; si no ⇒ `runDueReminders()` y `Response.json({ reminders })`. Otras tareas programadas viven en sus propias rutas (`/api/google/cron` en el paso 11, `/api/whatsapp/cron` en el paso 17); el programador del paso 18 las llama a las tres.

**Tests de servicio** (`tests/db/reminders-service.test.ts`, nuevo, escrito por el builder): criterios 2 a 6, con `SimulatorSender`/un sender falso, citas insertadas por SQL (como en `tests/db/reminders.test.ts`) y `opts.now` para adelantar el reloj. La concurrencia (criterio 5): dos `runDueReminders` en paralelo con el mismo sender; el total de envíos debe ser igual al número de recordatorios.

**Done when**
- [ ] WHEN `pnpm test:db tests/db/reminders.test.ts` runs THE SYSTEM SHALL pass, proving that a confirmed appointment 72 hours away gets pending `h24` and `h2` reminders due 24 h and 2 h before it, that one 10 hours away gets only `h2`, that cancelling skips pending reminders, and that a `sent` reminder is not reset.
- [ ] WHEN `runDueReminders` runs for a due reminder whose patient has `whatsapp_opt_in = true` THE SYSTEM SHALL send the template `recordatorio_cita` with 5 parameters through the injected sender, insert one outbound `whatsapp_messages` row, and set the reminder `sent`.
- [ ] WHEN the patient has no opt-in or no phone THE SYSTEM SHALL mark the reminder `skipped` and SHALL NOT call the sender.
- [ ] WHEN the sender throws THE SYSTEM SHALL increment `attempts` and keep the reminder `pending` until the third failure, after which it SHALL be `failed` with `last_error` set.
- [ ] WHEN two `runDueReminders` calls run concurrently over the same due reminders THE SYSTEM SHALL send each reminder exactly once.
- [ ] WHEN `POST /api/cron/tick` receives a missing or wrong bearer token THE SYSTEM SHALL answer 401 and process nothing, and WHEN it receives `Authorization: Bearer <CRON_SECRET>` THE SYSTEM SHALL answer 200 with a JSON summary.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/reminders.test.ts
pnpm test:db tests/db/reminders-service.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 10: reminders"
git tag step-10-reminders
git rev-parse --verify step-10-reminders   # expect: a commit id, exit 0
```

---

#### Step 11 — Google Calendar: conexión, publicación de citas y bloqueos

**Do**
Cada dentista puede conectar **su** Google Calendar (OAuth, acceso sin conexión). Las citas confirmadas se publican como eventos y sus bloqueos de "ocupado" se leen para no ofrecer esos horarios. **Diseño desacoplado:** la sincronización corre en el cron (cada 5 minutos), no dentro de la reserva, de modo que un fallo de Google nunca impide agendar. El refresh token se guarda **cifrado** (AES-256-GCM) y el navegador nunca puede leerlo (permiso de columna en la migración).

`supabase/migrations/20261020000006_google.sql`

```sql
-- supabase/migrations/20261020000006_google.sql
create table google_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null unique references memberships (id) on delete restrict,
  google_email text not null,
  calendar_id text not null default 'primary',
  refresh_token_enc text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  created_at timestamptz not null default now()
);

alter table google_connections enable row level security;
-- refresh_token_enc must never reach the browser: no SELECT for authenticated, the server reads it as owner.
revoke select on google_connections from authenticated;
grant select (id, clinic_id, membership_id, google_email, calendar_id, status, created_at)
  on google_connections to authenticated;
create policy google_connections_select on google_connections for select to authenticated
  using (membership_id in (select id from memberships where user_id = auth.uid()) or is_clinic_admin(clinic_id));
```

**`src/lib/google/`** (usa `fetch` directo; todas las funciones reciben `fetchImpl: typeof fetch = fetch` para los tests):
```ts
// crypto.ts — getEnv("crypto").TOKEN_ENC_KEY (32 bytes base64)
export function encryptToken(plain: string): string;      // "v1:<iv b64>:<tag b64>:<ciphertext b64>", IV aleatorio de 12 bytes, AES-256-GCM
export function decryptToken(enc: string): string;        // lanza si el formato, el tag o el contenido no son válidos
export function signState(membershipId: string, now?: Date): string;  // "<membershipId>.<expEpochSeconds>.<hmac-sha256 hex>" con TOKEN_ENC_KEY; vigencia 10 minutos
export function verifyState(state: string, now?: Date): string;       // devuelve membershipId o lanza (firma mala, vencido, formato)
// oauth.ts
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"]; // UNVERIFIED: confirmar contra la documentación de Google (§20.2)
export function buildAuthUrl(state: string): string;      // https://accounts.google.com/o/oauth2/v2/auth con client_id, redirect_uri = APP_URL + "/api/google/oauth/callback", response_type=code, scope, access_type=offline, prompt=consent, state
export function exchangeCode(code: string, fetchImpl?: typeof fetch): Promise<{ refreshToken: string; email: string }>;  // POST https://oauth2.googleapis.com/token; email del payload del id_token (se decodifica sin verificar: llega directo de Google por TLS)
export function accessTokenFromRefresh(refreshToken: string, fetchImpl?: typeof fetch): Promise<string>;  // lanza GoogleAuthError con code "invalid_grant" cuando Google responde error invalid_grant
export class GoogleAuthError extends Error { code: string }
// calendar.ts — base https://www.googleapis.com/calendar/v3
export function createEvent(accessToken: string, calendarId: string, ev: { summary: string; description?: string; startsAt: Date; endsAt: Date; timeZone: string }, fetchImpl?: typeof fetch): Promise<string>; // POST /calendars/{id}/events => id
export function deleteEvent(accessToken: string, calendarId: string, eventId: string, fetchImpl?: typeof fetch): Promise<void>; // DELETE; 404/410 se tratan como éxito
export function queryBusy(accessToken: string, calendarId: string, from: Date, to: Date, fetchImpl?: typeof fetch): Promise<Array<{ startsAt: Date; endsAt: Date }>>; // POST https://www.googleapis.com/calendar/v3/freeBusy
```
**`src/lib/google/sync.ts`**:
```ts
export function connectGoogle(actor: Actor, membershipId: string, code: string, fetchImpl?: typeof fetch): Promise<void>; // exchangeCode + upsert google_connections (refresh_token_enc = encryptToken)
export function runGoogleSync(opts?: { now?: Date; fetchImpl?: typeof fetch }): Promise<{ created: number; deleted: number; connections: number; revoked: number }>;
// Por conexión 'active' (withService): access token => (a) borrar eventos de citas 'cancelled' con google_event_id; (b) crear evento para citas 'confirmed' futuras sin google_event_id
// (summary "Cita: <paciente> — <motivo|Consulta>", sin datos clínicos) y guardar google_event_id; (c) queryBusy(now, now + 30 días) y reemplazar external_busy del dentista (DELETE + INSERT en una transacción; es una caché).
// GoogleAuthError invalid_grant => status 'revoked', last_error; seguir con las demás.
```
**Rutas** (`src/app/api/google/`): `oauth/start/route.ts` (`GET`, requiere sesión; `redirect(buildAuthUrl(signState(ctx.membershipId)))`) y `oauth/callback/route.ts` (`GET`, pública para el proxy pero valida `state` con `verifyState`, llama `connectGoogle` y redirige a `/configuracion/horarios?google=ok`; error ⇒ `?google=error`). Y `cron/route.ts` (`POST`/`GET`; `assertCron` de `@/app/api/cron/auth`; ruta pública para el proxy: `/api/google/cron`) que ejecuta `runGoogleSync()` y responde `{ google: <resumen> }`.

**Tests** (`tests/db/google.test.ts`, escrito por el builder): los 6 criterios con un `fetch` falso que registra las llamadas y responde según la URL; el criterio 5 también llama `loadSlots` (paso 8).

**Interfaz** (`src/app/(app)/configuracion/google/page.tsx`): estado de la conexión de Google Calendar del dentista que inicia sesión (conectado como <correo> / desconectado / revocado) y botón "Conectar Google Calendar" (enlace a `/api/google/oauth/start`); los administradores ven el estado de todos los dentistas.

**Done when**
- [ ] WHEN `encryptToken` encrypts the same plaintext twice THE SYSTEM SHALL produce two different `v1:` ciphertexts that both decrypt to the plaintext, and WHEN a ciphertext byte is altered THE SYSTEM SHALL throw on `decryptToken`, and WHEN the `authenticated` role selects `refresh_token_enc` from `google_connections` THE SYSTEM SHALL fail with `permission denied` while selecting `google_email` and `status` succeeds for the connection's owner.
- [ ] WHEN `verifyState` receives a state signed by `signState` within its lifetime THE SYSTEM SHALL return the membership id, and WHEN it is expired or tampered THE SYSTEM SHALL throw.
- [ ] WHEN `runGoogleSync` runs with a fake `fetch` and an active connection THE SYSTEM SHALL create one Calendar event per `confirmed` appointment that has no `google_event_id`, store the returned id, and WHEN it runs again THE SYSTEM SHALL create no new event.
- [ ] WHEN an appointment with a `google_event_id` is `cancelled` THE SYSTEM SHALL issue one DELETE for that event and clear `google_event_id`.
- [ ] WHEN the fake free/busy response lists busy blocks THE SYSTEM SHALL replace that dentist's `external_busy` rows with them, and `loadSlots` SHALL stop offering overlapping slots.
- [ ] WHEN Google answers `invalid_grant` while refreshing the token THE SYSTEM SHALL set the connection `revoked`, record `last_error`, and continue with the other connections without throwing.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/google.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 11: google-calendar"
git tag step-11-google-calendar
git rev-parse --verify step-11-google-calendar   # expect: a commit id, exit 0
```

---

#### Step 12 — Catálogo de tratamientos y cotizaciones

**Do**
Cotizaciones del dentista o la clínica hacia el paciente, con catálogo de tratamientos. **Dinero siempre en céntimos enteros de PEN** (precios con IGV incluido; las cotizaciones son referenciales y **no** son comprobantes SUNAT). Estados: `draft → sent → accepted | rejected | expired` (y `draft → expired`); el trigger de la base de datos impide cualquier otro salto.

`supabase/migrations/20261020000007_quotes.sql`

```sql
-- supabase/migrations/20261020000007_quotes.sql
create type quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

create table treatments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  default_price_cents integer not null check (default_price_cents >= 0),
  duration_minutes smallint not null default 30 check (duration_minutes between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create table quote_counters (
  clinic_id uuid primary key references clinics (id) on delete restrict,
  last_number integer not null default 0
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  number integer not null,
  status quote_status not null default 'draft',
  valid_until date not null,
  discount_cents integer not null default 0 check (discount_cents >= 0),
  notes text,
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, number)
);
create index quotes_patient_idx on quotes (patient_id, created_at);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  quote_id uuid not null references quotes (id) on delete restrict,
  treatment_id uuid references treatments (id),
  description text not null check (length(trim(description)) > 0),
  tooth_fdi smallint,
  quantity smallint not null default 1 check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);
create index quote_items_quote_idx on quote_items (quote_id);

-- Next quote number for a clinic. Row lock on the counter serialises concurrent callers.
create function next_quote_number(p_clinic uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_clinic not in (select current_clinic_ids()) then
    raise exception 'not a member of clinic %', p_clinic using errcode = 'insufficient_privilege';
  end if;
  insert into quote_counters (clinic_id, last_number) values (p_clinic, 1)
  on conflict (clinic_id) do update set last_number = quote_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

-- Only forward transitions: draft -> sent -> accepted | rejected | expired (and draft -> expired).
create function guard_quote_status() returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('sent', 'expired')) or
    (old.status = 'sent' and new.status in ('accepted', 'rejected', 'expired'))
  ) then
    raise exception 'invalid quote status change % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quotes_status_guard before update of status on quotes
  for each row execute function guard_quote_status();

alter table treatments enable row level security;
alter table quote_counters enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
revoke all on quote_counters from authenticated;

create policy treatments_select on treatments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy treatments_insert on treatments for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy treatments_update on treatments for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
create policy quotes_select on quotes for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_insert on quotes for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_update on quotes for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_select on quote_items for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_insert on quote_items for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_update on quote_items for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
```

`tests/db/quotes.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function quote(a: Awaited<ReturnType<typeof seedClinic>>) {
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into quotes (clinic_id, patient_id, number, valid_until, created_by) values ($1, $2, 1, current_date + 30, $3) returning id",
    [a.clinicId, patientId, a.dentist.membershipId],
  );
  return { patientId, quoteId: rows[0]?.id as string };
}

describe("quotes", () => {
  it("numbers are sequential per clinic and only members can draw one", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const next = async (userId: string, clinicId: string) =>
      (await asUser(userId, (c) => c.query("select next_quote_number($1) as n", [clinicId])))
        .rows[0].n as number;
    expect([
      await next(a.dentist.userId, a.clinicId),
      await next(a.dentist.userId, a.clinicId),
    ]).toEqual([1, 2]);
    expect(await next(b.dentist.userId, b.clinicId)).toBe(1);
    await expect(next(b.dentist.userId, a.clinicId)).rejects.toThrow(/not a member/);
  });

  it("status only moves forward: draft -> sent -> accepted, never draft -> accepted or back", async () => {
    const a = await seedClinic();
    const { quoteId } = await quote(a);
    const set = (status: string) =>
      pool.query("update quotes set status = $2 where id = $1", [quoteId, status]);
    await expect(set("accepted")).rejects.toThrow(/invalid quote status change/);
    await set("sent");
    await expect(set("draft")).rejects.toThrow(/invalid quote status change/);
    await set("accepted");
    await expect(set("rejected")).rejects.toThrow(/invalid quote status change/);
  });

  it("assistants cannot read quotes; dentists can; other clinics cannot", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await quote(a);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from quotes"))).rowCount,
    ).toBe(0);
    expect((await asUser(a.dentist.userId, (c) => c.query("select id from quotes"))).rowCount).toBe(
      1,
    );
    expect((await asUser(b.dentist.userId, (c) => c.query("select id from quotes"))).rowCount).toBe(
      0,
    );
  });

  it("only admins manage the treatment catalog", async () => {
    const a = await seedClinic();
    const add = (userId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into treatments (clinic_id, name, default_price_cents) values ($1, 'Limpieza', 8000)",
          [a.clinicId],
        ),
      );
    await expect(add(a.dentist.userId)).rejects.toThrow(/row-level security/);
    await add(a.admin.userId);
    await expect(add(a.admin.userId)).rejects.toThrow(/duplicate key/);
  });
});
```

**`src/lib/money.ts`**:
```ts
export class InvalidDiscountError extends Error {}
export function quoteTotals(items: Array<{ quantity: number; unitPriceCents: number }>, discountCents: number): { subtotalCents: number; discountCents: number; totalCents: number }; // descuento > subtotal => InvalidDiscountError
export function formatPEN(cents: number): string;   // "S/ 120.50" (siempre dos decimales, separador de miles con coma)
export function parsePEN(input: string): number | null; // "120.5", "S/ 1,200.50" => céntimos; negativo o no numérico => null
```

**`src/server/quotes.ts`** (actores de usuario; roles `admin` y `dentist` únicamente, otro rol ⇒ `ForbiddenError` de `src/server/session.ts`; el rol se consulta en `memberships`):
```ts
export class QuoteLockedError extends Error {}
export type QuoteItemInput = { treatmentId?: string; description: string; toothFdi?: number; quantity: number; unitPriceCents: number };
export function saveTreatment(actor: Extract<Actor, { kind: "user" }>, input: { id?: string; name: string; defaultPriceCents: number; durationMinutes: number; active?: boolean }): Promise<{ id: string }>; // solo admin (RLS lo exige; mapear a ForbiddenError)
export function listTreatments(actor: Actor, opts?: { activeOnly?: boolean }): Promise<Treatment[]>;
export function createQuote(actor: Extract<Actor, { kind: "user" }>, input: { patientId: string; validUntil?: string; discountCents?: number; notes?: string; items: QuoteItemInput[] }): Promise<{ id: string; number: number }>;
// number = select next_quote_number(clinic) en la misma transacción (withTenant); validUntil por defecto = hoy de Lima + 30 días; 1..50 ítems; valida con quoteTotals.
export function updateDraftQuote(actor: Extract<Actor, { kind: "user" }>, id: string, patch: Partial<{ validUntil: string; discountCents: number; notes: string; items: QuoteItemInput[] }>): Promise<void>; // si status != 'draft' => QuoteLockedError; si patch.items viene, reemplaza TODOS los ítems del borrador (ver nota); revalida con quoteTotals
export function setQuoteStatus(actor: Extract<Actor, { kind: "user" }>, id: string, status: "sent" | "accepted" | "rejected" | "expired"): Promise<void>; // el trigger valida; mapear check_violation a Error("invalid quote status change")
export function getQuote(actor: Extract<Actor, { kind: "user" }>, id: string): Promise<{ quote: Quote; items: QuoteItem[]; totals: ReturnType<typeof quoteTotals> } | null>;
export function listQuotes(actor: Extract<Actor, { kind: "user" }>, opts?: { patientId?: string; status?: string }): Promise<Quote[]>;
export function expireOverdueQuotes(opts?: { now?: Date }): Promise<number>; // withService; devuelve cuántas expiró
```
Nota sobre ítems en borrador: `authenticated` no tiene `DELETE`. Para reemplazar los ítems, primero verifica con `withTenant` que el actor ve la cotización y que está en `draft`, y ejecuta el borrado y la inserción de ítems con `withService` (propietario) filtrando por `quote_id` y `clinic_id`. Es la única excepción a "nadie borra": los ítems de un borrador no son un registro histórico.

**Tests de servicio** (`tests/db/quotes-service.test.ts`): los criterios 2 a 6.

**Interfaz** (`src/app/(app)/cotizaciones/`): lista con filtros por estado; `nueva/page.tsx` (elegir paciente, agregar ítems desde el catálogo o libres, descuento, vigencia; total en vivo con `quoteTotals` y `formatPEN`); `[id]/page.tsx` (detalle; botones "Marcar enviada", "Aceptada", "Rechazada" según el estado; enlace "Descargar PDF" que apunta a `/api/quotes/<id>/pdf`, creado en el paso 13); `catalogo/page.tsx` (solo admin: alta y edición de tratamientos con precio y duración).

**Done when**
- [ ] WHEN `pnpm test:db tests/db/quotes.test.ts` runs THE SYSTEM SHALL pass all 4 tests: sequential per-clinic numbers, forward-only status changes, role-limited reads, and an admin-only treatment catalog.
- [ ] WHEN `quoteTotals` receives items `2 x 5000` and `1 x 3000` cents with a discount of 1000 THE SYSTEM SHALL return subtotal 13000, discount 1000 and total 12000, and WHEN the discount exceeds the subtotal THE SYSTEM SHALL throw `InvalidDiscountError`.
- [ ] WHEN `createQuote` runs twice in one clinic THE SYSTEM SHALL assign numbers 1 and 2, and the quote SHALL start as `draft` with `valid_until` defaulting to 30 days from today in `America/Lima`.
- [ ] WHEN `updateDraftQuote` runs on a quote whose status is not `draft` THE SYSTEM SHALL throw `QuoteLockedError` and change nothing.
- [ ] WHEN `expireOverdueQuotes` runs THE SYSTEM SHALL set `expired` on every `draft` or `sent` quote whose `valid_until` is before today in Lima and leave `accepted` and `rejected` quotes untouched.
- [ ] WHEN an `assistant` calls `createQuote` or `listQuotes` THE SYSTEM SHALL throw `ForbiddenError`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/quotes.test.ts
pnpm test:db tests/db/quotes-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 12: quotes"
git tag step-12-quotes
git rev-parse --verify step-12-quotes   # expect: a commit id, exit 0
```

---

#### Step 13 — PDF de la cotización

**Do**
PDF descargable de una cotización con `@react-pdf/renderer` (renderiza en Node; `serverExternalPackages` ya lo excluye del bundle, §19.6).

**`src/lib/pdf/quote-document.tsx`**:
```ts
export type QuotePdfData = { clinicName: string; patientName: string; patientDocument: string; number: number; createdAt: Date; validUntil: string; notes?: string; items: Array<{ description: string; toothFdi?: number; quantity: number; unitPriceCents: number }>; discountCents: number };
export function renderQuotePdf(data: QuotePdfData): Promise<Buffer>; // renderToBuffer(<QuoteDocument … />)
```
Diseño: A4, fuente integrada Helvetica (sin descargas de red), encabezado con el nombre de la clínica y "COTIZACIÓN N° <número con ceros a la izquierda, 6 dígitos>", datos del paciente, tabla (Descripción · Pieza · Cant. · P. unit. · Subtotal), subtotal, descuento, **total en soles** con `formatPEN`, vigencia, notas y pie fijo: "Cotización referencial. No constituye comprobante de pago." Color de acento `#0f766e`.

**`src/app/api/quotes/[id]/pdf/route.ts`**: `export async function GET(request: Request, { params }: { params: Promise<{ id: string }> })`. Sin sesión ⇒ 401; rol `assistant` ⇒ 403; `getQuote` (paso 12) nulo ⇒ 404 (RLS oculta cotizaciones de otras clínicas); si no, `renderQuotePdf` con los datos de la cotización, el paciente (`getPatient`) y la clínica, y responde con `new Response(buffer, { headers })` con `Content-Type: application/pdf` y `Content-Disposition: inline; filename="cotizacion-<n>.pdf"`.

**Tests**: `tests/unit/quote-pdf.test.ts` (criterios 1 y 2) y `tests/db/quote-pdf-route.test.ts` (criterios 3 a 5, con `vi.mock("@/server/session")` y datos creados con los servicios de los pasos 5 y 12).

**Done when**
- [ ] WHEN `renderQuotePdf` receives a quote with 3 items THE SYSTEM SHALL return a Buffer whose first 5 bytes are `%PDF-` and whose length exceeds 1000 bytes.
- [ ] WHEN `renderQuotePdf` receives a quote with 0 items THE SYSTEM SHALL still return a valid PDF Buffer.
- [ ] WHEN `GET /api/quotes/<id>/pdf` is called without a session THE SYSTEM SHALL answer 401.
- [ ] WHEN it is called by an `assistant`, or for a quote of another clinic, THE SYSTEM SHALL answer 403 or 404 respectively and return no PDF bytes.
- [ ] WHEN it is called by a dentist of the quote's clinic THE SYSTEM SHALL answer 200 with `Content-Type: application/pdf` and `Content-Disposition: inline; filename="cotizacion-<number>.pdf"`.

**Verify**
```bash
pnpm db:up
pnpm test:unit tests/unit/quote-pdf.test.ts
pnpm test:db tests/db/quote-pdf-route.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 13: quote-pdf"
git tag step-13-quote-pdf
git rev-parse --verify step-13-quote-pdf   # expect: a commit id, exit 0
```

---

#### Step 14 — Registro de cobros y saldos

**Do**
Registro de **cobros** de la clínica al paciente (no procesa pagos: registra lo cobrado). Los cobros son **inmutables**; un error se corrige **anulando** (fila en `charge_voids`), nunca editando ni borrando. Admin, dentista y asistente pueden registrar cobros; solo admin puede anularlos. Los pagos parciales (abonos) son el caso normal en tratamientos largos.

`supabase/migrations/20261020000008_charges.sql`

```sql
-- supabase/migrations/20261020000008_charges.sql
create type payment_method as enum ('cash', 'yape', 'plin', 'card', 'transfer');

create table charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  quote_id uuid references quotes (id),
  appointment_id uuid references appointments (id),
  amount_cents integer not null check (amount_cents > 0),
  method payment_method not null,
  concept text not null check (length(trim(concept)) > 0),
  paid_at timestamptz not null default now(),
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index charges_patient_idx on charges (patient_id, paid_at);
create index charges_quote_idx on charges (quote_id);

create table charge_voids (
  charge_id uuid primary key references charges (id) on delete restrict,
  clinic_id uuid not null references clinics (id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  voided_by uuid not null references memberships (id),
  voided_at timestamptz not null default now()
);

create trigger charges_append_only before update or delete on charges
  for each row execute function forbid_mutation();
create trigger charge_voids_append_only before update or delete on charge_voids
  for each row execute function forbid_mutation();
revoke update on charges, charge_voids from authenticated;

-- Money owed on accepted quotes, net of non-voided charges.
create view quote_balances with (security_invoker = true) as
select q.id as quote_id, q.clinic_id, q.patient_id, q.number,
  greatest(coalesce(i.total, 0) - q.discount_cents, 0) as total_cents,
  coalesce(c.paid, 0) as paid_cents,
  greatest(coalesce(i.total, 0) - q.discount_cents, 0) - coalesce(c.paid, 0) as balance_cents
from quotes q
left join (select quote_id, sum(quantity * unit_price_cents)::bigint as total
           from quote_items group by quote_id) i on i.quote_id = q.id
left join (select ch.quote_id, sum(ch.amount_cents)::bigint as paid
           from charges ch left join charge_voids v on v.charge_id = ch.id
           where v.charge_id is null group by ch.quote_id) c on c.quote_id = q.id
where q.status = 'accepted';

alter table charges enable row level security;
alter table charge_voids enable row level security;
create policy charges_select on charges for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charges_insert on charges for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charge_voids_select on charge_voids for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charge_voids_insert on charge_voids for insert to authenticated
  with check (is_clinic_admin(clinic_id));
```

`tests/db/charges.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function acceptedQuote(a: Awaited<ReturnType<typeof seedClinic>>) {
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into quotes (clinic_id, patient_id, number, valid_until, discount_cents, created_by) values ($1, $2, 1, current_date + 30, 1000, $3) returning id",
    [a.clinicId, patientId, a.dentist.membershipId],
  );
  const quoteId = rows[0]?.id as string;
  await pool.query(
    "insert into quote_items (clinic_id, quote_id, description, quantity, unit_price_cents) values ($1, $2, 'Limpieza', 2, 5000)",
    [a.clinicId, quoteId],
  );
  await pool.query("update quotes set status = 'sent' where id = $1", [quoteId]);
  await pool.query("update quotes set status = 'accepted' where id = $1", [quoteId]);
  return { patientId, quoteId };
}

const charge = (
  a: Awaited<ReturnType<typeof seedClinic>>,
  patientId: string,
  quoteId: string,
  cents: number,
) =>
  pool.query<{ id: string }>(
    "insert into charges (clinic_id, patient_id, quote_id, amount_cents, method, concept, created_by) values ($1, $2, $3, $4, 'yape', 'abono', $5) returning id",
    [a.clinicId, patientId, quoteId, cents, a.admin.membershipId],
  );
const balance = async (quoteId: string) =>
  (
    await pool.query(
      "select total_cents, paid_cents, balance_cents from quote_balances where quote_id = $1",
      [quoteId],
    )
  ).rows[0];

describe("charges", () => {
  it("balance = items - discount - non-voided charges", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "0",
      balance_cents: "9000",
    });
    await charge(a, patientId, quoteId, 3000);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "3000",
      balance_cents: "6000",
    });
  });

  it("voiding a charge returns its amount to the balance and the charge row stays", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 3000);
    await pool.query(
      "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'monto mal digitado', $3)",
      [rows[0]?.id, a.clinicId, a.admin.membershipId],
    );
    expect((await balance(quoteId)).paid_cents).toBe("0");
    expect(
      (await pool.query("select count(*)::int as n from charges where id = $1", [rows[0]?.id]))
        .rows[0].n,
    ).toBe(1);
  });

  it("charges are immutable and a non-positive amount is rejected", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    await expect(
      pool.query("update charges set amount_cents = 1 where id = $1", [rows[0]?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from charges where id = $1", [rows[0]?.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(charge(a, patientId, quoteId, 0)).rejects.toThrow(/check constraint/);
  });

  it("only admins void; assistants may record charges; other clinics see nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    const voidAs = (userId: string, membershipId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'x', $3)",
          [rows[0]?.id, a.clinicId, membershipId],
        ),
      );
    await expect(voidAs(a.assistant.userId, a.assistant.membershipId)).rejects.toThrow(
      /row-level security/,
    );
    await voidAs(a.admin.userId, a.admin.membershipId);
    expect((await asUser(b.admin.userId, (c) => c.query("select id from charges"))).rowCount).toBe(
      0,
    );
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from charges"))).rowCount,
    ).toBe(1);
  });
});
```

**`src/server/charges.ts`**:
```ts
export class OverpaymentError extends Error {}
export class QuoteNotAcceptedError extends Error {}
export type PaymentMethod = "cash" | "yape" | "plin" | "card" | "transfer";
export function recordCharge(actor: Extract<Actor, { kind: "user" }>, input: { patientId: string; quoteId?: string; appointmentId?: string; amountCents: number; method: PaymentMethod; concept: string; paidAt?: Date }): Promise<{ id: string }>;
// zod: amountCents entero > 0; concept no vacío. Los asistentes registran cobros pero NO ven `quotes` por RLS, así que la operación completa corre con `withService` en UNA transacción, con autorización explícita:
// (a) la membresía actor.membershipId está activa en actor.clinicId (cualquier rol); (b) con quoteId: SELECT … FROM quotes WHERE id = $1 AND clinic_id = $2 FOR UPDATE (serializa cobros concurrentes de esa cotización), mismo paciente, status 'accepted' (QuoteNotAcceptedError) y amountCents <= saldo de quote_balances (OverpaymentError); (c) INSERT del cobro con created_by = actor.membershipId.
export function voidCharge(actor: Extract<Actor, { kind: "user" }>, chargeId: string, reason: string): Promise<void>; // solo admin => ForbiddenError; ya anulado => Error("charge already voided")
export function listCharges(actor: Extract<Actor, { kind: "user" }>, opts?: { patientId?: string; from?: Date; to?: Date }): Promise<Array<Charge & { voided: boolean }>>;
export function patientBalance(actor: Extract<Actor, { kind: "user" }>, patientId: string): Promise<{ totalCents: number; paidCents: number; balanceCents: number }>; // suma de quote_balances de ese paciente Corre con withService y la autorización explícita (a) de recordCharge: los asistentes no ven quotes por RLS.
```
**Tests de servicio** (`tests/db/charges-service.test.ts`): los criterios 2 a 5; la concurrencia usa `Promise.allSettled` sobre dos llamadas.

**Interfaz** (`src/app/(app)/cobros/`): formulario "Registrar cobro" (paciente, cotización aceptada opcional con su saldo visible, monto en soles con `parsePEN`, método, concepto), lista de cobros con filtros por paciente y fechas, y "Anular" (solo admin, con motivo obligatorio). Los anulados se muestran tachados con su motivo. Al elegir un paciente en el formulario, muestra su saldo pendiente con `patientBalance`.

**Done when**
- [ ] WHEN `pnpm test:db tests/db/charges.test.ts` runs THE SYSTEM SHALL pass all 4 tests: balance arithmetic, voiding, immutability, and role limits.
- [ ] WHEN `recordCharge` targets an `accepted` quote with total 9000 and amount 3000 THE SYSTEM SHALL insert the charge and `patientBalance` SHALL report a 6000 balance for that patient.
- [ ] WHEN `recordCharge` targets a quote that is not `accepted`, or an amount above the remaining balance, THE SYSTEM SHALL throw `OverpaymentError` or `QuoteNotAcceptedError` respectively and insert nothing.
- [ ] WHEN two `recordCharge` calls of 6000 each run concurrently against a remaining balance of 9000 THE SYSTEM SHALL insert exactly one and reject the other with `OverpaymentError`.
- [ ] WHEN an admin calls `voidCharge` THE SYSTEM SHALL insert a `charge_voids` row, the balance SHALL increase by the charge amount, and the charge row SHALL remain; WHEN a non-admin calls it THE SYSTEM SHALL throw `ForbiddenError`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/charges.test.ts
pnpm test:db tests/db/charges-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 14: charges"
git tag step-14-charges
git rev-parse --verify step-14-charges   # expect: a commit id, exit 0
```

---

#### Step 15 — Control de gastos y resumen mensual

**Do**
Control de gastos de la clínica (insumos, laboratorio, alquiler, sueldos, servicios, marketing, otros) y el **resumen mensual** ingresos − gastos. **Solo admin** ve y registra finanzas (RLS y servicio). Los gastos también son inmutables y se corrigen anulando. En v1 el comprobante es solo una nota de texto (`receipt_note`); no hay subida de archivos.

`supabase/migrations/20261020000009_expenses.sql`

```sql
-- supabase/migrations/20261020000009_expenses.sql
create type expense_category as enum
  ('insumos', 'laboratorio', 'alquiler', 'sueldos', 'servicios', 'marketing', 'otros');

create table expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  category expense_category not null,
  supplier text,
  description text not null check (length(trim(description)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  method payment_method not null,
  incurred_on date not null,
  receipt_note text,
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index expenses_clinic_date_idx on expenses (clinic_id, incurred_on);

create table expense_voids (
  expense_id uuid primary key references expenses (id) on delete restrict,
  clinic_id uuid not null references clinics (id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  voided_by uuid not null references memberships (id),
  voided_at timestamptz not null default now()
);

create trigger expenses_append_only before update or delete on expenses
  for each row execute function forbid_mutation();
create trigger expense_voids_append_only before update or delete on expense_voids
  for each row execute function forbid_mutation();
revoke update on expenses, expense_voids from authenticated;

-- Income minus expenses per clinic and month (America/Lima calendar months), voided rows excluded.
create view monthly_summary with (security_invoker = true) as
with inc as (
  select ch.clinic_id,
    date_trunc('month', ch.paid_at at time zone 'America/Lima')::date as month,
    sum(ch.amount_cents)::bigint as income_cents
  from charges ch left join charge_voids v on v.charge_id = ch.id
  where v.charge_id is null group by 1, 2
), exp as (
  select e.clinic_id, date_trunc('month', e.incurred_on)::date as month,
    sum(e.amount_cents)::bigint as expense_cents
  from expenses e left join expense_voids v on v.expense_id = e.id
  where v.expense_id is null group by 1, 2
)
select coalesce(inc.clinic_id, exp.clinic_id) as clinic_id,
  coalesce(inc.month, exp.month) as month,
  coalesce(inc.income_cents, 0) as income_cents,
  coalesce(exp.expense_cents, 0) as expense_cents,
  coalesce(inc.income_cents, 0) - coalesce(exp.expense_cents, 0) as net_cents
from inc full join exp on inc.clinic_id = exp.clinic_id and inc.month = exp.month;

alter table expenses enable row level security;
alter table expense_voids enable row level security;
-- Finance is admin-only: dentists and assistants cannot read expenses.
create policy expenses_select on expenses for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy expenses_insert on expenses for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy expense_voids_select on expense_voids for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy expense_voids_insert on expense_voids for insert to authenticated
  with check (is_clinic_admin(clinic_id));
```

`tests/db/expenses.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const expense = (a: Awaited<ReturnType<typeof seedClinic>>, cents: number, day = "2027-03-10") =>
  pool.query<{ id: string }>(
    "insert into expenses (clinic_id, category, description, amount_cents, method, incurred_on, created_by) values ($1, 'insumos', 'Guantes', $2, 'cash', $3, $4) returning id",
    [a.clinicId, cents, day, a.admin.membershipId],
  );

describe("expenses and the monthly summary", () => {
  it("only admins can read or write expenses", async () => {
    const a = await seedClinic();
    await expense(a, 2000);
    expect((await asUser(a.admin.userId, (c) => c.query("select id from expenses"))).rowCount).toBe(
      1,
    );
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from expenses"))).rowCount,
    ).toBe(0);
    await expect(
      asUser(a.assistant.userId, (c) =>
        c.query(
          "insert into expenses (clinic_id, category, description, amount_cents, method, incurred_on, created_by) values ($1, 'otros', 'x', 100, 'cash', '2027-03-01', $2)",
          [a.clinicId, a.assistant.membershipId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("the summary nets income against expenses per Lima month and ignores voided rows", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await expense(a, 2000, "2027-03-10");
    const voided = await expense(a, 500, "2027-03-11");
    await pool.query(
      "insert into expense_voids (expense_id, clinic_id, reason, voided_by) values ($1, $2, 'duplicado', $3)",
      [voided.rows[0]?.id, a.clinicId, a.admin.membershipId],
    );
    // 2027-04-01 03:00Z is still 2027-03-31 22:00 in Lima, so it counts toward March
    await pool.query(
      "insert into charges (clinic_id, patient_id, amount_cents, method, concept, paid_at, created_by) values ($1, $2, 10000, 'cash', 'consulta', '2027-04-01T03:00:00Z', $3)",
      [a.clinicId, patientId, a.admin.membershipId],
    );
    const { rows } = await asUser(a.admin.userId, (c) =>
      c.query("select month::text, income_cents, expense_cents, net_cents from monthly_summary"),
    );
    expect(rows).toEqual([
      { month: "2027-03-01", income_cents: "10000", expense_cents: "2000", net_cents: "8000" },
    ]);
  });

  it("expenses are immutable; a non-positive amount is rejected", async () => {
    const a = await seedClinic();
    const { rows } = await expense(a, 100);
    await expect(
      pool.query("update expenses set amount_cents = 5 where id = $1", [rows[0]?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(expense(a, 0)).rejects.toThrow(/check constraint/);
  });
});
```

**`src/server/expenses.ts`** (solo admin; otro rol ⇒ `ForbiddenError` de `src/server/session.ts`; el rol se consulta en `memberships`):
```ts
export type ExpenseCategory = "insumos" | "laboratorio" | "alquiler" | "sueldos" | "servicios" | "marketing" | "otros";
export function recordExpense(actor: Extract<Actor, { kind: "user" }>, input: { category: ExpenseCategory; supplier?: string; description: string; amountCents: number; method: PaymentMethod; incurredOn: string /* YYYY-MM-DD */; receiptNote?: string }): Promise<{ id: string }>;
export function voidExpense(actor: Extract<Actor, { kind: "user" }>, expenseId: string, reason: string): Promise<void>;
export function listExpenses(actor: Extract<Actor, { kind: "user" }>, opts?: { month?: string /* YYYY-MM */ }): Promise<Array<Expense & { voided: boolean }>>;
export function monthlySummary(actor: Extract<Actor, { kind: "user" }>, opts?: { months?: number }): Promise<Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>>; // lee la vista monthly_summary, más reciente primero, por defecto 12 meses
```
**Tests de servicio** (`tests/db/expenses-service.test.ts`): los criterios 2 a 5.

**Interfaz**: `src/app/(app)/gastos/` (formulario de gasto, lista por mes, "Anular" con motivo) y `src/app/(app)/resumen/` (tabla de los últimos 12 meses con ingresos, gastos y neto en `formatPEN`; neto negativo en el color `danger` **y** con el signo, nunca solo por color). Ambas páginas llaman `requireRole(ctx, "admin")` y, si no, muestran "Solo la administración puede ver esta sección".

**Done when**
- [ ] WHEN `pnpm test:db tests/db/expenses.test.ts` runs THE SYSTEM SHALL pass all 3 tests: admin-only access, the monthly net using Lima calendar months with voided rows excluded, and immutability.
- [ ] WHEN an admin calls `recordExpense` with a valid category, amount and date THE SYSTEM SHALL insert one expense and `listExpenses` SHALL return it.
- [ ] WHEN a dentist or assistant calls `recordExpense`, `voidExpense`, `listExpenses` or `monthlySummary` THE SYSTEM SHALL throw `ForbiddenError`.
- [ ] WHEN `voidExpense` runs THE SYSTEM SHALL insert an `expense_voids` row, the expense SHALL disappear from `monthlySummary` totals, and the expense row SHALL remain.
- [ ] WHEN `monthlySummary` runs over a month with income and expenses THE SYSTEM SHALL return `incomeCents`, `expenseCents` and `netCents = income - expense` for that month.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/expenses.test.ts
pnpm test:db tests/db/expenses-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 15: expenses"
git tag step-15-expenses
git rev-parse --verify step-15-expenses   # expect: a commit id, exit 0
```

---

#### Step 16 — Agente de WhatsApp: herramientas, bucle y salvaguardas

**Do**
El agente atiende por WhatsApp: identifica al paciente, ofrece horarios, **propone** una cita, la agenda cuando el paciente confirma, cancela, informa saldo y deriva a una persona. Es un bucle de modelo con herramientas, **con salvaguardas en el servidor, no en el prompt**:
1. **No hay herramienta que lea historia clínica.** El agente nunca ve diagnósticos ni notas.
2. **El paciente lo fija el servidor.** Las herramientas no reciben `patientId` del modelo: usan `agent_conversations.patient_id` (identificado por el teléfono del chat o por `register_patient`).
3. **Agendar exige confirmación real.** `propose_appointment` guarda una propuesta (vence en 10 minutos); `book_appointment` solo acepta el id de una propuesta **creada en un turno anterior** a un mensaje posterior del paciente, no vencida y no consumida.
4. Presupuesto: máximo 8 llamadas al modelo por mensaje, 25 segundos, historial de los últimos 20 turnos; al exceder ⇒ texto fijo y derivación.

`supabase/migrations/20261020000010_agent.sql`

```sql
-- supabase/migrations/20261020000010_agent.sql
create table agent_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  phone_e164 text not null,
  patient_id uuid references patients (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'handoff', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- One open conversation per clinic and phone.
create unique index agent_conversations_open_idx on agent_conversations (clinic_id, phone_e164)
  where status in ('active', 'handoff');

create table agent_turns (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index agent_turns_conversation_idx on agent_turns (conversation_id, id);

-- A proposal is the only way the agent can book: the patient-confirmed summary is stored server-side,
-- and book_appointment accepts nothing but the proposal id.
create table appointment_proposals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table agent_conversations enable row level security;
alter table agent_turns enable row level security;
alter table appointment_proposals enable row level security;
create policy agent_conversations_select on agent_conversations for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_conversations_update on agent_conversations for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_turns_select on agent_turns for select to authenticated
  using (conversation_id in (select id from agent_conversations));
```

**`src/lib/agent/llm.ts`**:
```ts
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> /* JSON Schema */ };
export type LlmMessage = { role: "user" | "assistant"; content: LlmBlock[] };
export type LlmBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type LlmResponse = { blocks: LlmBlock[]; stopReason: "end_turn" | "tool_use" | "other"; inputTokens: number; outputTokens: number };
export interface LlmClient { complete(req: { system: string; messages: LlmMessage[]; tools: ToolDef[]; signal?: AbortSignal }): Promise<LlmResponse>; }
export function anthropicLlm(): LlmClient; // SDK @anthropic-ai/sdk (versión en §11), getEnv("anthropic"): ANTHROPIC_API_KEY, AGENT_MODEL (por defecto "claude-sonnet-5-5"); messages.create({ model, max_tokens: 1024, system, messages, tools }); mapear bloques. Invoca la skill claude-api para confirmar nombres de parámetros y el ID del modelo (§18).
```
**`src/lib/agent/prompt.ts`**: `export function systemPrompt(clinic: { name: string; timezone: string }, now: Date): string` — español peruano, tono cordial y breve; reglas: solo agenda, cancelación, saldo e información de la clínica; **nunca** dar consejo médico, diagnósticos ni precios de tratamientos no listados; antes de agendar, repetir fecha, hora, dentista y motivo y pedir confirmación explícita; si el paciente pide hablar con una persona, está molesto o la consulta es clínica, usar `handoff_to_human`; las horas se dicen en hora de la clínica; no inventar horarios: solo los de `list_open_slots`.

**Herramientas** (`src/server/agent-tools.ts`; `export const TOOL_NAMES = [...]` con **exactamente** estas 8; cada una valida su entrada con zod y devuelve JSON de texto; opera con un actor de servicio `{ kind: "service", clinicId }` y la conversación):
| Herramienta | Entrada | Efecto |
|---|---|---|
| `identify_patient` | {} | busca en la clínica un paciente con `phone_e164` = teléfono del chat; si existe fija `conversation.patient_id` y devuelve `{ found: true, firstName }`; si no, `{ found: false }` |
| `register_patient` | { docType, docNumber, firstName, lastName, acceptsReminders } | `createPatient` (paso 5) con el teléfono del chat; `whatsappOptIn = acceptsReminders`; fija el paciente de la conversación |
| `list_open_slots` | { dentistId?, fromDate, toDate, minutes } | `loadSlots` (paso 8); devuelve hasta 8 horarios como texto en hora de la clínica más sus ISO |
| `propose_appointment` | { dentistId, startsAt, minutes, reason? } | exige paciente identificado; valida que `startsAt` esté en `loadSlots`; inserta `appointment_proposals` (expira en 10 min) y devuelve `{ proposalId, summary }` |
| `book_appointment` | { proposalId } | exige propuesta de esta conversación, no vencida, no consumida, creada **antes** del último mensaje del paciente; `bookAppointment` (fuente `whatsapp`); marca `consumed_at`; `SlotTakenError` ⇒ error "ese horario ya no está disponible" |
| `cancel_appointment` | { appointmentId } | solo citas futuras del paciente de la conversación; `cancelAppointment` |
| `get_balance` | {} | `patientBalance`-equivalente con actor de servicio; devuelve solo el saldo pendiente total |
| `handoff_to_human` | { reason } | `status = 'handoff'` |

**`src/lib/agent/loop.ts`**:
```ts
export const FALLBACK_TEXT = "Un miembro de nuestro equipo le responderá en breve.";
export type AgentDeps = { llm: LlmClient; now?: () => Date };
export function runAgent(deps: AgentDeps, conversationId: string, userText: string): Promise<string | null>;
// 1) carga la conversación (withService); status 'handoff' o 'closed' => null SIN llamar al modelo.
// 2) inserta el turno del usuario en agent_turns; carga los últimos 20 turnos.
// 3) bucle de hasta 8 llamadas: llm.complete({ system, messages, tools, signal: AbortSignal.timeout(25_000) });
//    por cada bloque tool_use ejecuta la herramienta (nombre fuera de TOOL_NAMES o entrada inválida => tool_result is_error, nunca excepción);
//    termina en end_turn y devuelve el texto concatenado; guarda cada turno (role, content JSON, tokens).
// 4) si se agotan las 8 llamadas, error del modelo o timeout => status 'handoff' y devuelve FALLBACK_TEXT.
```
**Tests** (`tests/db/agent-tools.test.ts` y `tests/db/agent-loop.test.ts`, escritos por el builder): un `LlmClient` falso que sigue un guion (lista de respuestas) y registra cuántas veces fue llamado; datos con `seedClinic()`, una regla de disponibilidad del dentista (SQL) y un paciente. Cubren los 6 criterios; el de la lista blanca compara `TOOL_NAMES` con la lista exacta de la tabla.

**Done when**
- [ ] WHEN the scripted model calls `book_appointment` without a proposal created in an earlier turn THE SYSTEM SHALL return an error tool result and create no appointment.
- [ ] WHEN the scripted model calls `propose_appointment`, the patient replies in a later turn, and the model then calls `book_appointment` with the proposal id THE SYSTEM SHALL create exactly one `confirmed` appointment with source `whatsapp` and consume the proposal; a second `book_appointment` with the same id SHALL fail.
- [ ] WHEN the model calls a tool outside the allow-list, or arguments that fail their zod schema, THE SYSTEM SHALL return an error tool result and continue the loop without throwing.
- [ ] WHEN the loop would exceed 8 model calls THE SYSTEM SHALL stop, return the fixed fallback text, and set the conversation status to `handoff`.
- [ ] WHEN `handoff_to_human` is called THE SYSTEM SHALL set the conversation to `handoff` and every later `runAgent` call SHALL return null without calling the model.
- [ ] WHEN `get_balance` or `cancel_appointment` runs on a conversation whose patient is not identified THE SYSTEM SHALL return an error tool result, and the allow-list SHALL contain exactly the 8 documented tools and no tool that reads clinical entries.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/agent-tools.test.ts
pnpm test:db tests/db/agent-loop.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 16: agent-core"
git tag step-16-agent-core
git rev-parse --verify step-16-agent-core   # expect: a commit id, exit 0
```

---

#### Step 17 — WhatsApp entrante: webhook, simulador y derivación

**Do**
Entrada de mensajes de WhatsApp (API oficial en la nube de Meta) hacia el agente, más un **simulador** para probar sin Meta.

**`src/server/inbound.ts`**:
```ts
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean; // header "sha256=<hex>"; HMAC-SHA256(rawBody, appSecret); comparación en tiempo constante
export type IngestResult = { messageIds: string[]; ignored: number };
export function ingestPayload(payload: unknown): Promise<IngestResult>;
// Payload de Meta: { entry: [{ changes: [{ value: { metadata: { phone_number_id }, contacts?: [{ profile: { name } }], messages?: [{ id, from, type: "text", text: { body } }] } }] }] }.
// Por cada mensaje de tipo "text": clínica = clinics.whatsapp_phone_number_id = phone_number_id (si no existe => ignored++); teléfono = "+" + from;
// INSERT en whatsapp_messages (direction 'in', status 'received') ON CONFLICT (wa_message_id) DO NOTHING; solo los realmente insertados cuentan en messageIds. Otros tipos (audio, imagen) => ignored++ (v1 responde solo a texto).
export function processInbound(messageId: string, deps: { llm: LlmClient; sender: WhatsAppSender }): Promise<void>;
// Carga el mensaje 'received' (FOR UPDATE SKIP LOCKED para no procesar dos veces); busca o crea agent_conversations abierta (clinic_id, phone) y fija last_message_at;
// reply = runAgent({ llm }, conversation.id, body); si reply !== null: sender.sendText(phoneNumberId, { to, body: reply }) y whatsapp_messages out 'sent'; marca el entrante 'processed'.
// Un error de envío => entrante 'failed' con error (no se reintenta solo).
export function sweepUnprocessed(deps: { llm: LlmClient; sender: WhatsAppSender; now?: Date }): Promise<number>; // procesa los 'received' con más de 60 s; devuelve cuántos
```
**`src/app/api/whatsapp/webhook/route.ts`**:
- `GET`: validar el reto de suscripción de Meta (`hub.mode === "subscribe"` y `hub.verify_token === WHATSAPP_VERIFY_TOKEN` ⇒ 200 con `hub.challenge` como texto; si no ⇒ 403).
- `POST`: leer el cuerpo **crudo** (`await request.text()`); en modo `cloud` exigir `verifySignature` (si no, 401); en modo `simulator` no se exige firma. `ingestPayload(JSON.parse(raw))`; responder **200 de inmediato** y procesar con `after(() => processInbound(...))` de `next/server` (si `after` no estuviera disponible en la versión fijada, procesar en el barrido). Meta reintenta si no recibe 2xx rápido, por eso la idempotencia por `wa_message_id` es obligatoria.
**`src/app/api/whatsapp/cron/route.ts`**: `POST`/`GET` con `assertCron` (de `@/app/api/cron/auth`) que ejecuta `sweepUnprocessed({ llm: anthropicLlm(), sender: getSender() })` y responde `{ whatsapp: { processed } }`.

**Simulador** (`src/app/(app)/simulador/`, solo admin): chat de prueba donde el admin escribe como un paciente (campo "Teléfono del paciente" +  mensaje); la acción del servidor construye un payload de Meta falso con `phone_number_id` de la clínica (asignar `clinics.whatsapp_phone_number_id = "SIMULADOR-<clinicId>"` la primera vez), llama `ingestPayload` y `processInbound` con `SimulatorSender` compartido, y muestra la conversación (`whatsapp_messages` de ese teléfono) con las respuestas del agente. Es la forma de demostrar el agente al cliente sin número verificado.

**Tests** (`tests/db/inbound.test.ts`, escrito por el builder): los 6 criterios con un `LlmClient` falso y `SimulatorSender`; para el criterio 2 firma el cuerpo en el test con `createHmac("sha256", secret)`.

**Done when**
- [ ] WHEN `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=abc` is called with the configured token THE SYSTEM SHALL answer 200 with the body `abc`, and WHEN the token is wrong THE SYSTEM SHALL answer 403.
- [ ] WHEN `POST /api/whatsapp/webhook` carries an invalid `X-Hub-Signature-256` in cloud mode THE SYSTEM SHALL answer 401 and store no message.
- [ ] WHEN the same inbound message id is delivered twice THE SYSTEM SHALL store exactly one `whatsapp_messages` row and run the agent once.
- [ ] WHEN a payload names a `phone_number_id` that belongs to no clinic THE SYSTEM SHALL answer 200 and store nothing.
- [ ] WHEN `processInbound` runs with a scripted model THE SYSTEM SHALL send the assistant reply through the injected sender and mark the message `processed`, and WHEN the conversation is in `handoff` THE SYSTEM SHALL send nothing.
- [ ] WHEN `POST /api/whatsapp/cron` runs with the cron bearer token THE SYSTEM SHALL process every inbound message that has stayed `received` for more than 60 seconds.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/inbound.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 17: whatsapp-inbound"
git tag step-17-whatsapp-inbound
git rev-parse --verify step-17-whatsapp-inbound   # expect: a commit id, exit 0
```

---

#### Step 18 — CI, datos de demostración y entrega

**Do**
Cierre: integración continua, programador de tareas, datos de demostración y documentación de entrega.

**`scripts/seed.ts`**:
```ts
export async function seedDemo(auth: AuthAdmin, opts?: { clinicName?: string }): Promise<{ clinicId: string }>;
// Idempotente por (nombre de clínica) y por documento/correo. Crea: clínica "Clínica Demo"; 1 admin (admin@demo.test), 2 dentistas, 1 asistente
// (correos @demo.test, contraseña tomada de SEED_PASSWORD o "demo-1234567890"); 8 pacientes FICTICIOS (DNI 00000001..00000008, teléfono +5190000000x, sin opt-in);
// reglas de disponibilidad lunes–viernes 09:00–13:00 y 15:00–18:00 para los dos dentistas; 5 tratamientos (Consulta 8000, Limpieza 12000, Resina 15000, Extracción 20000, Blanqueamiento 35000 céntimos; duraciones 30/45/45/60/60).
// Usa registerClinic/addMember (paso 4) y createPatient (paso 5); si ya existen no los duplica.
```
La CLI (`if (process.argv[1] ...)`, como `scripts/migrate.ts`): con `SUPABASE_SECRET_KEY` usa `supabaseAuthAdmin`; si no, sale con el mensaje "Define SUPABASE_SECRET_KEY o usa los tests". **Solo datos ficticios** (la Ley 29733 aplica a datos reales de pacientes, §14).

**`.github/workflows/ci.yml`**: en `push` y `pull_request`; un job en `ubuntu-latest` con `services.postgres` (`image: postgres:16`, usuario/contraseña `postgres`, base `dentistas_test`, puerto 5432, health check `pg_isready`); pasos: checkout, `actions/setup-node` leyendo `.nvmrc`, instalar pnpm con la versión que declara `packageManager` en `package.json` (`npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"`), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` con `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/dentistas_test`, `pnpm build`. Las acciones de GitHub se fijan con la versión mayor vigente **verificada al crear el archivo** (§11, "verificar antes de instalar").

**`.github/workflows/cron.yml`**: `on: schedule: - cron: "*/5 * * * *"` y `workflow_dispatch`; un paso por ruta con `curl --fail-with-body -sS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/cron/tick"`, y lo mismo para `/api/google/cron` y `/api/whatsapp/cron`. (GitHub puede retrasar tareas programadas varios minutos: aceptable para recordatorios; ver §20.2.)

**`README.md`** (español): qué es, requisitos, `cp .env.example .env`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, cómo probar el agente con el simulador, cómo correr los tests, y la lista del §10 de cuentas externas.

**Tests** (`tests/db/seed.test.ts`, escrito por el builder): criterios 1 y 2 con un `AuthAdmin` falso.

Al terminar, ejecuta **el gate global de §20.1** completo y deja todo en verde antes de entregar.

**Done when**
- [ ] WHEN `seedDemo` runs with a fake `AuthAdmin` on an empty test database THE SYSTEM SHALL create 1 clinic with 1 admin, 2 dentists and 1 assistant, 8 fake patients whose DNI start with `0000`, weekday availability rules for both dentists, and 5 catalog treatments.
- [ ] WHEN `seedDemo` runs a second time on the same clinic THE SYSTEM SHALL create no duplicate rows (patient count stays 8, member count stays 4).
- [ ] WHEN `.github/workflows/ci.yml` is read THE SYSTEM SHALL contain steps running `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, and a `postgres:16` service on port 5432.
- [ ] WHEN `.github/workflows/cron.yml` is read THE SYSTEM SHALL contain a schedule of `*/5 * * * *` and calls to `/api/cron/tick`, `/api/google/cron` and `/api/whatsapp/cron` with the `CRON_SECRET` bearer token taken from repository secrets.
- [ ] WHEN the global acceptance gate of §20.1 runs on the finished tree THE SYSTEM SHALL exit 0 for every command in it.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/seed.test.ts
grep -q 'frozen-lockfile' .github/workflows/ci.yml
grep -q 'postgres:16' .github/workflows/ci.yml
grep -q '\*/5 \* \* \* \*' .github/workflows/cron.yml
grep -q '/api/whatsapp/cron' .github/workflows/cron.yml
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 18: ci-seed-handoff"
git tag step-18-ci-seed-handoff
git rev-parse --verify step-18-ci-seed-handoff   # expect: a commit id, exit 0
```


---

### Adenda: prospectos y seguimiento (pasos 19 a 21)

Agregada después de los 18 pasos originales a pedido del cliente. El diseño completo, los criterios de aceptación y los comandos de verificación están en `epics/04-prospectos.md`; `tasks.json` trae las tareas `E4-T1` a `E4-T3`.

| # | Paso | Depende de | Compuerta |
|---|---|---|---|
| 19 | Prospectos: etapas, historial y seguimientos | 5, 8, 12 | `pnpm test:db tests/db/prospects-service.test.ts` |
| 20 | Seguimiento automático y captura por el agente | 19, 17 | `pnpm test:db tests/db/followups.test.ts` |
| 21 | Prospectos: tablero, ficha y seguimientos del día | 20 | `pnpm build` con `/prospectos` en la lista de rutas |

Efecto en el resto del blueprint: el objetivo 10 de §1 ("embudo de prospectos con seguimiento") sale de los no-objetivos; la lista blanca del agente (§14, paso 16) pasa de 8 a 9 herramientas con `capture_prospect`; `.github/workflows/cron.yml` suma la llamada a `/api/prospects/cron`; y las plantillas de WhatsApp a aprobar en Meta son dos: `recordatorio_cita` y `seguimiento_prospecto`.

---

## 10. Preparación del entorno

### Prerrequisitos
| Herramienta | Versión | Comprobación |
|---|---|---|
| Node.js | 24 LTS recomendado (24.22.0 verificado en nodejs.org el 2026-10-20); 22.12+ funciona (la prueba de arranque se ejecutó en 22.22.0) | `node -v` |
| npm | el que trae Node | `npm -v` |
| pnpm | 12.14.0 | `pnpm -v` debe imprimir `12.14.0` |
| Docker (para la base de pruebas) | cualquiera reciente con `docker compose` | `docker compose version` |
| git, curl, bash | cualquiera | `git --version` |

### Cuentas por crear primero
| Servicio | Para qué | Paso que lo exige | Dónde |
|---|---|---|---|
| Supabase (proyecto, región São Paulo `sa-east-1`) | base de datos y autenticación | 4 (registro) y todo lo que corre contra el proyecto real | https://supabase.com |
| Vercel | alojar la web | despliegue (post-build) | https://vercel.com |
| GitHub | repositorio, CI y cron | 18 | https://github.com |
| Anthropic | modelo del agente | 16 (pruebas usan modelo falso; el uso real necesita clave) | https://console.anthropic.com |
| Meta for Developers + WhatsApp Business | WhatsApp real (opcional: hay simulador) | 17 (real), post-build | https://developers.facebook.com |
| Google Cloud (proyecto OAuth) | Google Calendar | 11 (real), post-build | https://console.cloud.google.com |

Ningún paso del build **necesita** una cuenta externa para pasar sus gates: todo se prueba con Postgres local, modelo falso, `fetch` falso y el simulador.

### Variables de entorno
| Variable | Propósito | De dónde sale | Requerida desde el paso | ¿Secreta? |
|---|---|---|---|---|
| `TEST_DATABASE_URL` | Postgres local de pruebas (nombre termina en `_test`) | `docker-compose.yml`: `postgres://postgres:postgres@localhost:54329/dentistas_test` | 2 | no |
| `DATABASE_URL` | Postgres de la app (URI del *transaction pooler* de Supabase) | Supabase > Project Settings > Database | 4 (ejecución real) | sí |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto | Supabase > Project Settings > API | 3 (ejecución real) | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave publicable | idem | 3 (ejecución real) | no |
| `SUPABASE_SECRET_KEY` | administración de usuarios (registro, equipo) | idem | 4 (ejecución real) | sí |
| `APP_URL` | URL pública sin barra final | tu dominio de Vercel | 11 | no |
| `CRON_SECRET` | bearer de las rutas de cron (≥ 16 caracteres) | `openssl rand -hex 24` | 10 | sí |
| `TOKEN_ENC_KEY` | clave AES-256 (32 bytes base64) para tokens de Google | `openssl rand -base64 32` | 11 | sí |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth de Google | Cloud Console > Credenciales | 11 (real) | secreto el segundo |
| `WHATSAPP_MODE` | `simulator` (por defecto) o `cloud` | — | 10 | no |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp Cloud API (solo modo `cloud`) | Meta for Developers | 17 (real) | sí |
| `ANTHROPIC_API_KEY` | clave del modelo | consola de Anthropic | 16 (real) | sí |
| `AGENT_MODEL` | identificador del modelo | por defecto `claude-sonnet-5-5` (UNVERIFIED contra la API; confirmar al construir) | 16 | no |

Los tests no necesitan ninguna variable salvo `TEST_DATABASE_URL`, que `vitest.config.ts` ya trae con su valor local. `.env.example` se versiona con todas las claves y valores vacíos; `.env` está en `.gitignore`. **Listar una variable aquí no la carga:** `next` lee `.env` para la app; los scripts (`db:migrate`, `db:seed`) lo cargan con `tsx --env-file-if-exists=.env`; Vitest recibe lo suyo por configuración (§19.6).

### Archivos que deben versionarse
| Archivo | Por qué se versiona | Excepción en el ignore |
|---|---|---|
| `.env.example` | documenta las variables | `!.env.example` después de `.env*` (ya en `.gitignore` del workspace) |
| `pnpm-lock.yaml` | instalaciones reproducibles | no coincide con ningún patrón |
| `.claude/settings.json`, `.claude/rules/*`, `.claude/skills/*` | configuración del agente | no coincide (solo se ignora `.claude/settings.local.json`) |
| `supabase/migrations/*.sql` | esquema | no coincide |
| `.nvmrc`, `pnpm-workspace.yaml`, `docker-compose.yml` | reproducibilidad | no coincide |

### Bootstrap
```bash
set -euo pipefail
# order matters: ignore file + exceptions (in workspace/) → copy → repo init → install → first commit → services
# 1. pnpm 12 via npm (Corepack fails on pnpm 12 here); skip if already correct
if [ "$(pnpm -v 2>/dev/null || true)" != "12.14.0" ]; then npm install -g pnpm@12.14.0; fi
# 2. copy workspace/ to the project root WITHOUT clobbering files the build has since changed
#    (never overwrites package.json or pnpm-lock.yaml once they exist); loop form exits 0 on every platform
( cd blueprints/dentistas/workspace && find . -type f -print0 | while IFS= read -r -d '' f; do
    if [ ! -e "../../../$f" ]; then mkdir -p "../../../$(dirname "$f")" && cp "$f" "../../../$f"; fi
  done )
# 3. repository (idempotent) and a local identity so commits and tags work unattended
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
git config user.email >/dev/null 2>&1 || git config user.email "builder@dentistas.local"
git config user.name >/dev/null 2>&1 || git config user.name "Builder"
# 4. dependencies (writes pnpm-lock.yaml on the first run; no-op afterwards)
pnpm install
# 5. first commit carries .gitignore (copied above) and the lockfile; a tag needs a commit to point at
git add -A && { git diff --cached --quiet || git commit -m "chore: scaffold"; }
git rev-parse --verify HEAD >/dev/null 2>&1 || git commit --allow-empty -m "chore: scaffold"
# 6. local env file and the disposable test database (Docker; healthcheck-gated, idempotent)
[ -f .env ] || cp .env.example .env
pnpm db:up
```
El bundle `blueprints/dentistas/` debe estar **dentro** de la raíz del proyecto (los comandos de verificación corren desde ahí). Este bloque es seguro de repetir: la copia no sobrescribe, `git init` y la configuración son condicionales, `pnpm install` y `pnpm db:up` son idempotentes y el commit solo ocurre si hay cambios.

---

## 11. Dependencias

### Runtime
| Paquete | Versión | Para qué |
|---|---|---|
| `next` | 16.4.2 | Framework full-stack (App Router, Server Actions, `proxy.ts`) |
| `react` | 19.3.1 | UI |
| `react-dom` | 19.3.1 | UI |
| `pg` | 8.23.1 | Acceso directo a Postgres con RLS |
| `@supabase/supabase-js` | 2.118.0 | Cliente de Supabase Auth (administración de usuarios) |
| `@supabase/ssr` | 0.12.7 | Sesión de Supabase Auth con cookies en Next.js |
| `zod` | 4.6.7 | Validación de entradas (formularios, rutas, herramientas del agente) |
| `luxon` | 3.7.2 | Zonas horarias (IANA) para la agenda |
| `@anthropic-ai/sdk` | 0.135.0 | Modelo del agente de WhatsApp |
| `@react-pdf/renderer` | 4.9.0 | PDF de cotizaciones |

### Desarrollo
| Paquete | Versión | Para qué |
|---|---|---|
| `typescript` | 6.0.3 | Lenguaje (línea 6.x; la 7.0.2 existe pero se deja fuera: sin API de compilador estable) |
| `tailwindcss` | 4.3.3 | Estilos |
| `@tailwindcss/postcss` | 4.3.3 | Integración de Tailwind con PostCSS |
| `@biomejs/biome` | 2.5.15 | Lint + formato |
| `vitest` | 5.0.5 | Pruebas (proyectos `unit` y `db`) |
| `tsx` | 4.23.15 | Scripts (`migrate`, `seed`) |
| `@types/node` | 24.19.2 | Tipos de Node 24 |
| `@types/react` | 19.3.0 | Tipos |
| `@types/react-dom` | 19.3.0 | Tipos |
| `@types/pg` | 8.23.1 | Tipos |
| `@types/luxon` | 3.7.6 | Tipos |

### Deliberadamente no usadas
| Paquete / enfoque | Por qué no |
|---|---|
| ORM (Drizzle, Prisma) | El SQL explícito expone las restricciones y políticas que son el diseño |
| `googleapis` | Dependencia enorme para dos endpoints; se usa `fetch` |
| shadcn/ui, Radix | El prototipo usa componentes propios con tokens; menos descargas y menos fallos de arranque |
| Playwright / E2E | No-objetivo de v1; los gates son de servicio |
| react-hook-form, TanStack Query | Formularios con Server Actions; el estado vive en el servidor |
| Clerk, NextAuth | Un solo proveedor de identidad (Supabase Auth) |
| `server-only` | Rompe Vitest sin alias; la frontera se impone con las reglas de `CLAUDE.md` |

### Procedencia de versiones
Verificadas contra el registro de npm el 2026-10-20 con `npm view <paquete> version` (la columna de URL es el documento del registro de esa versión exacta). Los pares peer relevantes se leyeron en el registro: `next@16.4.2` exige Node `>=20.9.0` y React `^19`; `vitest@5.0.5` exige Node `^22.12.0 || ^24.0.0 || >=26.0.0`; `@supabase/supabase-js@2.118.0` exige Node `>=22.0.0`; `@anthropic-ai/sdk@0.135.0` acepta `zod ^3.25 || ^4`; `@react-pdf/renderer@4.9.0` acepta React 16.8 a 19.

| Paquete | Versión | Fuente | Fecha | Estado |
|---|---|---|---|---|
| `next` | 16.4.2 | https://registry.npmjs.org/next/16.4.2 | 2026-10-20 | VERIFIED |
| `react` | 19.3.1 | https://registry.npmjs.org/react/19.3.1 | 2026-10-20 | VERIFIED |
| `react-dom` | 19.3.1 | https://registry.npmjs.org/react-dom/19.3.1 | 2026-10-20 | VERIFIED |
| `pg` | 8.23.1 | https://registry.npmjs.org/pg/8.23.1 | 2026-10-20 | VERIFIED |
| `@supabase/supabase-js` | 2.118.0 | https://registry.npmjs.org/@supabase/supabase-js/2.118.0 | 2026-10-20 | VERIFIED |
| `@supabase/ssr` | 0.12.7 | https://registry.npmjs.org/@supabase/ssr/0.12.7 | 2026-10-20 | VERIFIED |
| `zod` | 4.6.7 | https://registry.npmjs.org/zod/4.6.7 | 2026-10-20 | VERIFIED |
| `luxon` | 3.7.2 | https://registry.npmjs.org/luxon/3.7.2 | 2026-10-20 | VERIFIED |
| `@anthropic-ai/sdk` | 0.135.0 | https://registry.npmjs.org/@anthropic-ai/sdk/0.135.0 | 2026-10-20 | VERIFIED |
| `@react-pdf/renderer` | 4.9.0 | https://registry.npmjs.org/@react-pdf/renderer/4.9.0 | 2026-10-20 | VERIFIED |
| `typescript` | 6.0.3 | https://registry.npmjs.org/typescript/6.0.3 | 2026-10-20 | VERIFIED |
| `tailwindcss` | 4.3.3 | https://registry.npmjs.org/tailwindcss/4.3.3 | 2026-10-20 | VERIFIED |
| `@tailwindcss/postcss` | 4.3.3 | https://registry.npmjs.org/@tailwindcss/postcss/4.3.3 | 2026-10-20 | VERIFIED |
| `@biomejs/biome` | 2.5.15 | https://registry.npmjs.org/@biomejs/biome/2.5.15 | 2026-10-20 | VERIFIED |
| `vitest` | 5.0.5 | https://registry.npmjs.org/vitest/5.0.5 | 2026-10-20 | VERIFIED |
| `tsx` | 4.23.15 | https://registry.npmjs.org/tsx/4.23.15 | 2026-10-20 | VERIFIED |
| `@types/node` | 24.19.2 | https://registry.npmjs.org/@types/node/24.19.2 | 2026-10-20 | VERIFIED |
| `@types/react` | 19.3.0 | https://registry.npmjs.org/@types/react/19.3.0 | 2026-10-20 | VERIFIED |
| `@types/react-dom` | 19.3.0 | https://registry.npmjs.org/@types/react-dom/19.3.0 | 2026-10-20 | VERIFIED |
| `@types/pg` | 8.23.1 | https://registry.npmjs.org/@types/pg/8.23.1 | 2026-10-20 | VERIFIED |
| `@types/luxon` | 3.7.6 | https://registry.npmjs.org/@types/luxon/3.7.6 | 2026-10-20 | VERIFIED |
| Node.js 24 LTS | 24.22.0 | https://nodejs.org/dist/index.json | 2026-10-20 | VERIFIED |
| pnpm | 12.14.0 | https://registry.npmjs.org/pnpm/12.14.0 | 2026-10-20 | VERIFIED |
| PostgreSQL (pruebas) | 16.x, imagen `postgres:16` | https://hub.docker.com/_/postgres | — | verify before install (etiqueta mayor sin digest; la prueba local usó 16.15) |
| Graph API de WhatsApp | `v23.0` | ejemplo de la documentación de Meta (búsqueda web) | 2026-10-20 | UNVERIFIED — confirmar la versión vigente |
| Alcances de Google Calendar | `calendar.events`, `calendar.freebusy` | conocimiento previo | — | UNVERIFIED — confirmar en la documentación de Google |
| Identificador del modelo | `claude-sonnet-5-5` | contexto de esta sesión de diseño | 2026-10-20 | UNVERIFIED contra la API — invocar la skill `claude-api` al construir |
| Acciones de GitHub (`checkout`, `setup-node`) | versión mayor vigente | — | — | verify before install |

---

## 12. Estrategia de despliegue

### Alojamiento
- **Web:** Vercel (proyecto conectado al repositorio de GitHub). Runtime de Node, no Edge.
- **Base de datos y autenticación:** Supabase, región São Paulo (`sa-east-1`) por latencia. La app usa el *transaction pooler* para `DATABASE_URL`.
- **Tareas programadas:** GitHub Actions (`.github/workflows/cron.yml`, cada 5 minutos) llamando a `/api/cron/tick`, `/api/google/cron` y `/api/whatsapp/cron`.

### Entornos
| Entorno | Base de datos | Notas |
|---|---|---|
| Local | Postgres 16 en Docker para pruebas; un proyecto Supabase de desarrollo para ejecutar la app | WhatsApp en modo `simulator` |
| Vista previa (Vercel) | el mismo proyecto de desarrollo | variables de entorno de vista previa |
| Producción | proyecto Supabase de producción | **solo con datos reales después de resolver el checklist de §20.1** |

### CI/CD
`ci.yml` en cada push y PR: instalación con lockfile, `typecheck`, `lint`, `test` (con servicio `postgres:16`), `build`. El despliegue es el de Vercel por integración con Git. **Las migraciones no se aplican solas**: se corre `pnpm db:migrate` contra el entorno destino antes de promover un despliegue que las necesite.

### Publicación y reversión
Migraciones solo hacia adelante y compatibles con la versión anterior del código (agregar, no renombrar ni quitar). Reversión de código: "Instant Rollback" de Vercel al despliegue anterior. Una migración mala se corrige con otra migración.

### Dominio, DNS, TLS
Dominio propio apuntando a Vercel (TLS automático). `APP_URL` y la URI de redirección de OAuth de Google deben coincidir con él.

---

## 13. Estrategia de pruebas

- **Proyectos de Vitest:** `unit` (`tests/unit`, sin base de datos) y `db` (`tests/db`, Postgres 16 real). La preparación global del proyecto `db` **borra y recrea el esquema `public`** de la base `*_test`, instala un stub de `auth.users`/`auth.uid()` y aplica las migraciones; cada prueba crea su propia clínica con `seedClinic()` y no depende de filas ajenas.
- **Se prueba más a fondo lo más riesgoso:** la función de disponibilidad (cuatro zonas, cambios de horario), el anti doble reserva (50 solicitudes concurrentes, 1 éxito), RLS por rol y por clínica, tablas de solo agregar, saldos y resúmenes, y las salvaguardas del agente (guion de un modelo falso).
- **Los servicios externos se sustituyen:** `fetch` falso (Google, Meta), `LlmClient` falso (Anthropic), `SimulatorSender` (WhatsApp), `AuthAdmin` falso (Supabase).

### Flujos críticos a cubrir de extremo a extremo
No hay E2E automatizado en v1 (§1). Cubierto por servicio: registrar clínica, crear paciente, escribir y corregir historia, reservar y reprogramar sin choques, recordatorio enviado, cotizar → aceptar → cobrar → saldo, gasto y resumen, y un diálogo completo del agente. El recorrido de punta a punta con el navegador está en el checklist manual de §20.1.

### Datos de prueba
Fábricas en `tests/db/helpers.ts` (`seedClinic`, `createPatientRow`, `addMember`, `asUser`) y la semilla de §4. Todo dato es ficticio.

### Qué deliberadamente no se prueba
Pixeles y estilos, la integración real con Meta, Google y Anthropic (gate manual con cuentas reales, §20.1) y el rendimiento bajo carga.

---

## 14. Seguridad y secretos

| Tema | Decisión |
|---|---|
| Datos de salud | Son **datos personales sensibles** (Ley N° 29733 de Protección de Datos Personales y su reglamento). El prototipo se prueba **solo con datos ficticios**. Antes de usar datos reales: consentimiento informado del paciente, política de privacidad, inscripción del banco de datos y aviso de transferencia transfronteriza (Supabase en Brasil, Vercel y Anthropic fuera del país). Verificar con un abogado peruano (§20.1). |
| Aislamiento | RLS en toda tabla de negocio; los servicios filtran por `clinic_id`; tests por rol y por clínica |
| Mínimo privilegio | `authenticated` sin `DELETE`/`TRUNCATE`; `anon` sin acceso; los asistentes no leen historias, cotizaciones ni finanzas |
| Inmutabilidad | Historia, odontograma, accesos, cobros y gastos: solo agregar (trigger) |
| Trazabilidad | `record_access_log` registra cada apertura de una historia |
| Secretos | Solo en variables de entorno (Vercel / GitHub Secrets); `.env` ignorado por git; `permissions.deny` en `.claude/settings.json` desalienta su lectura (no la impide: aislamiento real = sandbox) |
| Tokens de Google | Cifrados con AES-256-GCM (`TOKEN_ENC_KEY`); sin permiso de `SELECT` sobre esa columna para `authenticated` |
| Webhook de WhatsApp | Firma HMAC-SHA256 en comparación de tiempo constante; verificación por token; idempotencia por id de mensaje |
| Rutas de cron | Bearer con comparación de tiempo constante; sin token ⇒ 401 |
| Agente | Sin herramienta de historia clínica; el paciente lo fija el servidor, nunca el modelo; agendar exige propuesta previa; presupuesto de pasos y tiempo; derivación a humano |
| CSRF | Server Actions de Next.js comprueban origen; las rutas con efectos usan bearer o firma |
| Registros (logs) | Nunca nombres, documentos, teléfonos ni contenido clínico; solo ids |
| Copias de seguridad | Las del plan de Supabase; verificar antes de producción (§20.1) |
| Retención de historias | La NTS 139 fija plazos de conservación: **verificar el plazo y el procedimiento de archivo** contra la norma antes de producción (§20.2) |

---

## 15. Accesibilidad

### Requisitos base
Objetivo WCAG 2.2 nivel AA en el flujo principal. Etiquetas `<label>` en todos los campos, `autocomplete` correcto, errores en `role="alert"` y asociados al campo, contraste ≥ 4.5:1 (§7), objetivos táctiles ≥ 44 px, foco visible, orden de tabulación lógico, `lang="es-PE"`, nunca solo color para comunicar estado, tablas con encabezados reales, odontograma operable con teclado (cada pieza es un `<button>` con `aria-label`).

### Adiciones de WCAG 2.2 que suelen olvidarse
Objetivo mínimo de 24 px incluso en tablas densas (se usa 44), `autocomplete` en los campos de identidad, ayuda consistente (el enlace "Soporte" aparece en la misma posición), autenticación sin pruebas cognitivas (correo y contraseña con gestor de contraseñas permitido).

### Verificación
`pnpm lint` activa las reglas de accesibilidad de Biome (`a11y`) sobre el JSX y debe dar cero errores y cero advertencias; el paso por teclado y una pasada con lector de pantalla del flujo principal están en el checklist manual de §20.1. No hay herramienta de auditoría en el navegador dentro del build.

---

## 16. Observabilidad y costos

### Instrumentación
Registros estructurados en JSON a `stdout` (los recoge Vercel): evento, ids (clínica, cita, mensaje), duración. **Sin datos personales.** En el agente se registra el número de llamadas al modelo y los tokens por turno (también en `agent_turns`).

### Métricas que importan
Citas creadas por origen (web / whatsapp), recordatorios enviados / fallidos / omitidos, mensajes entrantes sin procesar (> 60 s), tasa de derivación a humano del agente, tokens por conversación, errores 5xx de las rutas de integración.

### Health check
`GET /api/health` → `{"status":"ok"}` (paso 1). No consulta la base de datos a propósito: sirve para saber que el proceso responde.

### Modelo de costos
Prototipo: planes gratuitos o de entrada de Vercel y Supabase. El costo variable real es **por mensaje de WhatsApp** (conversaciones de Meta, categoría y país) y **por tokens del modelo**; ambos se miden desde el primer día con la bitácora (`whatsapp_messages`, `agent_turns`) y se extrapolan con las tarifas vigentes de cada proveedor en el momento de producción (no se fijan cifras aquí: cambian).

---

## 17. Enrutamiento de modelos

El producto usa **un solo modelo** (el del agente de WhatsApp); no hay enrutamiento entre modelos.

### Tabla de enrutamiento
| Tarea | Modelo | Por qué |
|---|---|---|
| Conversación del agente con herramientas | `AGENT_MODEL` (por defecto `claude-sonnet-5-5`) | equilibrio entre seguir instrucciones con herramientas y costo; cambiable por variable de entorno sin tocar código |

### Estrategia de prompt y contexto
Un prompt de sistema en español (`src/lib/agent/prompt.ts`) con la hora actual de la clínica; historial de los últimos 20 turnos; herramientas con esquemas JSON estrictos. El modelo recibe **solo** datos de agenda y saldo, nunca historia clínica.

### Controles de costo
Máximo 8 llamadas al modelo por mensaje, `max_tokens` 1024, tiempo máximo de 25 s, un solo mensaje entrante procesado a la vez por conversación, y una conversación en `handoff` no vuelve a llamar al modelo.

### Manejo de fallos
Error del modelo, tiempo agotado o presupuesto excedido ⇒ conversación a `handoff` y mensaje fijo "Un miembro de nuestro equipo le responderá en breve.". Un envío fallido marca el mensaje `failed` para revisión; no se reintenta solo.

### Evaluación
Pruebas con un modelo guionizado en `tests/db/agent-*.test.ts` (salvaguardas, no calidad de redacción). Antes de producción, una lista de 20 conversaciones reales anonimizadas revisadas a mano (§20.1).

---

## 18. Skills a usar durante la construcción

| Skill | Cuándo | Para qué |
|---|---|---|
| `claude-api` | paso 16 | confirmar parámetros del SDK de Anthropic, formato de herramientas y el identificador de modelo vigente (el de este blueprint es UNVERIFIED) |
| `ui-ux-pro-max` | pasos 3 a 17, al construir pantallas | refinar componentes dentro de los tokens de §7 (no cambiar la paleta) |
| `add-migration`, `run-db-tests` | cada paso con base de datos | proyecto: `.claude/skills/` (§19.4) |

Si una skill no está instalada, usar este blueprint y la documentación oficial del paquete; los fallos de herramienta no bloquean el build. La documentación de Next.js 16 viene en `node_modules/next/dist/docs/`.

---

## 19. Espacio de trabajo del agente

En modo bundle estos archivos son **reales** bajo `workspace/` y reflejan la estructura del proyecto. El primer comando del Bootstrap (§10) copia **un solo directorio**: `workspace/` → raíz del proyecto, sin sobrescribir lo que el build ya cambió. **No se sobrescriben nunca** `package.json` ni `pnpm-lock.yaml` una vez que existen.

```
workspace/
├── CLAUDE.md · AGENTS.md
├── .claude/{settings.json, rules/{database.md,ui-es.md}, skills/{add-migration,run-db-tests}/SKILL.md}
├── package.json · pnpm-workspace.yaml · .nvmrc · .gitignore · .env.example
├── tsconfig.json · next.config.ts · postcss.config.mjs · biome.json · vitest.config.ts · docker-compose.yml
├── scripts/{migrate.ts, serve-check.sh}
└── tests/db/{global-setup.ts, helpers.ts}
```

No existe `.claude/commands/` (un comando solo se dispara si un humano lo escribe; el builder no escribe nada).

### 19.1 `CLAUDE.md`
Archivo real: `workspace/CLAUDE.md` (menos de 200 líneas): comandos primero, arquitectura con la ruta de una solicitud, fronteras entre capas, reglas de código verificables, trampas conocidas (Next.js 16, pnpm 12, pruebas de base de datos) y el proceso de pasos con puntos de control.

### 19.2 `AGENTS.md`
Archivo real: `workspace/AGENTS.md`: puente de 25 líneas para herramientas que no leen `CLAUDE.md`; remite a este como fuente de verdad.

### 19.3 `.claude/settings.json`
Archivo real: `workspace/.claude/settings.json`. Permite exactamente los comandos de verificación de §9 (cada subcomando por separado) y deniega leer `.env` y `git push`:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install:*)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm lint)",
      "Bash(pnpm format)",
      "Bash(pnpm test:*)",
      "Bash(pnpm build)",
      "Bash(pnpm dev:*)",
      "Bash(pnpm db:up)",
      "Bash(pnpm db:down)",
      "Bash(pnpm db:migrate)",
      "Bash(pnpm db:seed)",
      "Bash(bash scripts/serve-check.sh)",
      "Bash(DATABASE_URL=postgres://postgres:postgres@localhost:54329/dentistas_test pnpm db:migrate)",
      "Bash(docker compose:*)",
      "Bash(test:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git tag:*)",
      "Bash(git rev-parse:*)",
      "Bash(git check-ignore:*)",
      "Bash(git ls-files:*)",
      "Bash(git reset --hard step-:*)"
    ],
    "deny": ["Read(./.env)", "Read(./.env.*)", "Bash(git push:*)"]
  }
}
```

### 19.4 Skills del proyecto
| Skill | Se activa con | Qué automatiza |
|---|---|---|
| `add-migration` | "agregar una tabla / migración" | crear una migración nueva con RLS, trigger de solo agregar y su prueba |
| `run-db-tests` | "falla un test de base de datos" | levantar Postgres y correr o depurar `tests/db` |

### 19.5 Reglas por ruta (`.claude/rules/`)
| Archivo | `paths` | Cubre |
|---|---|---|
| `database.md` | `supabase/migrations/**`, `src/lib/db.ts`, `src/server/**`, `tests/db/**` | migraciones, RLS, errores con nombre, fechas |
| `ui-es.md` | `src/app/**/*.tsx`, `src/app/globals.css` | español, tokens, accesibilidad, Server Actions |

### 19.6 Configuración crítica para la verificación e infraestructura local
Todos son archivos reales bajo `workspace/` en la ruta que ocupan en el proyecto, con su contenido completo y ya formateados por `biome`:

| Archivo | Lo necesitan los gates de | Contenido clave |
|---|---|---|
| `package.json` | todos | scripts `typecheck`, `lint`, `test`, `test:unit`, `test:db`, `db:*`, `build`; versiones exactas de §2 |
| `pnpm-workspace.yaml` | instalación | `allowBuilds` (pnpm 12 exige decidir los scripts de instalación: `esbuild: true`) |
| `tsconfig.json` | typecheck, build, tsx | estricto; alias `@/*`; excluye `blueprints`; incluye `.next/dev/types` tal como lo reescribe Next |
| `biome.json` | lint | `css.parser.tailwindDirectives`; excluye `blueprints` para que los configs del bundle no cuenten como una segunda raíz |
| `vitest.config.ts` | todas las pruebas | proyectos `unit` y `db`, alias `@`, `TEST_DATABASE_URL` por defecto (fijado también en el proceso principal porque la preparación global corre antes del `env` del proyecto) |
| `docker-compose.yml` | pruebas de base de datos | `postgres:16` en 54329, `dentistas_test`, `tmpfs`, healthcheck con `pg_isready` |
| `tests/db/global-setup.ts`, `tests/db/helpers.ts` | pruebas `db` | recreación del esquema, stub de `auth`, fábricas (`seedClinic`…) |
| `scripts/migrate.ts` | `db:migrate`, pruebas `db` | aplica migraciones en orden, idempotente |
| `scripts/serve-check.sh` | paso 1 | arranca `next start`, comprueba `/api/health`, lo detiene |
| `.env.example`, `.gitignore`, `.nvmrc`, `next.config.ts`, `postcss.config.mjs` | build y arranque | ver §10 |

#### Contextos de resolución de módulos
Convención: importaciones relativas sin extensión y el alias `@/` para `src/`. Se comprobó en cada contexto con el comando que lo ejerce:
| Contexto | Resuelto por | Comando que lo comprueba |
|---|---|---|
| Código de la app | Next (bundler) + `paths` | `pnpm build` |
| Tests | Vitest (`resolve.alias`) | `pnpm test:unit`, `pnpm test:db` |
| Scripts independientes | `tsx` (lee `paths` de `tsconfig.json`) | `pnpm db:migrate` |
| Tipos | `tsc` (`moduleResolution: bundler`) | `pnpm typecheck` |

#### Cada herramienta que lee variables tiene su forma de cargarlas
`next` lee `.env`; `tsx --env-file-if-exists=.env` en `db:migrate` y `db:seed`; Vitest recibe `TEST_DATABASE_URL`/`DATABASE_URL` por `vitest.config.ts`; `scripts/serve-check.sh` no necesita variables (`/api/health` no las usa).

#### Reconciliación byte a byte de artefactos
NOT APPLICABLE — ningún gate compara salida real con un archivo de referencia (golden/snapshot).

#### Reconciliación de valores entre artefactos
| Valor | Dónde aparece | Comparado |
|---|---|---|
| URL de la base de pruebas `postgres://postgres:postgres@localhost:54329/dentistas_test` | `vitest.config.ts`, `docker-compose.yml`, `.env.example` | Compared: yes |
| Puerto 54329 y nombre `dentistas_test` | `docker-compose.yml`, `vitest.config.ts`, `CLAUDE.md`, `.claude/skills/run-db-tests` | Compared: yes |
| pnpm 12.14.0 | `package.json` (`packageManager`), §10, paso 18 (`ci.yml`), `CLAUDE.md` | Compared: yes |
| Zona `America/Lima` | migración foundation (default), `monthly_summary` (expenses), pasos 8, 9, 12 | Compared: yes |
| Paleta de §7 | `src/app/globals.css` (paso 1) | Compared: yes |

#### El bundle forma parte de la superficie de las herramientas
`blueprints/` vive dentro del proyecto. `biome.json` lo excluye (`!**/blueprints`), `tsconfig.json` lo excluye (`exclude`), Vitest solo recoge `tests/**` y Next solo compila `src/**`. Se ejecutó `pnpm lint`, `pnpm typecheck` y `pnpm build` con el bundle presente.

---

## 20. Gate de aceptación, riesgos y registro de decisiones

### 20.1 Gate de aceptación global
El proyecto está **terminado** cuando todos estos comandos salen con código 0 en una copia limpia (los mismos que corre `ci.yml`):

```bash
pnpm install --frozen-lockfile   # expect: exit 0, lockfile unchanged
pnpm db:up                       # expect: exit 0, test database healthy
pnpm typecheck                   # expect: exit 0, zero errors
pnpm lint                        # expect: exit 0, zero errors and zero warnings
pnpm test                        # expect: exit 0, 0 failed, 0 skipped (projects unit + db)
pnpm build                       # expect: exit 0
bash scripts/serve-check.sh      # expect: exit 0 — the built server answers {"status":"ok"} on /api/health
```
No hay `test:e2e` (no-objetivo de v1, §1). La accesibilidad de código la cubre `pnpm lint` (reglas `a11y` de Biome, cero advertencias). **Nada se ignora**: una advertencia tolerada se vuelve permanente.

Y estos gates manuales — la lista de lanzamiento — se revisan una vez antes de usar datos reales:
- [ ] Cada paso de §9 tiene su etiqueta en git (`git tag -l 'step-*'` lista una por paso).
- [ ] Cada archivo de la tabla "Archivos que deben versionarse" (§10) está en una copia limpia (`git ls-files --error-unmatch <ruta>` sale 0, **una ruta por invocación**) y ningún patrón de `.gitignore` lo traga (`status=0; git check-ignore -q .env.example || status=$?; test "$status" -eq 1`).
- [ ] El Bootstrap de §10 se volvió a ejecutar sobre un árbol ya inicializado, salió 0 y `package.json` conserva todas sus dependencias.
- [ ] Cada fila de §19.6 "Reconciliación de valores" sigue en `Compared: yes`.
- [ ] Cada no-objetivo de §1 sigue sin construirse.
- [ ] Cada variable de §10 está definida en Vercel y GitHub Secrets y **ausente del repositorio**.
- [ ] **Datos de salud:** inscripción del banco de datos personales, política de privacidad, consentimiento del paciente y plazo de conservación de historias, revisados con un abogado peruano (Ley 29733 y NTS 139).
- [ ] **Norma MINSA:** comparar los campos de filiación y de cada tipo de entrada (paso 5 y 6) con el anexo oficial de la NTS 139-MINSA/2018/DGAIN (RM 214-2018/MINSA) y ajustar.
- [ ] **WhatsApp real:** número verificado, plantilla `recordatorio_cita` aprobada por Meta, versión vigente de la Graph API confirmada, webhook registrado y probado con un mensaje real.
- [ ] **Google real:** proyecto OAuth con los alcances de §11 confirmados; si sigue en modo de pruebas, los usuarios de prueba agregados y avisados de que la autorización puede caducar (verificar el plazo en la documentación de Google).
- [ ] **Supabase real:** con dos usuarios de clínicas distintas, el usuario B no ve pacientes de A; `select has_table_privilege('authenticated','patients','DELETE')` es falso; "Confirm email" desactivado en el proyecto de desarrollo (el registro crea usuarios ya confirmados).
- [ ] **Agente:** revisión manual de 20 conversaciones de prueba en el simulador y con el número real; ninguna promete lo que no puede cumplir.
- [ ] **Recorrido manual con navegador:** registrar clínica → paciente → historia → agendar → cotizar → aceptar → cobrar → gasto → resumen, con teclado solamente y una pasada con lector de pantalla.
- [ ] Un error provocado a propósito llega al registro de Vercel (§16).
- [ ] Una reversión ("Instant Rollback") ejecutada una vez en vista previa (§12).

### 20.2 Registro de riesgos
| Riesgo | Prob. | Impacto | Señal temprana | Mitigación |
|---|---|---|---|---|
| **Datos de salud sin cumplir la Ley 29733** en producción | M | A | el cliente quiere cargar pacientes reales | prototipo solo con datos ficticios; consentimiento, registro y política antes de producción (§14, §20.1); RLS, roles y bitácora de accesos desde el paso 2 |
| **Campos de la historia clínica no coinciden con la NTS 139** (no se pudo leer el texto de la norma al diseñar) | M | A | el cliente o un auditor señala campos faltantes | cuerpos `jsonb` por tipo en el paso 6 y columnas de filiación anulables: se ajusta sin migraciones destructivas; verificación contra el anexo oficial en el checklist |
| **El agente agenda mal o promete de más** | M | M | conversaciones derivadas, citas canceladas por el paciente | salvaguardas en el servidor (propuesta previa, paciente fijado por el servidor, lista blanca de 8 herramientas), derivación a humano, pruebas con modelo falso; riesgo aceptado: la redacción del modelo puede ser torpe |
| **Meta tarda en aprobar el número o la plantilla** | A | M | plantilla "pendiente" o "rechazada" | el simulador permite demostrar todo; plantilla de categoría *utility* con texto sobrio; pedir la aprobación al empezar |
| **Alcance excesivo para un prototipo** | A | M | el paso 9 no termina en la primera semana | tandas con puntos de corte (§1); recortar primero 11, 13 y 18 |
| **Google en modo de pruebas caduca la autorización** (a verificar) | M | B | un dentista deja de sincronizar | el estado `revoked` se muestra en `/configuracion/google`; publicar la app antes de uso real |
| **Cron de GitHub Actions se retrasa** | M | B | recordatorios llegan con minutos de retraso | cada 5 min; migrar a Vercel Cron o `pg_cron` si se necesita precisión (decisión 12) |
| **Diferencias entre Postgres plano (pruebas) y Supabase real** | B | A | una política se comporta distinto en Supabase | stub de `auth.uid()` equivalente al real; checklist manual con dos usuarios en el proyecto real (§20.1) |
| **Dependencia de proveedores externos** (Meta, Google, Anthropic, Supabase) | M | M | cambios de API o precios | cada integración detrás de una interfaz inyectable (`WhatsAppSender`, `LlmClient`, `fetchImpl`, `AuthAdmin`) |

### 20.3 Registro de decisiones
| # | Decisión | Alternativa rechazada | Por qué | Se revierte si |
|---|---|---|---|---|
| 1 | Pista TypeScript/Node con Next.js 16 | Python (FastAPI) | un lenguaje de punta a punta; el usuario pidió TypeScript | el equipo no domina TypeScript |
| 2 | PostgreSQL en Supabase | Neon + otro proveedor de auth | RLS, auth y base en un servicio | los costos o la latencia a Perú lo vuelvan inviable |
| 3 | Supabase Auth | Clerk | un servicio menos y sin webhook de sincronización | se necesiten organizaciones e invitaciones complejas |
| 4 | Acceso con `pg` bajo RLS (`withTenant`) | supabase-js/PostgREST | los tests corren sobre Postgres plano y las mismas políticas aplican | se quiera exponer una API pública con PostgREST |
| 5 | SQL explícito, sin ORM | Drizzle | expone la restricción de exclusión y las políticas | el esquema crezca a docenas de tablas con muchas relaciones |
| 6 | Anti doble reserva con restricción de exclusión | bloqueo en la aplicación | una sola regla autoritativa bajo concurrencia | se necesiten capacidades > 1 (clases grupales) |
| 7 | Calcular slots, no guardarlos | tabla de slots | los cambios de reglas y de horario no la corrompen | el volumen haga lenta la consulta |
| 8 | Dinero en céntimos enteros de PEN | decimales | sin errores de redondeo | se agregue otra moneda |
| 9 | Solo agregar + anulaciones, sin borrado | borrado lógico (`deleted_at`) | la norma de historia clínica prohíbe enmendaduras; auditoría simple | un requisito legal exija eliminar datos a pedido (derechos ARCO) |
| 10 | Agente con herramientas y propuesta previa | bot de reglas / árbol de menús | conversación natural con salvaguardas verificables | el costo por mensaje sea inaceptable |
| 11 | API oficial de WhatsApp directa + simulador | un proveedor intermedio (Twilio, 360dialog) | menos intermediarios y costo; el simulador evita bloquear el prototipo | la aprobación de Meta resulte inmanejable |
| 12 | Cron con GitHub Actions cada 5 min | Vercel Cron / `pg_cron` | gratis y sin plan de pago | se necesite precisión al minuto |
| 13 | Sincronización de Google desacoplada (en cron) | publicar dentro de la reserva | un fallo de Google nunca impide agendar | los usuarios exijan ver la cita en Google al instante |
| 14 | Un usuario pertenece a una sola clínica | membresías múltiples | RLS más simple | un dentista trabaje en dos clínicas |
| 15 | PDF con `@react-pdf/renderer` | Puppeteer / navegador | sin binarios ni Chromium en el servidor | el diseño del PDF exija CSS complejo |

### 20.4 Qué construir después
1. **Facturación electrónica SUNAT** (boletas/facturas) — cuando el cliente pase a producción.
2. **Portal del paciente y envío de la cotización en PDF por WhatsApp** — tras validar el agente.
3. **Radiografías y archivos adjuntos** con almacenamiento y retención — cuando el cliente lo pida.
4. **Pruebas E2E con navegador** — antes de usar datos reales.
5. **Pasarela de pago en línea** — si hay volumen de cobros a distancia.

---

*Fin del blueprint. El orden de construcción es §9. Detente cuando §20.1 esté en verde.*
