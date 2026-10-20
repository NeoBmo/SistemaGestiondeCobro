# Plan — 012 Dependencias y secretos

1. Reproducir `npm audit` en CI/red disponible y conservar JSON.
2. Clasificar advisory por ruta y revisar fixes contra las restricciones de stack del repo.
3. Elegir escáner de secretos y ubicación de reportes; no exponer valores.
4. Revisar dependencias sin uso/nombres dudosos con imports y manifiestos.
5. Actualizar lockfile en cambio revisable separado, con CI completa.

Esfuerzo M · Ambos · No modifica reglas financieras. El escaneo de secretos debe excluir valores y artifacts sensibles.
