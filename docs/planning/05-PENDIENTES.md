# 05 — Decisiones pendientes

> Regla de oro: si algo está aquí, **no se decide dentro del código**. Se detiene el trabajo relacionado, se pregunta, y solo entonces se implementa — moviendo la decisión resultante a `02-DOMINIO.md` o `03-ARQUITECTURA.md` y borrándola de esta lista.

La mayoría de las decisiones de V1 ya están cerradas y viven en `02-DOMINIO.md` y `03-ARQUITECTURA.md`. Lo que queda:

## Abierto

- **Precios monetarios reales de los planes** (semanal/mensual/anual): se usan cifras de ejemplo (placeholder) solo para desarrollo — no bloquean F1, pero **no deben pasar a producción** sin reemplazarse por las cifras reales. El campo de precio queda modelado como configurable desde el inicio, precisamente para no tener que tocar esquema cuando llegue el número real.
- **Redacción legal de términos y condiciones, política de protección de datos y conservación.** No bloquea F1–F2 (F1 solo registra fecha/hora de aceptación). La política de protección de datos personales debe resolverse antes de F3 (primera PII); los términos y condiciones, antes de operar con datos reales (F8).

## Abiertos por fase (no bloquean fases anteriores; resolver **antes** de iniciar la fase indicada)

| Tema | Bloquea |
| --- | --- |
| Verificar que Supabase Auth (alojado) acepta el dominio del email sintético (ADR 0002): puede validar dominios/MX | F1 |
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
| Límite de intentos de login por usuario e IP en la aplicación (Auth ve la IP del servidor de Next: su límite de 30 intentos por 5 min es global y bastaría para bloquear el login de todos) y, si se quiere, bloqueo temporal o CAPTCHA | F8 (antes de datos reales) |
| Auditar intentos de login fallidos o denegados (02 §1.4 solo lista `InicioSesion` como evento) | F8 |
| Un usuario `PENDIENTE_CAMBIO_CONTRASENA` con un JWT vigente puede leer por la API de datos lo que su rol permite (el hook y la RLS no lo distinguen): bloquearlo en el hook o en las políticas | F2 (antes de las tablas de negocio) |
| Valores de `audit_events.result` (hoy `OK`/`RECHAZADO`; 02 §6.3 solo dice «resultado») y qué ve cada rol (hoy: el Admin lee la suscripción y la auditoría de su negocio; el Cobrador no lee negocio, suscripción ni auditoría) | F1 |
| Re-suscripción tras `ARCHIVADA`: hoy `unique(business_id)` permite una sola suscripción por negocio y `ARCHIVADA` es terminal; confirmar que «archivada = baja definitiva» | F1 |
| ¿Puede cambiar el rol, el negocio o el nombre de usuario de un perfil? (hoy inmutables por trigger; un cambio de rol exigiría refrescar el JWT) | F5 |
| Restablecer la contraseña del admin de un negocio (02 §1.4: «Super Admin restablece la del admin»): sin esto, un `createBusiness` cuya respuesta 201 se pierde deja la contraseña temporal irrecuperable y sin forma de reintentar sin abrir el negocio a mano | Antes de producción (F8), idealmente F1 |
| `scripts/create-super-admin.mjs` es la única vía para crear un Super Admin y no queda registro de quién lo ejecutó (persona de confianza con `.env.local`/service role); revisar antes de operar con datos reales si se necesita más control (motivo, actor del sistema operativo, límite de uso) | F8 |

## Explícitamente NO pendiente (ya decidido, no volver a abrir)

Reglas de negocio: relación contrato→préstamo (1:1), aplicación cronológica de pagos, cálculo de mora derivado, flujo de refinanciación, categorías de gasto, motivos de intento fallido, matriz de permisos por rol, estados de suscripción (incluido `ARCHIVADA` vs `SUSPENDIDA`), prioridad de tickets (sin SLA), fórmula de proyección de cobros futuros.

Política de contraseñas (8+ caracteres con letra y dígito, ADR 0004), estados de Negocio y Suscripción (dos campos sincronizados, `PROXIMA_A_VENCER`/`VENCIDA` derivados, vencimiento por calendario con ajuste de fin de mes, ver 02 §1.2–1.3), unicidad global del nombre de usuario (02 §1.4), zona horaria por negocio (02 §1.2; ADR 0003).

Decisiones técnicas: stack (`03-ARQUITECTURA.md`), retención de backups (7 días), moneda (COP sin decimales), formato de identificadores (UUID interno + código legible de contrato asignado al confirmar), seguridad de Super Admin (mismo flujo Supabase Auth que los demás roles, sin 2FA en V1), umbral de `PROXIMA_A_VENCER` (5 días antes del vencimiento), transacciones con `pg` directo (ADR 0001), 1 usuario = 1 negocio con email sintético (ADR 0002), interés en puntos básicos con redondeo half-up, jornada bloqueante sin cobros ni gastos fuera de una jornada `ABIERTA` (02 §5.2, invariante 13).

Todo esto ya está en `02-DOMINIO.md` / `03-ARQUITECTURA.md` — si Claude Code encuentra ambigüedad en alguno de estos puntos durante la implementación, es que el documento correspondiente quedó incompleto, no que la decisión siga abierta. En ese caso se corrige el documento, no se inventa en el código.
