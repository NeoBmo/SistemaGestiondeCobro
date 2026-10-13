# AGENTS.md — Guía operativa para agentes

> Aplica a **cualquier** agente que trabaje en este repo (OpenCode, Claude Code u otro).
> Este archivo no sustituye a nada: da el **cómo** trabajar aquí.

## Autoridad (léela antes de decidir nada)

1. `CLAUDE.md` — autoridad del proyecto: stack pineado, allowlist de operaciones, reglas de negocio no negociables.
2. `docs/planning/02-DOMINIO.md` — **gana en negocio**. Estados, invariantes, fórmulas, permisos.
3. `docs/planning/03-ARQUITECTURA.md` — gana en técnico. Decisiones en `docs/adr/`.
4. `docs/planning/04-PLAN.md` — fases y sus criterios de salida. `05-PENDIENTES.md` — lo que **no** está decidido.

Ante conflicto: `CLAUDE.md` para política del repo, `02` para reglas de negocio, `03` para decisiones técnicas. Este archivo solo describe el estado real y las trampas del tooling.

### Orden de autoridad (skills incluidas)

De mayor a menor:

1. `CLAUDE.md`.
2. `docs/planning/02-DOMINIO.md` (negocio) y `docs/planning/03-ARQUITECTURA.md` (técnico).
3. `AGENTS.md`.
4. `docs/planning/05-PENDIENTES.md` y `docs/planning/07-FLUJO-DE-TRABAJO.md`.
5. `.claude/agents/` y `.claude/skills/`.

**La regla que lo gobierna:** una skill **nunca** introduce una regla que no esté en los niveles 1-4. Si una skill la contradice, **manda el documento** y lo que se corrige es la skill, no al revés. `docs/planning/06-AGENTES-HABILIDADES.md:36` ya dice esto para los subagentes ("si un subagente y `CLAUDE.md` entran en conflicto, gana `CLAUDE.md`"); aquí se extiende a las skills, que son material de terceros y pueden cambiar de versión sin avisar.

### Reparto por skill (sin solapes)

| Skill | Cuándo | Alcance y límite |
| --- | --- | --- |
| `grilling` (lanzador: `grill-me`) | **Antes** de escribir, para afinar un plan o una decisión | Solo por invocación humana (`disable-model-invocation: true`). Debe terminar en la **decisión escrita** en `02`/`03`, y si venía de `05-PENDIENTES.md`, borrada de ahí en el mismo PR (`07-FLUJO-DE-TRABAJO.md:50`). No reabre nada de la sección «Explícitamente NO pendiente» de `05-PENDIENTES.md`. |
| `revisar-pendientes` | **Después** de escribir, sobre el diff | Mismo objetivo que `grilling` pero **otro momento**: pre vs post. Ninguna sustituye a la otra. |
| `systematic-debugging` | Ante cualquier fallo o comportamiento inesperado | Refuerza `07-FLUJO-DE-TRABAJO.md` §4: «la prueba nueva pasa» ≠ «toda la suite pasa». Ante una prueba roja se corrige **el código**, nunca la prueba (`07:46`). |
| `nueva-entidad-dominio`, `nuevo-comando-financiero` | Scaffolding de trabajo **nuevo** | **No** son herramientas de depuración: no se invocan para arreglar un fallo ya existente. |
| `web-design-guidelines` | Auditoría de UI / a11y / UX | Skill de auditoría: **descarga las reglas de una URL en cada uso**, así que requiere red. No es fuente normativa: si contradice `.claude/rules/frontend-design.md`, manda el archivo del repo. |
| `frontend-design` | Dirección estética: tipografía, identidad visual, layout | **Solo donde el repo no fija nada.** Donde `frontend-design.md` manda, no aplica. |
| `vercel-react-best-practices` | **Solo** revisión de UI y componentes | **Prohibida** en comandos financieros, migraciones y dictámenes de dominio: ver la nota siguiente. |

`vercel-react-best-practices` recomienda `after()`, SWR, Server Actions, paralelismo por declaración y Redis. Los cinco contradicen `03-ARQUITECTURA.md` y están registrados como **rechazados** en la sección «Explícitamente NO pendiente» de `05-PENDIENTES.md`. Por eso los tres subagentes financieros la tienen denegada por permisos (`.opencode/agents/`) y por instrucción explícita (`.claude/agents/`); `code-reviewer` sí puede verla, pero con esas cinco secciones marcadas como no aplicables.

### El criterio, para que la regla sobrevja a los cambios de versión

No «qué skill es más nueva» ni «qué dice la skill», sino esto: **manda el documento cuando la regla es un requisito** respaldado por `02`/`03`/`04` o por una prueba ejecutable (invariantes, secciones de auditoría, idempotencia, formato de `Money`); **manda la skill cuando es estética** y el repo no dice nada (tipografía, jerarquía visual, accesibilidad no cubierta). Ante la duda, es un requisito: pregunta y anótalo en `05-PENDIENTES.md`.

## Estado actual

- Fases **F0–F4 terminadas**. Sigue **F5**: cobradores, rutas de cobro, Caja Menor y liquidación.
- `src/modules/collections/` está vacío — es el módulo de F5.
- Antes de empezar a construir, ejecuta el subagente `verificador-de-fase` sobre F4: no des por hecha la base.

## Verificación (el orden que exige CI)

`.github/workflows/ci.yml`, job `quality`, en este orden exacto:

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

Un `npm test` en verde no significa que el build pase. Ejecuta la cadena completa antes de declarar una tarea terminada.

### Correr una sola prueba

```sh
npx vitest run src/modules/identity/login.test.ts                     # unitaria
npx vitest run --config vitest.integration.config.mts src/tests/integration/login.test.ts   # integración
npx playwright test --project=desktop                                 # e2e (proyectos: desktop, mobile)
```

### Trampa de e2e: sin Supabase local la suite falla, no se omite

Sin `npm run db:start`, `npm run test:e2e` termina con **exit code 1**. No sale en verde.

La causa: en `journeys`, `portfolio` y `payments`, el `test.skip(!process.env.E2E_REAL_SUPABASE, …)` aparece unas líneas **por encima** de

```ts
const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
```

Esas dos líneas se ejecutan al **cargar el módulo**, antes de que Playwright pueda honrar el `test.skip`. Y `playwright.config.ts` solo define `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` cuando encuentra Supabase local, así que `createAdminClient()` lanza `Falta TEST_SUPABASE_URL` y la suite muere.

Ojo al mensaje: señala a `global-setup.ts`, que pertenece a la integración de **Vitest**. Playwright nunca lo ejecuta, así que esa pista desorienta.

`smoke.spec.ts` no usa fixtures: es el único que corre sin base de datos y pasa 30/30 en `desktop` y `mobile`.

Para correr la suite completa:

```sh
npm run db:start
npx playwright test
```

En CI no ocurre el fallo: el job `e2e` levanta Supabase local y además fija `E2E_REQUIRE_SUPABASE: "1"`, que convierte la ausencia de Supabase local en error en lugar de silencio.

### Trampa de integración

- Exigen `npm run db:start` **y** migraciones aplicadas (`npm run db:migrate`).
- No hace falta `.env.local`: `src/tests/integration/global-setup.ts` inyecta `TEST_SUPABASE_*` parseando la salida de `npx supabase status -o env`.
- `src/tests/integration/helpers/db.ts` aborta si la URL no es `127.0.0.1` o `localhost`. No apuntes a un proyecto remoto.

## Entorno

- No existe script `db:reset`. Para migraciones locales usa `npm run db:migrate` (`supabase migration up`).
- El servidor no arranca sin las 5 variables validadas en `src/instrumentation.ts` → `src/shared/validation/env.ts`. Lee esa cadena antes de culpar a otro de un fallo de arranque.
- `AUTH_SYNTHETIC_EMAIL_DOMAIN` debe ser un **hostname con punto y TLD**: `localhost` no pasa el regex.
- `.env.example` sí se lee. `.env.local` y cualquier otro secreto están bloqueados por permisos, en ambas herramientas. Jamás los leas ni los escribas.

## Arquitectura (lo que no se deduce de los nombres)

- **`src/app/**` es delgado.** Route Handler → validar → servicio. Las páginas no calculan interés, mora, saldos ni permisos. Si aparece un cálculo financiero en un componente o en una ruta, está mal.
- **Esqueleto obligatorio de todo Route Handler de comando** (referencia: `src/app/api/super-admin/businesses/route.ts`):

  ```
  assertSameOrigin  →  requireSession({roles})  →  parseBody(schema, await readJsonBody(request))
                    →  servicio de dominio  →  commandResponse
  ```

  con `errorResponse` en el `catch`. `assertSameOrigin` (CSRF) y `readJsonBody` (que exige `Content-Type: application/json` exacto) **no son opcionales**: quitarlos no es una simplificación, es un agujero.

- **Los servicios de dominio reciben sus dependencias por parámetro** — `{db, admin, syntheticEmailDomain, now?, generatePassword?}` — para poder testearlos. No uses singletons de módulo dentro de un servicio: rompen la testabilidad.
- **`requireSession()` es la única fuente de `businessId` y `role`.** `business_id` nunca se lee del cuerpo de la petición ni de un parámetro del cliente.
- **El pool `pg` es privilegiado y no pasa por RLS.** El filtrado por `business_id` en la capa de aplicación es la defensa principal de las escrituras financieras; la RLS es la segunda línea, no la primera.
- **`withTransaction(fn, pool?)`** entrega un `Tx = Pick<PoolClient, "query">`. No hay transacciones anidadas ni `COMMIT` manual.
- **Auth y base de datos no son atómicos.** El patrón es: crear en Auth → transacción → si falla, compensar con `deleteUser`. Referencia: `src/modules/subscriptions/create-business.ts`.
- **`recordAuditEvent(tx, …)` va dentro de la transacción del comando**, nunca después: si el commit falla, la auditoría tampoco debe existir.
- **`Money`** es un entero con marca de tipo (`src/shared/money/money.ts`). Construye importes solo con `money()`; nunca sumes o compares `Money` con `number`. Interés en puntos básicos, redondeo half-up. V1 es COP sin decimales.

## Migraciones

- **Nunca edites una migración ya aplicada.** Crea una nueva.
- Tablas de solo agregado (append-only): `select private.make_append_only('public.x'::regclass, ARRAY['col']);`.
- Tablas y funciones nuevas **nacen sin privilegios** para `anon`, `authenticated` y `service_role`, y se concede explícitamente lo que corresponda. `src/tests/integration/identity-hardening.test.ts` tiene "guardianes de privilegios" que se aplican a **toda** tabla de `public`, presente y futura: una migración que olvide el `GRANT` rompe la suite de integración.
- Migraciones y lógica de negocio van en **commits separados**.

## Dependencias

`CLAUDE.md` fija las versiones exactas y documenta dos topes deliberados que **no se deben subir**:

- **TypeScript 7** rompe el lint (`typescript-eslint` exige `<6.1`).
- **ESLint 10** rompe `eslint-config-next`.

Solo sube parches o minors de bajo riesgo, y siempre revisa la tabla de stack de `CLAUDE.md` en el mismo cambio.

## Convenciones

- Código y base de datos en **inglés**: `snake_case` en BD, `camelCase` en TypeScript.
- Comentarios, mensajes de error y documentación en **español**.
- `docs/`, `.claude/` y `*.md` están en `.prettierignore`: `npm run format` **no** los toca, ni siquiera si el Markdown está mal formateado.

## Git

- Una tarea, una rama. **Nunca commitees en `main`.**
- Commits atómicos; migraciones y lógica de negocio en commits separados.
- `git push`, `git merge`, `supabase db push`, `supabase db reset`, `rm` y `mv` **requieren confirmación humana**. El force-push, `git reset --hard`, `git clean` y `git branch -D` están bloqueados sin excepción.
- No hagas commit de nada que no te hayan pedido commitar.

## Detente y pregunta

- Si un punto no está **textualmente** en `docs/planning/02-DOMINIO.md`, no lo inventes: anótalo en `docs/planning/05-PENDIENTES.md` y pregunta al humano. "Parece razonable" no es una fuente válida en este proyecto.
- Si la tarea toca algo ya listado en `05-PENDIENTES.md`, para el trabajo relacionado y pregunta.
- **Nunca debilites una prueba para que pase** (ni la elimines, ni la marques `skip`, ni la esquivates). Corrige el código. Corre la prueba nueva **y** toda la suite; reporta los fallos tal cual.
- No adelantes una fase de `04-PLAN.md` ni construyas nada marcado "fuera de V1" en `01-CONTEXTO.md`.

## Subagentes y skills

Los subagentes de `.opencode/agents/` y los skills de `.claude/skills/` están cableados en `opencode.json`. Úsalos en el orden que fija `docs/planning/06-AGENTES-HABILIDADES.md`: validar dominio → escribir migración → escribir comando → escribir pruebas → revisar → verificar fase. Cuándo usar cada skill y cuál pierde ante un conflicto, en «Orden de autoridad (skills incluidas)» más arriba.

## Estilo de respuesta

Ultraconciso. Al mostrar código, muestra solo el diff de las líneas modificadas, nunca el archivo completo salvo que se pida explícitamente.