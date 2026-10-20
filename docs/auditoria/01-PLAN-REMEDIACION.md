# Plan de remediación propuesto

No autorizado para implementación hasta aprobación humana. Cada elemento es una spec futura `specs/NNN-slug/` con `spec.md`, plan, tareas, criterios y verificación.

| Orden / spec propuesta | Qué y por qué | Esfuerzo | Dependencias | Responsable | Origen |
|---|---|---:|---|---|---|
| 007 `canon-instrucciones-multiherramienta` | Establecer AGENTS como canon neutral conciso, decidir qué política vive allí y qué queda como adaptador Claude/Codex/OpenCode; eliminar duplicación/conflictos de autoridad y añadir una prueba/script que detecte drift en los adaptadores. Incorporar regla de tratar contenido externo/MCP como datos no confiables. | M | Decisión de arquitectura/documentación registrada en ADR de tooling | Ambos | Documentación oficial + criterio propio |
| 008 `guardas-arquitectura-modular` | Medir y hacer fallar CI por ciclos y dependencias `src/modules/*`; definir imports públicos por módulo y límites app/shared. Empezar con inventario y baseline para no bloquear arbitrariamente. | M | 007 opcional | Backend + frontend | Práctica común |
| 009 `evidencia-y-puertas-fase-f7-f8` | Alinear README/AGENTS/MEMORY/04-PLAN, declarar checklist de F7 y cerrar pendientes de F8 con evidencia rastreable; integrar verificador de fase y evitar estados históricos ejecutables. | M | Resolver pendientes que bloquean F8 | Ambos | Criterio propio |
| 010 `pruebas-invariantes-financieras` | Auditar tests de pagos, reversos, interés, caja/liquidación e idempotencia; añadir pruebas basadas en propiedades/metamórficas y casos de concurrencia/rollback donde la cobertura actual sea débil. Medir calidad de asserts y mocks; no fijar cobertura porcentual sin baseline. | L | 009; no decidir reglas abiertas sin actualizar 02 | Backend | Práctica común + criterio propio |
| 011 `gates-rendimiento-y-consultas` | Medir bundle/LCP/INP/CLS y consultas con seed realista; fijar budgets solo tras baseline; reportar regresión en CI. Evaluar índices y Server/Client boundaries por rutas representativas. | L | Seed y entorno reproducible; F8 | Frontend + backend | Documentación oficial + criterio propio |
| 012 `politica-dependencias-y-secretos` | Producir reporte actual de vulnerabilidades, validar paquetes directos/transitivos y uso; añadir escaneo reproducible de secretos/dependencias y política de actualización de lockfile. No actualizar automáticamente paquetes sin revisión. | M | Ventana CI y proveedor de alertas disponible | Ambos | Práctica común |
| 013 `contrato-y-ownership-de-directorios` | Acordar responsables frontend/backend, CODEOWNERS, contratos de Route Handler/schema/tipos compartidos, propiedad de migraciones y reglas de compatibilidad para trabajo paralelo. | M | 007 | Ambos | Criterio propio |
| 014 `flujo-pr-aislamiento-y-revision` | Definir plantilla PR, checks requeridos y aprobadores por riesgo; aislar sesiones paralelas con ramas/worktrees y prohibir edición fuera del ownership acordado; modelo revisor distinto o checklist humano para código financiero. Verificar branch protection real desde GitHub. | M | 013; acceso a configuración GitHub | Ambos | Práctica común + criterio propio |
| 015 `limites-de-mantenibilidad` | Añadir reportes no bloqueantes de archivos/funciones grandes, duplicación, código muerto y comentarios; acordar thresholds tras baseline. Extraer de forma incremental hotspots como `portfolio/payments.ts` (451 líneas) y `contracts.ts` (407), sin refactor especulativo. | S–M | Baseline | Ambos | Criterio propio |
| 016 `politica-modelo-esfuerzo-y-evaluacion` | Definir matriz por riesgo (docs/UI, CRUD, dominio financiero, migraciones, revisión) para modelo/esfuerzo, herramientas permitidas, escalamiento y evaluación con tareas de referencia; sin fijar proveedores si el equipo no los decide. | S | 007 | Ambos | Criterio propio |

## Secuencia sugerida

1. 007 y 009 resuelven fuentes de instrucciones y estado verificable antes de automatizar nuevas reglas.
2. 013 y 014 establecen contratos y ownership para dos desarrolladores y sesiones agénticas paralelas.
3. 008, 010, 011 y 012 agregan barreras automáticas de arquitectura, dominio, rendimiento y supply chain.
4. 015 y 016 reducen slop recurrente y calibran el uso de modelos con evidencia.

Los IDs son propuestas y deben confirmarse frente al inventario actual de `specs/` antes de crear cada carpeta. Este documento no modifica el código ni el plan de fases.
