# Auditoría del proyecto — 2026-10-19

## Resumen ejecutivo

1. La base de dominio es sólida: fases F0–F6 aparecen implementadas y hay 24 migraciones; F7 está en cierre/verificación.
2. En la auditoría inicial faltaba una guardia modular; spec 008 ya la añadió. Cobertura y presupuestos de rendimiento siguen sin umbrales CI.
3. La política multiherramienta divergente de la auditoría inicial se alineó en spec 007: AGENTS es el canon y CLAUDE lo importa.
4. Finanzas tiene señales de buena disciplina (Money, transacciones, auditoría, idempotencia, RLS, inmutabilidad), pero la auditoría de código aquí fue por muestras y no certifica cada comando.
5. F8, el cierre formal de la spec 006 y la verificación de restauración/producción siguen abiertos; no declarar lanzamiento listo.

### Avance de remediación (2026-10-19)

- **007 completada:** canon común en AGENTS, import en CLAUDE, ADR 0012 y chequeo ejecutado en CI.
- **008 completada:** `check:module-boundaries` revisó 67 fuentes; la allowlist pasó y se eliminó el ciclo de tipo `identity ↔ audit`. Typecheck pasó.
- **009 completada:** estados documentales conciliados. F7 no se declara cerrada; los pendientes F8 quedan abiertos a petición del dueño.
- **010 completada con límite de entorno:** allocator cronológico compartido y pruebas generadas deterministas; 300 tests unitarios pasan. La integración financiera no pudo conectarse a Supabase local (`127.0.0.1:54322`, `EACCES`), por lo que no se certifica aquí.
- **015 completada como baseline no bloqueante:** `npm run report:code-hotspots` genera `docs/auditoria/02-HOTSPOTS.md`; detecta archivos de producto y pruebas grandes, pero no duplicación ni código muerto.
- **016 completada:** ADR 0013 establece T1/T2/T3 relativos al riesgo, sin fijar proveedor/modelo ni cambiar permisos.
- **012 parcial:** `codex/security-updates` actualiza Next y eslint-config-next a 16.4.2; `npm audit --json` ahora muestra 5 nodos altos del mismo advisory transitivo `braces` (source-map-js y avisos de Next ya no aparecen). La solución sugerida para lint es downgrade major y se rechazó. Vitest completo aún tiene fallo ambiental ENOENT; push protection no se confirmó.
- **013 parcial:** CODEOWNERS y contrato inicial están en `specs/013-contrato-y-ownership-de-directorios/`. GitHub confirmó `NeoBmo` admin y `Lballest25` write; falta que el archivo llegue al branch base y probar la asignación en un PR.
- **014 parcial:** plantilla de PR y política local están en `.github/PULL_REQUEST_TEMPLATE.md`; CODEOWNERS y contrato por directorios están preparados. El dueño reportó que activó la protección de `main` después de la consulta remota previa (`protected: false`); no se verificó de nuevo ni se modificaron settings remotos.
- **F8 sigue abierto:** no se fijaron presupuestos de rendimiento ni supuestos de volumen/dispositivo; spec 011 queda diferida a F8. No se tocaron reglas ni settings remotos.

## Veredicto de hipótesis

| Hipótesis | Veredicto | Evidencia y matiz |
|---|---|---|
| 1. Claude 2.1.277 lee AGENTS solo si falta CLAUDE; si ambos, solo CLAUDE | **Confirmada** por la documentación oficial actual: el soporte directo de AGENTS requiere v2.1.277+; con ambos archivos Claude carga CLAUDE por defecto. También documenta la opción `@AGENTS.md` que los incluye ambos. | [Claude Code memory](https://code.claude.com/docs/en/memory) |
| 2. Codex lee AGENTS, no CLAUDE, y las reglas de CLAUDE no son deterministas | **Parcialmente confirmada**: Codex reconoce/inserta AGENTS.md; CLAUDE.md no aparece como su fuente persistente documentada. La afirmación absoluta de que nunca lee CLAUDE no se verifica, pero no debe dependerse de que lo abra por iniciativa propia. | [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) |
| 3. Permisos Claude no gobiernan Codex/OpenCode | **Confirmada**: `.claude/settings.json` configura permisos/hooks Claude; `opencode.json` posee reglas propias de shell/lectura/edición; Codex usa su propio sandbox/permisos de ejecución. | [Claude settings](https://docs.anthropic.com/en/docs/claude-code/settings), [OpenCode permissions](https://opencode.ai/docs/permissions/), [Codex sandbox](https://developers.openai.com/codex/security) |
| 4. Patrón común: AGENTS canónico, CLAUDE importa | **No verificada** como “lo habitual”. Los docs oficiales describen compatibilidades y alternativas, no un patrón universal. Sí es una opción de diseño útil para este repo porque Codex/OpenCode reconocen AGENTS. OpenCode prioriza AGENTS y usa CLAUDE como fallback, así que con ambos no consume CLAUDE automáticamente. | [OpenCode rules](https://opencode.ai/docs/rules/) |
| 5. CI es la única barrera común a herramientas | **Refutada literalmente / confirmada en esencia**: CI es la puerta común automática de integración, pero los controles de GitHub (protección de rama), hooks locales y sandbox del entorno también limitan acciones. La CI actual no valida todos los atributos solicitados. | `.github/workflows/ci.yml:1-75`; README registra protección de `main`, pero no evidencia configuración remota actual. |

## Estado de fases F0–F8

| Fase | Estado | Evidencia breve |
|---|---|---|
| F0 Fundación | Cumplida* | `.nvmrc`, validación env, CI, estructura y scripts presentes (`package.json:6-21`, `tsconfig.json:1-25`, `.github/workflows/ci.yml`). Preview separado para cada cambio no está probado. |
| F1 Identidad | Cumplida* | Rutas/servicios de identidad y migración RLS (`src/modules/identity/`, `supabase/migrations/20260928020743_identity_rls_and_auth_hook.sql`). |
| F2 Caja y auditoría | Cumplida* | `src/modules/cash/commands.ts`, `run-cash-command.ts`, `src/modules/audit/record-audit-event.ts`; pruebas integración de caja. |
| F3 Cartera | Cumplida* | `src/modules/portfolio/contracts.ts`, `loan-calculation.ts`, migraciones y pruebas de esquema/servicio. |
| F4 Pagos/mora | Cumplida* | `src/modules/portfolio/payments.ts`, `late-fees.ts`, `refinancing.ts`; integración en `src/tests/integration/payments.test.ts`, `late-fees.test.ts`, `refinancing.test.ts`. |
| F5 Cobradores/liquidación | Cumplida* | `src/modules/collections/{collectors,routes,assignments,sessions,settlements,attempts}.ts`; integración `collectors.test.ts`, `sessions.test.ts`, `settlements.test.ts`. |
| F6 Dashboard | Cumplida* | `src/modules/dashboard/`, `src/app/negocio/`; `src/modules/dashboard/dashboard.test.ts`. Evidencia de volumen/índices medidos no encontrada. |
| F7 Super Admin/soporte/monitoreo | Parcial/en curso | `src/modules/support/`, `src/modules/monitoring/`, páginas y README `Estado del proyecto`; respaldos/indicadores son visibles, pero el criterio de disponibilidad, latencia y último backup operacional requiere entorno real. |
| F8 endurecimiento/lanzamiento | No cumplida | `04-PLAN.md:145-153` exige restauración ensayada, recorrido completo y jornada sin inconsistencias. `MEMORY.md` registra E2E completo, pero checklist manual sigue abierto y no hay evidencia de restore/prod. |

\* Cumplida según evidencia de artefactos y reportes almacenados, no reejecutada en esta auditoría. La tabla no sustituye el verificador de fase definido por el proyecto.

## Hallazgos priorizados

### Alto

- **La fuente canónica de reglas no era común ni determinista.** Antes de la spec 007, `CLAUDE.md` no importaba AGENTS y AGENTS le asignaba autoridad universal. Esta deriva se resuelve con AGENTS común y el import documentado en ADR 0012.
- **Resuelto en spec 008:** `scripts/check-module-boundaries.mjs` comprueba imports cruzados, dirección `modules → app` y ciclos; CI lo ejecuta. No cubre dependencias dinámicas no resolubles ni cobertura de pruebas.
- **No hay puerta de cobertura ni performance.** CI (`.github/workflows/ci.yml`) corre formato, types, lint, test, build y suites de integración/E2E, pero no umbrales de cobertura, LCP/INP/CLS, bundle ni SQL plans. La spec 006 deja métricas sin presupuesto (`docs/frontend/01-PLAN-FRONTEND.md`, `docs/frontend/04-MATRIZ-VERIFICACION.md`).
- **Resuelto en spec 009:** README, AGENTS y 04-PLAN informan el mismo estado de fases; MEMORY conserva historial y señala el checkpoint vigente de E2E.

### Medio

- **Pruebas extensas, pero cobertura no cuantificada y pruebas de esquema grandes.** No se configura `coverage` en `package.json`/Vitest ni threshold; abundan pruebas integración de 400–778 líneas. La inspección estática no determinó tautologías; se recomienda auditoría focalizada de aserciones, dobles/mocks y mutación sobre pagos.
- **La propiedad por rutas ya está propuesta localmente, pero no aplicada en el branch base.** CODEOWNERS asigna frontend/backend y existe contrato inicial en spec 013. Como `main` no está protegida y CODEOWNERS aún no está en la rama base, esas revisiones no son obligatorias ni se ha probado su asignación.
- **Auditoría de dependencias no reproducible aún.** La primera consulta reportó 7 altas/0 críticas; la segunda no resolvió npm registry y offline no aporta avisos. El primer resultado carece de reporte íntegro preservado, así que requiere repetición antes de corregir o cerrar. No se actualizó nada.
- **Estado limpio no disponible.** El árbol ya tenía cambios y artefactos no rastreados antes de escribir esta auditoría (`git status --short`): se preservaron; por ello no se puede atribuir esos cambios al trabajo actual ni hacer lectura fiable de diff global.
- **Riesgo de inyección desde fuentes MCP/web.** OpenCode conecta Context7, Chrome DevTools, Playwright y Supabase local (`opencode.json`); instrucciones del repo no fijan claramente que el contenido de páginas/documentos/MCP sea dato no confiable. Autorizaciones shell amplias como `npm run db:migrate*` están en allow.

### Bajo

- **Señales de mantenimiento/slop cuantificables:** el baseline actual lista `src/modules/portfolio/payments.ts` (479 líneas), `contracts.ts` (433), y tests de integración >400 líneas; funciones UI de 259–290 líneas y handlers financieros de hasta 213. El tamaño identifica concentración para revisar, no demuestra por sí mismo defecto. `docs/auditoria/02-HOTSPOTS.md` documenta que duplicación, código muerto, abstracciones sin uso, comentarios obvios y tests tautológicos requieren análisis aparte. No se interpreta búsqueda textual de `any` como conteo tipado.
- **ADR sí existe.** `docs/adr/` registra decisiones (por ejemplo 0001–0011 según referencias); mantenerlo es adecuado, pero falta un índice/plantilla de estado/relación explícita con decisiones de herramientas y ownership.

## Muestra financiera y arquitectura

En muestras de Caja, pagos y Cobrador hay claves `Idempotency-Key` en Route Handlers (`src/app/api/negocio/caja/[command]/route.ts:67-84`, `src/app/api/cobrador/pagos/route.ts:13-25`), derivación del actor de sesión en handlers y servicios, transacción compartida (`src/modules/cash/run-cash-command.ts`, `src/modules/portfolio/payments.ts`, `src/modules/collections/sessions.ts`), auditoría dentro de transacción (`src/modules/audit/record-audit-event.ts:15-18`) y tipos de dinero enteros (`src/shared/money/money.ts`). Migraciones base definen `forbid_update_delete` (`supabase/migrations/20260928012027_base_conventions.sql`) y RLS (`20260928020743_identity_rls_and_auth_hook.sql`).

La separación de responsabilidades está presente como convención, pero no hay guard automático de imports/ciclos. La inspección no ejecutó análisis dinámico ni repitió todas las pruebas; verificar cada comando financiero y todas las políticas RLS requiere una revisión por módulo y entorno.

## Inventario de herramientas de IA

| Herramienta | Instrucciones | Permisos/sandbox | Agentes/skills/comandos | MCP/modelos/esfuerzo |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md`, `AGENTS.md` (sin import), `.claude/rules/frontend-design.md` | `.claude/settings.json`: allow/ask/deny; secretos deny; push ask; hook `PreToolUse` ejecuta `block-commit-on-main.sh`. No es política para otras herramientas. | 6 `.claude/agents`; skills bajo `.claude/skills` (dominio, comando, debugging, revisión, diseño, auditoría, fase); `grill-me` es la única invocación humana según AGENTS. Skills no equivalen a slash commands separados evidenciados. | MCP recomendados documentados; settings Claude no declara MCP. Frontmatter de agentes usa `sonnet`; esfuerzo no configurado en repo. |
| Codex | `AGENTS.md`; `CLAUDE.md` es contexto adicional manual, no garantía según documentación consultada. `.codex/` no existe en el repo. | Sandbox y approval dependientes de configuración de Codex/host; no hay `.codex/config.toml` versionado. | No hay agentes/skills nativos Codex versionados identificados; `.claude/skills` no garantiza su descubrimiento por Codex. | No hay MCP/modelo/esfuerzo de Codex configurado en repo. |
| OpenCode | `AGENTS.md`; `opencode.json` también carga `.claude/skills`. Con ambos archivos de regla, OpenCode usa AGENTS. | `opencode.json`: shell general ask, allowlist de comandos y bloqueos textuales de secretos; skills incluidas. | 6 agentes espejo en `.opencode/agents`; skill directory `.claude/skills`. No hay comandos `.opencode/commands` identificados. | Chrome DevTools, Playwright, Context7 local y Supabase local remoto en config. Modelo/esfuerzo no visible en configuración versionada; reglas de agentes incluyen permisos propios. MCP remoto y páginas son frontera de prompt-injection.

## Notas A–E

| Área | Nota | Criterio y qué la subiría |
|---|---:|---|
| A. Planificación/dominio | 8/10 | Dominio detallado, invariantes, fases y ADR; bajar por plan obsoleto en AGENTS y pendientes envejecidos. Sincronizar estado real, clasificar pendientes con fecha/owner y enlazar evidencia de salida por fase. |
| B. Configuración técnica/calidad | 6/10 | Stack exacto, strict TS, lint/format/build y CI con integration/E2E. Sin puertas de arquitectura/cobertura/performance ni hooks comunes. Añadir las puertas priorizadas, con señal y costos medidos. |
| C. Personalización multi-IA | 5/10 | Configuración rica, agentes duplicados y permisos por herramienta, pero autoridad cruzada ambigua, sin política Codex y mantenimiento duplicado. Canon compartido conciso, adaptadores automáticos verificados y evaluación por herramienta. |
| D. Salud/mantenibilidad del código | 7/10 | Módulos claros, comandos auditados y tipado; muestra con archivos largos, sin métricas de duplicación/ciclos y sin ejecución completa en esta auditoría. Automatizar límites de dependencia, medir hotspots y revisar comandos críticos con pruebas de propiedades/mutación. |
| E. Seguridad/operación/rendimiento | 6/10 | RLS, env validation, protección de hechos y E2E local documentados; faltan restore probado, evidencia de producción, budgets y control robusto MCP. Cerrar F8 con evidencia reproducible y observabilidad/latencia medibles. |

No se ejecutó `npm test`, typecheck, lint, build ni E2E en esta auditoría: MEMORY trae evidencia reciente, pero no equivale a resultado de esta corrida. No se leyeron archivos secretos.
