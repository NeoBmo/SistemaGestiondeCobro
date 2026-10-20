# Spec 009 — Estado y evidencia de F7/F8

## Problema

El estado de fase diverge entre README y AGENTS, y MEMORY retiene checkpoints anteriores al E2E completo de 2026-10-19. El cierre de F7 requiere verificar los criterios literales de `docs/planning/04-PLAN.md`; F8 tiene decisiones abiertas en `05-PENDIENTES.md` que no deben resolverse por inferencia.

## Alcance

- Alinear el estado declarado: F0–F6 reportadas como terminadas, F7 en cierre/verificación, F8 pendiente y bloqueada por criterios abiertos.
- Conservar los criterios de salida de `04-PLAN.md`; el estado documental no equivale a certificación de fase.
- Añadir una nota de precedencia temporal en MEMORY: los resultados posteriores de E2E reemplazan checkpoints antiguos, sin borrar el historial.
- Corregir documentación de spec 006 que aún afirma que Supabase/E2E están pendientes, manteniendo la checklist manual sin cerrar.
- Mantener todos los ítems de `05-PENDIENTES.md` abiertos. No editar negocio, infraestructura, secretos ni pruebas.

## Criterios de aceptación

1. README y AGENTS coinciden sobre la fase actual y no presentan F5 como siguiente.
2. `04-PLAN.md` sigue siendo la fuente de criterios de salida y distingue estado reportado de cierre verificado.
3. MEMORY señala el E2E más reciente (79 passed, 1 skip) y no lo contradice con el checkpoint previo al arranque de Supabase.
4. Spec 006 conserva pendiente su checklist manual AA/responsive, y deja claro que métricas no son gates.
5. Los pendientes F8 se listan como bloqueadores, sin decidirlos ni borrarlos.

## Fuera de alcance

Cerrar F7, cerrar la spec 006, decidir asuntos de `05-PENDIENTES.md`, cambiar el comportamiento financiero, configurar entornos remotos o iniciar F8.

## Verificación

Contrastar cada estado con archivos/criterios y `MEMORY.md`; revisar los diffs acotados y ejecutar `git diff --check`. No se ejecutan suites ni se realizan cambios de base de datos.
