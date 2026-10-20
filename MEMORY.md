# Checkpoint — MCP Engram y Supabase local

- Request: diagnose and fix the Engram and Supabase local MCP servers.
- Profile: `con-suite`; `npm test` runner and CI workflow exist, so full TDD/SDD loop applies.
- Branch: `fix/e2e-paralelismo-base-compartida`.
- Existing unrelated worktree changes must be preserved: `AGENTS.md`, `opencode.json`, `playwright.config.ts`, `src/app/negocio/caja/page.tsx`, `.playwright-mcp/`.
- Diagnóstico original: ejecutable Engram no encontrado/argumentos incorrectos; Supabase `ConnectionRefused` porque Docker Linux engine estaba detenido.
- Spec activa: `specs/001-reparar-mcp-local/{spec,plan,tasks}.md`; tarea 3 COMPLETADA, resto de reparación no cerrado.
- URL Supabase del WIP `opencode.json`: `http://localhost:54321/mcp`, válida; conservar. Docker seguía detenido en el último chequeo, no se inició aquí.
- Humano iniciará Docker; autorización previa para `npm run db:start` solo después de comprobar motor activo. Esta continuación excluye intervenir Supabase.
- Engram oficial v3.4.0 Windows AMD64 instalado en `C:\Users\BMO\.config\opencode\bin\engram.exe`; PATH intacto, Go ausente.
- ZIP AMD64 aprobado y verificado: SHA-256 `3065736ec7ff8137eb3fc607275f542ea13bb743a5157318c8a8770f11ce3289`; no confundir con ZIP ARM64 inicialmente citado.
- Configuración global aprobada: comando absoluto `engram.exe mcp`, `environment.ENGRAM_DATA_DIR=C:\Users\BMO\.config\opencode`; DB objetivo inicialmente ausente.
- Usuario autorizó T4 `openai/gpt-6.1-sol#high`, después habilitación exclusiva de Engram (`disabled: false`), lectura MCP y creación inicial de la DB acordada.
- No rotar modelos por cuota/saldo. Dispatch anterior de Sonnet falló por fondos; OpenAI créditos no pagan OpenCode Go. Modelo más potente requiere autorización explícita.
- Nunca leer secretos, sobrescribir DB existente, ejecutar `engram setup`, resetear BD o alterar WIP sin aprobación. Subagente previo alcanzó límite de profundidad; revisión adicional queda al padre.

## Auditoría global OpenCode (2026-10-13, terminada)

- Reauditoría vigente tras Luna y Engram: examinar agentes, flujo y configuración global; solo diagnóstico, sin editar configuración.
- OpenCode instalado: `2.0.28`; configuración global en `C:/Users/BMO/.config/opencode`.
- Objetivo global: sin runner/marcadores, auditoría solo lectura; la aplicación sigue `con-suite`. Preservar propuesta MCP y todo el WIP.
- API confirmó root `openai/gpt-6-luna` activo y cinco perfiles `#medium`; la cadena gratuita ya fue retirada. Auditoría hecha con Luna high/medium, sin escalado.
- Reglas API evaluadas estáticamente: implementer permite shell/edición general; reviewer `*test*` coincide con un push a rama test y bloquea lint/build. No se ejecutaron mutaciones; separar ámbito global y repo con `location[directory]`.
- API global en la auditoría: Chrome DevTools, Context7, GitHub y web-validator conectados; Engram entonces deshabilitado, ahora habilitado tras aprobación separada.
- Dictamen contrastado: armazón útil bajo supervisión, controles insuficientes para autonomía crítica; sin benchmark de calidad de código. Prioridades: permisos, `/swap` y estados implementada/validada. Remediación NO autorizada.

## Cambio solicitado: modelos globales GPT-6 (2026-10-13)

- Usuario pide sustituir gratuitos por GPT-6, preferentemente Luna; avisar antes de necesitar un modelo más potente.
- Raíz real del cambio: `C:/Users/BMO/.config/opencode`; puerta de runner ejecutada allí: sin runner ni marcadores, sin build. Ajuste documental/configuración pequeño; no añadir tooling ni specs al repo para este cambio.
- `openai/gpt-6-luna` existe con `low/medium/high`; smoke real `#low` respondió `LUNA_OK`. Evitar ruta `opencode/` por saldo/acceso.
- Alcance aprobado por humano y completado: root default `openai/gpt-6-luna`; cinco agentes con `#medium`; escalera T1 low / T2 medium / T3 high; T4 y cualquier necesidad de mayor capacidad requieren autorización. Si Luna falla, checkpoint y consultar: sin rotación automática.
- Editados solo 7 archivos globales (config, doctrina y cinco agentes); respaldo en `C:/Users/BMO/AppData/Local/Temp/opencode/backup-global-model-policy-20261013`.
- Reviewer Luna: `APROBADO`; API confirmó default y agentes; permisos/MCP intactos, UTF-8 sin NUL, sin referencias gratuitas anteriores. No cambios de código app, commits, instalaciones ni arranque DB.
- Sesiones existentes conservan su modelo seleccionado; `/models` permite elegir Luna. Hallazgos siguen pendientes; MCP tiene progreso parcial, no está cerrado (ver sección de continuación).
- Auditoría no autoriza remedios, activar MCP ni DB. Si Luna falla, checkpoint y consulta humana: no rotación automática, secretos ni `service.json`.

## Tarea 3 MCP — completada (2026-10-13)

- Binario no reinstalado; SHA-256 del exe previamente verificado `c2bca1167cad86c7618fd03b8ca3bdfc52df072da600593612edece3cf25f8ab` (distinto del ZIP).
- Única edición global en esta continuación: `engram.disabled: true → false`. JSONC validado sin imprimir el archivo; hash del resultado coincide exactamente con esa única sustitución, todos los demás bytes intactos.
- `opencode mcp list`: Engram **connected**; Supabase sigue `ConnectionRefused`. No se ejecutó ningún comando Supabase ni arranque Docker.
- Lectura directa Code Mode `mem_current_project` sobre el repo: `project=sistemagestiondecobro`, `project_source=git_remote`, ruta correcta, `available_projects=null`. Sin generación ni herramientas de escritura de recuerdos.
- DB y companions ausentes antes; creación inicial autorizada al conectar: `engram.db`, `engram.db-wal`, `engram.db-shm` existen en `C:\Users\BMO\.config\opencode`. No se inspeccionó contenido.
- Hashes WIP protegidos (`AGENTS.md`, `opencode.json`, `playwright.config.ts`, `src/app/negocio/caja/page.tsx`) intactos; solo checkpoints MEMORY/tasks editados en repo.
- Siguiente: revisión del padre y continuar tareas pendientes cuando se autorice su alcance. CI completa (tarea 7) y verificación de ambos MCP (tarea 5) NO ejecutadas aquí; no declarar reparación conjunta terminada.

## Frontend V1 — tokens e identidad visual (2026-10-16)

- El usuario aprobó aplicar el borrador de identidad V1 y avanzar spec por spec. Tipografías: IBM Plex Sans variable + IBM Plex Mono regular; tema del sistema sin selector manual; verde de éxito separado; movimiento solo `transform`/`opacity`; vidrio restringido a capas flotantes. Para cubrir la marca V1, aprobó un cuadrado esmeralda sin glifo como placeholder visible y favicon; el diseño propio llegará después.
- `specs/002-tokens-y-tema/` es la spec activa. Se implementaron tema claro/oscuro y tokens semánticos en `src/app/globals.css`, fuentes en `src/app/fonts.ts`, conexión en layout raíz, ajustes en controles compartidos/filtros y marca reemplazable en `src/shared/ui/brand-mark.tsx` + `src/app/icon.svg`; Playwright tiene smoke del tema/mark/fav icon. Se preservó el hash de `src/app/negocio/caja/page.tsx` (`FFFB84C9471C0573C34679EF02EB3A94FE9A9E2D5B1D3EDC1EBEA070160520BA`).
- Estado inicial registrado el 2026-10-16: typecheck/lint/build y 55 suites/298 tests pasaban; el runner fallaba en Turbopack y los assets de fuentes dependían de Google Fonts. Ese bloqueo se resolvió en la continuación de esta sección.
- Fuentes: IBM Plex Sans variable TTF (537,244 bytes), IBM Plex Mono Regular TTF (135,580 bytes) y licencia `OFL.txt` (4,456 bytes), descargados del repositorio oficial `google/fonts` y guardados en `src/app/_fonts/`. `src/app/fonts.ts` usa `next/font/local`; no se añadió dependencia ni fetch externo de fuentes.
- `playwright.config.ts` construye el servidor E2E con `next build --webpack`, evitando el panic de subproceso de Turbopack que ocurría en el runner. También pasó `npm run build` predeterminado con Turbopack una vez configuradas las fuentes locales.
- Smoke E2E: 34/34 desktop/mobile; incluye tema claro/oscuro, carga de fuente local, redirects privados sin sesión, login/teclado, objetivos de 44px, reduced motion, overflow y capturas de landing/login a 360/768/1280. Capturas visualmente inspeccionadas en `playwright-report/` (ignorado por Git).
- Cadena CI en orden: `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test -- --pool=threads --maxWorkers=1` (55 suites/298 pruebas), `npm run build`: todo pasa. Prettier omite únicamente `.playwright-mcp/page-*.yml`, snapshots generados locales; los archivos se preservaron sin editar.
- `specs/002-tokens-y-tema` cerrada: tareas 1–9 completas y revisión independiente final aprobada. Se corrigieron las notas E2E/format contradictorias, se incluyó el literal `/* PLACEHOLDER-IDENTIDAD */` en el marcador y se aclaró que la escala tipográfica centralizada se adopta en componentes nuevos o modificados, sin migración masiva de páginas. El smoke cubre landing/login; no se ejercitaron pantallas privadas con sesión real. El WIP de MCP eliminado por petición humana sigue sin declararse resuelto en conjunto.

## Frontend V1 — estados y presentación financiera (2026-10-16)

- `specs/003-estados-y-presentacion-financiera` cerrada con revisión independiente aprobada. Inventario por rol en `plan.md`; se corrigió el estilo tabular de importes de aplicación en historial y de valores aplicado/pendiente en cargos de mora. Resto de estados y formatos reutiliza componentes y utilidades existentes.
- `format:check`, `typecheck`, `lint`, 55 suites/298 pruebas con un worker y `build` pasan. `npm test` predeterminado falla por ENOENT del temporal de Vitest en Windows; el comando alternativo no omite pruebas. E2E visual multi-ancho queda para spec 006.

## Frontend V1 — patrones responsivos por perfil (2026-10-17)

- `specs/004-patrones-responsivos-por-perfil` cerrada con revisión independiente **APROBADO**. Cambios limitados a wrapping/reflow de nombres, datos de identificación/teléfono y observaciones largas en shell, cobrador, clientes, jornadas, rutas y Super Admin; en el detalle del préstamo, resúmenes en una columna en móvil y layout compacto desde `sm`.
- Se mantuvieron botones/enlaces de acción del Cobrador con objetivo existente de 44 px. No se añadieron tablas, dependencias, pruebas E2E visuales ni cambios de dominio. Capturas y comprobaciones automatizadas 360/768/1280 quedan para spec 006 según lo acordado.
- Calidad: `format:check`, `typecheck`, `lint`, 55 suites/298 pruebas con `--pool=threads --maxWorkers=1`, y `build` pasan. `npm test` predeterminado reprodujo `ENOENT` de temporales de Vitest en Windows; la suite completa con un worker pasó. Próxima spec: `specs/005-seo-y-rendimiento-publico`.

## Frontend V1 — SEO y rendimiento público (2026-10-17)

- `specs/005-seo-y-rendimiento-publico` implementada. `PUBLIC_SITE_URL` es un origen HTTP(S) absoluto validado; `metadataBase` lo reutiliza y `.env.example` contiene un ejemplo reservado `https://example.invalid`. El valor real de producción sigue siendo configuración de despliegue y no se leyó ningún `.env*`.
- La landing declara canonical y Open Graph con el contenido existente. Auth y layouts privados de Cobrador, Negocio y Super Admin declaran `noindex,nofollow`; `robots.txt` anuncia el sitemap sin bloquear el rastreo, y el sitemap solo incluye `/`.
- `format:check`, `typecheck`, `lint`, 55 suites/299 pruebas con `--pool=threads --maxWorkers=1`, y build con Webpack pasan. `npm test` predeterminado presenta `ENOENT` de temporales en Windows; build Turbopack no pudo crear junction por permisos del sandbox.
- Metadata/rastreo por ruta automatizados y mediciones LCP/INP/CLS quedan para `specs/006-verificacion-frontend`. No hubo dependencias nuevas ni cambios a módulos de dominio, Route Handlers, middleware, RLS o base de datos.

## Frontend V1 — verificación automatizada (spec 006, 2026-10-19)

- Aprobada la spec 006 y el uso de `@axe-core/playwright@4.13.0` + `web-vitals@6.2.2`, exactas y solo `devDependencies`. E2E define `PUBLIC_SITE_URL=https://example.invalid`; AGENTS sincronizado a seis variables obligatorias y `MONITOR_SECRET` opcional.
- Smoke Playwright ampliado: metadata título/description/canonical/OG, robots/sitemap, noindex de autenticación, axe WCAG 2.1 AA landing/login. Los checks pasaron en Chromium desktop y Pixel 7 mobile (39 cada proyecto); vitals corre cinco muestras solo desktop. Capturas/reporte HTML local en `playwright-report/` (ignorado por Git).
- Test nuevo `frontend-profiles.spec.ts`: fixture sintético para Super Admin, Administrador y Cobrador, screenshots/overflow a 360/768/1280, acción táctil, axe y noindex. Corrió como skip explícito porque no había Supabase real; `docker info` confirmó que el motor no está iniciado. No se arrancó Docker ni Supabase según el checkpoint humano.
- `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test -- --pool=threads --maxWorkers=1` (55 suites/299 pruebas) y `npm run build` con Turbopack + origen reservado pasan. Cadena E2E completa sigue pendiente de iniciar el entorno local autorizado.
- El smoke reveló y corrigió el título duplicado de landing: `(public)/layout.tsx` ahora fija metadata title absoluta “Cuadre”.
- `docs/frontend/04-MATRIZ-VERIFICACION.md` documenta estados, evidencia y checklist manual, que permanece sin completar. No declarar cerrada la spec 006 ni habilitar gates LCP/INP hasta correr perfiles/Supabase, revisar capturas de sesión y checklist manual.
- `npm install` reportó 7 vulnerabilidades high en el árbol; no se ejecutó `npm audit fix` ni se intentaron cambios fuera de la spec.
- Continuación autorizada por el usuario (2026-10-19): Docker Engine `29.8.2` y Supabase local activos. La consulta de solo lectura `supabase migration list --local` mostró las 24 migraciones sincronizadas; `db:migrate` fue rechazado por revisión automática al poder modificar el esquema, por eso no se ejecutó.
- E2E completo con `E2E_REQUIRE_SUPABASE=1`: **79 passed, 1 skipped** en 2.4 min; el skip es solo vitals en proyecto mobile (baseline configurado para Chromium desktop). El nuevo test de perfiles autenticados pasó en desktop/mobile, incluyendo axe y 360/768/1280. No hubo fallos de pruebas; Next imprimió advertencias `The destination stream closed early` durante navegación, sin fallos asociados.
- La verificación automatizada de spec 006 está completa. Cierre formal pendiente de checklist manual AA/responsive en `docs/frontend/04-MATRIZ-VERIFICACION.md`; no activar gates de LCP/INP todavía.

## Estado conciliado de fases (2026-10-19)

- Este es el estado documental vigente: F0–F6 reportadas como terminadas; F7 está en cierre/verificación, no certificada; F8 sigue pendiente y no debe iniciarse hasta resolver los bloqueadores de `docs/planning/05-PENDIENTES.md`.
- El checkpoint anterior de spec 006 que decía que Supabase/E2E autenticado estaban pendientes fue superado por la continuación posterior del mismo día: 24 migraciones sincronizadas, E2E completo **79 passed / 1 skipped**. La omisión es vitals en mobile por diseño; la checklist manual AA/responsive permanece abierta.
- No se han decidido los objetivos de volumen, dispositivos/navegadores, presupuestos por entorno ni los riesgos/supuestos financieros de F8. Mantenerlos abiertos hasta que el dueño los resuelva.

## Invariantes de aplicación de pagos (spec 010, 2026-10-19)

- El preview y `registerPayment` usan `src/modules/portfolio/payment-allocation.ts`; el asignador solo implementa la regla explícita de cuotas cronológicas de `02-DOMINIO.md` §3.2.
- Prueba generativa determinista: calendarios de 1, 2, 3, 7 y 12 cuotas, saldos parciales/cerrados, input desordenado y todos los pagos desde 1 hasta saldo exacto. Conservación, no sobreaplicación, orden y remanente pasan.
- `format:check`, `typecheck`, `lint` y suite unitaria con un worker: 56 archivos / 300 pruebas pasan. Vitest con workers por defecto reprodujo ENOENT de temporales Windows.
- La integración de pagos no corrió: conexión local denegada a `127.0.0.1:54322`; no se arrancó Docker/Supabase. Dejarlo explícito hasta repetir con BD autorizada y activa.
