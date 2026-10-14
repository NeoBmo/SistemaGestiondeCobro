# ADR 0009 — Cobradores, rutas, jornada de Caja Menor y liquidación

- **Estado:** aceptada
- **Fecha:** 2026-10-13
- **Fuente:** `02-DOMINIO.md` §4 y §5 (abiertos de F5 en `05-PENDIENTES.md`)

## Contexto

F5 introduce al cobrador, sus rutas y asignaciones, la jornada de Caja Menor y la liquidación contra la Caja Mayor. `02` define las entidades pero dejaba abiertos cómo se relacionan los estados de jornada y liquidación, qué pasa al bajar de plan con más de 5 cobradores activos, qué ve un cobrador de un cliente reasignado, en qué caja se corrige un pago de una jornada ya cerrada, quién bloquea a un usuario, cuántas transferencias de fondo admite una jornada, si la Caja Menor puede quedar negativa y cuándo entra el dinero entregado a la Caja Mayor. El dueño del producto lo decidió el 2026-10-13.

## Decisión

- **La liquidación decide la jornada.** El cobrador declara: la jornada pasa a `PENDIENTE_LIQUIDACION` y la liquidación nace `PENDIENTE_REVISION`. El Admin confirma: la liquidación queda `CUADRADA` (diferencia cero) o `CON_DIFERENCIA`, y la jornada `LIQUIDADA` o `LIQUIDADA_CON_DIFERENCIA`. `REVISADA` significa que el Admin resolvió la diferencia con un `AJUSTE` (la liquidación previa nunca cambia: el estado `REVISADA` se deriva de la existencia de ese ajuste vinculado).
- **Bajar de plan se bloquea.** Si el negocio tiene más cobradores `ACTIVO` que el tope del plan destino (5 en el semanal), el cambio se rechaza con 409; nunca se desactiva a nadie automáticamente. Tampoco se activa un sexto cobrador en el plan semanal.
- **Un cliente reasignado deja de existir para el cobrador anterior.** Al cerrarse la asignación pierde acceso al cliente, sus pagos y sus intentos; el historial sigue visible para el Admin y los cobros que ya hizo siguen en su jornada.
- **La corrección de una jornada cerrada va a la Caja Mayor.** Un reverso o ajuste sobre un pago de una jornada `LIQUIDADA` (o `LIQUIDADA_CON_DIFERENCIA`) lo registra el Admin contra la Caja Mayor, vinculado al original; la jornada no se reabre ni cambia. Mientras la jornada siga `ABIERTA` o `PENDIENTE_LIQUIDACION` el reverso afecta su saldo esperado.
- **Desactivar es bloquear.** El Admin pone al cobrador `INACTIVO` y su cuenta queda `BLOQUEADA` (no puede entrar); reactivarlo la desbloquea. Solo se puede desactivar sin jornada `ABIERTA`/`PENDIENTE_LIQUIDACION` ni ruta `ACTIVA` (se cierra la ruta antes, lo que exige reasignar sus clientes).
- **Varias transferencias de fondo por jornada.** El cobrador abre la jornada en cero; el Admin puede transferir fondo una o más veces mientras esté `ABIERTA` (el monto puede ser cero). El fondo operativo recibido es la suma.
- **La Caja Menor no queda negativa.** Un gasto (o reverso de un cobro) que dejaría el saldo esperado de la jornada por debajo de cero se rechaza; el Admin debe transferir más fondo (ADR 0006, misma regla que la Caja Mayor).
- **El dinero entra a la Caja Mayor al confirmar.** Declarar no mueve dinero. Al confirmar el Admin se registra el movimiento `LIQUIDACION` (lo realmente entregado) y, si hay diferencia, `DIFERENCIA_CAJA`, y la jornada queda en cero.

## Forma técnica

- Cobrador, ruta y asignación son tablas append-only con estado derivado de su par de fechas/eventos de cierre, igual que en F3/F4 (ningún hecho se edita).
- Un cobro del cobrador se registra contra su jornada `ABIERTA` en la misma transacción que reduce la deuda (invariante de F5); el Admin sigue cobrando contra la Caja Mayor sin jornada. Las columnas nuevas (jornada, quién recibe) se añaden sin mutar los pagos de F4.
- El cobrador accede por políticas/funciones propias filtradas por su asignación activa y su jornada; el resto de F4 sigue siendo solo para el Admin.

## Consecuencias

- No se reabren jornadas: toda corrección posterior al cierre es un hecho nuevo del Admin en la Caja Mayor.
- La jornada de un día queda ligada a la fecha local del negocio; la regla «no abrir otra jornada si hay una `PENDIENTE_LIQUIDACION` de cualquier día» sigue vigente (02 §5.2).
- Queda abierto (`05-PENDIENTES.md`): si el rol, el negocio o el nombre de usuario de un perfil pueden cambiar (hoy inmutables).
