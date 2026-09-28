# CLAUDE.md — Sistema de Gestión de Cobros

## Proyecto

Plataforma web multi-negocio para negocios que prestan dinero y cobran cuotas mediante cobradores. Núcleo: trazabilidad financiera total — nada se edita ni se borra, todo se audita. Roles: Super Admin, Admin de negocio, Cobrador (aislados por `business_id`). Fuente de verdad de negocio → `docs/planning/02-DOMINIO.md`.

## Stack (pinnear exacto en package.json al iniciar F0)

> Política: última versión compatible, exacta en `package.json` (resuelta con `npm view` en F0-T1, 2026-09-27). Las marcadas «se fija en T0.4» aún no están instaladas. Desviaciones deliberadas: TypeScript 6.0.x porque `typescript-eslint` exige `<6.1` (TS 7 rompe el lint); ESLint 9 porque `eslint-plugin-react` (dentro de `eslint-config-next`) no funciona con ESLint 10 — revisar al actualizar `eslint-config-next`.

| Capa | Paquete | Versión |
| --- | --- | --- |
| Runtime | Node.js | 24 LTS |
| Framework | next | 16.3.6 |
| UI | react / react-dom | 19.3.0 |
| Lenguaje | typescript | 6.0.3 |
| Estilos | tailwindcss (+ @tailwindcss/postcss) | 4.3.3 |
| BD / Auth | @supabase/ssr, @supabase/supabase-js | ^2.x (se fija en T0.4) |
| Transacciones | pg, @types/pg | ^8.x (se fija en T0.4) |
| Validación | zod | 4.x (se fija en T0.4) |
| Test unitario | vitest | 5.0.2 |
| Test e2e | @playwright/test | 1.63.0 |
| Calidad | eslint, prettier, prettier-plugin-tailwindcss | 9.39.5, 3.9.9, 0.8.1 |

## Comandos

| Acción | Comando |
| --- | --- |
| Desarrollo | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Test unitario | `npm test` |
| Test e2e | `npm run test:e2e` |
| Build | `npm run build` |
| Migración BD | `supabase db push` (pide confirmación: puede apuntar a un proyecto remoto) |

## Documentos fuente (leer antes de implementar)

`docs/planning/01` a `08` (`08-GLOSARIO.md`: término de dominio → identificador en código; decisiones técnicas en `docs/adr/`). Ante conflicto entre ellos: `02-DOMINIO.md` gana en negocio, `03-ARQUITECTURA.md` en técnico. Cualquier archivo fuera de `docs/planning/0X` es historial obsoleto, no referencia.

## Allowlist de operaciones

La tabla fija la intención; `.claude/settings.json` (commitéalo) la aplica de verdad vía `permissions.allow/ask/deny` — edítalos juntos, nunca uno sin el otro.

| Permitido sin confirmar | Requiere confirmación explícita |
| --- | --- |
| Leer/buscar (Read, Grep, Glob) — excepto secretos, bloqueados en `settings.json` | Borrar archivos o carpetas (`rm`) |
| Editar/crear en `src/`, `docs/`, pruebas | Modificar una migración ya aplicada |
| Crear migraciones nuevas | `supabase db reset` o cualquier comando destructivo de BD |
| `npm run lint / typecheck / test / build` | Instalar dependencias no listadas arriba |
| `git add` + `git commit` local en una rama de tarea, nunca en `main` (commitea seguido, esto no toca el remoto) | `git push` (siempre; `--force` va bloqueado sin excepción) o merge a `main` |
| Leer `.env.example` | Leer o escribir `.env.local` / cualquier secreto — bloqueado, no solo "a confirmar" |

## Reglas de negocio no negociables

| # | Regla |
| --- | --- |
| 1 | Aislamiento estricto por `business_id`; ninguna consulta lo cruza |
| 2 | Contrato, préstamo, cuota, pago, mora, gasto, movimiento, auditoría: entidades separadas, nunca fusionadas |
| 3 | Ningún hecho financiero se edita/borra — corrección = `AJUSTE`/`REVERSO` nuevo con motivo |
| 4 | Contrato `CONFIRMADO` es inmutable |
| 5 | Pago parcial: faltante queda en su cuota; excedente a la siguiente cuota, cronológicamente |
| 6 | Mora = cálculo derivado; nunca genera cobro automático |
| 7 | Comando financiero = transacción única + auditoría + idempotencia, todo o nada |
| 8 | Dinero como enteros: tipo `Money` (entero seguro tipado) en TS, `bigint` en BD; nunca `number` decimal/`float`. Interés en puntos básicos, redondeo half-up |
| 9 | Escritura financiera solo vía Route Handler → servicio → transacción; nunca desde el navegador |

## Qué no hacer

- Si algo no está en `02-DOMINIO.md`: detente, no inventes la regla, anótalo en `05-PENDIENTES.md` y pregunta.
- No construyas nada marcado "fuera de V1" en `01-CONTEXTO.md`, ni "por si acaso" o "para dejarlo preparado".
- No adelantes una fase de `04-PLAN.md` mientras la actual no cumpla su criterio de salida exacto.

## Estilo de respuesta

Sé ultraconciso: resume tu razonamiento en 1–2 líneas, sin repetir el plan completo cada turno. Al mostrar cambios de código, muestra solo las líneas modificadas (diff), nunca el archivo completo salvo que se pida explícitamente.
