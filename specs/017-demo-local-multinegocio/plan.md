# Plan — 017 Demostración local multi-negocio

1. Inspeccionar y documentar el patrón de fixtures de `src/tests/e2e` y los servicios vigentes de identidad, negocios, cartera, cobranzas y caja; elegir los servicios permitidos sin duplicar reglas.
2. Diseñar un comando de seed local con guardas de loopback, nombres reservados, claves idempotentes y validación de estado completo; no leer/escribir `.env*` ni persistir contraseñas.
3. Crear cuentas de negocio y cinco conjuntos pequeños de datos mediante flujos existentes, con las credenciales temporales emitidas una sola vez en la terminal local.
4. Añadir pruebas del guard remoto, idempotencia, coherencia e aislamiento entre negocios; no reutilizar el seed de volumen que desactiva disparadores.
5. Documentar preparación, arranque de Next en red local, acceso móvil dentro de la misma Wi-Fi, usuarios y recuperación ante fallo parcial.
6. Ejecutar verificaciones de la cadena del repo, E2E y checklist manual de Super Admin, Administrador y Cobrador en escritorio/móvil.
7. Revisar los diffs de cualquier código financiero, confirmar que no se alteraron pendientes de F8 y reportar que esta tarea no cierra ninguna fase.

## Riesgos y límites

- La creación de Auth y PostgreSQL no es atómica; el plan debe usar compensación y fallar cerrado ante entornos no locales.
- Los comandos existentes pueden no permitir una composición de seed sin pasar por Route Handlers o sin crear auditoría real. Si el patrón actual no admite el caso, detenerse y proponer una decisión antes de introducir acceso privilegiado nuevo.
- Las identidades de Supabase Auth no son eliminables por el dominio financiero; recuperación y repetición deben quedar acotadas a los identificadores reservados de demo.
- El acceso LAN depende del firewall del dispositivo anfitrión; la guía no debe recomendar publicar puertos en el router.
- Ningún caso listado en `05-PENDIENTES.md` se resuelve como parte de esta tarea.
