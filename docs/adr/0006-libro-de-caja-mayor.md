# ADR 0006 — Libro de Caja Mayor: movimientos definitivos, saldo no negativo y forma de los comandos

- **Estado:** aceptada
- **Fecha:** 2026-10-12
- **Fuente:** `02-DOMINIO.md` §5.1, §5.3, §5.4, §9 y `03-ARQUITECTURA.md` §3 (abierto de F2 en `05-PENDIENTES.md`)

## Contexto

F2 construye el libro de Caja Mayor. `02` fijaba que el saldo se deriva de los movimientos y que nada se edita, pero dejaba cuatro puntos sin cerrar: si un movimiento tiene estado, si el saldo puede quedar negativo por algo distinto de un desembolso, cuántos saldos de apertura admite un negocio y cómo se expresan un ajuste y un reverso. El dueño del producto los decidió el 2026-10-12.

## Decisión

- **Los movimientos no tienen estado.** Un movimiento registrado es definitivo y cuenta en el saldo. Se corrige solo con un `AJUSTE` o un `REVERSO` nuevo que lo referencia y lleva motivo.
- **El saldo de Caja Mayor nunca es negativo.** Todo movimiento que lo dejaría por debajo de cero se rechaza (`INSUFFICIENT_FUNDS`, 409). La comprobación y la inserción ocurren bajo el bloqueo consultivo por negocio+caja (`03` §3), así dos salidas simultáneas no pueden pasar ambas.
- **Un solo `SALDO_APERTURA` por negocio.** Lo hace cumplir un índice único parcial en la base, no solo la aplicación. Los ingresos posteriores son `INGRESO_CAPITAL`.
- **`AJUSTE` ±, `REVERSO` total.** Un ajuste lleva dirección explícita (suma o resta) y motivo. Un reverso anula por completo un movimiento propio de F2, una sola vez (índice único sobre el movimiento reversado), con motivo. Los reversos de movimientos que nacen en fases posteriores (cobros, desembolsos) se definen en esas fases.

## Forma técnica

- `cash_boxes`: una por negocio y tipo; en F2 solo la Caja Mayor. Se crea con el negocio (misma transacción de `createBusiness`) y se rellena para los negocios existentes.
- `cash_movements` (solo agregado): `business_id`, `cash_box_id`, `type`, `direction` (`ENTRADA`/`SALIDA`), `amount` `bigint > 0`, `reference_type`/`reference_id` (entidad origen), `reverses_movement_id`, `reason`, `created_by`, `created_at`. Saldo = Σ entradas − Σ salidas de la caja. Nunca se guarda.
- `expenses` (solo agregado): el gasto (categoría, observación, fecha, movimiento asociado) es una entidad separada del movimiento (regla 2).
- `idempotency_keys`: única por (`business_id`, comando, clave) con hash del payload y resultado, según `03` §3.
- Comandos de F2, todos del Admin de negocio (§8: «ajustar caja»): saldo de apertura, ingreso de capital, gasto de Caja Mayor, ajuste, reverso.

## Consecuencias

- Una corrección nunca borra: deja dos movimientos (el original y su reverso/ajuste), ambos en el historial.
- Reversar un ingreso ya gastado se rechaza si dejaría el saldo negativo; hay que registrar antes lo que corresponda.
- Los comandos de F3 en adelante (desembolso, fondo, liquidación) reutilizan el mismo ejecutor de comandos y la misma regla de saldo.
