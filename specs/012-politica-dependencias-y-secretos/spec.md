# Spec 012 — Política de dependencias y secretos

## Alcance

Registrar una auditoría reproducible de vulnerabilidades, dependencias directas/transitivas y secretos, y acordar cómo se guardan los reportes. No actualizar dependencias sin revisión de compatibilidad.

## Estado

Parcial: la rama `codex/security-updates` eleva Next y eslint-config-next a 16.4.2 y elimina los avisos de Next y source-map-js. `npm audit --json` ahora confirma 5 nodos altos ligados al advisory de `braces` GHSA-vfj7-8cjw-p6xm; npm propone downgrade major de eslint-config-next a 14.2.35, rechazado por incompatibilidad. Falta una resolución compatible y validar de nuevo toda la suite Vitest (fallos ENOENT al crear temporales SSR en Windows). Secret scanning está confirmado por el dueño; push protection no se confirmó. Evidencia: `docs/auditoria/03-DEPENDENCIAS.md`.

## Criterios de salida

- [ ] Reporte íntegro repetible con conexión a registry y artifact retenido.
- [ ] Cada vulnerabilidad tiene ruta, exposición, mitigación y responsable.
- [x] El dueño confirma GitHub secret scanning activo.
- [ ] Confirmar push protection y si cubre el flujo del equipo.
- [ ] Política de reportes de audit, lockfile y actualizaciones configurada.
- [ ] Revisar paquetes sospechosos o no usados con evidencia de importación.
