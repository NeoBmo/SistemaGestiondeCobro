# ADR 0003 — Estados de Negocio y Suscripción, usuario único y zona horaria por negocio

- **Estado:** aceptada
- **Fecha:** 2026-09-28
- **Fuente:** `02-DOMINIO.md` §1.2–1.4 (abierto de F1 en `05-PENDIENTES.md`)

## Contexto

`02` daba estado propio al Negocio (`ACTIVO`/`SUSPENDIDO`) y a la Suscripción (cinco estados) con eventos duplicados (`NegocioSuspendido` aparecía en ambos), sin decir cuál manda. Tampoco fijaba el alcance de unicidad del usuario, la zona horaria del negocio ni el cálculo del vencimiento.

## Decisión

- `businesses.access_status` es la única compuerta de acceso. `subscriptions.status` almacena `ACTIVA`/`SUSPENDIDA`/`ARCHIVADA`; `PROXIMA_A_VENCER` y `VENCIDA` se derivan de las fechas al leer (mismo criterio que `CuotaVencida`).
- Suspender, activar y archivar cambian ambos campos en una sola transacción; archivar es terminal y deja el negocio bloqueado.
- Un negocio archivado puede volver por re-suscripción, con una suscripción nueva (ADR 0005).
- Nombre de usuario único en toda la plataforma.
- `businesses.time_zone` (IANA, default `America/Bogota`).
- Vencimiento por calendario con ajuste al último día del mes.

## Consecuencias

- Dos campos que deben mantenerse coherentes: se protege con el comando único por transición y con pruebas de integración de la invariante (acceso `ACTIVO` ⇔ suscripción `ACTIVA`), comprobando siempre la suscripción vigente (ADR 0005).
- El login del cobrador es solo usuario + contraseña; una colisión de nombre entre negocios se resuelve eligiendo otro nombre.
- Nada de esto requiere un proceso programado: los estados informativos se calculan al consultar.
