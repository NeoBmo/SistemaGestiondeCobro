# CLAUDE.md — Sistema de Gestión de Cobros

## Proyecto

Plataforma web multi-negocio para negocios que prestan dinero y cobran cuotas mediante cobradores. Núcleo: trazabilidad financiera total — nada se edita ni se borra, todo se audita. Roles: Super Admin, Admin de negocio, Cobrador (aislados por `business_id`). Fuente de verdad de negocio → `docs/planning/02-DOMINIO.md`.

## Stack (pinnear exacto en package.json al iniciar F0)

| Capa | Paquete | Versión |
| --- | --- | --- |
| Runtime | Node.js | 24 LTS |
| Framework | next | 16.2.x |
| UI | react / react-dom | 19.1.x |
| Lenguaje | typescript | 5.7.x |
| Estilos | tailwindcss | 4.1.x |
| BD / Auth | @supabase/ssr, @supabase/supabase-js | ^2.x |
| Validación | zod | ^3.23 |
| Test unitario | vitest | ^2.x |
| Test e2e | @playwright/test | ^1.48 |
| Calidad | eslint 9, prettier 3 | latest |

## Comandos

| Acción | Comando |
| --- | --- |
| Desarrollo | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Test unitario | `npm test` |
| Test e2e | `npm run test:e2e` |
| Build | `npm run build` |
| Migración BD | `supabase db push` |

## Documentos fuente (leer antes de implementar)

`docs/planning/01` a `07`. Ante conflicto entre ellos: `02-DOMINIO.md` gana en negocio, `03-ARQUITECTURA.md` en técnico. Cualquier archivo fuera de `docs/planning/0X` es historial obsoleto, no referencia.

## Allowlist de operaciones

La tabla fija la intención; `.claude/settings.json` (commitéalo) la aplica de verdad vía `permissions.allow/ask/deny` — edítalos juntos, nunca uno sin el otro.

| Permitido sin confirmar | Requiere confirmación explícita |
| --- | --- |
| Leer/buscar (Read, Grep, Glob) — excepto secretos, bloqueados en `settings.json` | Borrar archivos o carpetas (`rm`) |
| Editar/crear en `src/`, `docs/`, pruebas | Modificar una migración ya aplicada |
| Crear migraciones nuevas | `supabase db reset` o cualquier comando destructivo de BD |
| `npm run lint / typecheck / test / build` | Instalar dependencias no listadas arriba |
| `git add` + `git commit` local (commitea seguido, esto no toca el remoto) | `git push` (siempre; `--force` va bloqueado sin excepción) o merge a `main` |
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
| 8 | Dinero como enteros; nunca `number`/`float` de JS |
| 9 | Escritura financiera solo vía Route Handler → servicio → transacción; nunca desde el navegador |

## Qué no hacer

- Si algo no está en `02-DOMINIO.md`: detente, no inventes la regla, anótalo en `05-PENDIENTES.md` y pregunta.
- No construyas nada marcado "fuera de V1" en `01-CONTEXTO.md`, ni "por si acaso" o "para dejarlo preparado".
- No adelantes una fase de `04-PLAN.md` mientras la actual no cumpla su criterio de salida exacto.

## Estilo de respuesta

Sé ultraconciso: resume tu razonamiento en 1–2 líneas, sin repetir el plan completo cada turno. Al mostrar cambios de código, muestra solo las líneas modificadas (diff), nunca el archivo completo salvo que se pida explícitamente.
