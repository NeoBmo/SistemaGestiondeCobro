# Tareas — 012

- [x] Capturar resultado inicial de auditoría y sus límites.
- [x] Obtener reporte JSON completo, identificar los 7 nodos afectados y sus avisos/rutas.
- [x] Trazar el advisory inicial de `source-map-js@1.2.1`; actualizar Next/eslint-config-next y confirmar que ya no aparece.
- [x] Revisar las propuestas de npm; rechazar el downgrade major de `eslint-config-next`.
- [x] Conseguir conectividad y preparar actualización compatible de Next 16.4.2 en `codex/security-updates`.`n- [ ] Resolver el advisory residual de `braces` sin downgrade major incompatible.`n- [ ] Repetir `npm audit` y suite Vitest completa en entorno estable; guardar evidencia.
- [x] Verificar versiones fijadas, lockfile, concordancia instalada y exclusión por nombre de archivos `.env`/secretos en Git (sin leer valores).
- [x] Obtener el reporte íntegro y clasificar las seis vulnerabilidades restantes.
- [x] Registrar confirmación del dueño de que GitHub secret scanning está activo.
- [ ] Confirmar Settings de push protection; si no está cubierto, acordar escáner local/CI y retención de artifacts.
- [ ] Revisar paquetes sin uso/sospechosos.
- [ ] Proponer actualizaciones en cambios separados y ejecutar CI.
