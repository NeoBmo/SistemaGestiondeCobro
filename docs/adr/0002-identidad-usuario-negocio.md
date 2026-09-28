# ADR 0002 — Un usuario, un negocio; acceso por «usuario» con email sintético

- **Estado:** aceptada
- **Fecha:** 2026-09-27
- **Fuente:** `02-DOMINIO.md` §1.4

## Contexto

Supabase Auth exige email o teléfono como identificador, pero el dominio define acceso por «usuario» y los cobradores pueden no tener email. `01-CONTEXTO.md` decía que una persona podía asociarse a varios negocios, lo que contradecía `02` (usuario con un solo negocio).

## Decisión

- Un usuario pertenece a un único negocio; la misma persona en dos negocios tiene dos cuentas.
- El «usuario» se mapea internamente a un email sintético (no se envían correos).
- El admin restablece la contraseña de sus cobradores; el Super Admin la del admin. Todo restablecimiento pasa por `PENDIENTE_CAMBIO_CONTRASENA` y se audita.

## Consecuencias

- Sin tabla de membresías: `business_id` y `role` del JWT bastan para RLS.
- El dominio del email sintético debe ser reservado/no enrutable y fijarse en configuración.
- Si en el futuro se requiere multi-negocio por persona, se necesitará una ADR nueva y migración de identidad.
