---
name: nuevo-comando-financiero
description: Scaffolding de un comando financiero completo (Route Handler, validación, servicio de dominio, transacción con bloqueos, idempotencia, auditoría y pruebas) según 03-ARQUITECTURA.md §3. Úsalo con el nombre del comando (pago, gasto, desembolso, liquidación, ajuste, reverso, refinanciación…).
---

# Nuevo comando financiero

Argumento: nombre del comando. Un comando por sesión. Patrón obligatorio: `docs/planning/03-ARQUITECTURA.md` §3 y ADR 0001.

## Prerrequisito

La ejecución común (idempotencia, bloqueos y auditoría) es el **runner de comandos financieros que se crea en F2**. Si todavía no existe en `src/shared/database/`, esta skill no aplica al comando: primero se construye el runner (F2) y se prueba con los comandos de Caja Mayor. **No reimplementes idempotencia, bloqueos ni auditoría dentro de un comando.**

## 1. Antes de escribir código

1. Lee la regla del comando en `02-DOMINIO.md` (estados, invariantes de §9, matriz de permisos de §8) y los nombres en `08-GLOSARIO.md`.
2. Revisa `05-PENDIENTES.md`; si un abierto toca este comando y su fase bloqueante es la actual o anterior, **detente y pregunta**.
3. Pasa el plan por `guardian-de-dominio`.

## 2. Diseño del comando

- **Entrada:** esquema Zod; la clave de idempotencia se valida con `parseIdempotencyKey` (`@/shared/ids/idempotency-key`); importes con `money()`; interés en `interest_bps`.
- **Route Handler** (`src/app/api/...`): valida sesión, rol y recurso; `business_id` sale de la sesión/recurso autorizado en servidor, **jamás del cuerpo**; delega en el servicio y devuelve `CommandResult` (`@/shared/types/command-result`). Errores de regla: `AppError` con código estable.
- **Servicio** (`src/modules/<módulo>/service.ts`): abre una única transacción con `withTransaction` (`@/shared/database/with-transaction`) y, en este orden fijo: toma bloqueos (`SELECT … FOR UPDATE` sobre préstamo y cuotas; `pg_advisory_xact_lock` por negocio+caja) → comprueba invariantes → crea el hecho financiero y su movimiento de caja → actualiza solo estado derivado permitido → crea el evento de auditoría → registra la clave de idempotencia. Todo o nada.
- **Correcciones:** `AJUSTE`/`REVERSO` nuevos con motivo, enlazados al original; nunca `UPDATE`/`DELETE`.
- Sin caché en funciones que escriben dinero.

## 3. Pruebas (el comando no está terminado sin ellas)

- **Unitaria** de la regla de dominio (cita la sección de `02`).
- **Integración** (`src/tests/integration/`, `helpers/db.ts`): atomicidad (fallo a mitad no deja nada), reintento con la misma clave devuelve el mismo resultado sin duplicar dinero, misma clave con payload distinto → 409, aislamiento entre negocios, rechazo por rol no autorizado y concurrencia (dos comandos simultáneos sobre el mismo recurso no rompen invariantes).
- Si expone pantalla: los 4 estados (carga, vacío, error, éxito) y resultado verificable en el éxito (`.claude/rules/frontend-design.md` §5).

## 4. Cierre

`npm run typecheck && npm run lint && npm test && npm run test:integration` en verde, luego el subagente `code-reviewer` sobre los archivos cambiados (obligatorio para dinero) y un humano lee el diff completo antes de mergear (`07-FLUJO-DE-TRABAJO.md` §3). Commits atómicos en rama de tarea.
