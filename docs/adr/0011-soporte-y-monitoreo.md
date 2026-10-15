# ADR 0011 — Tickets de soporte y monitoreo de plataforma

- **Estado:** aceptada
- **Fecha:** 2026-10-16
- **Fuente:** `02-DOMINIO.md` §6.2, §8 y §1.3; `03-ARQUITECTURA.md` §1 y §7

## Contexto

F7 completa al Super Admin con soporte (tickets), monitoreo básico y una vista de operación. `02` define el ticket (negocio, creador, fecha, descripción, respuesta, última actualización, estado, prioridad; sin chat, adjuntos ni SLA) pero no quién cambia cada estado ni cómo se guarda el historial; `03` pide «registro de errores centralizado + chequeo de disponibilidad» y backups con retención de 7 días, sin decir de dónde sale el dato en el panel. El dueño del producto lo decidió el 2026-10-16.

## Decisión

- **Tickets.** El Admin del negocio crea el ticket (descripción y prioridad `ALTA`/`MEDIA`/`BAJA`) y lo ve solo su negocio. El Super Admin lo atiende: pasa a `EN_ATENCION` o `RESUELTO`, puede cambiar la prioridad y escribe o actualiza la **respuesta** (un solo campo, sin chat). El Admin cierra un ticket `RESUELTO` (`CERRADO`) o lo reabre (`ABIERTO`); `CERRADO` es final. El cobrador no ve tickets.
- **Historial.** Cada cambio (creación, estado, prioridad, respuesta) es un evento de solo agregado ligado al ticket; el ticket conserva solo el estado vigente. Nada se borra.
- **Registro de errores.** Los errores 500 inesperados de los Route Handlers se guardan como eventos de plataforma (tipo, ruta y fecha; nunca el mensaje ni datos del usuario o del negocio). Registrar es de mejor esfuerzo: un fallo al registrar nunca altera la respuesta.
- **Disponibilidad y latencia.** Un chequeo programable (un `POST` autenticado con un secreto de entorno desde un servicio externo, p. ej. un cron) verifica la base y la autenticación, y guarda el resultado y la latencia. Una interrupción es un chequeo fallido o la **ausencia** de chequeos recientes (si la base no responde no se puede escribir); ambas se muestran en el panel. No hay alertas por correo ni mensajería en V1.
- **Backups.** El Super Admin registra cada verificación de backup (fecha, resultado, nota). El panel muestra la última y avisa si pasaron más de 24 horas o si el registro no cubre los últimos 7 días. No se integra con el proveedor.
- **Indicadores del Super Admin.** Disponibilidad y latencia (24 h y 7 días), errores (24 h), último backup, tickets abiertos por prioridad y negocios con suscripción próxima a vencer o vencida. La alerta de suscripción **no** suspende: la única compuerta de acceso sigue siendo `businesses.access_status` (ADR 0003).

## Forma técnica

- Las escrituras son comandos de administración (transacción única y auditoría, sin dinero ni clave de idempotencia). Las tablas de eventos, chequeos y verificaciones son de solo agregado; solo el ticket tiene columnas de estado mutables.
- El chequeo programado no usa sesión: se autentica con el secreto, que se compara en tiempo constante, y nunca se registra.

## Consecuencias

- El panel indica salud con datos propios, sin servicios externos de monitoreo; si hace falta más, se sustituye la fuente sin cambiar el panel.
- La respuesta de un ticket se sobrescribe, pero cada versión queda en su evento.
