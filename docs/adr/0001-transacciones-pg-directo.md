# ADR 0001 — Transacciones financieras con `pg` directo

- **Estado:** aceptada
- **Fecha:** 2026-09-27
- **Fuente:** `03-ARQUITECTURA.md` §1, §3

## Contexto

Cada comando financiero exige una transacción única (hecho + movimiento de caja + estados + auditoría + idempotencia). `supabase-js` habla con PostgREST y no soporta transacciones multi-sentencia.

## Decisión

El servicio de dominio (TypeScript) abre la transacción con el driver `pg` sobre el pooler de Supabase. La lógica de dominio vive en TS, testeable con Vitest. Se añaden `pg` y `@types/pg` a la lista de dependencias.

## Consecuencias

- La conexión `pg` es privilegiada y **no pasa por RLS**: el filtro por `business_id` de la sesión en la capa de aplicación es la defensa principal en escrituras financieras; RLS protege el acceso vía API de datos.
- Hay que gestionar pool, timeouts y modo del pooler (transaction pooling) en F0.
- Bloqueos explícitos (`FOR UPDATE`, advisory locks) e idempotencia por tabla se implementan en el runner de comandos (F2).
- Alternativa descartada: funciones PL/pgSQL vía RPC (lógica en SQL, tests dependientes de BD).
