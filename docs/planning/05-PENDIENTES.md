# 05 — Decisiones pendientes

> Regla de oro: si algo está aquí, **no se decide dentro del código**. Se detiene el trabajo relacionado, se pregunta, y solo entonces se implementa — moviendo la decisión resultante a `02-DOMINIO.md` o `03-ARQUITECTURA.md` y borrándola de esta lista.

La mayoría de las decisiones de V1 ya están cerradas y viven en `02-DOMINIO.md` y `03-ARQUITECTURA.md`. Lo que queda:

## Abierto

- **Precios monetarios reales de los planes** (semanal/mensual/anual): se usan cifras de ejemplo (placeholder) solo para desarrollo — no bloquean F1, pero **no deben pasar a producción** sin reemplazarse por las cifras reales. El campo de precio queda modelado como configurable desde el inicio, precisamente para no tener que tocar esquema cuando llegue el número real.
- **Redacción legal de términos y condiciones, política de protección de datos y conservación.** No bloquea la implementación (F1 solo registra fecha/hora de aceptación), pero debe resolverse antes de operar con datos reales (F8).

## Explícitamente NO pendiente (ya decidido, no volver a abrir)

Reglas de negocio: relación contrato→préstamo (1:1), aplicación cronológica de pagos, cálculo de mora derivado, flujo de refinanciación, categorías de gasto, motivos de intento fallido, matriz de permisos por rol, estados de suscripción (incluido `ARCHIVADA` vs `SUSPENDIDA`), prioridad de tickets (sin SLA), fórmula de proyección de cobros futuros.

Decisiones técnicas: stack (`03-ARQUITECTURA.md`), retención de backups (7 días), moneda (COP sin decimales), formato de identificadores (UUID interno + código legible de contrato), seguridad de Super Admin (mismo flujo Supabase Auth que los demás roles, sin 2FA en V1), umbral de `PROXIMA_A_VENCER` (5 días antes del vencimiento).

Todo esto ya está en `02-DOMINIO.md` / `03-ARQUITECTURA.md` — si Claude Code encuentra ambigüedad en alguno de estos puntos durante la implementación, es que el documento correspondiente quedó incompleto, no que la decisión siga abierta. En ese caso se corrige el documento, no se inventa en el código.
