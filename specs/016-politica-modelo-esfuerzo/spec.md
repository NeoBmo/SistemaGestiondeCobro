# Spec 016 — Política de modelo, esfuerzo y revisión

## Problema

El repositorio contiene perfiles de agentes con modelos fijados por herramienta, pero carece de una política común de esfuerzo ligada al riesgo de la tarea. Las preferencias globales actuales describen un esquema T1/T2/T3, pero no están versionadas con el repo ni aclaran riesgos financieros o escalamiento entre herramientas.

## Decisión propuesta

Definir niveles relativos de esfuerzo y riesgo, no nombres de proveedor/modelo. Cada herramienta mapea T1/T2/T3 a lo que soporte. Un límite/fallo no cambia automáticamente proveedor/modelo ni eleva el esfuerzo: se conserva checkpoint y se solicita instrucción humana. Cambios financieros, de autorización/RLS o migraciones requieren revisión humana; una revisión independiente de otro agente/herramienta/modelo ayuda, pero no sustituye esa puerta.

## Criterios de aceptación

1. La matriz cubre documentación/UI, cambios rutinarios y riesgos financieros/seguridad/migración.
2. La guía distingue modelo/esfuerzo (capacidad) de permisos/sandbox (control ejecutable).
3. No se fijan proveedores ni modelos exactos y no se cambian configuraciones globales.
4. Se documenta la revisión independiente recomendada y la aprobación humana obligatoria según la política existente del repo.

## Fuera de alcance

Benchmarks/evals automáticos, selección automática de proveedor, precios/cuotas, configuración de modelos por herramienta, permisos de MCP y nombres de revisores.

## Verificación

Revisar consistencia con AGENTS, CLAUDE, agentes locales y MEMORY. No requiere pruebas de código.
