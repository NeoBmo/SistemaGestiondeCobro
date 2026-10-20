# Spec 014 — Flujo de PR, aislamiento y revisión

## Decisiones locales

- Cada tarea usa su rama; nunca trabajar/commitear en `main` (AGENTS).
- Los commits son checkpoints/versiones atómicas de la rama. Merge a `main` solo por PR, con verificaciones aplicables verdes y aprobación humana explícita.
- Para sesiones agénticas que se solapan, preferir worktrees Git separados o una sesión por rama. Compartir un checkout no permite que dos agentes editen la misma área de forma segura.
- `CODEOWNERS` declara revisión por área; aprobación obligatoria depende de protección de rama en GitHub.
- Los cambios T3 (dinero, auth/RLS, migraciones, seguridad, concurrencia) reciben revisión independiente y humana según política del repo; una herramienta distinta reduce sesgo común, no garantiza corrección.
- La CI es la barrera común automatizada de estilo y tipos; humanos revisan reglas del dominio, intención y riesgos que no expresan los checks.

## Estado

Plantilla de PR agregada en `.github/PULL_REQUEST_TEMPLATE.md`. Inspección remota de solo lectura: GitHub reporta `main` como no protegida (`protected: false`) y ruleset `main` (`https://github.com/NeoBmo/SistemaGestiondeCobro/rules/24333075`) con enforcement `disabled`; define 1 aprobación, `require_code_owner_review: false`, y contextos requeridos `quality`, `integration`, `E2E (Playwright)`. Los jobs del workflow tienen nombres visibles `Calidad (format, typecheck, lint, test, build)`, `Integración (Supabase local)` y `E2E (Playwright)`, así que los dos primeros contextos podrían no corresponder. El commit observado de `main` no presenta status checks combinados, por lo que no se pudo contrastar los contextos en una ejecución. GitHub confirmó a `NeoBmo` como admin y `Lballest25` con write. No se cambió configuración remota ni `main`.

## Criterios de salida

- [x] Plantilla solicita alcance, riesgo y evidencia de verificación.
- [x] Política de ramas, worktrees y revisión independiente documentada.
- [ ] El dueño revisa y habilita la protección de `main` cuando lo apruebe; antes alinear los contextos requeridos de CI y activar `require_code_owner_review`. Esta tarea solo registra la evidencia y no cambia ajustes remotos.
- [ ] Probar en PR que CODEOWNERS solicita los revisores correctos y no permite bypass no deseado.
