# Tareas: estados de interfaz y presentación financiera

1. [x] **Cerrar inventario y baseline frontend.** Registrar pantallas concretas por perfil, sus límites `loading.tsx`/`error.tsx`, vacíos, comandos y formateadores; conservar cambios locales preexistentes.
   **Hecho:** inventario y baseline están en `plan.md`. El WIP previo de `src/app/negocio/caja/page.tsx` se inspecciona solo como referencia y no se editará.

2. [x] **Normalizar presentación financiera existente.** Confirmar formatos compartidos, estilo tabular para valores independientes y estados textuales.
   **Hecho:** la revisión detectó y corrigió valores de aplicación en el historial de pagos y saldos aplicado/pendiente de cargos de mora; los demás casos usan formatos COP/fechas comunes y estilo tabular para valores independientes.

3. [x] **Auditar estados de consulta.** Revisar límites de carga/error de App Router y resultados vacíos/datos en las páginas delimitadas.
   **Hecho:** las áreas revisadas tienen límites de carga/error; los vacíos inspeccionados aparecen solo tras consulta correcta. Evidencias: `src/app/cobrador/{loading,error}.tsx`, `src/app/negocio/{loading,error}.tsx` y límites anidados, `src/app/super-admin/{loading,error}.tsx` y límites anidados.

4. [x] **Auditar estados de comando.** Revisar carga, error y éxito verificable, protección ante envío duplicado y canal de anuncio.
   **Hecho:** `useCommand` y `CommandForm` representan estados; el éxito sucede tras respuesta exitosa y los canales compartidos evitan duplicar el anuncio de `Alert`.

5. [x] **Auditar confirmaciones y accesibilidad de feedback.** Revisar motivo, consecuencia, anuncios y foco en los flujos incluidos.
   **Hecho:** reversos/anulaciones revisados describen la consecuencia y solicitan motivo; errores enfocan `Alert`; `Spinner`, `Alert` y feedback usan semántica accesible existente.

6. [x] **Verificar el cierre e integrar la memoria.** Ejecutar la cadena de calidad, documentar el resultado y solicitar revisión independiente. La automatización visual multi-ancho se cubre en la spec 006.
   **Hecho:** `format:check`, `typecheck`, `lint`, `npm test -- --pool=threads --maxWorkers=1` (55 suites/298 pruebas) y `build` pasan. `npm test` predeterminado produce ENOENT del temporal de Vitest; el comando alternativo no omite pruebas. Revisión independiente aprobada y `MEMORY.md` actualizado.
