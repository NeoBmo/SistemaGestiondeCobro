# ADR 0010 — Dashboard, alertas y cartera filtrable

- **Estado:** aceptada
- **Fecha:** 2026-10-15
- **Fuente:** `02-DOMINIO.md` §7 y §8, `01-CONTEXTO.md` (planes)

## Contexto

F6 convierte los datos de F1–F5 en información de decisión sin reglas de negocio nuevas. `02` dice que el dashboard son «agregados» y que los planes mensual y anual lo tienen «configurable» (el semanal, predeterminado), pero no define qué indicadores trae, qué se puede configurar ni qué alertas muestra. El dueño del producto lo decidió el 2026-10-15.

## Decisión

- **Indicadores del dashboard predeterminado (núcleo operativo).** Saldo de la Caja Mayor; cartera pendiente (saldo de las cuotas de los préstamos `ACTIVO`); cartera vencida y número de clientes en mora; cobrado del periodo; gastos del periodo; jornadas pendientes de liquidar y diferencias sin resolver; proyección de cobros de los próximos 7 días (cuotas pendientes por fecha de vencimiento futura, sin mora).
- **«Configurable» = widgets y periodo.** En los planes mensual y anual el Admin elige qué indicadores ver, su orden y el periodo (7 días, 30 días, mes calendario o año calendario). Es solo presentación: se guarda por negocio, nunca escribe balances ni altera datos. El plan semanal ve el dashboard predeterminado (periodo de 7 días) y no lo modifica.
- **Alertas** (siempre derivadas al leer, nunca guardadas): cartera vencida, jornadas pendientes de liquidar, diferencias de liquidación sin resolver y suscripción próxima a vencer.
- **Periodo.** Termina «hoy» en la zona horaria del negocio e incluye ese día; los importes del periodo se agrupan por la fecha local del hecho. El cobrado es neto de reversos y los gastos incluyen los de Caja Mayor y los de los cobradores, netos de reversos.
- **Prioridad de clientes** (02 §7): mayor mora activa, mayor saldo vencido, vencimiento más antiguo; es la misma regla que ya usa el cobrador. **Historial de comportamiento** sin puntaje: cuotas pagadas a tiempo y tardías, días de mora actuales, saldo vencido y refinanciaciones.
- **Cartera filtrable** para el Admin: por cobrador, por ruta, por estado (al día, en mora, sin préstamo activo) y por texto (nombre o identificación), ordenada por prioridad.

## Forma técnica

- Las consultas son de solo lectura sobre los hechos existentes; ningún dashboard escribe balances. La única escritura es la configuración de presentación (`dashboard_settings`), con el comando de un Admin de plan mensual o anual.
- Los agregados se miden con un seed de volumen realista y se añaden índices solo donde las consultas lo necesiten.

## Consecuencias

- Un indicador nuevo o una alerta nueva se añaden sin migración de datos: solo código de lectura.
- Si un negocio baja de mensual/anual a semanal, su configuración se conserva pero el dashboard se muestra en su forma predeterminada.
