# Tareas: verificación frontend

Estado: **verificación automatizada completa; checklist manual de accesibilidad pendiente**.

1. [x] **Cerrar aprobación de herramientas.** Aprobadas `@axe-core/playwright@4.13.0` y `web-vitals@6.2.2`, ambas como devDependencies exactas de test.
2. [x] **Alinear entorno del runner.** E2E define `PUBLIC_SITE_URL=https://example.invalid`; `AGENTS.md` refleja seis variables obligatorias y `MONITOR_SECRET` opcional.
3. [x] **Definir matriz de rutas/fixtures.** `docs/frontend/04-MATRIZ-VERIFICACION.md` vincula perfiles, rutas, anchos, datos sintéticos y límites; smoke público separado de sesión real.
4. [x] **Implementar cobertura responsive.** Landing/login y los tres perfiles pasan 360/768/1280 con capturas; pruebas autenticadas usan fixtures sintéticos.
5. [ ] **Cerrar auditoría de accesibilidad.** axe pasa para landing/login y las tres áreas privadas en desktop/mobile. Checks automatizados de teclado, foco, etiquetas, error, reduced motion y 44 px pasan; checklist manual de color redundante/uso visual queda abierta en la matriz.
6. [x] **Registrar los cuatro estados.** Matriz creada con evidencia automatizada existente, verificación manual requerida y casos no aplicables justificados.
7. [x] **Automatizar SEO/rastreo.** E2E valida metadata pública, canonical/OG, `robots.txt`, `sitemap.xml`, `noindex` de autenticación y de las tres áreas privadas.
8. [x] **Medir rendimiento de landing.** Harness adjunta cinco muestras y condiciones para LCP/INP/CLS; INP queda etiquetado como laboratorio y no hay gates.
9. [x] **Cerrar verificación automatizada.** Reporte registrado: formato, tipos, lint, suite unitaria (55 suites/299 pruebas), build y E2E completo pasan. Playwright reportó 79 pasaron y 1 omitido (vitals mobile por diseño); no se reejecutaron en esta continuación.
10. [ ] **Revisar y cerrar.** Diff y `MEMORY.md` revisados. No cerrar la spec ni convertir targets de rendimiento en gates hasta completar la checklist manual de accesibilidad.
