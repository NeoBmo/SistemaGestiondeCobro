# Plan: patrones responsivos por perfil

## Estrategia

Auditar rutas por rol y cambiar solo layouts que incumplan un criterio observable de `spec.md`. Mantener el shell y la composición existentes cuando funcionen; preferir ajustes de grid/flex, wrapping y límites relativos antes que duplicar componentes o introducir layouts paralelos por dispositivo. No rediseñar la identidad ni añadir comportamiento de negocio.

La resolución de un caso será local a la vista que lo necesita salvo que dos o más usos reales demuestren una regla compartida. No crear una abstracción responsive global para anticipar futuras pantallas. Para contenido financiero, conservar formato, orden y contexto de lectura ya establecidos por spec 003.

## Inventario de implementación

- **Cobrador:** `src/app/cobrador/page.tsx`, `src/app/cobrador/clientes/[clientId]/page.tsx`, `src/app/cobrador/_components/collector-forms.tsx`.
- **Shell y navegación:** `src/shared/ui/private-shell.tsx`, `src/app/cobrador/layout.tsx`, `src/app/negocio/layout.tsx`, `src/app/super-admin/layout.tsx`.
- **Administrador:** `src/app/negocio/page.tsx`, `caja/page.tsx` y sus acciones, `cartera/page.tsx`, `clientes/{page.tsx,[clientId]/page.tsx,nuevo/page.tsx}`, `prestamos/{[loanId]/page.tsx,nuevo/page.tsx,importar/page.tsx}` y componentes de formularios/listas; además `cobradores/page.tsx`, `jornadas/page.tsx`, `rutas/{page.tsx,[routeId]/page.tsx}` y `soporte/{page.tsx,[ticketId]/page.tsx}`.
- **Super Admin:** `src/app/super-admin/page.tsx`, `negocios/{nuevo/page.tsx,[businessId]/page.tsx}`, `soporte/{page.tsx,[ticketId]/page.tsx}` y `monitoreo/page.tsx`, junto a componentes de listas/acciones relacionados.

Los directorios de `src/app/` contienen cambios locales previos. Antes de editar cualquier archivo se comparará su diff con el estado inicial de la tarea; se conservará todo WIP y en particular el diff preexistente de Caja Mayor. No se tocarán módulos, API, dominio, migraciones o permisos.

## Secuencia

1. Confirmar baseline por ruta y asociar problemas a un criterio RF; registrar por separado rutas revisadas sin discrepancias.
2. Resolver primero defectos del Cobrador móvil: ancho disponible, wrapping, orden y alcance táctil, manteniendo flujo y contenido.
3. Resolver defectos de listas/formularios del Administrador y jerarquía/acciones de Super Admin en los anchos aplicables.
4. Revisar cambios compartidos de shell en los tres perfiles y retirar ajustes locales redundantes únicamente si el diff de esta tarea los introdujo.
5. Revisar los diffs contra RF-08 y restricciones de repo; ejecutar cadena de calidad y evaluación independiente.
6. Registrar cierre en tareas y `MEMORY.md`; dejar pruebas/capturas multi-viewport automatizadas para la spec 006.

## Verificación de esta spec

- Inspección estática de rutas incluidas, con lista explícita de archivos revisados y correcciones relacionadas a RF.
- `npm run format:check`, `npm run typecheck`, `npm run lint`, suite completa y `npm run build`, respetando el orden de `AGENTS.md`. Si el runner Vitest predeterminado repite el ENOENT documentado, se reportará y se ejecutará la misma suite con el workaround conocido de un worker, sin excluir pruebas.
- Revisión independiente del diff y comprobación de que el WIP previo se preservó.
- No se considera terminado el ejercicio de capturas/overflow automatizado hasta `specs/006`.

## Riesgos

- Los ajustes al shell pueden afectar simultáneamente los tres perfiles; conservar la configuración específica de ancho por rol existente.
- Cambiar una lista a tabla no forma parte de esta spec y podría empeorar el móvil o requerir una decisión de producto; no hacerlo como arreglo automático.
- En scroll contenido solo se admite cuando existe información tabular que lo exige; los elementos de acción y el encabezado deben seguir disponibles y accesibles.
- El verificador visual integral se difiere deliberadamente a la spec 006 para evitar duplicar el esfuerzo de automatización.

## Resultado de implementación

La revisión estática de los recorridos incluidos no justificó rediseños generales ni la introducción de tablas. Se corrigieron casos con contenido extenso que podía forzar el ancho mínimo: nombre/rol y botón de salida en el shell, identificaciones/teléfonos y nombres de registro, observaciones e identificadores largos. El calendario y los dos resúmenes del préstamo se apilan en móvil y vuelven a su composición de pares desde `sm`; las tres métricas por cuota pasan a columnas desde `sm`.

La base táctil existente se conserva: los controles `Button` usan `min-h-11 min-w-11` (`src/shared/ui/button.tsx`) y los enlaces de contacto del Cobrador usan `min-h-11` (`src/app/cobrador/clientes/[clientId]/page.tsx`). No hubo cambios de datos, permisos o comandos. Se preservó el WIP previo de Caja Mayor; sus cambios no forman parte de esta spec.

La cadena pasó en orden: `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test -- --pool=threads --maxWorkers=1` (55 archivos/298 pruebas) y `npm run build`. La ejecución inicial de `npm test` con workers predeterminados reprodujo el ENOENT de temporales de Vitest en Windows; la ejecución completa con un worker pasó sin excluir pruebas. Revisión independiente: **APROBADO**. No se hicieron capturas ni pruebas visuales multi-viewport; quedan documentadas para `specs/006-verificacion-frontend`.
