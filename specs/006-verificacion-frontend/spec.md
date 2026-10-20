# Spec: verificación frontend

## Estado

**Implementada; automatización verificada.** Depende de `specs/003-estados-y-presentacion-financiera`, `specs/004-patrones-responsivos-por-perfil` y `specs/005-seo-y-rendimiento-publico`, ya implementadas. La checklist manual de accesibilidad sigue abierta antes del cierre final.

## Objetivo

Convertir los criterios frontend ya aprobados en evidencia repetible: comportamiento en tres anchos, accesibilidad, estados de UI, rastreo público/privado y métricas de rendimiento. Las verificaciones deben ejecutarse sobre el build de producción y no incorporar telemetría al producto.

## Alcance

- Extender Playwright existente para rutas representativas de landing, login y los perfiles Cobrador, Administrador y Super Admin.
- Cubrir anchos CSS de 360, 768 y 1280 px. Las páginas autenticadas se prueban con datos sintéticos y Supabase local; el smoke público sigue siendo ejecutable por separado.
- Capturar evidencia de cada perfil/ancho en artefactos de prueba, sin guardar datos reales ni depender de screenshots de clientes.
- Auditar accesibilidad de páginas representativas: nombres y etiquetas, teclado/foco, contraste, errores anunciados, movimiento reducido y controles táctiles del Cobrador.
- Revisar los cuatro estados visuales en una matriz de pantallas/componente: carga, vacío, error y éxito. La matriz diferencia cobertura automatizada de verificación manual y no afirma que una ruta cubierta represente todas las demás.
- Comprobar metadata pública, política `noindex`, canonical, Open Graph, `robots.txt` y `sitemap.xml` de la spec 005.
- Medir LCP, INP y CLS en la landing de producción-like, con registro del navegador, build, viewport, interacción y entorno. El informe muestra los objetivos LCP ≤ 2,5 s e INP ≤ 200 ms; CLS se reporta sin umbral aprobado.
- Mantener `PUBLIC_SITE_URL` válida en el entorno del servidor E2E y corregir la documentación que aún cuenta cinco variables obligatorias.

Fuera de alcance: cambios a lógica financiera, módulos de dominio, Route Handlers, middleware, RLS o migraciones; analítica/telemetría de usuarios; tests de carga; presupuestos de CLS inventados; pruebas visuales de todas las combinaciones de las 26 rutas; incorporar una dependencia antes de aprobación.

## Decisiones propuestas

1. Playwright existente será el ejecutor. Mantener las capturas como adjuntos de ejecución identificados por ruta y viewport. No introducir screenshots dorados (`toHaveScreenshot`) en esta entrega: el objetivo inmediato es producir evidencia revisable, sin fragilidad por diferencias del host.
2. Separar pruebas sin sesión de las que requieren sesión real. Playwright debe recibir `PUBLIC_SITE_URL=https://example.invalid` como origen reservado de test. Las pruebas que requieren Supabase local se ejecutan con la configuración E2E existente; su ausencia nunca debe contarse como una corrida completa en verde.
3. Usar `@axe-core/playwright` como devDependency exacta para análisis automatizado. axe complementa, pero no sustituye, la revisión manual ni demuestra por sí solo conformidad WCAG 2.1 AA.
4. Usar `web-vitals` como devDependency exacta, exclusivamente por el harness para obtener LCP, INP y CLS; no se integra con el código de aplicación ni envía datos fuera del proceso. INP se mide tras interacciones de laboratorio y se etiqueta como tal, no como dato de campo/CrUX.
5. Ejecutar las métricas en build de producción, con navegador Chromium fijado por Playwright, viewport móvil/escritorio documentado y cinco corridas. Informar mediana y rango. Los objetivos aprobados se muestran como referencias; no hacen fallar CI hasta tener un baseline estable del runner.
6. Versiones aprobadas e instaladas: `@axe-core/playwright@4.13.0` y `web-vitals@6.2.2`; ambas se limitan al harness de prueba.

## Requisitos funcionales (EARS)

- **RF-01 — Entorno de prueba:** Cuando Playwright inicia el build de la app, entonces define `PUBLIC_SITE_URL` con un origen reservado válido y las seis variables obligatorias del servidor están representadas en la documentación operativa.
- **RF-02 — Viewports por perfil:** Cuando se verifica una ruta incluida a 360, 768 o 1280 CSS px, entonces no hay overflow horizontal de página ni se pierde una acción o dato esencial; los controles principales del Cobrador mantienen objetivo táctil mínimo de 44×44 px.
- **RF-03 — Evidencia visual:** Cuando termina una verificación responsive, entonces el reporte adjunta capturas identificadas por perfil, ruta y ancho, generadas con datos sintéticos y sin credenciales o información real.
- **RF-04 — Accesibilidad:** Cuando se audita una ruta representativa, entonces el análisis automatizado no deja violaciones WCAG 2.1 AA críticas/serias sin resolver y la checklist manual confirma teclado, foco visible, etiquetas, anuncios de error, movimiento reducido y significado no dependiente solo del color.
- **RF-05 — Estados:** Cuando una pantalla/componente incluido consulta o muta datos, entonces la matriz identifica cómo verificar carga, vacío, error y éxito, y cada estado tiene evidencia automatizada o una justificación manual registrada.
- **RF-06 — SEO:** Cuando se verifican landing, autenticación y rutas privadas representativas, entonces canonical/OG/sitemap/robots coinciden con spec 005 y login/cambio de contraseña/áreas privadas exponen `noindex,nofollow` en la metadata efectiva.
- **RF-07 — Métricas de experiencia:** Cuando se mide la landing en build de producción, entonces el reporte registra LCP, INP y CLS, muestra sus condiciones y distingue INP de laboratorio de métricas de campo. Si el navegador no produce una métrica válida, el resultado se marca no disponible, nunca se sustituye por otra bajo el mismo nombre.
- **RF-08 — Privacidad de la verificación:** Cuando se ejecutan pruebas o mediciones, entonces los datos provienen de fixtures sintéticos y ningún resultado se envía a una plataforma de analítica o servicio externo.

## Matriz de rutas propuesta

| Perfil / grupo | Rutas representativas | Sesión | Anchos |
|---|---|---|---|
| Público | `/`, `/login` | No | 360, 768, 1280 |
| Cobrador | `/cobrador`, detalle de cliente/cobro del fixture | Sí, Supabase local | 360, 768, 1280 |
| Administrador | `/negocio`, cartera/clientes y caja | Sí, Supabase local | 360, 768, 1280 |
| Super Admin | `/super-admin`, soporte/monitoreo | Sí, fixture autorizado | 360, 768, 1280 |
| Indexación | landing, `/login`, `/cambiar-contrasena` y una ruta autenticada por segmento | Según ruta | Metadata efectiva |

La matriz final usa rutas comprobadas existentes en `docs/frontend/04-MATRIZ-VERIFICACION.md`. El test por perfil usa solo vistas de lectura; el fixture no crea una jornada ni operaciones financieras.

## Ejecución registrada

- La cadena `format:check`, `typecheck`, `lint`, `npm test -- --pool=threads --maxWorkers=1` (55 archivos/299 pruebas) y `npm run build` terminó en verde.
- Smoke desktop/móvil: 39 pasaron por proyecto. Suite completa: 79 pasaron y 1 se omitió intencionalmente (vitals mobile). Cinco muestras locales de vitals se ejecutaron en Chromium desktop. Reporte HTML y capturas están en `playwright-report/` (ignorado por Git).
- axe y rastreo público pasaron sin hallazgos en landing/login. La metadata de la landing se ajustó a título absoluto para evitar el duplicado `Cuadre · Cuadre`.
- El test autenticado por perfiles pasó en desktop y mobile con Supabase local y datos sintéticos; axe, overflow, objetivo táctil del Cobrador y `noindex` pasaron. La consulta solo lectura confirmó las 24 migraciones sincronizadas; no se aplicaron migraciones.
- La checklist manual AA/responsive sigue abierta en `docs/frontend/04-MATRIZ-VERIFICACION.md`; los targets de LCP/INP todavía no son gates.

## Criterios de aceptación

1. E2E configura `PUBLIC_SITE_URL` y el conteo de variables obligatorias en `AGENTS.md` queda sincronizado con `src/shared/validation/env.ts`.
2. Las pruebas públicas de landing/login recorren los tres anchos y adjuntan capturas; los recorridos con sesión cubren al menos una vista representativa de cada perfil a los mismos anchos.
3. Los test runs con/sin Supabase están separados: el smoke sin sesión se puede ejecutar en aislamiento y una corrida autenticada sin Supabase no se declara exitosa ni silenciosamente omitida.
4. El análisis axe y la checklist manual están aplicados a la matriz representativa; cada hallazgo se corrige o queda ligado a una incidencia documentada y aprobada, nunca se oculta con exclusiones generales.
5. Hay una matriz de estados por ruta/componente que registra cuatro estados y su tipo de evidencia; los estados no aplicables incluyen motivo.
6. Las comprobaciones SEO automáticas validan título/description, canonical absoluta, OG, sitemap solo con `/`, robots sin bloqueo de rutas `noindex` y noindex efectivo en auth y las tres áreas privadas.
7. La medición de rendimiento produce artefactos con cinco muestras y condiciones; informa mediana/rango de LCP, INP y CLS, sin afirmar que una prueba local represente CrUX.
8. Las dos dependencias aprobadas se fijan exactamente y no se importan desde código de producto.
9. La cadena CI de `AGENTS.md` y los comandos E2E de la matriz terminan en verde; los fallos preexistentes se reportan y corrigen en código, nunca se silencian.
10. No se añade telemetría de rendimiento/accesibilidad a producción ni se guardan datos reales en capturas.

## Fuentes técnicas

- Playwright, capturas y variación entre hosts: [visual comparisons](https://playwright.dev/docs/test-snapshots).
- axe para Playwright: [documentación del paquete](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright).
- `web-vitals` mide LCP, INP y CLS con el algoritmo utilizado por herramientas de Google: [GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals).
- INP requiere interacción real; una medición de laboratorio debe identificarse como tal: [web.dev — INP](https://web.dev/articles/inp), [web.dev — medición](https://web.dev/articles/vitals-measurement-getting-started).
