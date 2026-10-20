# Spec 015 — Baseline de hotspots de mantenibilidad

## Problema

El repositorio carece de métricas de tamaño de archivo y función. La inspección visual encontró servicios financieros y pruebas extensos, pero no hay un baseline repetible ni thresholds aprobados. No se debe bloquear la CI con límites arbitrarios.

## Decisión

Añadir un reporte local, sin dependencias nuevas, que use la API de TypeScript ya instalada para medir líneas por archivo y spans de funciones. Proponer análisis de duplicación/código muerto con herramientas existentes o futuras, pero no instalarlas ni fingir que el reporte detecta esos casos. El reporte es informativo y no corre como gate.

## Criterios de aceptación

1. Reporte determinista de archivos y funciones más grandes, separando tests del código de producto.
2. Sin thresholds, autofix ni cambios de producto.
3. Uso manual vía script npm, sin CI bloqueante ni paquetes nuevos.
4. La auditoría identifica las limitaciones: duplicación, código muerto y comentarios obvios requieren herramienta/revisión aparte.

## Verificación

Ejecutar el reporte y `git diff --check`; revisar si ofrece información accionable sin etiquetar tamaño por sí solo como defecto.
