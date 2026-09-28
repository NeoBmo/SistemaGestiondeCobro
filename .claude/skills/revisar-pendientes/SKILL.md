---
name: revisar-pendientes
description: Cruza el diff actual con docs/planning/05-PENDIENTES.md y avisa si el cambio toca alguna decisión abierta. Úsalo antes de commitear o abrir un PR.
---

# Revisar pendientes

1. Obtén los archivos cambiados: `git diff --name-only main...HEAD` y `git status --short`.
2. Lee `docs/planning/05-PENDIENTES.md` (secciones «Abierto» y «Abiertos por fase»).
3. Para cada tema abierto, busca en el diff (nombres de archivo y contenido) señales de que se decide dentro del código o de la documentación.
4. Informa en tabla: tema abierto | archivo/línea que lo toca | acción recomendada (detenerse y preguntar).
5. Si no hay coincidencias, dilo en una línea. No resuelvas ningún pendiente por tu cuenta.
