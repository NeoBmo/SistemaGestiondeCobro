---
name: nueva-entidad-dominio
description: Scaffolding de una entidad nueva de 02-DOMINIO.md (migración, módulo con tipos, validación y servicio, pruebas unitarias e de integración). Úsalo con el nombre de la entidad, antes de escribir cualquier código de esa entidad.
---

# Nueva entidad de dominio

Argumento: nombre de la entidad como aparece en `docs/planning/02-DOMINIO.md` (p. ej. `Cliente`). Una entidad por sesión (`07-FLUJO-DE-TRABAJO.md` §1). Sin UI: la interfaz llega cuando sus invariantes y pruebas estén resueltas.

## 1. Antes de escribir código

1. Lee la sección de la entidad en `02-DOMINIO.md` (datos, estados, reglas, eventos) y los invariantes de §9 que la tocan.
2. Busca sus términos en `08-GLOSARIO.md`; si falta alguno, añádelo **antes** de nombrarlo en código (código y BD en inglés).
3. Revisa `05-PENDIENTES.md`: si algún abierto toca esta entidad y su fase bloqueante es la actual o anterior, **detente y pregunta**.
4. Pasa el plan por el subagente `guardian-de-dominio`. Si dictamina `NO CONFORME`, corrige el plan; no inventes reglas.

## 2. Clasificar

- **Hecho financiero o de auditoría** (pago, movimiento, gasto, liquidación, evento de auditoría…): solo agregado. Su migración llama `select private.make_append_only('<tabla>'[, array['<columna_derivada>']])`.
- **Entidad mutable** (cliente, ruta, cobrador…): se edita con auditoría; los cambios de estado siguen las transiciones de `02`.

## 3. Migración (commit propio, subagente `escritor-de-migraciones`)

`supabase migration new <nombre>`; nunca edites una migración ya aplicada. Toda tabla operativa: `business_id` NOT NULL con FK, entidades hijas con el mismo `business_id` que su padre, importes `bigint`, `interest_bps` entero, fechas `timestamptz` UTC, restricciones de los invariantes de `02` §9 como `CHECK`/`UNIQUE`/índices parciales, RLS por negocio y rol (políticas que exigen también negocio `ACTIVO`, con los helpers envueltos en `(select …)`), índices por `business_id`, estado y fecha. Las tablas nuevas nacen **sin privilegios** para los roles de la API: concede explícitamente `select` a `authenticated` (nunca escritura) y no dejes `EXECUTE` a `PUBLIC` en funciones nuevas. Aplica en local con `npm run db:migrate`.

## 4. Módulo `src/modules/<módulo>/`

Archivos: `types.ts` (tipos de dominio; importes con `Money` de `@/shared/money/money`), `validation.ts` (Zod), `service.ts` (reglas de dominio; lo más puro posible), `queries.ts` (lecturas; `business_id` siempre de la sesión del servidor, nunca de un parámetro del cliente). Las pruebas van junto al código como `*.test.ts`. Una página nunca calcula reglas: llama al servicio.

## 5. Pruebas (según riesgo; subagente `escritor-de-pruebas`)

- Unitarias por cada regla de `02` (cita la sección en el nombre del caso).
- Integración en `src/tests/integration/` con `helpers/db.ts` (`createTestPool`, `withRollback`, `attempt`): restricciones de BD, aislamiento entre negocios y, si es hecho financiero, que `UPDATE`/`DELETE` se rechazan. Los guardianes de `identity-hardening.test.ts` (RLS activo en toda tabla de `public`, sin escritura para la API) deben seguir en verde.

## 6. Cierre

`npm run typecheck && npm run lint && npm test && npm run test:integration` en verde; luego el subagente `code-reviewer` sobre los archivos cambiados; commits atómicos en rama de tarea (migración y lógica separadas).
