# ADR 0004 — Política de contraseñas y endurecimiento del inicio de sesión

- **Estado:** aceptada
- **Fecha:** 2026-09-28
- **Fuente:** `02-DOMINIO.md` §1.4 («contraseña segura»; abierto de F1 en `05-PENDIENTES.md`)

## Contexto

`02` exigía una «contraseña segura» sin definirla. Las cuentas las crea el administrador con una contraseña temporal y el usuario debe cambiarla en su primer acceso. Los cobradores la teclean en el celular, en la calle.

## Decisión

- **Política (elegida por el dueño del producto):** mínimo 8 caracteres con al menos una letra y un dígito; máximo 72 bytes, porque bcrypt (Supabase Auth) trunca en silencio lo que exceda. Se valida en el servidor (`password-policy.ts`) y Supabase Auth la impone también (`minimum_password_length = 8`, `password_requirements = "letters_digits"` en `supabase/config.toml`; en el proyecto alojado se configura en el panel de Auth).
- **Registro público cerrado:** `[auth].enable_signup = false`. Ojo: `[auth.email].enable_signup` habilita el proveedor de email completo (incluido el login), por lo que debe seguir en `true`.
- **Comandos con cookie de sesión:** tipo MIME `application/json` exacto y comprobación de `Sec-Fetch-Site`/`Origin` (`assertSameOrigin`) contra CSRF; cookies de sesión `httpOnly`, `sameSite=lax` y `secure` en producción.
- **Cierre de sesión:** solo el dispositivo actual (`scope: local`). Al cambiar la contraseña temporal se cierran las demás sesiones.
- Un usuario inexistente y una contraseña errónea producen el mismo error; el motivo de un bloqueo o de un negocio suspendido solo se explica tras validar la contraseña.

## Consecuencias

- Auth y la BD no son atómicos: si la BD falla tras cambiar la contraseña, el usuario queda pendiente y debe elegir otra distinta de la actual (Auth rechaza repetirla).
- Auth ve la IP del servidor de Next, no la del cliente: su límite de intentos es global. Un límite por usuario e IP en la aplicación queda como pendiente (`05-PENDIENTES.md`).
