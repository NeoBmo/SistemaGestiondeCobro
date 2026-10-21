# Matriz de verificación frontend

Estado: **vigente para la spec 006**. Distingue cobertura automática de revisión manual; una celda sin evidencia automatizada no se considera verificada por inferencia.

## Rutas, perfil y artefactos

| Grupo / ruta | Sesión | 360 / 768 / 1280 | Evidencia automatizada | Límite |
| --- | --- | --- | --- | --- |
| Landing `/` | No | Sí | Smoke, overflow, captura, axe, title/description/canonical/OG, vitals (5 muestras desktop) | El resultado INP es de laboratorio. |
| Login `/login` | No | Sí | Smoke, overflow, captura, axe, teclado, foco, error anunciado, controles 44 px, `noindex` | No verifica credenciales reales. |
| Cambio de contraseña `/cambiar-contrasena` | No, formulario protegido por flujo de autenticación | No | `noindex` de metadata efectiva | Estado de éxito requiere sesión local y queda fuera del smoke. |
| Cobrador `/cobrador` | Sí, Supabase local | Sí | **Pasó**: captura, overflow, acción táctil principal, axe, `noindex` | Fixture sintético sin jornada ni deuda; E2E 2026-10-19, desktop y mobile. |
| Administrador `/negocio` | Sí, Supabase local | Sí | **Pasó**: captura, overflow, axe, `noindex` | Datos iniciales vacíos de negocio; no representa cada widget configurable; E2E 2026-10-19, desktop y mobile. |
| Super Admin `/super-admin` | Sí, Supabase local | Sí | **Pasó**: captura, overflow, axe, `noindex` | Lista con negocio fixture; E2E 2026-10-19, desktop y mobile. |

Capturas y JSON de vitals se adjuntan al reporte Playwright; no se versionan. Configuración serial (`workers: 1`, `fullyParallel: false`) conserva la seguridad de la base compartida. Corrida completa 2026-10-19: 79 pasaron y 1 se omitió, la medición vitals en mobile, intencionalmente limitada a Chromium desktop.

## Estados de interfaz

| Pantalla / componente | Carga | Vacío | Error | Éxito | Evidencia / acción |
| --- | --- | --- | --- | --- | --- |
| Login | Botón “Ingresando…” y deshabilitado | No aplica | Error con foco/anuncio, smoke | Redirección autenticada; no automatizada sin Supabase | `src/tests/e2e/smoke.spec.ts`; éxito autenticado en `journeys.spec.ts`. |
| Formularios de comando compartidos | Botón ocupado mientras espera | No aplica | Alert con foco; errores de campo | Anuncio del resultado | Revisión estática de `src/app/negocio/_components/command-form.tsx`; escenarios financieros E2E en `cash`, `collections` y `payments`. |
| Landing | No consulta datos | No aplica | No aplica | Contenido público servido | Smoke público y axe. |
| Cartera / clientes | Indicador o estado pendiente a revisar manualmente | Mensaje sin registros cuando no hay filas | Error de segmento cuando falla la consulta | Lista/operación finalizada | `portfolio.spec.ts` prueba creación y lectura; estados de transporte se revisan manualmente en la ruta. |
| Inicio de Cobrador | Carga de ruta a revisar manualmente | Sin jornada ofrece abrir; lista vacía depende de fixture | `cobrador/error.tsx` | Jornada/cobro reportan confirmación | `collector.spec.ts` recorre apertura, cobro y entrega con Supabase local. |
| Caja Mayor | Botones ocupados durante comandos | Sin movimientos según contenido | Alert de error | Feedback de operación | `journeys.spec.ts` cubre apertura, ingreso, gasto, reverso y saldo. |
| Monitoreo Super Admin | Sección de error diferenciada | “Sin errores registrados” | Alerta si hay interrupción | Datos operativos al responder la consulta | Revisión estática en `src/app/super-admin/monitoreo/page.tsx`; fixture no crea errores de infraestructura. |

### Criterio de registro

- **Automatizada:** hay una aserción Playwright/Vitest estable para el estado indicado.
- **Manual:** se revisa en la ejecución y se registra el resultado junto con ruta, viewport y tema.
- **No aplica:** el estado no tiene significado en esa pantalla; debe justificarse como arriba.
- Al completar futuras pruebas de estado, enlazar la aserción concreta en esta tabla. No usar “la pantalla funciona” como cobertura de sus cuatro estados.

## Checklist manual AA / responsive

- [ ] Navegación completa por teclado; foco visible, orden lógico y retorno de foco en diálogos.
- [ ] Errores y éxitos anunciados por tecnología asistiva; ayudas asociadas a campos.
- [ ] Mora, pago y diferencias incluyen texto o icono además del color.
- [ ] Revisar contraste de superficies, controles, foco y estados en tema claro y oscuro.
- [ ] Con `prefers-reduced-motion`, quitar desplazamientos y reducir transiciones.
- [ ] Inspeccionar capturas 360, 768 y 1280 px por perfil; no solo ausencia de overflow.
- [ ] Confirmar en Cobrador objetivos táctiles de al menos 44×44 px y uso con una mano.
- [ ] Inspeccionar tablas densas de Administrador/Super Admin y su alternativa usable en móvil.

La automatización axe no sustituye esta revisión y no certifica por sí sola WCAG 2.1 AA.
