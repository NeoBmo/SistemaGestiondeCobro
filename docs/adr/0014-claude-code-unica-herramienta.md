# ADR 0014 — Claude Code como única herramienta agéntica

- Estado: Aceptado
- Fecha: 2026-10-24
- Reemplaza: ADR 0012 (canon de instrucciones multiherramienta)
- Contexto: ADR 0012 hizo de `AGENTS.md` la entrada común para Codex, Claude Code y OpenCode, con `CLAUDE.md` importándolo. En la práctica, mantener tres herramientas duplicó la configuración (agentes en `.claude/agents/` y `.opencode/agents/` con cuerpos ya divergentes, permisos en `.claude/settings.json` y `opencode.json`, hooks solo en Claude Code) y abrió huecos: la regla de no commitear en `main` solo se aplicaba en una herramienta (auditoría V-07/V-08). El dueño decidió trabajar el proyecto únicamente con Claude Code.

## Decisión

- Claude Code es la única herramienta agéntica del repositorio.
- `CLAUDE.md` es la única guía operativa (contiene lo que antes estaba en `AGENTS.md`). No existe `AGENTS.md`.
- Subagentes en `.claude/agents/`, skills en `.claude/skills/`, reglas en `.claude/rules/`, permisos y hooks en `.claude/settings.json`.
- Se eliminan `opencode.json`, `.opencode/` y los metadatos de Codex dentro de las skills.
- La autoridad de contenido no cambia: `02-DOMINIO.md` en negocio; `03-ARQUITECTURA.md` y ADR aceptados en lo técnico.

## Consecuencias

- `check:agent-instructions` falla si reaparece `AGENTS.md`, `opencode.json` o `.opencode/`, o si `CLAUDE.md` pierde alguna de las 9 reglas de negocio no negociables.
- `next dev` mantiene su bloque de reglas de Next.js dentro de `CLAUDE.md` cuando no existe `AGENTS.md` (`node_modules/next/dist/server/lib/generate-agent-files.js`); no vuelve a crear `AGENTS.md`.
- La política de esfuerzo y revisión por riesgo (ADR 0013) sigue vigente; la revisión independiente se hace con subagentes de Claude Code o con revisión humana.
- Volver a varias herramientas exigiría un ADR nuevo y reintroducir una fuente compartida con su chequeo de sincronía.
- Los documentos de `docs/auditoria/` y `specs/` que mencionan Codex/OpenCode son historial y no se reescriben.
