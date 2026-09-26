# 01 — Contexto y alcance

## Qué se está construyendo

Una plataforma multi-negocio para negocios que prestan dinero y cobran cuotas mediante cobradores. No es un simple registro de cobros diarios: centraliza la cartera, la operación de los cobradores y el movimiento financiero del negocio.

El resultado que debe conseguir un administrador es poder responder, con datos verificables:

- cuánto dinero se prestó, se recibió, se gastó y permanece en movimiento;
- qué clientes deben, cuánto deben y con qué nivel de cumplimiento;
- qué debe cobrar cada cobrador y qué dinero administra;
- qué dinero se espera recuperar;
- qué ocurrió, cuándo, quién lo hizo y sobre qué operación.

La Caja Mayor, las cajas de los cobradores, las proyecciones y el historial son el núcleo del producto, no funcionalidades secundarias. El dashboard es una vista sobre esos datos, nunca su fuente.

## Áreas de la aplicación

```text
Aplicación
├── Área pública
│   ├── Landing page
│   ├── Planes
│   └── Inicio de sesión
└── Área privada
    ├── Super Admin  — plataforma, negocios y suscripciones
    ├── Administrador — cartera, dinero y operación de un negocio
    └── Cobrador      — ruta, cobros, gastos y liquidación
```

## Actores

| Actor | Resumen |
| --- | --- |
| **Super Admin** | Administra la plataforma, no la operación de un negocio. Crea/activa/suspende negocios, asigna planes, atiende soporte, supervisa backups e incidencias. No crea ni altera contratos, pagos, cajas o liquidaciones de ningún negocio. |
| **Administrador del negocio** | Representa a la organización. Gestiona clientes, contratos, préstamos, cobradores, rutas, cajas, gastos, mora, refinanciaciones y dashboard. V1 tiene **una sola cuenta administrativa principal por negocio**. |
| **Cobrador** | Usuario operativo de un único negocio. Trabaja solo sobre su cartera asignada: consulta obligaciones, contacta, registra pagos/intentos, administra su jornada de Caja Menor, registra gastos y liquida. |
| **Cliente** | Persona a quien el negocio presta dinero. No es usuario de la aplicación en V1. Puede tener varios contratos y préstamos activos. |

**Aislamiento obligatorio:** los datos financieros y operativos de cada negocio son estrictamente independientes. Una persona puede asociarse a más de un negocio sin que eso permita mezclar datos.

## Alcance de V1

### Incluido

- Gestión de múltiples negocios, suscripciones y soporte básico.
- Roles: Super Admin, administrador del negocio, cobrador.
- Clientes, contratos, préstamos, cuotas, pagos, mora y refinanciación con el nivel de detalle definido en `02-DOMINIO.md`.
- Asignación de clientes, rutas simples y registro de actividad de cobro.
- Caja Mayor, Caja Menor, gastos, liquidaciones, movimientos e historial.
- Dashboard configurable, estadísticas, proyecciones e indicador básico de prioridad/reputación (sin scoring automático).
- Contacto por teléfono/WhatsApp y apertura de direcciones en mapas (enlaces profundos).
- Auditoría, backups y monitoreo básico de plataforma.

### Explícitamente fuera de V1

- Operación completamente offline, sincronización avanzada y resolución de conflictos.
- Optimización automática de rutas, geofencing o rastreo permanente de cobradores.
- Scoring de riesgo avanzado, decisiones financieras por IA, automatizaciones avanzadas de WhatsApp.
- Integraciones bancarias, pasarela de pagos, facturación automática, API pública.
- Aplicación o portal para clientes finales.
- Múltiples administradores por negocio o permisos administrativos granulares.
- Saldo a favor, devoluciones o pagos superiores al total adeudado.
- Almacenamiento de comprobantes de gastos, aprobación multinivel de gastos.
- Chat en tiempo real, SLA o adjuntos en tickets de soporte.
- Suspensión o cobro automático de suscripciones.

No se construye ninguna de estas capacidades "como preparación". V1 puede asumir conectividad; el producto debe poder evolucionar hacia ellas sin implementarlas ahora.

## Planes (resumen comercial — detalle de reglas en `02-DOMINIO.md`)

| Capacidad | Semanal | Mensual | Anual |
| --- | :---: | :---: | :---: |
| Cartera, cobros, cajas, liquidaciones | Sí | Sí | Sí |
| Dashboard | Predeterminado | Configurable | Configurable |
| Cobradores activos | Máximo 5 | Sin límite práctico | Sin límite práctico |
| Vigencia | 7 días | 1 mes | 1 año |
| Precio relativo | Base | Estándar | 20 % menos que 12 mensualidades |

Precios monetarios exactos: ver `05-PENDIENTES.md`.

## Principio rector

> Construir un sistema sencillo de utilizar, pero suficientemente estructurado para que el dinero, las obligaciones y las decisiones del negocio nunca pierdan su trazabilidad.

La simplicidad buscada es de uso y de implementación — nunca pérdida de información financiera.
