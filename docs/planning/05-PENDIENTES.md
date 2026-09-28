# 05 — Decisiones pendientes

> Regla de oro: si algo está aquí, **no se decide dentro del código**. Se detiene el trabajo relacionado, se pregunta, y solo entonces se implementa — moviendo la decisión resultante a `02-DOMINIO.md` o `03-ARQUITECTURA.md` y borrándola de esta lista.

La mayoría de las decisiones de V1 ya están cerradas y viven en `02-DOMINIO.md` y `03-ARQUITECTURA.md`. Lo que queda:

## Abierto

- **Precios monetarios reales de los planes** (semanal/mensual/anual): se usan cifras de ejemplo (placeholder) solo para desarrollo — no bloquean F1, pero **no deben pasar a producción** sin reemplazarse por las cifras reales. El campo de precio queda modelado como configurable desde el inicio, precisamente para no tener que tocar esquema cuando llegue el número real.
- **Redacción legal de términos y condiciones, política de protección de datos y conservación.** No bloquea F1–F2 (F1 solo registra fecha/hora de aceptación). La política de protección de datos personales debe resolverse antes de F3 (primera PII); los términos y condiciones, antes de operar con datos reales (F8).

## Abiertos por fase (no bloquean fases anteriores; resolver **antes** de iniciar la fase indicada)

| Tema | Bloquea |
| --- | --- |
| Solapamiento de estados entre `Negocio.estado_acceso` y `Suscripción.estado` (¿una sola máquina de estados o dos con reglas de sincronía?) | F1 |
| Estado del `movimiento_caja`: ¿hay estados o todo movimiento registrado es definitivo? (02 §5.3 habla de «movimientos confirmados») | F2 |
| Política de protección de datos personales y conservación (cédulas, teléfonos, direcciones) | Antes de F3 |
| Reverso de pago cuando existen pagos posteriores: ¿se reaplican en orden o se bloquea el reverso? | F4 |
| Reverso o ajuste que impacta una jornada ya `LIQUIDADA`: ¿en qué caja se registra el movimiento? | F4 |
| Orden de aplicación entre cuotas y cargos de mora; ¿el tope de un pago incluye el saldo de mora? | F4 |
| ¿El saldo refinanciado incluye cargos de mora activos (y por tanto genera interés)? | F4 |
| Bajar de plan con más de 5 cobradores activos (¿se bloquea el cambio o se desactivan cobradores?) | F5 |
| Estados de `Jornada` vs `Liquidación` (`LIQUIDADA` vs `CUADRADA`, significado exacto de `REVISADA`) | F5 |
| Visibilidad del cobrador sobre historial (pagos/intentos) de clientes que le fueron reasignados a otro | F5 |
| Metas no funcionales: volumen esperado por negocio, dispositivos/navegadores objetivo, presupuesto por entorno (requiere cifras del dueño del producto) | F8 |
| Riesgos aceptados a revisar antes de operar con datos reales: retención de 7 días sin recuperación punto-en-el-tiempo, ausencia de 2FA en Super Admin/Admin, operación sin conexión de cobradores | F8 |

## Explícitamente NO pendiente (ya decidido, no volver a abrir)

Reglas de negocio: relación contrato→préstamo (1:1), aplicación cronológica de pagos, cálculo de mora derivado, flujo de refinanciación, categorías de gasto, motivos de intento fallido, matriz de permisos por rol, estados de suscripción (incluido `ARCHIVADA` vs `SUSPENDIDA`), prioridad de tickets (sin SLA), fórmula de proyección de cobros futuros.

Decisiones técnicas: stack (`03-ARQUITECTURA.md`), retención de backups (7 días), moneda (COP sin decimales), formato de identificadores (UUID interno + código legible de contrato asignado al confirmar), seguridad de Super Admin (mismo flujo Supabase Auth que los demás roles, sin 2FA en V1), umbral de `PROXIMA_A_VENCER` (5 días antes del vencimiento), transacciones con `pg` directo (ADR 0001), 1 usuario = 1 negocio con email sintético (ADR 0002), interés en puntos básicos con redondeo half-up, jornada bloqueante sin cobros ni gastos fuera de una jornada `ABIERTA` (02 §5.2, invariante 13).

Todo esto ya está en `02-DOMINIO.md` / `03-ARQUITECTURA.md` — si Claude Code encuentra ambigüedad en alguno de estos puntos durante la implementación, es que el documento correspondiente quedó incompleto, no que la decisión siga abierta. En ese caso se corrige el documento, no se inventa en el código.
