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

- El nombre de usuario se guarda en minúsculas y solo admite letras a-z, dígitos, punto, guion y guion bajo (3–32 caracteres), porque es la parte local del email sintético; la unicidad global es un índice único.

- Sin tabla de membresías: `business_id` y `role` del JWT bastan para RLS.
- El dominio del email sintético se fija en configuración (`AUTH_SYNTHETIC_EMAIL_DOMAIN`). **Riesgo por verificar en F1:** Supabase Auth (alojado) puede rechazar emails de dominios reservados o sin registros MX; si ocurre, usar un dominio propio con MX o repensar el identificador.
- Si en el futuro se requiere multi-negocio por persona, se necesitará una ADR nueva y migración de identidad.
