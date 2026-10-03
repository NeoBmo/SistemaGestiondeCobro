# ADR 0005 — Resultado de auditoría, re-suscripción y restablecimiento de contraseña

- **Estado:** aceptada
- **Fecha:** 2026-10-01
- **Fuente:** `02-DOMINIO.md` §1.3, §1.4, §6.3 y §8 (abiertos de F1 en `05-PENDIENTES.md`)

## Contexto

La revisión de F1 dejó tres puntos que el dominio no cerraba y que el código ya había implementado por su cuenta:

- `audit_events.result` tenía un `CHECK (result in ('OK', 'RECHAZADO'))` en el esquema, pero `02` §6.3 solo decía «resultado». Nadie sabía si un error de validación generaba evento.
- `subscriptions.business_id` era `UNIQUE`: una suscripción de por vida, mientras `02` §1.3 llamaba a `ARCHIVADA` un estado terminal. Un negocio archivado no tenía vuelta atrás.
- `02` §1.4 exigía que el Super Admin restableciera la contraseña del admin, pero sin alcance, sin evento y sin efecto sobre las sesiones. Sin eso, un `createBusiness` cuya respuesta 201 se pierde deja la contraseña temporal irrecuperable: nunca existió en ningún log.

## Decisión

- **`result`** admite `OK` (el comando se aplicó) y `RECHAZADO` (el actor estaba autenticado pero sin permiso sobre esa entidad concreta). No se auditan rechazos por datos inválidos ni intentos de login fallidos: `entity_id` es obligatorio y un payload inválido no tiene entidad sobre la que auditar. La visibilidad queda en la matriz de §8 (Super Admin todo, Admin su negocio, Cobrador nada), que es lo que ya aplican las políticas RLS.
- **Re-suscripción permitida.** Un negocio archivado puede volver mediante una suscripción **nueva**: el Super Admin elige el plan, se crea la fila `ACTIVA` desde hoy y el negocio vuelve a `ACTIVO`. La fila `ARCHIVADA` no se reactiva ni se modifica, queda como historial. La unicidad pasa a ser parcial (una suscripción *vigente* por negocio) y el evento registra el plan y las fechas de la anterior. Las cuentas de los usuarios sobreviven al archivado; si cambió el titular, el Super Admin restablece la del admin. No exige motivo.
- **Restablecimiento de contraseña por el Super Admin, solo sobre la cuenta `ADMIN_NEGOCIO` en V1** (los cobradores no existen todavía). Deja al usuario en `PENDIENTE_CAMBIO_CONTRASENA`, le revoca las sesiones activas y se audita con el evento `ContrasenaRestablecida`.

## Consecuencias

- `ARCHIVADA` sigue siendo terminal **por fila**, no por negocio: el término es que una suscripción archivada no vuelve a ser la vigente, no que el negocio sea irrecuperable.
- El trigger de coherencia negocio ↔ suscripción debe ignorar las filas `ARCHIVADA` al comprobar la invariante de acceso `ACTIVO` ⇔ suscripción `ACTIVA`; con varias filas, un `join` sin filtro compararía contra una fila arbitraria.
- Re-suscribir es una excepción a la regla de que `businesses.access_status` se cambia siempre junto al estado de la suscripción vigente: aquí se reactivan ambos en la misma transacción, con la fila nueva.
- La auditoría sigue siendo append-only: la re-suscripción no edita la fila anterior, añade una nueva.