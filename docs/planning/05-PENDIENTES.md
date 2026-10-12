# 05 — Decisiones pendientes

> Regla de oro: si algo está aquí, **no se decide dentro del código**. Se detiene el trabajo relacionado, se pregunta, y solo entonces se implementa — moviendo la decisión resultante a `02-DOMINIO.md` o `03-ARQUITECTURA.md` y borrándola de esta lista.

La mayoría de las decisiones de V1 ya están cerradas y viven en `02-DOMINIO.md` y `03-ARQUITECTURA.md`. Lo que queda:

## Abierto

- **Precios monetarios reales de los planes** (semanal/mensual/anual): se usan cifras de ejemplo (placeholder) solo para desarrollo — no bloquean F1, pero **no deben pasar a producción** sin reemplazarse por las cifras reales. El campo de precio queda modelado como configurable desde el inicio, precisamente para no tener que tocar esquema cuando llegue el número real.
- **Redacción legal de términos y condiciones, política de protección de datos y conservación.** No bloquea F1–F2 (F1 solo registra fecha/hora de aceptación). El dueño confirmó el 2026-10-12 haber cumplido el gate previo a F3 (revisión de 02 con un operador real y política de datos personales); **la política escrita no está en el repositorio** — debe incorporarse a `docs/` cuando exista. Los términos y condiciones, antes de operar con datos reales (F8).

## Abiertos por fase (no bloquean fases anteriores; resolver **antes** de iniciar la fase indicada)

| Tema | Bloquea |
| --- | --- |
| Verificar que Supabase Auth (alojado) acepta el dominio del email sintético (ADR 0002): puede validar dominios/MX | F1 |
| Reverso de pago cuando existen pagos posteriores: ¿se reaplican en orden o se bloquea el reverso? | F4 |
| Reverso o ajuste que impacta una jornada ya `LIQUIDADA`: ¿en qué caja se registra el movimiento? | F4 |
| Orden de aplicación entre cuotas y cargos de mora; ¿el tope de un pago incluye el saldo de mora? | F4 |
| ¿El saldo refinanciado incluye cargos de mora activos (y por tanto genera interés)? | F4 |
| Bajar de plan con más de 5 cobradores activos (¿se bloquea el cambio o se desactivan cobradores?) | F5 |
| Estados de `Jornada` vs `Liquidación` (`LIQUIDADA` vs `CUADRADA`, significado exacto de `REVISADA`) | F5 |
| Visibilidad del cobrador sobre historial (pagos/intentos) de clientes que le fueron reasignados a otro | F5 |
| Metas no funcionales: volumen esperado por negocio, dispositivos/navegadores objetivo, presupuesto por entorno (requiere cifras del dueño del producto) | F8 |
| Riesgos aceptados a revisar antes de operar con datos reales: retención de 7 días sin recuperación punto-en-el-tiempo, ausencia de 2FA en Super Admin/Admin, operación sin conexión de cobradores | F8 |
| Límite de intentos de login por usuario e IP en la aplicación (Auth ve la IP del servidor de Next: su límite de 30 intentos por 5 min es global y bastaría para bloquear el login de todos) y, si se quiere, bloqueo temporal o CAPTCHA | F8 (antes de datos reales) |
| Auditar intentos de login fallidos o denegados (02 §1.4 solo lista `InicioSesion` como evento) | F8 |
| ¿Puede cambiar el rol, el negocio o el nombre de usuario de un perfil? (hoy inmutables por trigger; un cambio de rol exigiría refrescar el JWT) | F5 |
| `scripts/create-super-admin.mjs` es la única vía para crear un Super Admin y no queda registro de quién lo ejecutó (persona de confianza con `.env.local`/service role); revisar antes de operar con datos reales si se necesita más control (motivo, actor del sistema operativo, límite de uso) | F8 |
| **Supuestos de F1-T4 por confirmar** (el código los aplica; 02 §1.3 no los define): cambiar de plan se permite con la suscripción `ACTIVA` o `SUSPENDIDA` (no `ARCHIVADA`) y no cambia su estado; elegir el mismo plan reinicia el período y sirve de renovación (hoy no existe un flujo de renovación propio); la observación es opcional salvo el motivo de archivado y la nueva sustituye a la anterior en `subscriptions.note` (el historial queda en la auditoría); activar no comprueba el vencimiento (`VENCIDA` es informativa) | Confirmar antes de F8 |
| La deduplicación de eventos `RECHAZADO` (uno por actor, acción y entidad por minuto) lee y luego inserta sin bloqueo: dos rechazos simultáneos pueden dejar dos eventos | F8 (junto al límite de frecuencia) |
| **Reverso de un gasto de Caja Mayor** (F2-T3): se permite (decisión del 2026-10-12: el reverso anula cualquier movimiento propio de F2), pero 02 §5.4 dice que corregir un gasto genera un `AJUSTE` y la fila de `expenses` queda viva aunque su movimiento esté reversado. ¿Se mantiene el reverso total de gastos? Todo reporte de gastos (F6) debe excluir los gastos cuyo movimiento esté reversado | F6 (reportes de gastos) |
| Reversar el `SALDO_APERTURA` anula la entrada pero el índice único impide registrar otro: ¿se acepta (corregir con ingreso o ajuste) o la apertura reversada debe liberar el cupo? | Antes de F8 |
| **Esquema de cartera (F3-T2)**: (a) no se puede borrar ningún cliente, aunque 02 §2.1 solo lo prohíbe con historial financiero: ¿se permite borrar uno creado por error y sin contratos? (b) `interest_bps` y `installment_count` no tienen tope en la base (los topes técnicos viven en `calculateLoan`, ADR 0007) (c) el trigger del calendario es O(n²) por préstamo: suficiente para 6–24 cuotas, a revisar en importaciones masivas | F3 (importación) |
| **Importación de cartera (02 §6.1)**: el esquema exige cuotas numeradas 1..n sumando `scheduled_amount`; una cartera importada con cuotas ya pagadas debe decidir si se renumeran, y falta guardar el «monto ya pagado histórico (solo referencia)» y el saldo inicial | F3-T importación |
| Evento `RECHAZADO` (ADR 0005): hoy se deduplica a uno por actor, acción y negocio por minuto, pero un usuario autenticado que conozca un UUID de negocio aún puede dejar eventos en su auditoría; límite de frecuencia por usuario/IP en la aplicación | F8 (junto al límite de intentos de login) |
| **Usuario `BLOQUEADO`** (T1.4b): restablecer la contraseña deja al usuario `PENDIENTE_CAMBIO_CONTRASENA`, así que **no** se aplica a un usuario `BLOQUEADO` (409) para no desbloquearlo por la puerta de atrás; pero 02 define el estado y el evento `UsuarioBloqueado` sin ningún comando para bloquear ni desbloquear. ¿Quién bloquea/desbloquea y cómo (V1)? | F5 (cobradores) |
| El restablecimiento borra `auth.sessions` por SQL como segunda barrera (esta versión de Auth ya revoca las sesiones al cambiar la contraseña por su API): verificar en el proyecto Supabase alojado que el rol `postgres` puede borrar de `auth.sessions` y que `updateUserById` revoca sesiones. Si el borrado SQL no fuera posible, el comando sigue (mejor esfuerzo con savepoint, queda `sessionsRevoked: null` en la auditoría). Ventana teórica conocida: un login que ya verificó la contraseña anterior podría crear una sesión justo después del restablecimiento (comportamiento de Auth); y restablecer no lleva clave de idempotencia (repetirlo emite otra contraseña): la pantalla debe deshabilitar el botón mientras envía | Antes de producción (F8); botón en T1.5 |

## Explícitamente NO pendiente (ya decidido, no volver a abrir)

Reglas de negocio: relación contrato→préstamo (1:1), aplicación cronológica de pagos, cálculo de mora derivado, flujo de refinanciación, categorías de gasto, motivos de intento fallido, matriz de permisos por rol, estados de suscripción (incluido `ARCHIVADA` vs `SUSPENDIDA`), prioridad de tickets (sin SLA), fórmula de proyección de cobros futuros.

Política de contraseñas (8+ caracteres con letra y dígito, ADR 0004), estados de Negocio y Suscripción (dos campos sincronizados, `PROXIMA_A_VENCER`/`VENCIDA` derivados, vencimiento por calendario con ajuste de fin de mes, ver 02 §1.2–1.3), unicidad global del nombre de usuario (02 §1.4), zona horaria por negocio (02 §1.2; ADR 0003).

Cerrado en F1 (ADR 0005): resultado de la auditoría (`OK`/`RECHAZADO`, y solo cuando el actor autenticado carece de permiso sobre esa entidad; visibilidad por rol en 02 §8), re-suscripción de un negocio archivado (suscripción nueva, la `ARCHIVADA` queda como historial) y restablecimiento de contraseña por el Super Admin (solo la cuenta `ADMIN_NEGOCIO` en V1, con el evento `ContrasenaRestablecida`).

Decisiones técnicas: stack (`03-ARQUITECTURA.md`), retención de backups (7 días), moneda (COP sin decimales), formato de identificadores (UUID interno + código legible de contrato asignado al confirmar), seguridad de Super Admin (mismo flujo Supabase Auth que los demás roles, sin 2FA en V1), umbral de `PROXIMA_A_VENCER` (5 días antes del vencimiento), transacciones con `pg` directo (ADR 0001), 1 usuario = 1 negocio con email sintético (ADR 0002), interés en puntos básicos con redondeo half-up, jornada bloqueante sin cobros ni gastos fuera de una jornada `ABIERTA` (02 §5.2, invariante 13), movimientos de caja siempre definitivos, saldo de Caja Mayor nunca negativo, un solo saldo de apertura por negocio y ajuste ± / reverso total (ADR 0006).

Todo esto ya está en `02-DOMINIO.md` / `03-ARQUITECTURA.md` — si Claude Code encuentra ambigüedad en alguno de estos puntos durante la implementación, es que el documento correspondiente quedó incompleto, no que la decisión siga abierta. En ese caso se corrige el documento, no se inventa en el código.
