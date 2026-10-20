# Cuadre

> Plataforma de gestión de cobros para negocios que prestan dinero y cobran cuotas mediante cobradores. Cartera, cajas, cobradores y trazabilidad financiera completa, en un solo lugar.

## Estado del proyecto

🚧 **F0–F6 reportadas como terminadas; F7 en cierre/verificación; F8 pendiente.** Las áreas de Super Admin, soporte y monitoreo están implementadas; aún no se certifica el criterio de salida de F7. F8 no puede iniciarse hasta resolver los bloqueadores de `docs/planning/05-PENDIENTES.md`. Los criterios de salida se mantienen en `docs/planning/04-PLAN.md`.

| Fase | Contenido | Estado |
| --- | --- | --- |
| F0 | Fundación técnica | Terminada |
| F1 | Identidad, negocios y suscripciones | Terminada |
| F2 | Libro de caja y auditoría financiera | Terminada |
| F3 | Cartera: clientes, contratos, préstamos y cuotas | Terminada |
| F4 | Pagos, mora y refinanciación | Terminada |
| F5 | Cobradores, rutas, Caja Menor y liquidación | Terminada |
| F6 | Dashboard y operación administrativa | Terminada |
| F7 | Super Admin, soporte y monitoreo | Cierre/verificación pendiente |
| F8 | Endurecimiento, prueba real y lanzamiento | Pendiente |

### Qué funciona hoy

- **Acceso:** login, logout y cambio obligatorio de contraseña temporal.
- **Super Admin:** alta de negocio con su cuenta admin inicial, detalle del negocio y acciones de activar, suspender, archivar, cambiar plan y restablecer contraseña.
- **Negocio (admin):** Caja Mayor (saldo, registro de movimientos, reverso e historial), clientes (alta, edición auditada y búsqueda), préstamos (alta con vista previa, confirmación con desembolso y calendario de cuotas, detalle, anulación e importación de cartera previa).
- **F4:** registro de pagos con aplicación cronológica a cuotas, historial de pagos, cargos de mora manuales (crear, pagar, anular), refinanciación y reverso de pagos.
- **Cobrador:** área de operación de campo con rutas, clientes asignados, jornadas y cobros; experiencia orientada a móvil.
- **F6:** dashboards y operación administrativa para cartera, cajas y alertas.
- **F7:** áreas de Super Admin, soporte y monitoreo implementadas; criterio de salida pendiente de verificación formal.

### Estado de verificación

Última verificación registrada para la preparación de tokens e identidad visual (2026-10-16):

| Comando | Resultado |
| --- | --- |
| `npm run format:check` | Limpio |
| `npm run typecheck` | Limpio |
| `npm run lint` | Limpio |
| `npm test -- --pool=threads --maxWorkers=1` | 55 suites / 298 pruebas en verde |
| `npm run build` | Build de producción completado |
| Smoke E2E de `smoke.spec.ts` | 34 casos en desktop y móvil, sin Supabase; incluye landing/login en 360, 768 y 1280 px |

La comprobación E2E anterior cubre smoke sin sesión y no equivale a ejecutar los recorridos con sesión real. Para la suite E2E completa, incluidos `journeys`, `portfolio` y `payments`, inicia Supabase local con `npm run db:start`; CI levanta su propia instancia local.

El repositorio contiene áreas de aplicación para páginas públicas, autenticación, negocio, cobrador y Super Admin, además de endpoints API. La spec 006 automatizó los checks frontend y E2E; queda pendiente su checklist manual AA/responsive (`docs/frontend/04-MATRIZ-VERIFICACION.md`).

### Pendientes de infraestructura

No bloquean el desarrollo; son acciones fuera del repo:

- [x] CI en verde en GitHub (los 3 jobs —calidad, integración y e2e— pasan en cada push a `main`).
- [x] Proteger `main` exigiendo los checks `quality`, `integration` y `e2e` antes de mergear.
- [ ] Conectar Vercel para previews por PR.
- [ ] Crear los proyectos Supabase dev, preview y producción (y sus variables de entorno).

## Qué es

Una plataforma web multi-negocio para negocios que prestan dinero y cobran cuotas mediante cobradores. No es un simple registro de cobros diarios: centraliza la cartera de clientes, préstamos y cuotas, la operación de los cobradores en ruta, y el movimiento financiero completo del negocio (Caja Mayor, cajas de cobradores, gastos y liquidaciones).

El valor central es la **trazabilidad**: cada peso prestado, cobrado, gastado o transferido puede reconstruirse — qué pasó, quién lo hizo, cuándo, y sobre qué operación. Ningún hecho financiero se edita ni se borra.

## Stack (V1)

| Capa | Elección |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript estricto |
| Estilos | Tailwind CSS 4 |
| Base de datos / Auth | PostgreSQL vía Supabase (Auth + RLS); transacciones con `pg` |
| Pruebas | Vitest (unitarias e integración) + Playwright (e2e) |

Versiones exactas y comandos → `CLAUDE.md`. Justificación completa → `docs/planning/03-ARQUITECTURA.md`.

## Cómo levantar el proyecto

**Requisitos:** Node.js 24 (`.nvmrc`), Docker Desktop en ejecución y Git.

```bash
npm ci
cp .env.example .env.local
npm run db:start      # Postgres/Auth locales en Docker (la primera vez descarga imágenes)
npx supabase status -o env
```

Copia a `.env.local` los valores que imprime `supabase status`. Nunca se commitea (está en `.gitignore`):

| Variable | Valor local |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` (solo servidor) |
| `DATABASE_URL` | `DB_URL` |
| `AUTH_SYNTHETIC_EMAIL_DOMAIN` | un dominio propio, p. ej. `cuadre.invalid` |

El servidor **no arranca** si falta una variable o es inválida: el error nombra la variable (nunca su valor).

```bash
npm run dev           # http://localhost:3000  (y /api/health)
```

### Pruebas y calidad

| Comando | Qué hace | Requiere |
| --- | --- | --- |
| `npm test` | Unitarias (Vitest) | — |
| `npm run test:integration` | Contra Postgres real: inmutabilidad, transacciones, bloqueos | `npm run db:start` |
| `npx playwright install chromium` y luego `npm run test:e2e` | Smoke e2e en desktop y móvil; los recorridos con sesión real (`journeys`, `portfolio`, `payments`) requieren `npm run db:start` — sin él la suite falla al cargar esos specs | Chromium de Playwright |
| `npm run typecheck` · `npm run lint` · `npm run format:check` | Calidad estática | — |
| `npm run build` | Compilación de producción | — |

Base local: `npm run db:migrate` aplica migraciones nuevas y `npm run db:stop` detiene los contenedores. Las pruebas de integración solo corren contra `127.0.0.1`/`localhost`.

### CI y despliegue

- **CI** (`.github/workflows/ci.yml`): en cada PR y push a `main` corren calidad, integración y e2e.
- **Preview / producción:** Next.js en Vercel y base de datos en Supabase, con proyectos separados para dev, preview y producción. Las migraciones van local → preview → producción con respaldo verificado (`docs/planning/04-PLAN.md`, trabajo transversal).

## Estructura de este repositorio

```text
├── CLAUDE.md                    # reglas y contexto que lee cualquier IA al empezar
├── .github/workflows/ci.yml     # CI: calidad, integración, e2e
├── .gitattributes / .nvmrc      # fin de línea LF y versión de Node
├── .env.example                 # nombres de variables (sin valores)
├── .claude/
│   ├── settings.json            # permisos reales (allow/ask/deny) y hook anti-commit en main
│   ├── agents/                  # code-reviewer + 5 subagentes de dominio/migraciones/comandos/pruebas/fase
│   ├── skills/                  # checklist-de-fase, revisar-pendientes, nueva-entidad-dominio, nuevo-comando-financiero
│   ├── rules/frontend-design.md # estándares de UI
│   └── mcp-recomendados.md
├── docs/
│   ├── planning/                # 01 contexto · 02 dominio · 03 arquitectura · 04 plan · 05 pendientes
│   │                            # 06 agentes · 07 flujo de trabajo · 08 glosario
│   ├── frontend/                # diagnóstico, plan visual y flujo frontend
│   └── adr/                     # decisiones técnicas registradas
├── src/
│   ├── app/                     # rutas por área y recursos compartidos de interfaz
│   │   └── _fonts/              # fuentes locales y licencia OFL
│   ├── modules/                 # dominio: identity, subscriptions, portfolio, collections, cash, support, audit
│   ├── shared/                  # errors, types, money, dates, ids, validation, database, UI y auth
│   ├── tests/                   # unit, integration, e2e
│   └── instrumentation.ts       # valida el entorno al arrancar
└── supabase/                    # config local y migraciones versionadas
```

## Cómo trabajar en este repo

- Toda IA (incluido Claude Code) lee `CLAUDE.md` primero, siempre.
- Las reglas de negocio viven en `docs/planning/02-DOMINIO.md` — es la autoridad final; nada se implementa por inferencia o "porque parece razonable".
- El plan de fases está en `docs/planning/04-PLAN.md`. No se salta una fase sin cerrar los criterios de salida de la anterior.
- El día a día (tamaño de tareas, disciplina de Git, puerta de pruebas) está en `docs/planning/07-FLUJO-DE-TRABAJO.md`.
- Lo que todavía no está decidido está en `docs/planning/05-PENDIENTES.md` — no se rellena por inferencia.
- Una tarea por rama; nunca se commitea directo en `main` (un hook lo bloquea). Migraciones y lógica de negocio van en commits separados.

## Principio rector

> Construir un sistema sencillo de utilizar, pero suficientemente estructurado para que el dinero, las obligaciones y las decisiones del negocio nunca pierdan su trazabilidad.
