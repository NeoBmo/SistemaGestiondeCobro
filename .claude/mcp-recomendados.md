# MCP recomendados para este proyecto

> Activar desde la configuración de Claude Code (`claude mcp add <nombre>` o el flujo equivalente de tu versión). Verifica la sintaxis exacta en la documentación vigente de Claude Code antes de activar — este documento fija el **qué** y el **porqué** para este proyecto, no el comando literal de instalación de cada versión.

| MCP | Por qué en este proyecto | Cuándo se usa |
| --- | --- | --- |
| **Playwright** (o Chrome DevTools MCP) | El perfil Cobrador es mobile-first y los tres perfiles exigen 4 estados visuales obligatorios (`.claude/rules/frontend-design.md`). Este MCP cierra el bucle: implementar → abrir en navegador real → verificar visualmente → corregir, sin salir de la sesión ni depender de que el humano confirme cada detalle visual. | Al terminar cualquier tarea de UI (login F1, flujo de cobrador F5, dashboard F6) — antes de dar la tarea por cerrada, no después. |
| **Context7** | El stack fija versiones exactas (Next.js 16, React 19, Tailwind 4, Supabase). Estas librerías cambian rápido y el conocimiento de entrenamiento del modelo puede estar desactualizado para una API reciente (App Router de Next 16, RLS de Supabase). Context7 trae documentación real de la versión instalada en vez de que el modelo la infiera de memoria. | Antes de implementar contra cualquier API de Supabase, Next.js o librería del stack cuyo comportamiento exacto de versión importe (RLS, Server Actions, App Router). |

## Regla de uso

Ningún MCP sustituye la autoridad de `docs/planning/02-DOMINIO.md` en reglas de negocio.

- **Context7** resuelve dudas de *cómo* usar una librería — nunca de *qué* debe hacer el sistema.
- **Playwright** verifica que la UI implementada cumple lo ya decidido en `.claude/rules/frontend-design.md` — no decide diseño nuevo por sí solo, y no reemplaza al subagente `code-reviewer` para la lógica de negocio.
