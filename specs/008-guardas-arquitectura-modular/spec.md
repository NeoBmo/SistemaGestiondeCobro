# Spec 008 — Guardas de arquitectura modular

## Problema

La arquitectura declara un monolito modular (`docs/planning/03-ARQUITECTURA.md`), pero CI no detecta ciclos ni nuevas dependencias cruzadas. El grafo medido muestra el ciclo de tipos `identity ↔ audit`: autorización de identidad registra rechazos; `audit/record-rejection.ts` vuelve a importar `SessionContext`.

## Decisión de alcance

Usar la API del TypeScript ya fijado para resolver imports y construir el grafo de `src/modules/*`. Mantener una allowlist explícita de dependencias de módulo observadas y aprobadas por la arquitectura actual. Detectar ciclos en los imports de código; eliminar el ciclo identidad/auditoría usando un contrato estructural mínimo en auditoría. No introducir paquetes.

## Requisitos

- Detectar imports estáticos, re-exports e imports dinámicos resolubles entre módulos.
- Fallar ante dependencia entre módulos no incluida en la allowlist o un ciclo del grafo.
- Ignorar imports externos y compartidos; `src/shared` es la capa común existente.
- Detectar imports de módulos hacia `src/app` como violación de dirección de dependencias.
- La comprobación es determinista, rápida, no instala dependencias y corre en CI.
- La allowlist documenta el baseline existente y no convierte ciclos actuales en excepciones.

## Fuera de alcance

Refactorizar servicios/módulos completos, prohibir dependencias existentes que son necesarias para flujos financieros, reubicar código en una capa nueva, medir tamaño/duplicación, o cambiar API pública.

## Criterios de aceptación

1. El script identifica las dependencias importadas reales mediante el resolver de TypeScript.
2. Un ciclo nuevo o una dependencia no permitida produce salida accionable y exit code distinto de cero.
3. No queda ciclo entre módulos después de separar el tipo `SessionContext` de auditoría.
4. CI ejecuta el guard.
5. `docs/planning/03-ARQUITECTURA.md` registra la regla y no presenta un estado F0 falso.

## Verificación

Ejecutar `npm run check:module-boundaries`, `npm run typecheck` y `git diff --check`. El resto de la suite no se amplía en esta tarea; no modificar reglas financieras ni migraciones.
