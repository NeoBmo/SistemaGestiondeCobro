# 06 — Agentes y habilidades para Claude Code

> Objetivo de este documento: que trabajar con Claude Code en este repo sea repetible y no dependa de que cada sesión "recuerde" las reglas de `02-DOMINIO.md` y `03-ARQUITECTURA.md` de memoria. Verifica la sintaxis exacta de subagentes/skills en la documentación actual de Claude Code antes de crearlos — aquí se da el criterio de diseño, no la sintaxis literal.

## 1. Por qué dividir el trabajo así

Este proyecto tiene un riesgo específico de "código espagueti": mezclar la capa de negocio (reglas financieras de `02-DOMINIO.md`) con la capa de infraestructura (Route Handlers, RLS, migraciones). El objetivo de agentes/skills no es "ir más rápido", es **forzar que cada cambio pase por el filtro correcto** antes de tocar código.

## 2. Subagentes recomendados (`.claude/agents/`)

| Agente | Cuándo se invoca | Qué hace / qué NO hace |
| --- | --- | --- |
| `guardian-de-dominio` | Antes de implementar o modificar cualquier cosa en `modules/portfolio`, `modules/cash`, `modules/collections` | Lee `02-DOMINIO.md` y valida que el cambio propuesto respete estados, invariantes y la regla de aplicación de pagos. Rechaza cualquier cambio que invente una regla no listada ahí; en ese caso remite a `05-PENDIENTES.md` en vez de decidir. No escribe código de infraestructura. |
| `escritor-de-migraciones` | Cuando un cambio de dominio requiere alterar el esquema | Genera migraciones versionadas siguiendo `03-ARQUITECTURA.md` §4 (FKs, `business_id`, restricciones, índices). Nunca edita una migración ya aplicada; siempre crea una nueva. |
| `escritor-de-comandos-financieros` | Al implementar cualquier operación de la lista: pago, gasto, transferencia, liquidación, ajuste, reverso, refinanciación | Aplica el patrón obligatorio de `03-ARQUITECTURA.md` §3: Route Handler → validación → servicio de dominio → transacción con auditoría e idempotencia. No entrega el comando como "terminado" sin su prueba de integración. |
| `escritor-de-pruebas` | Después de cualquier cambio en `modules/` | Escribe/actualiza pruebas Vitest (reglas de dominio) o Playwright (flujos E2E de `04-PLAN.md`) según corresponda a la fase activa. No reduce cobertura existente para "hacer pasar" un cambio. |
| `verificador-de-fase` | Antes de dar una fase de `04-PLAN.md` por cerrada | Contrasta el trabajo hecho contra los "criterios de aceptación"/"criterio de salida" exactos de la fase en curso. Si algo falta, lo dice explícitamente en vez de asumir que "ya casi está". |
| `code-reviewer` ✅ implementado en `.claude/agents/code-reviewer.md` | Después de cualquier tarea, antes de commit/PR | Revisor de diff independiente (solo `Read`, `Grep`, `Glob` — sin Bash, así que quien lo invoca debe pasarle la lista de archivos cambiados, no la obtiene solo). Da veredicto `APROBADO`/`APROBADO CON OBSERVACIONES`/`RECHAZADO`. Complementa a `verificador-de-fase`: este revisa un diff puntual, aquel revisa el cierre de una fase completa. |

## 3. Skills / comandos recomendados (`.claude/skills/` o slash commands)

| Skill | Uso |
| --- | --- |
| `nueva-entidad-dominio` | Scaffolding de una entidad nueva de `02-DOMINIO.md`: tipos, validación Zod, migración base, servicio vacío, carpeta de pruebas — siguiendo la estructura de `03-ARQUITECTURA.md` §2. |
| `nuevo-comando-financiero` | Scaffolding de un comando financiero completo (Route Handler + servicio + transacción + auditoría + prueba de integración) a partir del patrón de `03-ARQUITECTURA.md` §3. |
| `checklist-de-fase` | Imprime los criterios de aceptación de la fase activa de `04-PLAN.md` para revisión manual antes de merge. |
| `revisar-pendientes` | Recorre `05-PENDIENTES.md` y avisa si algo en el diff actual toca una de esas áreas. |

## 4. Herramientas / MCP útiles

- **Supabase MCP** (si está disponible): consultar el esquema real, RLS y migraciones aplicadas sin salir de la sesión, para evitar que un agente proponga una migración que ya existe o contradiga una política de RLS vigente.
- **GitHub/Git**: para que las fases de `04-PLAN.md` se reflejen en historial de commits/PRs claramente delimitado por fase — facilita auditar qué fase introdujo qué.

## 5. Regla de convivencia con `CLAUDE.md`

`CLAUDE.md` en la raíz sigue siendo la autoridad que cualquier agente lee primero. Los subagentes de este documento son una forma de **aplicar** esas reglas de forma consistente, no de reemplazarlas. Si un subagente y `CLAUDE.md` entran en conflicto, gana `CLAUDE.md`, y eso es señal de que el subagente necesita ajustarse — no al revés.

## 6. Qué mantener actualizado a mano (no automatizable)

- `05-PENDIENTES.md`: cuando una decisión pendiente se resuelve, se mueve a `02-DOMINIO.md`/`03-ARQUITECTURA.md` y se borra de aquí en el mismo cambio.
- `04-PLAN.md`: si una fase cambia de alcance, se edita ahí antes de que el código diverja del plan escrito.
