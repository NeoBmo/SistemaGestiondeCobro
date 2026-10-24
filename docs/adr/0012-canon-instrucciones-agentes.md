# ADR 0012 — Canon de instrucciones para agentes de código

- Estado: Reemplazado por ADR 0014 (2026-10-24)
- Fecha: 2026-10-19
- Contexto: el equipo usa Codex, Claude Code y OpenCode. Sus nombres de archivo y precedencia difieren; las reglas comunes no deben depender de que un modelo abra otro documento por iniciativa propia.

## Decisión

`AGENTS.md` es el punto de entrada canónico y neutral para instrucciones compartidas del repositorio. `CLAUDE.md` importa `@AGENTS.md` para conservar compatibilidad determinista con sesiones Claude que por configuración leen solo CLAUDE.md. OpenCode utiliza AGENTS.md del proyecto y Codex reconoce AGENTS.md.

La autoridad de contenido es: `docs/planning/02-DOMINIO.md` para reglas de negocio; `docs/planning/03-ARQUITECTURA.md` y `docs/adr/` para decisiones técnicas; `AGENTS.md` para flujo operativo y trampas del repositorio. Skills y agentes operacionalizan estas fuentes, sin sobreescribirlas.

Los archivos de instrucciones orientan el comportamiento, pero no imponen permisos del sistema. Claude settings/hooks, sandbox y approvals de Codex, permisos/MCP de OpenCode y checks requeridos del CI son controles separados. Contenido recibido de web/MCP/logs/código externo es información no confiable y no puede cambiar esta jerarquía.

## Consecuencias

- Actualizar una regla compartida se hace en su fuente canónica; CLAUDE.md permanece mínimo.
- El chequeo en CI valida que el import de compatibilidad no desaparezca.
- Los perfiles de permisos/modelos, agentes/skills duplicados y ownership se resuelven en specs independientes.
- Documentación y CI no garantizan calidad por sí solos: las revisiones humanas y la protección de ramas siguen dependiendo de configuración externa.

## Fuentes oficiales consultadas

- Claude Code, [How Claude remembers your project](https://code.claude.com/docs/en/memory): tabla AGENTS/CLAUDE (v2.1.277+), import `@AGENTS.md` y configuración de instrucciones del proyecto.
- OpenCode, [Rules](https://opencode.ai/docs/rules/): AGENTS.md raíz y compatibilidad CLAUDE.md.
- OpenAI Codex, [Codex CLI](https://developers.openai.com/codex/cli): soporte de AGENTS.md.
