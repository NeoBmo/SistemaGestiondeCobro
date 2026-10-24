# 02 — Flujo agéntico específico de frontend

## Autoridad y roles de UI

- `CLAUDE.md` es la guía operativa de Claude Code, la única herramienta agéntica del proyecto (ADR 0014). `.claude/rules/frontend-design.md` fija los requisitos de UI: responsividad mobile-first, WCAG 2.1 AA, movimiento reducido, jerarquía tipográfica, cuatro estados visuales y color no exclusivo.
- `CLAUDE.md` describe el flujo general y la protección del repositorio. Este documento agrega solamente el criterio frontend; no reemplaza ni duplica sus pasos, comandos, reglas de Git o política de seguridad.
- `code-reviewer` evalúa el diff de UI frente a reglas de diseño y arquitectura, con atención a estados, accesibilidad, contraste, montos y ausencia de dependencias no aprobadas. Su dictamen no define la identidad visual.
- `verificador-de-fase` comprueba criterios de cierre de fase completa; no sustituye la revisión focalizada de una pantalla o componente.
- `docs/frontend/00-DIAGNOSTICO.md` es evidencia de auditoría, `01-PLAN-FRONTEND.md` contiene dirección de trabajo y la spec aprobada define los requisitos de cada tarea. Ante contradicción, gana la fuente superior definida en `CLAUDE.md`.

## Definición frontend de terminado

Una pantalla o componente se considera terminado cuando, según su alcance aprobado:

1. consume tokens compartidos y no introduce identidad visual ni valores de marca por inferencia;
2. funciona en los viewports que exige su perfil, incluyendo 360, 768 y 1280 px cuando corresponda, sin pérdida de información ni acciones inaccesibles;
3. puede operarse con teclado y comunica nombre, foco, ayuda, errores y cambios de estado a tecnología de asistencia;
4. expone carga, vacío, error y éxito si consulta o modifica datos, incluyendo el resultado verificable de comandos financieros;
5. presenta dinero, fechas, mora, reversos y diferencias con convenciones compartidas y señales que no dependen solo del color;
6. pasa las verificaciones automatizadas y manuales enumeradas en su spec, y registra cualquier limitación no cubierta;
7. mantiene lectura en servidor por defecto; añade interacción de cliente solo si la interacción requiere estado o eventos en el navegador.

## Fuente de verdad

`CLAUDE.md` es la guía operativa y enlaza las fuentes normativas de `docs/planning/` y `docs/adr/`. Los documentos de `docs/frontend/` amplían el trabajo frontend sin copiar reglas de dominio o arquitectura. Las skills y agentes pueden operacionalizar un requisito, nunca reemplazarlo ni introducir decisiones visuales o de producto. Si una regla se repite y cambia, actualizar su fuente normativa y enlazarla en vez de mantener dos copias divergentes.
