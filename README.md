# Cuadre

> Plataforma de gestión de cobros para negocios que prestan dinero y cobran cuotas mediante cobradores. Cartera, cajas, cobradores y trazabilidad financiera completa, en un solo lugar.

## Estado del proyecto

🗂️ **En planificación.** Este commit no contiene todavía código de aplicación — contiene el modelo de dominio, la arquitectura, el plan de fases y la configuración de trabajo con Claude Code que van a gobernar la construcción de V1. El siguiente paso es F0 (fundación técnica), descrito en `docs/planificacion/04-PLAN.md`.

## Qué es

Una plataforma web multi-negocio para negocios que prestan dinero y cobran cuotas mediante cobradores. No es un simple registro de cobros diarios: centraliza la cartera de clientes, préstamos y cuotas, la operación de los cobradores en ruta, y el movimiento financiero completo del negocio (Caja Mayor, cajas de cobradores, gastos y liquidaciones).

El valor central es la **trazabilidad**: cada peso prestado, cobrado, gastado o transferido puede reconstruirse — qué pasó, quién lo hizo, cuándo, y sobre qué operación. Ningún hecho financiero se edita ni se borra.

## Stack (V1)

| Capa | Elección |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript estricto |
| Estilos | Tailwind CSS 4 |
| Base de datos / Auth | PostgreSQL vía Supabase (Auth + RLS) |
| Pruebas | Vitest (unitarias) + Playwright (e2e) |

Versiones exactas y comandos → `CLAUDE.md`. Justificación completa → `docs/planificacion/03-ARQUITECTURA.md`.

## Estructura de este repositorio

```text
├── CLAUDE.md                    # reglas y contexto que lee cualquier IA al empezar
├── .claudeignore                # exclusiones de contexto (no es seguridad)
├── .claude/
│   ├── settings.json             # permisos reales (allow/ask/deny)
│   ├── agents/code-reviewer.md   # subagente revisor de diffs
│   ├── rules/frontend-design.md  # estándares de UI
│   └── mcp-recomendados.md
└── docs/planificacion/
    ├── 01-CONTEXTO.md            # qué se construye, para quién, alcance de V1
    ├── 02-DOMINIO.md             # entidades, estados, reglas — autoridad de negocio
    ├── 03-ARQUITECTURA.md        # stack, estructura de carpetas, patrones técnicos
    ├── 04-PLAN.md                # fases F0→F8 con criterios de aceptación
    ├── 05-PENDIENTES.md          # lo que aún no está decidido
    ├── 06-AGENTES-HABILIDADES.md # subagentes/skills de Claude Code
    └── 07-FLUJO-DE-TRABAJO.md    # cómo se trabaja sesión a sesión
```

## Cómo trabajar en este repo

- Toda IA (incluido Claude Code) lee `CLAUDE.md` primero, siempre.
- Las reglas de negocio viven en `docs/planificacion/02-DOMINIO.md` — es la autoridad final; nada se implementa por inferencia o "porque parece razonable".
- El plan de fases está en `docs/planificacion/04-PLAN.md`. No se salta una fase sin cerrar los criterios de salida de la anterior.
- El día a día (tamaño de tareas, disciplina de Git, puerta de pruebas) está en `docs/planificacion/07-FLUJO-DE-TRABAJO.md`.
- Lo que todavía no está decidido está en `docs/planificacion/05-PENDIENTES.md` — no se rellena por inferencia.

## Principio rector

> Construir un sistema sencillo de utilizar, pero suficientemente estructurado para que el dinero, las obligaciones y las decisiones del negocio nunca pierdan su trazabilidad.
