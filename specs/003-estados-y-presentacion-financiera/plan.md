# Plan: estados de interfaz y presentación financiera

## Estrategia

Aplicar patrones pequeños por consulta y comando, manteniendo la arquitectura por pantalla: consultas en Server Components y formularios/clientes mínimos con `useCommand`. Reutilizar `formatMoney`, `formatIsoDate`, `formatDateTimeInZone`, `Alert` y el canal de feedback existente. No crear una abstracción global antes de que dos o más casos concretos demuestren una necesidad compartida.

El límite funcional se ancla a la respuesta del servidor y al dominio: la interfaz presenta hechos y estados ya calculados, pero no calcula saldo, mora, aplicación de pago o permisos. Si una operación no devuelve el dato necesario para una confirmación verificable, se anota como dependencia/pregunta; esta spec no autoriza cambiar el comando.

## Inventario delimitado y baseline

La tarea 1 confirmó que los patrones principales ya existen; el trabajo se limita a auditar y corregir inconsistencias comprobables en estos recorridos, sin reescribirlos:

- **Cobrador:** `/cobrador` y `/cobrador/clientes/[clientId]`, `src/app/cobrador/_components/collector-forms.tsx`; límites de consulta `src/app/cobrador/loading.tsx` y `error.tsx`.
- **Administrador:** Caja Mayor (se permite leer `src/app/negocio/caja/page.tsx`, pero se preserva su diff WIP previo), `cash-actions.tsx` y `reverse-movement.tsx`; jornadas (`jornadas/page.tsx`, `_components/session-forms.tsx`); detalle y comandos del préstamo (`prestamos/[loanId]/page.tsx`, `_components/installment-badge.tsx`, `late-fees.tsx`, `payment-history.tsx`, `register-payment.tsx`).
- **Super Admin:** lista/detalle de negocios y `business-actions.tsx`/`status-badge.tsx`; `/super-admin/soporte`, detalle de ticket y `src/app/_components/ticket-parts.tsx`; `/super-admin/monitoreo`.
- **Base compartida auditada:** `src/shared/ui/{use-command,alert,spinner}.tsx`, `src/app/negocio/_components/{command-form,cash-feedback}.tsx` y `src/shared/{money/money,dates/dates}.ts`.

Baseline observado: los límites App Router disponibles tienen `loading.tsx` y `error.tsx` por área; los vacíos representativos distinguen consulta correcta sin datos; los comandos usan `useCommand`/`CommandForm`, alertas enfocables y feedback compartido; dinero y fechas ya pasan por los formateadores comunes. El diff local previo de Caja Mayor queda fuera de escritura.

## Secuencia

1. Mantener el inventario y baseline de arriba como límite de alcance; separar cualquier discrepancia de interfaz de una regla de negocio.
2. Auditar los casos seleccionados contra los requisitos. Reutilizar los patrones existentes y hacer cambios puntuales solo si la evidencia demuestra una inconsistencia.
3. Verificar ejemplos de COP, fechas calendario/instantes, mora/pago parcial, carga, vacío, error y éxito; cubrir anuncios/foco con pruebas de UI ya disponibles o casos dirigidos.
4. Ejecutar la cadena acordada de calidad y revisar visualmente estados representativos por perfil. La cobertura multi-ancho se consolidará con la spec 006 de verificación frontend.

## Verificación prevista

- Pruebas dirigidas de UI para los estados y formato dentro de las áreas incluidas; no cambiar pruebas financieras ni duplicar las unitarias existentes de dinero/fechas.
- Playwright para al menos un caso de consulta vacía/error y un comando confirmado/error en rutas sin crear reglas nuevas; los recorridos con sesión real requieren Supabase local según `AGENTS.md`.
- Verificar teclado, foco y `aria-live`/`role=status`/`role=alert` para actualizaciones dinámicas; revisar al menos un flujo por perfil.
- Ejecutar el conjunto de calidad del repo según `AGENTS.md` antes de cerrar implementación; la revisión visual amplia y capturas multi-ancho pueden agruparse al cerrar las specs frontend, como acordó el usuario.

## Riesgos

- Diferencias entre `role=status`, `aria-live` y foco pueden producir anuncios duplicados; comprobar el flujo completo, no solo el componente aislado.
- No todo error de lectura es recuperable desde una página; mantener los error boundaries y mensajes existentes cuando sea el comportamiento definido por arquitectura.
- La confirmación nunca sustituye idempotencia ni validación del servidor.

## Resultado de la auditoría

La primera revisión encontró importes de aplicación y saldos aplicado/pendiente de cargos de mora sin tipografía tabular. Se corrigieron esos valores de presentación dentro del alcance; los patrones compartidos de estado y los demás formatos reutilizan la base existente.

La cadena CI quedó verificada: `format:check`, `typecheck`, `lint`, 55 suites/298 pruebas y `build` pasaron. `npm test` con los workers predeterminados falló por `ENOENT` del temporal de Vitest en Windows; la misma suite pasó con `--pool=threads --maxWorkers=1`, sin excluir casos. Las pruebas E2E visuales multi-ancho se consolidan en `specs/006-verificacion-frontend` según el plan aprobado.
