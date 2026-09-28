# 08 — Glosario: dominio → código

> Convención (`03-ARQUITECTURA.md` §2): documentación y UI en español; código y BD en inglés (`snake_case` en BD, `camelCase` en TS). Si aparece un término de `02-DOMINIO.md` que no está aquí, se añade **antes** de nombrarlo en código.

## Entidades

| Dominio (ES) | Identificador (EN) | Tabla |
| --- | --- | --- |
| Plan | `plan` | `plans` |
| Negocio | `business` | `businesses` |
| Suscripción | `subscription` | `subscriptions` |
| Usuario | `user` (perfil interno) | `profiles` |
| Cliente | `client` | `clients` |
| Contrato | `contract` | `contracts` |
| Préstamo | `loan` | `loans` |
| Cuota | `installment` | `installments` |
| Pago | `payment` | `payments` |
| Aplicación de pago | `paymentApplication` | `payment_applications` |
| Cargo de mora | `lateFeeCharge` | `late_fee_charges` |
| Refinanciación | `refinancing` | `refinancings` |
| Cobrador | `collector` | `collectors` |
| Ruta | `route` | `routes` |
| Asignación de cliente | `clientAssignment` | `client_assignments` |
| Evento de intento de cobro | `collectionAttempt` | `collection_attempts` |
| Caja Mayor | `mainCashbox` | `main_cashboxes` |
| Jornada de Caja Menor | `collectorShift` | `collector_shifts` |
| Movimiento de caja | `cashMovement` | `cash_movements` |
| Gasto | `expense` | `expenses` |
| Liquidación | `settlement` | `settlements` |
| Ticket de soporte | `supportTicket` | `support_tickets` |
| Evento de auditoría | `auditEvent` | `audit_events` |
| Clave de idempotencia | `idempotencyKey` | `idempotency_keys` |

## Estados y enumeraciones

Los valores de estado se guardan como en `02-DOMINIO.md` (`CONFIRMADO`, `PARCIAL`, `SALDO_APERTURA`…), en mayúsculas y en español: son vocabulario de negocio visible al usuario y estable en datos. Solo los **nombres de tipos, tablas y columnas** van en inglés.

## Campos de identidad y suscripción

| Concepto | Columna / valores |
| --- | --- |
| Estado de acceso del negocio | `businesses.access_status` (`ACTIVO`, `SUSPENDIDO`) |
| Zona horaria del negocio | `businesses.time_zone` (IANA, default `America/Bogota`) |
| Estado almacenado de la suscripción | `subscriptions.status` (`ACTIVA`, `SUSPENDIDA`, `ARCHIVADA`) |
| Inicio / vencimiento | `subscriptions.starts_on` / `subscriptions.expires_on` (fecha calendario) |
| Rol | `profiles.role` (`SUPER_ADMIN`, `ADMIN_NEGOCIO`, `COBRADOR`) |
| Nombre de usuario (único global) | `profiles.username` |

## Campos transversales

| Concepto | Columna |
| --- | --- |
| Negocio propietario | `business_id` |
| Creación / actor | `created_at`, `created_by` |
| Clave de idempotencia del comando | `idempotency_key` |
| Documento revertido / ajustado | `reverses_id` / `adjusts_id` |
| Interés (puntos básicos) | `interest_bps` |
| Importes | `*_amount` (`bigint`, unidad mínima = 1 COP) |
