# ADR 0008 — Pagos, reversos, cargos de mora y refinanciación

- **Estado:** aceptada
- **Fecha:** 2026-10-12
- **Fuente:** `02-DOMINIO.md` §3 (abiertos de F4 en `05-PENDIENTES.md`)

## Contexto

F4 registra pagos y cierra el ciclo de la deuda. `02` fija la aplicación cronológica, que un pago normal se aplica a cuotas y que el cargo de mora se paga con un pago explícito contra ese cargo, pero dejaba abiertos qué pasa al reversar un pago cuando hay pagos posteriores, si el tope de un pago incluye la mora y si el saldo refinanciado incluye cargos de mora activos. El dueño del producto lo decidió el 2026-10-12.

## Decisión

- **Reverso solo del último pago.** Un pago se reversa únicamente si es el más reciente no reversado de su préstamo; para reversar uno anterior se reversan antes los posteriores. No hay reaplicaciones: cada reverso restaura exactamente lo que aplicó su pago.
- **Topes separados.** Un pago de cuotas no puede superar el saldo pendiente de las cuotas (no incluye mora); un pago de cargo de mora no puede superar el saldo de ese cargo. No hay saldos a favor. El préstamo está `PAGADO` solo con cuotas y cargos activos en cero.
- **Refinanciación sin mora pendiente.** El saldo refinanciado es solo el saldo pendiente de las cuotas. Si el préstamo tiene cargos de mora `ACTIVO` con saldo, la refinanciación se rechaza hasta que se paguen o se anulen (con motivo).

## Forma técnica

- Todo hecho es de solo agregado; **el estado se deriva**, no se escribe encima:
  - `payments` (monto, tipo `CUOTAS`/`CARGO_MORA`, cargo opcional, movimiento de caja, observación, autor) y `payment_applications` (a qué cuota o cargo fue cada peso).
  - `payment_reversals` (una por pago, con motivo, autor y su movimiento de caja): un pago está `REVERSADO` si tiene reverso; sus aplicaciones **permanecen** y dejan de contar.
  - Saldo de una cuota = valor esperado − aplicaciones de pagos no reversados. Estado de la cuota (`PENDIENTE`/`PARCIAL`/`VENCIDA`/`PAGADA`) y `PAGADO` del préstamo se derivan al leer.
  - `late_fee_charges` y `late_fee_voids`: el cargo lo crea el Admin a mano; su estado (`ACTIVO`/`PAGADO`/`ANULADO`) se deriva de sus pagos y su anulación.
  - `refinancings` enlaza el préstamo anterior con el nuevo; el anterior pasa a `REFINANCIADO` (único estado de préstamo que se escribe además de `ANULADO`) y su deuda queda cancelada sin mover efectivo.
- El pago de un Admin entra a la Caja Mayor como `COBRO` (entrada); su reverso es un `REVERSO` vinculado y, como toda salida de Caja Mayor, no puede dejar el saldo negativo. Los pagos de un cobrador entran a su jornada en F5.
- Todo comando (pago, reverso, cargo, anulación de cargo, refinanciación) pasa por `runCashCommand`: una transacción, bloqueo, idempotencia y auditoría.

## Consecuencias

- Reversar un pago antiguo exige reversar primero todos los posteriores: más pasos para el Admin, pero ninguna aplicación cambia de destino y la auditoría es lineal.
- El reverso de un pago puede rechazarse si la Caja Mayor ya no tiene el dinero (invariante 14); el Admin debe reponerlo antes.
- Anular un contrato (F3) debe comprobar ahora que el préstamo no tiene pagos vigentes (queda en 05 como obligación de F4).
