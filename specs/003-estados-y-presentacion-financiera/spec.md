# Spec: estados de interfaz y presentación financiera

## Estado

**Implementada y aprobada en revisión independiente.** Depende de `specs/002-tokens-y-tema`, implementada y aprobada. La auditoría encontró y corrigió dos importes de listas que no usaban numerales tabulares. Esta spec usa los formatos y reglas financieras ya definidos en `docs/planning/02-DOMINIO.md`, `docs/planning/03-ARQUITECTURA.md` y `src/shared/`; no crea reglas de negocio.

## Objetivo

Hacer consistentes los estados de consulta y escritura, y la lectura de montos, fechas y estados financieros en la interfaz. La persona debe distinguir datos cargando, ausencia real de resultados, fallos y resultados confirmados sin que la UI calcule o sugiera hechos financieros que el servidor no devolvió.

## Alcance

- Definir y aplicar patrones para carga, vacío, error y éxito en pantallas y componentes frontend que consultan o escriben datos.
- Reutilizar los formatos compartidos existentes para montos (`formatMoney`) y fechas (`formatIsoDate`, `formatDateTimeInZone`) sin duplicar formato ni aritmética.
- Aplicar presentación financiera legible y consistente: IBM Plex Mono/tabular nums para importes, etiqueta textual para estados y señales que no dependan solo del color.
- Comunicar el resultado confirmado de comandos financieros con los datos devueltos por servidor y el canal accesible existente.
- Confirmaciones y resumen de consecuencias solo en las acciones cuyo flujo actual o dominio ya exija confirmación; respetar el motivo obligatorio para reversos/anulaciones.

Fuera de alcance: reglas, fórmulas o estados nuevos; cálculos financieros en páginas; cambios de APIs, Route Handlers, servicios, `src/modules/**`, migraciones o RLS; nuevas operaciones, permisos o flujos de negocio; rediseño general o migración completa de pantallas no incluidas en las tareas aprobadas.

## Requisitos funcionales (EARS)

- **RF-01 — Carga de consulta:** Cuando una consulta de pantalla está pendiente, entonces la interfaz muestra una señal de carga perceptible y no presenta la ausencia temporal de datos como estado vacío.
- **RF-02 — Vacío de consulta:** Cuando una consulta termina correctamente y no devuelve registros, entonces la interfaz muestra un mensaje de vacío contextual; solo ofrece una acción sugerida si esa acción ya existe y está permitida para el rol.
- **RF-03 — Error de consulta:** Cuando falla una consulta, entonces la interfaz presenta un mensaje comprensible para el rol, permite identificar el área afectada y no expone stack traces ni códigos técnicos crudos.
- **RF-04 — Resultado de consulta:** Cuando una consulta termina correctamente con información, entonces la interfaz muestra los datos y conserva un tratamiento claro para una lista completa, truncada o filtrada, según los metadatos ya disponibles.
- **RF-05 — Carga de comando:** Cuando una persona envía un formulario, entonces la acción muestra carga simple, bloquea envíos duplicados según el patrón existente y no sugiere que la operación financiera ya se completó.
- **RF-06 — Éxito de comando:** Cuando el servidor confirma un comando, entonces la interfaz anuncia una confirmación breve y verificable usando solo los datos devueltos por el servidor; en pagos, reversos, liquidaciones y caja comunica el efecto pertinente ya devuelto por el comando.
- **RF-07 — Error de comando:** Cuando el servidor rechaza o no puede completar un comando, entonces la interfaz conserva la entrada cuando sea seguro, comunica el mensaje de error disponible y permite corregir o reintentar sin ocultar la causa comprensible.
- **RF-08 — Presentación de montos:** Cuando un importe COP se presenta como valor financiero independiente (métrica, campo, fila de lista, tabla o línea de cálculo), entonces se formatea con `formatMoney`, sin decimales, con signo y separadores coherentes, y usa tipografía mono con numerales tabulares; la UI no convierte importes a `number` decimal ni recalcula saldos. El importe dentro de prosa explicativa, etiquetas de opción y anuncios accesibles (`aria-live`) conserva el formato COP y la lectura natural, sin exigir estilo tabular.
- **RF-09 — Presentación de fechas:** Cuando se muestra una fecha calendario, entonces se formatea con `formatIsoDate`; cuando se muestra un instante, entonces se formatea con `formatDateTimeInZone` y la zona horaria proporcionada por el contexto servidor. La UI no interpreta fechas calendario como instantes UTC.
- **RF-10 — Estado financiero:** Cuando se presenta mora, cuota parcial/vencida/pagada, diferencia de caja o reverso, entonces el estado tiene texto visible (y, si aplica, icono) además de color, y no altera la semántica del estado almacenado o derivado.
- **RF-11 — Confirmación:** Cuando una acción existente requiere confirmación, entonces antes de enviarla se identifica el registro y la consecuencia prevista; si el dominio exige motivo, el formulario lo solicita y valida mediante el flujo ya existente.
- **RF-12 — Accesibilidad de estados:** Cuando cambia un estado de carga, éxito o error de forma dinámica, entonces el cambio se expone con semántica accesible apropiada (`role`, `aria-live` o foco según el patrón) sin anunciar repetidamente contenido estático.

## Reglas de presentación aprobadas

- COP V1 se expresa en pesos enteros y sin decimales; los valores negativos mantienen el signo delante del símbolo (`-$50.000`). El origen del formato es `src/shared/money/money.ts`.
- Las fechas calendario son días, no instantes; los instantes se muestran en la zona IANA del negocio o la zona explícita que provea el servidor. Referencia: `src/shared/dates/dates.ts` y `docs/planning/03-ARQUITECTURA.md` §3.
- Estados de cuota y mora siguen exactamente `docs/planning/02-DOMINIO.md` §2.4 y §3.3. Una cuota vencida con pago parcial sigue comunicándose como `VENCIDA — pago parcial`; no se crea un quinto estado.
- Los mensajes de éxito de comandos no se deducen desde la petición del navegador. Se basan en la respuesta real del servidor y refrescan los datos por el mecanismo actual.
- Las acciones de reverso/anulación explican cuál registro se afecta; los motivos y restricciones siguen siendo los ya establecidos por dominio.

## Criterios de aceptación

1. Cada pantalla/operación incluida en el inventario de tareas tiene estados aplicables documentados: consulta con carga/vacío/error/datos; escritura con reposo/carga/error/éxito, sin confundir reposo con éxito.
2. Los formularios no muestran éxito antes de recibir confirmación del servidor y conservan el bloqueo de doble envío existente.
3. Las vistas financieras incluidas usan los formateadores compartidos y los montos se distinguen con numerales tabulares; no se agrega formateo local duplicado.
4. Las fechas calendario e instantes se distinguen y las vistas usan la zona horaria entregada por servidor donde corresponda.
5. Los estados financieros incluidos conservan etiqueta textual y no se comunican solo con color.
6. Los anuncios dinámicos de éxito/error y la carga se perciben con tecnologías de asistencia sin duplicar anuncios.
7. No cambian datos, permisos, efectos financieros, rutas, mensajes del servidor ni semántica de negocio.

## Riesgos y límites

- Hay pantallas Server Components que fallan mediante el boundary de error de Next, y componentes cliente que gestionan sus estados localmente. La implementación debe respetar el patrón existente de cada área, sin introducir un sistema global de estado.
- Algunos comandos ya anuncian resultados por `useCashFeedback` y otros usan `useCommand`; no deben aparecer dos anuncios para el mismo evento.
- La especificación mejora consistencia de las pantallas priorizadas, pero no promete una migración visual completa de todas las rutas en una sola tarea.

## Fuentes de autoridad

- Negocio: `docs/planning/02-DOMINIO.md`.
- Interfaz, formatos, cuatro estados y seguridad de páginas: `docs/planning/03-ARQUITECTURA.md` §§3 y 5.
- Reglas UI: `.claude/rules/frontend-design.md` §§2, 5 y 6.
- Identidad y tokens: `specs/002-tokens-y-tema/spec.md`.
