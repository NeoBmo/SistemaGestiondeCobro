# Plan: verificación frontend

## Estrategia

Usar el runner Playwright y las fixtures locales existentes. Dividir el smoke público, que no requiere Supabase, de los recorridos con sesión real. Reutilizar identidades y datos sintéticos; no duplicar operaciones financieras ni alterar sus aserciones. Cubrir una matriz pequeña de rutas que represente los tres perfiles y los criterios pendientes de las specs 003–005.

La verificación debe dejar resultados legibles y reproducibles sin introducir telemetría al producto. Las capturas son adjuntos identificados, no snapshots dorados. Se usan `@axe-core/playwright@4.13.0` y `web-vitals@6.2.2`, ambas solo para test.

## Inventario y archivos previstos

- Runner/configuración: `playwright.config.ts`; agregar `PUBLIC_SITE_URL` al entorno temporal E2E porque ahora forma parte del esquema obligatorio.
- Pruebas existentes: `src/tests/e2e/smoke.spec.ts` para landing/login sin sesión; recorridos `collector.spec.ts`, `journeys.spec.ts`, `dashboard.spec.ts`, `support.spec.ts` y demás archivos existentes con Supabase local para perfiles autenticados.
- Nueva cobertura: archivos Playwright separados para la matriz responsive/a11y/SEO y para recorridos de sesión si no se pueden sumar sin acoplar responsabilidades a los smoke actuales.
- Dependencias aprobadas e instaladas con versión exacta: `@axe-core/playwright@4.13.0` y `web-vitals@6.2.2`, solo para desarrollo/test.
- Documento operativo: `AGENTS.md`, corregir la cuenta de variables de entorno obligatorias de cinco a seis y registrar la variable pública de origen.
- Evidencia de corrida: adjuntos de Playwright/reportes locales; no se versionan screenshots con datos de sesión.

No editar `.env*`, lógica en `src/modules/**`, Route Handlers, middleware, migraciones, políticas RLS ni datos productivos. No instalar herramientas desde CDN ni usar endpoints de medición externos.

## Secuencia

1. Confirmar rutas, sesiones/fixtures y los comandos exactos para correr smoke aislado y recorridos autenticados. Verificar los scripts que usa CI y conservar `workers: 1`/`fullyParallel: false`.
2. Actualizar `playwright.config.ts` con un origen reservado `PUBLIC_SITE_URL`; corregir el conteo/documentación en `AGENTS.md` sin tocar otros cambios locales.
3. Completar checks de metadata y rastreo contra `/`, `/login`, `/cambiar-contrasena`, robots/sitemap y rutas autenticadas de cada segmento.
4. Añadir captura y aserciones a 360/768/1280 para landing/login y una vista representativa por perfil, usando fixtures sintéticos. Reutilizar smoke checks de overflow y objetivos táctiles donde correspondan.
5. Añadir análisis axe sobre páginas representativas y vincular hallazgos a componentes/rutas; completar checklist manual de teclado, foco, anuncios, contraste, reduced motion y color redundante.
6. Crear una matriz de los cuatro estados por pantalla/componente seleccionado. Probar automáticamente estados que tengan un flujo estable y documentar verificación manual de estados que dependan de APIs reales; no crear mocks que alteren reglas financieras.
7. Añadir medición local de LCP/INP/CLS en landing usando web-vitals desde el harness, activar interacciones controladas y hacer cinco repeticiones sobre build de producción. Guardar valores/condiciones como artefactos; no hacer bloqueantes los targets hasta aprobar baseline estable.
8. Correr la cadena de calidad en orden `AGENTS.md`, después smoke E2E sin sesión y suite E2E con Supabase local/migraciones. La suite completa requiere `npm run db:start` y `npm run db:migrate` según AGENTS.
9. Revisar el diff y los adjuntos, cerrar tasks y `MEMORY.md` con resultados, desviaciones y pasos manuales pendientes. No commitear sin solicitud.

## Verificación

- Unitarias: cadena del repo; Vitest puede necesitar `--pool=threads --maxWorkers=1` en Windows para evitar el `ENOENT` temporal ya observado, sin excluir pruebas.
- E2E smoke aislado: `npx playwright test src/tests/e2e/smoke.spec.ts --project=desktop` y `--project=mobile`.
- E2E con sesión: `npm run db:start`, `npm run db:migrate`, luego `npx playwright test` con `E2E_REQUIRE_SUPABASE=1`; respetar ejecución serial. Actualización 2026-10-19: Supabase local estaba activo, 24 migraciones sincronizadas, y el recorrido completo pasó 79 casos con 1 skip intencional de vitals mobile.
- Capturas: adjuntar ruta, ancho, tema y rol; inspeccionar para overflow, pérdida de controles, texto y datos personales accidentales.
- Métricas: guardar JSON/HTML de cada repetición, navegador/build/viewport/condiciones y mediana/rango; clasificar INP como laboratorio. No reemplazar INP por TBT.
- Auditoría manual: checklist a11y y matriz de estados enlazadas en `docs/frontend/04-MATRIZ-VERIFICACION.md`; sigue pendiente completarla antes del cierre.

## Riesgos y límites

- Playwright por sí solo no detecta toda la conformidad WCAG; axe automatiza parte de las reglas, la revisión manual permanece obligatoria.
- Las capturas dependen de SO, versión del navegador y renderizado; mantenerlas como artefactos de inspección evita una falsa señal de estabilidad entre hosts.
- El INP de una ejecución local con interacciones de prueba es una medida de laboratorio, no el percentil 75 de usuarios reales/CrUX. No añadir RUM ni telemetría en esta spec.
- El runner E2E actual no define `PUBLIC_SITE_URL`; hasta corregirlo, el build del servidor de pruebas falla en instrumentación/metadata.
- Los objetivos LCP/INP se conservan como referencia aprobada, pero un gate CI solo se propone cuando la medición tenga baseline repetible y equipo/entorno definidos.
