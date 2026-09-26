# 03 — Arquitectura técnica

> **Estado: adoptada.** Es la base sobre la que ya se construyó `04-PLAN.md` y sobre la que ya arrancó F0. No se re-discute salvo que una fase posterior demuestre que una pieza concreta no alcanza — en ese caso se documenta el cambio aquí mismo, no se decide en silencio dentro del código.

**Decisión central:** monolito modular. Una aplicación web, una base de datos relacional, límites internos claros entre módulos. Sin microservicios, colas, caché distribuida ni app móvil nativa en V1.

## 1. Stack

| Capa | Elección | Por qué |
| --- | --- | --- |
| Aplicación web | Next.js (App Router) + React + TypeScript estricto | Landing, áreas privadas y capa de servidor en un solo proyecto mantenible |
| Interfaz | Tailwind CSS, HTML semántico, componentes propios | Interfaz sobria y consistente sin depender de un kit visual rígido |
| Base de datos | PostgreSQL administrado vía Supabase | Dominio relacional, financiero y transaccional: necesita restricciones, transacciones y auditoría |
| Autenticación | Supabase Auth con sesiones seguras para Next.js | Resuelve credenciales/sesiones sin construir identidad propia |
| Autorización | Roles en la app + Row Level Security (RLS) por negocio | Dos capas de defensa contra fugas entre negocios |
| Comandos financieros | Route Handler → servicio de dominio → transacción PostgreSQL | El navegador nunca escribe pagos, cajas o liquidaciones directamente |
| Despliegue | Vercel (Next.js) + Supabase (BD/Auth) | Reduce operación de infraestructura en V1 |
| Errores y salud | Registro de errores centralizado + chequeo de disponibilidad | Alimenta el panel de Super Admin sin monitoreo propio complejo |
| Pruebas | Vitest (dominio) + Playwright (flujos críticos) | Protege reglas financieras y recorridos reales |

Dependencias iniciales: Next.js, React, TypeScript, Tailwind CSS, `@supabase/ssr` + cliente oficial, Zod (validación), React Hook Form (solo formularios complejos), Vitest, Playwright, ESLint + Prettier. No se añade Redux, Zustand, React Query, GraphQL, tRPC, Redis ni una librería de componentes masiva salvo necesidad real demostrada.

## 2. Estructura de carpetas

La organización sigue el dominio, no el tipo de archivo:

```text
src/
├── app/
│   ├── (public)/          # landing y planes
│   ├── (auth)/             # inicio de sesión
│   ├── super-admin/        # monitoreo, negocios, suscripciones, tickets
│   ├── negocio/             # cartera, cajas, cobradores, dashboard
│   ├── cobrador/            # meta, ruta, pagos, gastos, liquidación
│   └── api/                 # Route Handlers: comandos y lecturas puntuales
├── modules/
│   ├── identity/            # usuarios, roles, sesión
│   ├── subscriptions/       # negocio, planes, suscripción
│   ├── portfolio/           # cliente, contrato, préstamo, cuota, pago
│   ├── collections/         # cobrador, rutas, asignaciones, intentos
│   ├── cash/                # cajas, movimientos, gastos, liquidaciones
│   ├── support/              # tickets
│   └── audit/                # eventos auditables
├── shared/
│   ├── ui/ validation/ auth/ database/
└── tests/
    ├── unit/ integration/ e2e/
```

Cada módulo contiene sus tipos, validaciones, servicios, consultas y pruebas. **Una página no calcula interés, mora, saldos ni permisos: llama al servicio del módulo correspondiente.**

## 3. Patrón obligatorio para operaciones financieras

Pagos, desembolsos, gastos, transferencias de caja, liquidaciones, ajustes, anulaciones y refinanciaciones son **comandos**, nunca actualizaciones directas de formulario.

```text
Formulario
  → Route Handler
  → validar entrada y sesión
  → verificar rol, negocio y recurso permitido
  → servicio de dominio
  → una transacción PostgreSQL
      ├── comprobar reglas e invariantes (ver 02-DOMINIO.md §9)
      ├── crear hecho financiero
      ├── crear movimiento de caja
      ├── actualizar/derivar estado necesario
      └── crear evento de auditoría
  → respuesta al cliente
```

Ejemplo: registrar un pago crea, en una sola transacción, el pago, sus aplicaciones a cuotas, el movimiento de Caja Menor/Mayor, el estado de cuotas/préstamo y el evento de auditoría. Si algo falla, no se guarda nada.

Reglas de implementación:

- Cada comando financiero recibe una clave de idempotencia.
- `business_id` se obtiene de la sesión y del recurso autorizado en el servidor, nunca de un valor enviado por el navegador.
- Importes como enteros en unidad mínima de moneda, nunca `number` decimal de JS.
- Fechas en UTC; cada negocio muestra fecha/hora en su zona configurada.
- Reversos y ajustes son eventos nuevos enlazados al original.
- Las funciones que escriben dinero no usan caché.

## 4. Datos, multi-tenancy y seguridad

1. Toda tabla operativa incluye `business_id`, salvo entidades globales (planes, Super Admin).
2. RLS habilitado en cualquier tabla expuesta a la API de datos.
3. Las políticas distinguen Super Admin / admin de negocio / cobrador, y siempre restringen al negocio correcto.
4. Las tablas financieras no aceptan escrituras directas desde el navegador.
5. Las claves `service_role` permanecen exclusivamente en el servidor.
6. Cada consulta se filtra también por contexto de negocio en la capa de aplicación — RLS es una segunda defensa, no un sustituto.

Restricciones físicas que el esquema debe expresar: un contrato confirmado tiene un solo préstamo; una cuota no recibe más dinero que su saldo pendiente; un cobrador solo tiene una ruta activa; un cliente solo tiene una asignación activa; un cobrador solo tiene una jornada abierta/pendiente por día; una clave de idempotencia no se reutiliza; una entidad hija pertenece siempre al mismo negocio que su relación padre. No se acepta una base sin claves foráneas, restricciones y migraciones versionadas.

## 5. Interfaz

- TypeScript estricto en toda la app; formularios validados en cliente (feedback) y servidor (seguridad).
- Estados de carga, vacío, error y éxito definidos para cada operación relevante.
- Landing/planes: estáticos. Dashboards/listas: Server Components. Formularios/filtros/flujo de cobro: Client Components puntuales.
- Sin estado global para datos financieros; cada pantalla consulta datos frescos tras un comando exitoso.
- Super Admin: señales de salud y alertas. Administrador: dashboard, cartera filtrable, controles de caja. Cobrador: mobile-first, botones grandes, lista priorizada.
- WhatsApp y mapas vía enlaces profundos; sin SDK de mapas ni geolocalización en V1.

## 6. Pruebas obligatorias

**Unitarias (Vitest):** generación de cuotas y redondeo, aplicación cronológica de pagos, cálculo de mora, cierre de préstamo, refinanciación, cálculo de Caja Menor y diferencias, permisos por rol.

**Integración:** transacciones completas de pago y liquidación, restricciones de negocio, RLS y aislamiento entre negocios, reversos y auditoría, importación de cartera.

**E2E (Playwright):**

1. Super Admin crea, activa y suspende un negocio.
2. Administrador crea cliente, contrato y préstamo.
3. Cobrador registra pago parcial, intento fallido y gasto.
4. Administrador liquida Caja Menor con y sin diferencia.
5. Un usuario no puede leer ni alterar información de otro negocio.

Una interfaz no se considera terminada hasta que estos recorridos pasan automatizados.

## 7. Entornos, observabilidad y backups

- Entornos: `local`, `preview` (por cambio propuesto), `production`.
- Observabilidad: errores centralizados, chequeo externo de disponibilidad, logs/latencia de Route Handlers.
- No se registran contraseñas, documentos de identidad completos, teléfonos completos ni datos financieros sensibles en logs.
- Backups: plan administrado de Supabase con copias diarias verificables, **retención de 7 días**, sin recuperación punto-en-el-tiempo en V1; exportación lógica periódica adicional; un backup no está validado hasta que se ha comprobado que puede restaurarse.
- Moneda: V1 opera en pesos colombianos (COP), sin decimales — los importes se manejan siempre como enteros (unidad mínima = 1 peso). Si en el futuro se soporta una moneda con decimales, revisar `shared/money/money.ts` antes de asumir la unidad mínima actual.
- Identificadores: `negocio.id` es un UUID v4 interno. El número de contrato es un código secuencial legible por negocio (ej. `CT-000123`), generado por el sistema al confirmar, nunca editable.

## 8. Secuencia de implementación

1. Proyecto, convenciones, entornos, migraciones.
2. Autenticación, roles, negocio, RLS.
3. Clientes, contratos, préstamos, cuotas, comandos financieros con pruebas.
4. Caja Mayor, Caja Menor, gastos, liquidaciones.
5. Cobradores, rutas, asignaciones, intentos.
6. Dashboard derivado y listas de cartera.
7. Super Admin, suscripciones, tickets, monitoreo.
8. Pruebas E2E, seguridad, backups, despliegue de producción.

Regla de avance: un módulo no pasa a interfaz completa hasta que sus invariantes de dominio y sus pruebas transaccionales están resueltas. Detalle fase a fase → `04-PLAN.md`.
