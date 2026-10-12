# ADR 0007 — Calendario de cuotas, redondeo, contratos en un paso y clientes únicos

- **Estado:** aceptada
- **Fecha:** 2026-10-12
- **Fuente:** `02-DOMINIO.md` §2.1–2.4 (abiertos de F3 que el dominio no cerraba)

## Contexto

F3 genera el calendario de cuotas y registra clientes y contratos. `02` fija el cálculo del interés y que «el único ajuste de redondeo va en la última cuota», pero no decía cómo se calculan las fechas, cuánto vale cada cuota cuando el total no se divide exacto, si se guardan contratos en `BORRADOR` ni si la identificación de un cliente es única. El dueño del producto lo decidió el 2026-10-12.

## Decisión

- **Fechas en calendario corrido** a partir de la primera fecha de cobro: `DIARIA` cada día calendario (incluye domingos y festivos), `SEMANAL` +7 días, `MENSUAL` el mismo día del mes con ajuste a fin de mes (`addMonthsClamped`, calculado siempre desde la primera fecha para que un 31 no «arrastre» el día 28 a los meses siguientes). No hay lógica de festivos ni días hábiles.
- **Valor de las cuotas:** las cuotas 1..n−1 valen `piso(total / n)` y la última, `total − suma de las anteriores` (puede ser algo mayor). Nunca se cobra de más antes de la última cuota y la suma es exactamente el total.
- **Un solo paso con vista previa.** La pantalla pide al servidor una vista previa (principal, interés, total, cuotas y fechas) que no guarda nada; al confirmar se crean, en una sola transacción, el contrato `CONFIRMADO` con su número, el préstamo, las cuotas y el desembolso de Caja Mayor. El estado `BORRADOR` sigue definido en el dominio pero **no se construye** en V1 (no hay tabla de condiciones editables ni descarte de borradores).
- **Identificación única por negocio.** Dos clientes del mismo negocio no comparten identificación; el mismo documento sí puede existir en otro negocio. Lo impone un índice único `(business_id, identification)`.

## Límites técnicos (no son reglas de negocio)

Para mantener los importes dentro de los enteros seguros (regla 8) y evitar calendarios absurdos: principal ≤ 10¹² pesos, interés ≤ 1.000.000 bps (10.000 %), entre 1 y 1.000 cuotas, y no más cuotas que pesos por pagar (una cuota nunca vale cero). Con el piso, la última cuota puede superar a las demás hasta en n−1 pesos (p. ej. total 1.999 en 1.000 cuotas: 999 de $1 y una de $1.000); es una consecuencia de la regla elegida y el dueño puede acotarla si lo desea.

## Consecuencias

- El cálculo del calendario es una función pura sin acceso a la base de datos, probada con los ejemplos de `02` (1.000.000 al 20 % en 12 cuotas) y con totales que no se dividen exactos.
- Si más adelante el operador necesita saltar domingos o festivos, cambia la función de fechas y no el esquema: el calendario ya queda guardado cuota por cuota al confirmar y no se recalcula nunca.
- Agregar borradores después no rompe nada: sería una tabla nueva de condiciones y un paso previo a la confirmación.
