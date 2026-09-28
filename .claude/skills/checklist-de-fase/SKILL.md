---
name: checklist-de-fase
description: Imprime los criterios de aceptación, pruebas críticas y criterio de salida de una fase de docs/planning/04-PLAN.md como checklist para revisión manual antes de merge. Úsalo con el id de fase (F0–F8).
---

# Checklist de fase

Argumento: id de fase (`F0`…`F8`). Si falta, pregunta cuál.

1. Lee `docs/planning/04-PLAN.md` y localiza la sección de esa fase.
2. Imprime, sin resumir ni reinterpretar, tres bloques como casillas `- [ ]`:
   - **Trabajo** (un ítem por elemento separado por `·`);
   - **Pruebas críticas** (un ítem por prueba);
   - **Criterio de salida** y **Criterios de aceptación** si existen.
3. Añade al final los puntos del «Criterio general de terminado» aplicables.
4. No marques ninguna casilla: la verificación con evidencia la hace `verificador-de-fase`.
