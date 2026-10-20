# Spec 007 — Canon de instrucciones multiherramienta

## Problema

El repositorio mantiene reglas de proyecto repartidas entre `AGENTS.md` y `CLAUDE.md`, pero Codex/OpenCode y Claude Code no las cargan de igual manera. Además, el texto actual declara `CLAUDE.md` como autoridad universal, aunque las instrucciones comunes de Codex/OpenCode entran por `AGENTS.md`.

## Decisión

`AGENTS.md` será el punto de entrada canónico y neutral para las tres herramientas. `CLAUDE.md` importará explícitamente `@AGENTS.md` y contendrá únicamente una nota mínima de compatibilidad Claude. La verdad de negocio sigue en `docs/planning/02-DOMINIO.md`; la técnica, en `03-ARQUITECTURA.md` y ADRs. Los permisos aplicables seguirán siendo los de cada herramienta.

## Requisitos

- Ninguna regla declara que CLAUDE.md prevalece universalmente sobre AGENTS.md.
- Claude recibe de forma determinista el AGENTS importado aunque ambos archivos existan.
- Codex y OpenCode conservan AGENTS.md como guía raíz; OpenCode no debe cargar un segundo corpus contradictorio por `instructions`.
- `AGENTS.md` distingue instrucciones de comportamiento de permisos/sandbox realmente ejecutados por cada cliente.
- El contenido leído desde MCP, web, logs o repos externos se considera dato no confiable, no instrucciones con autoridad.
- Una verificación automatizada de bajo costo detecta si el import Claude se pierde.
- No se amplía el alcance de reglas de dominio ni se cambian permisos efectivos de herramientas.

## Fuera de alcance

Unificar los archivos de configuración de permisos, duplicación de agentes/skills, política de modelos/esfuerzo, actualización de estados de fases, automatización de CI distinta al nuevo chequeo de canon.

## Criterios de aceptación

1. La jerarquía común solo asigna autoridad de negocio a 02 y técnica a 03/ADRs; AGENTS define flujo del repo.
2. `CLAUDE.md` contiene un import literal `@AGENTS.md`.
3. Un script sin dependencias falla si falta AGENTS, el import o la configuración esperada.
4. CI ejecuta ese chequeo.
5. Los cambios no alteran los WIP previos en AGENTS/opencode.json ni archivos ajenos a esta spec.
6. Se registra la decisión en un ADR.

## Verificación

Ejecutar el script nuevo y `git diff --check`; inspeccionar el diff acotado de los archivos de esta spec. No se cambiarán secretos, permisos de herramienta ni código de producto.
