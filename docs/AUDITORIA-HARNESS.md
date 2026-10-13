# Auditoría del harness de agentes — Sistema de Gestión de Cobros (Cuadre)

> **Documento de revisión.** No es fuente de verdad del proyecto y no modifica ninguna regla.
> Fecha: 2026-10-12 · Rama auditada: `fix/e2e-paralelismo-base-compartida` · HEAD: `a2d74e0`
>
> **Objetivo:** que una segunda persona revise el estado del harness agéntico y decida qué
> hallazgos aceptar, cuáles descartar y cuáles ejecutar. Los puntos de abajo son
> observaciones, no decisiones tomadas. Las decisiones que sí tocan reglas del proyecto
> van a `docs/planning/05-PENDIENTES.md`, no aquí.

---

## 1. Veredicto en una línea

El **harness de dominio** del repositorio es ejemplar. El déficit no es de disciplina del
proyecto, sino de **costura**: el harness local (`opencode.json`, `.opencode/agents/`) es
fuerte, pero el harness global (`~/.config/opencode/`) está desconectado de él y ambos
compiten por la autoridad de la planificación.

**Puntuación: 68 / 100** en cumplimiento literal del marco de referencia
(`specs/` + EARS + `MEMORY.md` + `constitution.md` + CI + agentes).
Equivale a **~85 / 100** de madurez operativa real.

Los ~57 puntos perdidos **no son ausencia de rigor**: este repo no adoptó ese vocabulario y
construyó uno equivalente y más estricto con `04-PLAN.md` (fases F0–F8, tareas atómicas
F4-T1…T6), `02-DOMINIO.md`, 8 ADRs, `verificador-de-fase` y el skill `checklist-de-fase`.

---

## 2. Matriz de cumplimiento

| # | Pilar | Subpuntos | Estado |
|---|---|---|---|
| 1 | Gobierno y contexto | 1,5 / 3 | 🟡 |
| 2 | Metodología SDD (`specs/`, EARS) | 0,5 / 3 | 🔴 |
| 3 | Arquitectura multiagente y permisos | 2 / 3 | 🟢 |
| 4 | Red de seguridad y testing | 2,5 / 3 | 🟢 |
| 5 | CI/CD y flujo de trabajo en Git | 2,25 / 3 | 🟢 |
| 6 | Integración MCP y herramientas | 2,75 / 3 | 🟢 |

### Lo que ya está bien (no tocar)

- `AGENTS.md` de 123 líneas con trampas reales documentadas (e2e sin Supabase, base
  compartida en paralelo, `.env.example` sí se lee).
- **6 subagentes de dominio** con permisos efectivos: `code-reviewer` y `guardian-de-dominio`
  con `edit` y `shell` en `deny`; denegación explícita de `vercel-react-best-practices` en los
  tres agentes financieros, con el porqué anotado.
- **87 ficheros de prueba**, ~12.600 líneas, 35 de integración. Cada commit `feat` arrastra
  sus pruebas.
- **CI en 3 jobs** (`quality`, `integration`, `e2e`), actions fijadas por SHA,
  `permissions: contents: read`, `concurrency`.
- **42 merges por PR, 0 commits directos en `main`.**
- `05-PENDIENTES.md` + skill `revisar-pendientes`: la regla de "no inventar reglas de
  negocio" está implementada, y es la que más impide que el código se desvíe de
  `02-DOMINIO.md`.

---

## 3. Hallazgos

### 🔴 Críticos

**V-01 — Los 4 agentes del bucle agéntico no son portables.**
`coordinator`, `planner`, `implementer`, `reviewer` y `router` viven en
`~/.config/opencode/agents/`, fuera del repo. Un clon limpio, un CI o otra máquina arrancan
**sin bucle agéntico**: sin planificación y sin revisión independiente. El repo versiona sus
6 agentes de dominio pero no el esqueleto del proceso que los orquesta.
*Impacto: alto · Esfuerzo: bajo (copiar 5 ficheros)*

**V-02 — Colisión de fuentes de verdad: `specs/` vs `docs/planning/`.**
El `planner` global está cableado a `specs/NNN-nombre/{spec,plan,tasks}.md`. El repo usa
`04-PLAN.md` + `02-DOMINIO.md`. Si se invoca `planner`, crea un **segundo sistema de verdad**
que contradice `AGENTS.md` («`02-DOMINIO.md` gana en negocio»). Hoy no ha ocurrido porque
`planner` nunca se ha invocado: es suerte, no garantía.
*Impacto: alto · Esfuerzo: bajo (una decisión de diseño)*

**V-03 — `MEMORY.md` inexistente con el bucle global apuntando a él.**
El `coordinator` tiene `edit * deny` + `allow MEMORY.md`: su única capacidad de escritura
apunta a un archivo que nadie crea. La persistencia entre sesiones que promete la doctrina
global está silenciosamente rota. (En la práctica el estado vive en el repo, que es mejor,
pero el contrato del harness no lo refleja.)
*Impacto: medio · Esfuerzo: bajo*

**V-04 — Byte NUL en `src/modules/portfolio/loan-validation.ts`.**
Presente en HEAD (offset 3432) y en disco (offset 3413). Git clasifica el archivo como
**binario** y así aparece en el historial:

```
 src/modules/portfolio/loan-validation.ts   | Bin 2989 -> 3571 bytes
```

Esto anula lo que `07-FLUJO-DE-TRABAJO.md` §3 declara innegociable: *«Pull request por
tarea, con el diff completo leído por un humano»*. **Un archivo de validación de préstamos
financieros es invisible a revisión humana.** Rompe además `grep` y el code review.
Causa probable: escritura desde PowerShell.
*Impacto: alto · Esfuerzo: bajo (reescribir en UTF-8 sin BOM + LF)*

### 🟠 Altos

**V-05 — Working tree con tres dominios distintos en una sola rama.**
4 ficheros sin commitear: `AGENTS.md` + `opencode.json` (harness),
`playwright.config.ts` (corrección E2E) y `src/app/negocio/caja/page.tsx` (bug de UI).
Viola dos reglas del propio repo: *commits atómicos* y *rama por tarea*. Commiteado junto,
un cambio de permisos acaba justificado por un bug de CSS.
*Esfuerzo: bajo*

**V-06 — `.playwright-mcp/` sin ignorar.** Artefacto MCP visible como untracked; compite
con `git add` y acaba commiteado por descuido. Una línea en `.gitignore`.

**V-07 — Agentes duplicados y ya divergentes.**
`.claude/agents/` y `.opencode/agents/` contienen los mismos 6 agentes, pero **4 de 6 tienen
cuerpos distintos** (hash del cuerpo normalizando CRLF):

| Agente | Estado |
|---|---|
| `code-reviewer` | DIVERGE |
| `escritor-de-comandos-financieros` | DIVERGE |
| `escritor-de-migraciones` | DIVERGE |
| `guardian-de-dominio` | DIVERGE |
| `escritor-de-pruebas` | IGUAL |
| `verificador-de-fase` | IGUAL |

Dos IAs con reglas sutilmente distintas sobre código financiero.

**V-08 — Hook anti-commit en `main` asimétrico.**
`.claude/hooks/block-commit-on-main.sh` protege a Claude Code. **OpenCode no tiene
equivalente**: `opencode.json` permite `git commit*` sin condición de rama. La regla
«nunca commitees en `main`» depende del cliente que se use.

### 🟡 Medios

**V-09 — Sin gate de cobertura.** `package.json` no menciona `coverage` y
`vitest.config.mts` no fija umbral. La regresión se detecta por aserción existente rota,
nunca por caída de cobertura.

**V-10 — TDD por commit, no test-first.** Los commits mezclan `feat` + `test` (F4-T3: 1.372
líneas, 538 de prueba). Cobertura que acompaña al código —aceptable—, pero sin evidencia
verificable de rojo previo en el historial.

**V-11 — Sin `PULL_REQUEST_TEMPLATE.md`, sin `CODEOWNERS`, sin branch protection versionada.**
El hook anti-commit es local. Nada impide por servidor un merge sin revisión ni un push
directo a `main`. Las 42 PRs lo hacen bien por costumbre, no por arquitectura.

**V-12 — GitHub MCP es dependencia de entorno no documentada.**
Vive en `opencode.jsonc` global con `{env:GITHUB_PERSONAL_ACCESS_TOKEN}`. Sin esa variable de
usuario el servidor no autentica (*«Incompatible auth server»*). No está en `AGENTS.md`,
pese a que ese archivo documenta el cableado de herramientas.

### 🟢 Bajos

**V-13 — `engram` MCP deshabilitado** sin nota de si es decisión u olvido.

**V-14 — Ningún ADR cubre las decisiones de harness** (doble configuración
Claude/OpenCode y quién manda en cada eje), que ocuparon 3 commits y modificaron la
gobernanza del proyecto.

---

## 4. Plan de acción propuesto

Marca lo que aceptes. Los tres primeros caben en una hora.

### Prioridad ALTA — antes de empezar F5

- [ ] **A-1** (V-05) Separar el WIP: `playwright.config.ts` → rama `fix/e2e-*`;
      `caja/page.tsx` → rama propia; `AGENTS.md` + `opencode.json` → rama `chore/harness`.
      Tres commits, tres justificaciones.
- [ ] **A-2** (V-04) Eliminar el byte NUL de `loan-validation.ts` (UTF-8 sin BOM, LF) y
      añadir un guard en CI: `git diff --check` no lo detecta, hace falta
      `grep -rlP '\x00' src/` en el job `quality`. Sin el guard, el byte vuelve en la
      siguiente sesión de PowerShell.
- [ ] **A-3** (V-06) Añadir `.playwright-mcp/` a `.gitignore`.
- [ ] **A-4** (V-01) Portar `coordinator`, `planner`, `implementer`, `reviewer` y `router` a
      `.opencode/agents/` del repo; dejar `~/.config/opencode` como override del usuario, no
      como fuente de verdad. El arreglo que más madurez devuelve por minuto invertido.
- [ ] **A-5** (V-02) Decidir por escrito la colisión `specs/` y anotarla en
      `05-PENDIENTES.md`:
      - **Opción A** — mapear `planner` a `docs/planning/` (respeta la autoridad existente).
      - **Opción B** — adoptar `specs/` y **degradar `04-PLAN.md` a índice**.
      *No decidir deja a `planner` apuntando a un directorio fantasma.*
- [ ] **A-6** (V-03) Resolver `MEMORY.md`: si es global, crearlo fuera del repo y
      documentarlo en `AGENTS.md`; si es de repo, decidir que se commitea.

### Prioridad MEDIA — durante F5

- [ ] **M-1** (V-07) Sincronizar los 4 agentes divergentes y añadir
      `scripts/check-agent-sync.mjs` que falle en CI si `.claude/agents/X.md` ≠
      `.opencode/agents/X.md`. Elimina la clase de bug, no el síntoma.
- [ ] **M-2** (V-08) Guard de rama para OpenCode replicando el hook de Claude Code.
- [ ] **M-3** (V-11) `PULL_REQUEST_TEMPLATE.md` + `CODEOWNERS` + branch protection en `main`
      (require PR, require CI, require 1 review).
- [ ] **M-4** (V-09) `vitest run --coverage` con umbral (~70 % en `src/modules/**`) en el job
      `quality`.
- [ ] **M-5** (pilar 2) Adoptar EARS en los criterios de aceptación de F5–F8 sin reescribir
      F0–F4: `04-PLAN.md` gana en forma, `02-DOMINIO.md` sigue ganando en contenido.

### Prioridad BAJA — mantenimiento

- [ ] **B-1** (V-14) ADR 0009 — «Gobierno del harness: Claude Code y OpenCode».
- [ ] **B-2** (V-12) Documentar `GITHUB_PERSONAL_ACCESS_TOKEN` en «Entorno» de `AGENTS.md`.
- [ ] **B-3** (V-13) Decidir `engram`: activar o eliminar.
- [ ] **B-4** (pilar 2) Si A-5 va hacia `specs/`, evaluar un `spec.md` **por feature** en
      F5: cobradores, Caja Menor y liquidación tienen entidad suficiente para tres specs.

---

## 5. Preguntas abiertas para quien revise

1. **A-5 es la decisión de fondo.** ¿Se adapta el harness global al vocabulario del repo
   (opción A) o se migra el repo al vocabulario del harness (opción B)? La opción A es más
   barata; la B escala mejor si el harness se comparte con otros proyectos.
2. ¿Los agentes financieros deben tener permiso de `shell` para `npm run db:*`? Hoy no lo
   tienen; se valida a través de CI y del humano.
3. ¿70 % de cobertura es el umbral adecuado para un módulo financiero, o conviene separar
   umbrales por capa (dominio alto, UI bajo)?
4. ¿La divergencia entre `.claude/agents/` y `.opencode/agents/` es intencional (OpenCode
   adaptado) o deriva sin querer? De la respuesta depende si M-1 es «sincronizar» o
   «documentar que divergen a propósito».

---

## 6. Cómo se auditó

Inspección de estructura y permisos (`opencode.json`, `.claude/settings.json`, frontmatter de
los 11 agentes), historial de Git (74 commits, 42 merges, convención de mensajes por fase),
carpeta de pruebas (87 ficheros, 12.623 líneas), `.github/workflows/ci.yml`, configuración
MCP de proyecto y global, y estado del working tree. Comandos de solo lectura; no se modificó
ningún archivo del repositorio.