# Tareas — 010

- [x] Revisar las reglas explícitas sobre pago cronológico en `02-DOMINIO.md` §3.2 e invariantes.
- [x] Compartir el asignador entre UI y comando.
- [x] Añadir pruebas generativas deterministas de invariantes.
- [x] Ejecutar la prueba focalizada y la suite unitaria: 56 archivos / 300 pruebas pasan con un worker; typecheck, lint y format pasan.
- [x] Revisar que no se tocaron reglas abiertas ni aserciones existentes.

Limitación de verificación: la prueba de integración `payments.test.ts` no pudo iniciar porque la base local no está disponible (`connect EACCES 127.0.0.1:54322`). No se arrancó Docker/Supabase. La ejecución Vitest predeterminada también reprodujo el fallo ENOENT conocido; la misma cobertura pasó con un worker, sin omitir pruebas.
