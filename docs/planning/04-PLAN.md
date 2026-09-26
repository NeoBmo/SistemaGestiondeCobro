# 04 — Plan de implementación

Se construye de adentro hacia afuera: **seguridad y datos → reglas financieras → operación de cobranza → visualización y soporte → endurecimiento y lanzamiento.** No se empieza por el dashboard ni por una UI completa.

Reglas de ejecución:

- Una fase solo avanza si sus criterios de aceptación y pruebas pasan.
- Los cambios de esquema se hacen mediante migraciones versionadas, nunca manualmente en producción.
- Un comando financiero debe ser atómico, auditado e idempotente **antes** de exponerlo en UI.
- No se agregan dependencias ni funcionalidades fuera de este plan sin una decisión explícita registrada.

## Dependencias entre fases

```text
F0 Fundación técnica
 └─ F1 Identidad, negocios y suscripciones
     └─ F2 Libro de caja y auditoría
         └─ F3 Cartera: clientes, contratos, préstamos, cuotas
             └─ F4 Pagos, mora y refinanciación
                 └─ F5 Cobradores, rutas, gastos y liquidación
                     └─ F6 Dashboards y operación administrativa
                         └─ F7 Super Admin, soporte y monitoreo
                             └─ F8 Seguridad final y lanzamiento
```

---

## F0 — Fundación técnica

**Objetivo:** proyecto reproducible, entornos separados, calidad automática, estructura modular. Sin funciones de negocio visibles.

Trabajo: Next.js + TS estricto + Tailwind + ESLint/Prettier · estructura por módulos (`03-ARQUITECTURA.md` §2) · variables de entorno validadas al iniciar · proyectos Supabase separados (dev/preview/prod) · CI con typecheck/lint/test/build · Vitest + Playwright configurados · layouts vacíos por área · convenciones de errores, comandos, fechas, dinero e IDs.

Convenciones concretas ya definidas:

- Scripts: `typecheck`, `format`, `format:check`, `test`, `test:watch`, `test:e2e`.
- `src/shared/errors/app-error.ts` — `AppError { code, message, status }`.
- `src/shared/types/command-result.ts` — `{ ok: true, data } | { ok: false, error: { code, message } }`.
- `src/shared/money/money.ts` — enteros en unidad mínima, `formatMoney`/`parseMoneyInput`.
- `src/shared/dates/dates.ts` — helpers UTC.
- `src/shared/ids/idempotency-key.ts` — tipo + validación UUID.
- Supabase: `supabase-browser.ts`, `supabase-server.ts` (cookies), `supabase-admin.ts` (service role, solo server-side, sin middleware de auth aún).
- Rutas mínimas: `/`, `/login` (placeholder), `/super-admin`, `/negocio`, `/cobrador`, `/api/health`.

**Criterios de aceptación:** una persona nueva levanta el proyecto con la documentación del repo · ninguna clave secreta en código ni expuesta al navegador · un cambio genera preview antes de producción · typecheck/lint/test obligatorios para integrar.

---

## F1 — Identidad, negocios y suscripciones

**Objetivo:** aislamiento multi-negocio y acceso por rol antes de crear datos financieros.

Datos/seguridad: entidades `usuario`, `negocio`, `suscripción`, `plan`, `evento_auditoría` · `business_id` en toda entidad que pertenezca a un negocio · Supabase Auth + perfiles internos (sin 2FA en V1, mismo flujo para todos los roles incluido Super Admin) · roles Super Admin/Admin/Cobrador · RLS inicial por negocio y rol · utilidades de servidor para sesión/rol/negocio · auditoría de creación de negocio, cambio de plan, activación/suspensión/archivado · job o chequeo que marca `PROXIMA_A_VENCER` 5 días antes del vencimiento.

Interfaz: landing con planes e inicio de sesión · login/logout y cambio obligatorio de contraseña temporal · panel Super Admin para crear negocio · formulario de negocio (responsable, identificación, teléfono, plan con precio placeholder configurable, cuenta admin inicial) · lista de negocios filtrable · activación/suspensión/archivado/cambio de plan con observación.

**Pruebas críticas:** Super Admin crea negocio + cuenta admin inicial · un admin solo entra a su propio negocio · un usuario no lee/altera datos de otro negocio · suspender bloquea, activar restablece · plan semanal no permite un sexto cobrador activo.

**Criterio de salida:** negocios aislados, autenticados, con suscripción controlada manualmente — sin cartera todavía.

---

## F2 — Libro de caja y auditoría financiera

**Objetivo:** fundamento contable antes de préstamos o cobros.

Trabajo: `caja_mayor`, `movimiento_caja`, soporte `ajuste`/`reverso` · saldo de apertura e ingreso de capital · gastos directos de Caja Mayor · tipos de movimiento, referencias a entidad origen, claves de idempotencia · servicio transaccional de movimientos · auditoría automática por comando · UI administrativa de Caja Mayor (saldo derivado, historial, registro).

**Pruebas críticas:** saldo de apertura/ingreso calculan correctamente · gasto directo reduce Caja Mayor y audita · reintentar el mismo comando no duplica dinero · usuario no autorizado no registra movimientos.

**Criterio de salida:** control de efectivo del negocio con historial confiable de Caja Mayor.

---

## F3 — Cartera: clientes, contratos, préstamos y cuotas

**Objetivo:** registrar y consultar cartera, sin pagos todavía.

Dominio: `cliente`, `contrato`, `préstamo`, `cuota` con sus estados · edición de contacto auditada · borrador/confirmación inmutable · cálculo de interés/total/redondeo/calendario · movimiento de desembolso al confirmar (bloqueado si Caja Mayor no alcanza) · anulación segura de contrato/préstamo · importación de cartera previa sin pagos ni movimientos históricos.

Interfaz: lista de clientes con búsqueda · ficha de cliente · flujo de contrato (cliente existente/nuevo, condiciones, vista previa de cálculo, confirmación) · detalle de préstamo y calendario · flujo de importación.

**Pruebas críticas:** $1.000.000 al 20 % → total $1.200.000 · suma de cuotas = total exacto · contrato confirmado crea exactamente un préstamo y no se edita · desembolso reduce Caja Mayor una sola vez · importado no altera Caja Mayor ni inventa pagos · un cliente con varios préstamos activos funciona.

**Criterio de salida:** cartera nueva e importada registrada, con saldos programados entendibles, sin pagos aún.

---

## F4 — Pagos, mora y refinanciación

**Objetivo:** ciclo de deuda completo y seguro.

Dominio: `pago`, `aplicación_pago`, `cargo_mora`, `refinanciación` · aplicación automática cronológica · pagos parciales/anticipados/cierre · rechazo de pago superior al saldo · mora derivada por cuota · creación/pago/anulación de cargo de mora · reversión de pago auditada · refinanciación completa (nuevo contrato/préstamo, liquidación interna, desembolso adicional opcional) · movimientos de caja correspondientes.

Interfaz: registro de pago con aplicación explicable · detalle de cuota (esperado/aplicado/pendiente/mora) · cargo manual de mora · flujo de refinanciación con vista previa.

**Pruebas críticas:** pago parcial deja saldo en la cuota original, sin tocar la última · pago superior cubre cuotas en orden cronológico sin crear saldo a favor · préstamo pasa a pagado solo con cuotas y mora activa en cero · reverso restaura cuotas y cajas sin borrar el pago original · mora se calcula por fecha/saldo, nunca automática en dinero · refinanciación no edita el préstamo anterior.

**Criterio de salida:** la cartera cobra, muestra mora, cierra deudas y refinancia preservando todos los hechos.

---

## F5 — Cobradores, rutas, Caja Menor y liquidación

**Objetivo:** cobranza cotidiana desde el perfil operativo y cierre correcto del efectivo diario.

Dominio: `cobrador`, `ruta`, `asignación_cliente`, `evento_cobro`, `jornada_caja_menor`, `gasto`, `liquidación` · creación/activación de cobradores y cuentas · límite de 5 cobradores para plan semanal · una ruta activa por cobrador, una asignación activa por cliente · reasignación con cierre de historial · apertura de jornada, fondo operativo, saldo esperado · pago de cobrador contra su jornada · gastos y ajustes auditados · intento fallido / volver a cobrar · declaración, confirmación y diferencia de liquidación.

Interfaz: admin — gestión de cobradores/rutas/asignaciones/fondos · cobrador — mobile-first, meta diaria, Caja Menor, lista priorizada, detalle de cliente · llamada/WhatsApp/mapas por enlaces profundos · formulario rápido de pago/intento/reintento/gasto · admin — revisión y confirmación de liquidación.

**Pruebas críticas:** un cobrador no ve clientes ni jornadas ajenas · un cliente no tiene dos asignaciones activas · un cobrador no tiene dos rutas activas ni dos jornadas abiertas el mismo día · un cobro aumenta Caja Menor y reduce deuda en la misma transacción · un gasto reduce el saldo esperado · liquidación cuadrada devuelve efectivo a Caja Mayor y cierra en cero · diferencia se registra, no desaparece, exige revisión.

**Criterio de salida:** un cobrador completa una jornada real de principio a fin.

---

## F6 — Dashboard y operación administrativa

**Objetivo:** convertir datos confiables en información de decisión, sin reglas nuevas.

Trabajo: consultas/vistas de lectura para saldos, cartera, mora, cajas, rendimiento · prioridad de clientes (mora activa máxima, saldo vencido, vencimiento más antiguo) · historial de comportamiento sin scoring · dashboard predefinido (semanal) y configurable (mensual/anual) · filtros de cartera · alertas de vencido/caja pendiente/diferencia/suscripción · garantía de que ningún dashboard escribe balances.

**Pruebas críticas:** prioridad coincide con detalle real de cuotas/mora · dashboard y Caja Mayor consistentes con movimientos · usuario semanal no modifica dashboard · usuarios mensual/anual solo configuran presentación.

**Criterio de salida:** el administrador dirige su negocio con datos confiables y filtrables.

---

## F7 — Super Admin, soporte y monitoreo

**Objetivo:** completar capacidades de plataforma y su supervisión.

Trabajo: panel Super Admin completo (negocios, plan, vencimiento, estado, límite de cobradores) · tickets (creación, estados, prioridad alta/media/baja sin SLA de tiempo, respuesta) · registros de error centralizados + chequeo de disponibilidad · indicadores en Super Admin (disponibilidad, latencia, último backup con retención de 7 días, errores, tickets abiertos por prioridad) · alertas de suscripción sin suspensión automática · auditoría de cambios de negocio y soporte.

**Pruebas críticas:** un admin crea un ticket visible solo para su negocio · Super Admin lo gestiona y conserva historial · una interrupción se refleja en el canal de monitoreo · vencimiento genera alerta, no suspensión automática.

**Criterio de salida:** operación de negocios, soporte y salud básica desde un solo lugar.

---

## F8 — Endurecimiento, prueba real y lanzamiento

**Objetivo:** V1 segura y verificable para datos reales.

Trabajo: revisión de RLS/permisos/rutas protegidas · pruebas de aislamiento entre negocios y acceso de cobrador · comandos financieros bajo reintentos/doble envío/errores de red · formato de dinero/fechas/zona horaria · backups verificados con restauración ensayada en entorno separado · flujos completos con datos ficticios · accesibilidad (teclado, foco, contraste, errores) · índices a partir de datos representativos · dominio/variables/logs/alertas de producción · guía de operación por rol.

**E2E de lanzamiento:** crear negocio semanal/mensual/anual · crear admin/cobrador/cliente/contrato · desembolsar préstamo · pago parcial + pago posterior + gasto + liquidación · intento fallido + reintento · refinanciar un préstamo activo · suspender/reactivar negocio · confirmar aislamiento total entre negocios · verificar dashboard/auditoría/caja contra movimientos reales · restaurar copia de prueba y validar consistencia.

**Criterio de salida:** la aplicación maneja una jornada completa de un negocio de prueba sin inconsistencias de acceso, deuda, efectivo, historial ni liquidación.

---

## Trabajo transversal en todas las fases

| Disciplina | Regla continua |
| --- | --- |
| Seguridad | Revisar rol, negocio y propiedad del recurso en cada comando |
| Auditoría | Crear evento para cada acción financiera o administrativa relevante |
| Pruebas | Se añaden junto al caso de negocio, no al final |
| UX | Cada flujo se diseña para el perfil y dispositivo que lo usa |
| Rendimiento | Medir consultas reales; indexar por negocio, estado, fecha, relaciones usadas |
| Documentación | Si una decisión funcional cambia, se actualiza el documento correspondiente antes de programarla |
| Despliegue | Toda migración pasa por local → preview → producción con respaldo verificado |

## Criterio general de "terminado"

Una funcionalidad está terminada solo si: respeta el modelo de dominio y los permisos · tiene validación de entrada y manejo de errores · conserva auditoría cuando corresponde · no rompe el aislamiento por negocio · tiene pruebas acordes al riesgo · funciona en móvil cuando pertenece al cobrador · presenta estados de carga/vacío/error/éxito · está documentada y desplegada en preview antes de producción.
