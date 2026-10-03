# 02 — Modelo de dominio (autoridad final en reglas de negocio)

> Describe entidades, estados, reglas y eventos. No es un esquema físico de tablas — el diseño físico vive en las migraciones, pero debe expresar exactamente estas reglas.

## Principios

1. Todo dato de negocio pertenece a un único `Negocio`, salvo usuarios Super Admin y planes globales.
2. Un hecho financiero no se elimina ni se edita: se revierte o corrige mediante un nuevo evento vinculado.
3. Contrato, préstamo, cuota, pago, cargo de mora, gasto, movimiento de caja y auditoría son entidades distintas.
4. Balances, mora, prioridad, reputación y dashboard son **cálculos derivados** de hechos registrados — nunca campos editables directamente.
5. Los estados controlan qué operaciones son válidas; no son textos libres.

## Mapa conceptual

```text
PLATAFORMA
├── Plan
├── Usuario (Super Admin)
└── Negocio
    ├── Suscripción
    ├── Usuario administrador
    ├── Cobrador ── Usuario cobrador
    │   └── Ruta ── Asignación de cliente ── Cliente
    ├── Cliente ── Contrato ── Préstamo ── Cuota
    │                              │            └── Aplicación de pago ── Pago
    │                              └── Cargo de mora
    ├── Caja Mayor ── Movimiento de caja
    ├── Jornada de Caja Menor ── Movimiento de caja
    │                              └── Liquidación ── Diferencia de caja
    ├── Gasto
    ├── Ticket de soporte
    └── Evento de auditoría
```

---

## 1. Plataforma, negocio y acceso

### 1.1 Plan

Valores V1: `SEMANAL`, `MENSUAL`, `ANUAL`.

- Semanal: 7 días, máximo 5 cobradores activos, dashboard predeterminado.
- Mensual: 1 mes, sin límite práctico de cobradores, dashboard configurable.
- Anual: 1 año, mismas capacidades que mensual, 20 % de ahorro frente a 12 mensualidades.

### 1.2 Negocio

Datos: id único, nombre, responsable (nombre e identificación), teléfono, zona horaria (IANA, por defecto `America/Bogota`, fijada al crear el negocio), fecha de creación, estado de acceso (`ACTIVO` | `SUSPENDIDO`).
Reglas: ninguna consulta/acción cruza negocios; suspender bloquea acceso sin borrar datos; solo Super Admin activa/suspende. **El estado de acceso del Negocio es la única compuerta de acceso**: un negocio `SUSPENDIDO` no admite sesiones de sus usuarios; los estados informativos de la suscripción nunca bloquean.
Eventos: `NegocioCreado`, `NegocioActualizado`, `NegocioSuspendido`, `NegocioActivado`.

### 1.3 Suscripción

Datos: negocio, plan, fecha inicio, fecha vencimiento, estado, observación, actor de cambio. Cada negocio tiene una suscripción vigente; sus cambios (plan, estado) actualizan esa fila y cada uno se audita con el valor anterior y el nuevo.
Estados **almacenados**: `ACTIVA` | `SUSPENDIDA` (manual, reversible) | `ARCHIVADA` (manual, terminal). Estados **derivados** por fecha al leer, nunca almacenados: `PROXIMA_A_VENCER` (una suscripción `ACTIVA` a 5 días o menos de su vencimiento) y `VENCIDA` (una `ACTIVA` con vencimiento pasado, según la fecha de hoy en la zona horaria del negocio).
Vencimiento: `SEMANAL` = inicio + 7 días; `MENSUAL` = mismo día del mes siguiente; `ANUAL` = mismo día del año siguiente; si ese día no existe se usa el último del mes (31 ene → 28/29 feb).
Sincronía con el Negocio (una sola transacción por comando): suspender → suscripción `SUSPENDIDA` y negocio `SUSPENDIDO`; activar → `ACTIVA` y `ACTIVO`; archivar (solo desde `ACTIVA` o `SUSPENDIDA`, con motivo) → `ARCHIVADA` y negocio `SUSPENDIDO`. Cambiar de plan reinicia inicio y vencimiento desde hoy.
Re-suscripción: un negocio archivado puede volver. El Super Admin crea una **suscripción nueva** `ACTIVA` desde hoy, con el plan que elija, y el negocio vuelve a `ACTIVO`; sus cuentas siguen vivas (el Super Admin restablece la del admin si cambió de titular). La fila `ARCHIVADA` **no se reactiva ni se modifica**: queda como historial. Cada negocio tiene como máximo **una suscripción vigente** (las `ARCHIVADA` no cuentan) y la re-suscripción no exige motivo, pero el evento registra el plan y las fechas de la suscripción anterior (ADR 0005).
Reglas: `PROXIMA_A_VENCER`/`VENCIDA` son informativos, no bloquean automáticamente. Solo Super Admin cambia entre `ACTIVA`/`SUSPENDIDA`. `ARCHIVADA` es un estado terminal distinto de `SUSPENDIDA`: se usa cuando un negocio se da de baja, mientras que `SUSPENDIDA` sigue siendo reversible. Si un negocio archivado vuelve, es por re-suscripción (una suscripción nueva), nunca por reactivar la fila archivada. Solo Super Admin archiva y re-suscribe. Todo cambio se audita.
Eventos: `SuscripcionCreada`, `PlanCambiado`, `NegocioSuspendido`, `NegocioActivado`, `NegocioArchivado`. (`SuscripcionVencida` deja de ser un evento persistido: es un estado derivado.)

### 1.4 Usuario

Datos: id, nombre visible, usuario, contraseña segura, rol, negocio opcional, estado, fechas de acceso.
Acceso: el «usuario» es el identificador de inicio de sesión; internamente se mapea a un email sintético para Supabase Auth (no se envían correos). **Un usuario pertenece a un único negocio**: una misma persona en dos negocios tiene dos cuentas independientes. El nombre de usuario es **único en toda la plataforma** (el login pide solo usuario y contraseña); crear un usuario con un nombre existente en cualquier negocio se rechaza.
Recuperación de contraseña: el admin del negocio restablece la de sus cobradores; el Super Admin restablece la del admin. En V1 su alcance es solo la cuenta `ADMIN_NEGOCIO` (los cobradores aún no existen). Todo restablecimiento deja el usuario en `PENDIENTE_CAMBIO_CONTRASENA`, le revoca las sesiones activas y se audita.
Roles: `SUPER_ADMIN` (sin negocio), `ADMIN_NEGOCIO` (una sola cuenta principal por negocio en V1), `COBRADOR` (pertenece a un negocio, vinculado a un cobrador).
Estados: `ACTIVO`, `BLOQUEADO`, `PENDIENTE_CAMBIO_CONTRASENA`.
Reglas: la identificación personal nunca es contraseña; contraseña inicial temporal obliga cambio en primer acceso; política de contraseña: 8 o más caracteres con al menos una letra y un dígito (ADR 0004); un cobrador no actúa sobre otro negocio ni otra cartera.
Eventos: `UsuarioCreado`, `PrimerAccesoCompletado`, `InicioSesion`, `UsuarioBloqueado`, `ContrasenaCambiada`, `ContrasenaRestablecida`.

---

## 2. Clientes y cartera

### 2.1 Cliente

Sin acceso de usuario en V1.
Datos: negocio, nombre, sobrenombre opcional, identificación, dirección, teléfono, WhatsApp, notas, fechas.
Reglas: datos de contacto editables y auditados; un cliente con historial financiero no se elimina; el cliente **no** almacena un único estado de contrato/saldo/prioridad editable — se calcula desde sus préstamos y cuotas.
Eventos: `ClienteCreado`, `ClienteActualizado`.

### 2.2 Contrato

Acuerdo entre negocio y cliente que origina **una única** operación de préstamo en V1.
Datos: negocio, cliente, número (código legible por negocio, asignado por el sistema al confirmar; un `BORRADOR` no lo tiene), fecha/hora, admin creador, comentario opcional, origen (`NUEVO` | `IMPORTADO`), estado.
Estados: `BORRADOR` (editable, sin deuda ni movimientos) → `CONFIRMADO` (inmutable, exactamente un préstamo) → `ANULADO` (permanece en historial).
Reglas: un `CONFIRMADO` no se edita ni elimina; solo se anula si su préstamo no tiene pagos ni liquidaciones posteriores; la anulación exige motivo, auditoría y reversión explícita de cualquier desembolso inicial; la asignación a cobrador no pertenece al contrato y puede cambiar sin alterarlo.
Eventos: `ContratoCreado`, `ContratoConfirmado`, `ContratoAnulado`.

### 2.3 Préstamo

Obligación financiera resultante de un contrato confirmado.
Datos: contrato, monto principal, interés % (guardado en puntos básicos enteros: 20 % = 2000) y monetario, total a pagar, fecha de desembolso, primera fecha de cobro, frecuencia (`DIARIA`|`SEMANAL`|`MENSUAL`), cantidad de cuotas, saldo pendiente derivado, préstamo anterior opcional (si viene de refinanciación), estado.
Estados: `ACTIVO` (saldo pendiente) → `PAGADO` (sin saldo en cuotas ni cargos de mora activos) | `REFINANCIADO` (saldo cancelado por préstamo nuevo) | `ANULADO` (anulación válida del contrato).
Reglas: un contrato confirmado genera un préstamo y su calendario de cuotas; el desembolso de un préstamo nuevo reduce Caja Mayor (no puede confirmarse sin saldo suficiente); un préstamo importado no genera desembolso histórico; un cliente puede tener varios préstamos activos; el total original no se modifica tras confirmar.
Eventos: `PrestamoCreado`, `PrestamoDesembolsado`, `PrestamoPagado`, `PrestamoRefinanciado`, `PrestamoAnulado`.

### 2.4 Cuota

Datos: préstamo, número de orden, fecha de vencimiento, valor esperado, valor aplicado, saldo pendiente derivado, estado.
Estados: `PENDIENTE` (saldo, no venció) | `PARCIAL` (pago recibido, conserva saldo, no venció) | `VENCIDA` (fecha pasó, conserva saldo) | `PAGADA` (saldo cero). Si una vencida tiene pago parcial: se muestra `VENCIDA — pago parcial`, sin crear un quinto estado.
Reglas: el calendario se genera al confirmar el préstamo; la suma de cuotas = total a pagar exacto (el único ajuste de redondeo va en la última cuota, y solo al crearla — nunca por pagos posteriores); los pagos no cambian valor esperado ni fecha de las cuotas; una cuota pagada conserva su historial de atraso.
Eventos: `CuotasGeneradas`, `CuotaPagada`. El estado `VENCIDA` es **derivado** (no es un evento persistido ni requiere un proceso programado): una cuota con saldo está vencida cuando la fecha de hoy, en la zona horaria del negocio, es posterior a su fecha de vencimiento. Coherente con los días de mora: una cuota que vence hoy tiene 0 días de mora.

### Cálculo confirmado

```text
interés monetario = redondeo half-up(monto principal × interés bps / 10000)   (20 % = 2000 bps por defecto, configurable al crear la operación; admite medios puntos, ej. 12,5 % = 1250 bps)
total a pagar      = monto principal + interés monetario
```

El redondeo del interés se aplica una sola vez, al crear el préstamo, y el total resultante es exacto e inmutable.

Ejemplo: $1.000.000 al 20 % → total $1.200.000; en 12 cuotas → cuota esperada $100.000.
Cantidades frecuentes de cuotas: 6, 12, 24 (configurable). Frecuencia diaria es el caso habitual.

---

## 3. Pagos, mora y refinanciación

### 3.1 Pago

Datos: negocio, préstamo, monto, fecha/hora, usuario que registra, cobrador o admin que recibe, observación opcional, estado (`REGISTRADO` | `REVERSADO`).
Reglas: monto > 0 y nunca superior al saldo total exigible; un pago normal se aplica a cuotas, un pago de cargo de mora se registra explícitamente contra ese cargo; un pago no se elimina — se revierte mediante un evento nuevo con motivo que revierte sus aplicaciones y su movimiento de caja.
Eventos: `PagoRegistrado`, `PagoAplicado`, `PagoReversado`.

### 3.2 Aplicación de pago

Datos: pago, cuota, monto aplicado, orden de aplicación, fecha/hora.

**Regla de aplicación automática (obligatoria, no se altera):**

1. Se toma la cuota pendiente más antigua.
2. Se cubre hasta su saldo pendiente.
3. Si sobra dinero, se aplica a la siguiente cuota pendiente, en orden cronológico.
4. Si todas las cuotas y cargos activos quedan sin saldo, el préstamo pasa a `PAGADO`.
5. **Nunca se traslada un faltante a la última cuota ni se modifica el calendario original.**

Ejemplo:

```text
Cuota 1 pendiente: $100.000 | Cuota 2 pendiente: $100.000
Pago $50.000  → cuota 1 queda en $50.000, cuota 2 no cambia
Pago $150.000 → completa cuota 1 y cubre cuota 2
```

No se permite registrar un pago superior al saldo total pendiente. V1 no maneja saldos a favor ni devoluciones.

### 3.3 Mora de cuota (cálculo, no entidad)

```text
días de mora = máximo(0, fecha de referencia − fecha de vencimiento)
```

- Cuota pendiente: fecha de referencia = hoy. Cuota pagada: fecha de referencia = fecha en que se completó.
- Un pago parcial no detiene la mora mientras exista saldo.
- No se crea una entidad financiera de mora por cada día de atraso.

**Prioridad de cobro** (orden explicable, sin scoring):

1. clientes con cuotas vencidas, por mayor máximo de días de mora activos;
2. en empate, por mayor saldo vencido;
3. en empate, por la cuota con vencimiento más antiguo.

**Reputación histórica** (solo datos, sin score ni bloqueo automático): cuotas a tiempo, cuotas con atraso, días de mora acumulados, saldo vencido actual, refinanciaciones realizadas.

### 3.4 Cargo de mora

Penalización monetaria **decidida manualmente** por el administrador — nunca automática.
Datos: negocio, préstamo, cuota opcional, monto original, monto pagado, saldo pendiente, fecha, motivo, admin creador, estado (`ACTIVO`|`PAGADO`|`ANULADO`).
Reglas: no se crea por fórmula automática; se paga solo con un pago registrado explícitamente contra el cargo; anularlo exige motivo y auditoría; un préstamo no pasa a `PAGADO` con cargos `ACTIVO` con saldo pendiente.
Eventos: `CargoMoraCreado`, `CargoMoraPagado`, `CargoMoraAnulado`.

### 3.5 Refinanciación

Sustitución trazable de un préstamo activo por uno nuevo.
Datos: préstamo anterior, contrato/préstamo nuevo, saldo refinanciado, monto adicional entregado, fecha, admin creador, observación.
Reglas:

1. Solo parte de un préstamo `ACTIVO`.
2. `nuevo principal = saldo pendiente anterior + monto adicional entregado`.
3. Se crea un contrato y préstamo nuevos con interés, cuotas, frecuencia y primera fecha propios.
4. Se crea una liquidación interna sin efectivo que deja el préstamo anterior como `REFINANCIADO`.
5. Si hay monto adicional, genera un desembolso separado desde Caja Mayor.
6. El préstamo previo no se edita ni desaparece.
Eventos: `RefinanciacionCreada`, `SaldoAnteriorRefinanciado`, `MontoAdicionalDesembolsado`.

---

## 4. Cobradores, rutas y actividad de cobro

### 4.1 Cobrador

Datos: negocio, usuario asociado, nombre, fecha de creación, estado (`ACTIVO`|`INACTIVO`).
Reglas: pertenece a un único negocio; puede crearse sin ruta ni clientes; solo consulta/opera sobre su propia ruta, caja y eventos.

### 4.2 Ruta

Lista nombrada de clientes asignados a un cobrador. No optimiza recorrido ni registra geolocalización; el cobrador decide el orden.
Datos: negocio, cobrador, nombre, fecha de inicio, estado (`ACTIVA`|`CERRADA`).
Regla: cada cobrador tiene como máximo una ruta `ACTIVA`.

### 4.3 Asignación de cliente

Período durante el que un cliente está bajo responsabilidad de una ruta/cobrador.
Datos: negocio, cliente, ruta, cobrador, fecha/hora inicio, fecha/hora fin opcional, estado (`ACTIVA`|`CERRADA`).
Reglas: un cliente tiene como máximo una asignación `ACTIVA`; reasignar cierra la anterior y crea una nueva (nunca sustituye historia); la asignación no modifica contrato ni préstamo.
Eventos: `RutaCreada`, `ClienteAsignado`, `ClienteReasignado`, `RutaCerrada`.

### 4.4 Evento de intento de cobro

Datos: negocio, cliente, cobrador, fecha/hora, tipo, motivo, observación, fecha/hora de reintento opcional.
Tipos: `INTENTO_FALLIDO`, `VOLVER_A_COBRAR`.
Motivos de intento fallido: `CLIENTE_AUSENTE`, `LUGAR_CERRADO`, `SIN_DINERO`, `DIRECCION_INCORRECTA`, `OTRO` (exige observación).
El evento no altera la deuda ni crea una cuota nueva.

---

## 5. Cajas, gastos y liquidaciones

### 5.1 Caja Mayor

Una por negocio. **No se guarda un saldo manual como fuente de verdad** — se deriva de sus movimientos confirmados.

### 5.2 Jornada de Caja Menor

Caja operativa de un cobrador durante una jornada (no una caja con saldo permanente).
Datos: negocio, cobrador, fecha, fondo operativo recibido, saldo esperado derivado, dinero entregado, diferencia derivada, estado, fechas de apertura/cierre.
Estados: `ABIERTA` → `PENDIENTE_LIQUIDACION` → `LIQUIDADA` | `LIQUIDADA_CON_DIFERENCIA`.
Reglas: máximo una jornada abierta/pendiente por cobrador por día; inicia en cero y recibe fondo desde Caja Mayor; liquidada queda en cero; no se registran pagos/gastos en jornada cerrada. Un cobrador **no puede registrar cobros ni gastos sin una jornada `ABIERTA`**, y **no puede abrir una jornada nueva mientras tenga otra en `PENDIENTE_LIQUIDACION`, de cualquier día**.

### 5.3 Movimiento de caja

Datos: negocio, fecha/hora, tipo, monto, caja origen/destino opcional, entidad origen, usuario creador, observación, estado.
Tipos V1: `SALDO_APERTURA`, `INGRESO_CAPITAL`, `DESEMBOLSO_PRESTAMO`, `FONDO_OPERATIVO`, `COBRO`, `GASTO_COBRADOR`, `GASTO_CAJA_MAYOR`, `LIQUIDACION`, `DIFERENCIA_CAJA`, `AJUSTE`, `REVERSO`.
Reglas: todo movimiento tiene causa de negocio identificable; no se edita ni elimina — un `REVERSO`/`AJUSTE` nuevo referencia al original y exige motivo; cobro registrado por cobrador aumenta su jornada, uno registrado por admin aumenta Caja Mayor.

### 5.4 Gasto

Datos: negocio, tipo de caja, jornada opcional, monto, categoría, fecha, observación, usuario creador, movimiento asociado.
Categorías: `GASOLINA`, `ALIMENTACION`, `REPARACION`, `MEDICINA`, `OTRO` (exige observación).
Corregir/rechazar un gasto genera un `AJUSTE`; nunca cambia ni borra el gasto original.

### 5.5 Liquidación

Cierre de una jornada de Caja Menor frente a Caja Mayor.
Datos: jornada, saldo esperado, dinero entregado, diferencia, cobrador declarante, admin que confirma, fechas, estado.
Estados: `PENDIENTE_REVISION`, `CUADRADA`, `CON_DIFERENCIA`, `REVISADA`.
Reglas: transfiere a Caja Mayor el dinero **realmente entregado**; la diferencia se registra como `FALTANTE`/`SOBRANTE`, exige observación y genera un movimiento `DIFERENCIA_CAJA` para cerrar la jornada en cero; resolver una diferencia genera un nuevo `AJUSTE`, nunca cambia la liquidación previa.
Eventos: `JornadaAbierta`, `FondoOperativoTransferido`, `GastoRegistrado`, `LiquidacionDeclarada`, `LiquidacionConfirmada`, `DiferenciaRegistrada`, `AjusteRegistrado`.

Fórmulas:

```text
saldo esperado = fondo operativo + pagos recibidos − gastos
diferencia      = saldo esperado − dinero entregado
```

---

## 6. Importación, soporte y auditoría

### 6.1 Importación de cartera

No es una entidad adicional: es un contrato/préstamo con `origen = IMPORTADO`.
Datos requeridos: cliente, fecha original, principal original, interés o total pactado, frecuencia, cuotas si se conocen, monto ya pagado histórico (solo referencia), saldo inicial pendiente, próxima fecha de cobro, cuotas futuras.
Reglas: no crea pagos, desembolsos ni movimientos históricos en cajas; los pagos posteriores a la importación siguen las reglas normales; la mora anterior solo se representa si se conocen fechas de vencimiento pasadas.

### 6.2 Ticket de soporte

Datos: negocio, creador, fecha, descripción, respuesta, última actualización, estado, prioridad.
Estados: `ABIERTO`, `EN_ATENCION`, `RESUELTO`, `CERRADO`.
Prioridad: `ALTA`, `MEDIA`, `BAJA` — campo simple sin SLA de tiempo de respuesta asociado. Sin chat, adjuntos ni automatizaciones en V1.

### 6.3 Evento de auditoría

Registra la **acción**, no el hecho financiero mismo.
Datos: negocio opcional, actor, tipo de acción, entidad afectada, id de entidad, fecha/hora, resultado, resumen seguro del cambio.
Resultado: `OK` (el comando se aplicó) o `RECHAZADO` (el actor estaba autenticado pero no tenía permiso sobre esa entidad). No se auditan los rechazos por datos inválidos ni los intentos de inicio de sesión fallidos (ADR 0005).
Se crea para: contratos, préstamos, pagos, cargos de mora, rutas, asignaciones, cajas, gastos, liquidaciones, suscripciones, usuarios, tickets.

---

## 7. Valores derivados (nunca editables directamente)

| Valor | Se deriva de |
| --- | --- |
| Saldo de préstamo | Cuotas pendientes + cargos de mora activos |
| Estado de cuota | Fecha de vencimiento, saldo pendiente, pagos aplicados |
| Días de mora | Fecha de vencimiento y fecha de referencia |
| Prioridad de cliente | Máximo de mora activa, saldo vencido, vencimiento más antiguo |
| Reputación/historial | Cuotas a tiempo/tardías, días de mora, saldo vencido, refinanciaciones |
| Saldo de Caja Mayor | Movimientos de Caja Mayor |
| Saldo esperado de Caja Menor | Fondo operativo + cobros − gastos |
| Diferencia de liquidación | Saldo esperado − dinero entregado |
| Meta diaria de cobrador | Cuotas vencidas o con vencimiento hoy de su cartera asignada |
| Proyección de cobros futuros | Suma del valor esperado de cuotas pendientes, agrupada por fecha de vencimiento futura (nunca incluye cuotas ya pagadas ni cargos de mora sin confirmar) |
| Dashboard | Agregados de contratos, préstamos, cuotas, pagos, cajas, gastos, liquidaciones |

---

## 8. Matriz de permisos

| Operación | Super Admin | Admin negocio | Cobrador |
| --- | :---: | :---: | :---: |
| Crear/suspender negocio, cambiar plan | Sí | No | No |
| Re-suscribir un negocio archivado | Sí | No | No |
| Monitoreo global y backups | Sí | No | No |
| Crear/editar clientes | No | Sí | No |
| Crear/anular contrato, refinanciar | No | Sí | No |
| Crear cobrador, ruta, asignación | No | Sí | No |
| Registrar pago | No | Sí | Sí (solo su cartera) |
| Crear cargo de mora / reversar pago | No | Sí | No |
| Registrar gasto | No | Sí | Sí (solo su jornada) |
| Transferir fondo, confirmar liquidación, ajustar caja | No | Sí | No |
| Crear / gestionar ticket | No / Sí | Sí / No | No / No |
| Abrir su propia jornada de Caja Menor | No | No | Sí |
| Declarar su liquidación | No | No | Sí |
| Registrar intento de cobro / volver a cobrar | No | No | Sí (solo su cartera) |
| Anular cargo de mora | No | Sí | No |
| Cerrar ruta, reasignar cliente | No | Sí | No |
| Importar cartera | No | Sí | No |
| Ver dashboard del negocio | No | Sí | No |
| Restablecer contraseña de usuario | Solo de admins | Solo de sus cobradores | No |
| Ver auditoría | Sí | Solo la de su negocio | No |

---

## 9. Invariantes de integridad (no violables)

1. Toda entidad operativa y financiera pertenece a un negocio.
2. Un cobrador pertenece a un único negocio; un cliente tiene una sola asignación activa.
3. Un contrato confirmado tiene exactamente un préstamo.
4. El importe aplicado a una cuota nunca supera su saldo pendiente.
5. Un pago nunca supera el saldo exigible que intenta pagar.
6. Un préstamo solo se marca `PAGADO` cuando cuotas y cargos de mora activos no tienen saldo.
7. Una ruta activa pertenece a un único cobrador; un cobrador tiene como máximo una ruta activa.
8. Una jornada cerrada no acepta cobros, gastos ni nuevos fondos.
9. Una liquidación conserva el dinero realmente entregado, aunque sea distinto al esperado.
10. Ningún hecho financiero se elimina: corrección = reverso o ajuste vinculado.
11. Dashboard, prioridad, mora y reputación nunca son fuente primaria de verdad.
12. Ninguna acción puede modificar información de un negocio ajeno.
13. Un cobrador solo registra cobros y gastos con una jornada `ABIERTA`, y no abre una jornada nueva con otra en `PENDIENTE_LIQUIDACION`.
