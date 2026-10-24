# Lanzamiento: guarda de producción (INV-034)

`npm run check:production-readiness` (`scripts/check-production-readiness.mjs`) falla con código 1 y lista en lenguaje claro lo que impide llevar datos reales a producción:

| Bloqueante | Qué busca | Cómo se resuelve |
| --- | --- | --- |
| Identidad visual provisional | El marcador `PLACEHOLDER-IDENTIDAD` en `src/` o `public/` | Sustituir el activo provisional por el definitivo y quitar el marcador |
| URL pública de ejemplo | Con `NODE_ENV=production`: `PUBLIC_SITE_URL` ausente, inválida o en `.invalid` (p. ej. `https://example.invalid`) | Configurar el dominio real en Vercel y en la variable `PUBLIC_SITE_URL` del repositorio |
| Pendientes que bloquean F8 | En `docs/planning/05-PENDIENTES.md`, secciones abiertas: viñetas con «bloquea F8» y filas cuya columna «Bloquea» menciona F8 (salvo las que empiezan por «Resuelto») | Decidir, mover la decisión a `02`/`03` y borrar la fila (`07-FLUJO-DE-TRABAJO.md`) |

Sin `NODE_ENV=production` la comprobación de la URL se omite y el script lo avisa.

## Dónde corre

No está en el CI de cada PR: hasta cerrar F8 fallaría siempre. Corre en `.github/workflows/release-readiness.yml`:

- al empujar una etiqueta `v*` (p. ej. `v1.0.0`), y
- a mano: *Actions → Guarda de lanzamiento → Run workflow*.

El workflow usa `NODE_ENV=production` y la **variable** de repositorio `PUBLIC_SITE_URL` (*Settings → Secrets and variables → Actions → Variables*), que el dueño crea con el dominio real.

## En local

```sh
npm run check:production-readiness
NODE_ENV=production PUBLIC_SITE_URL=https://<dominio-real> npm run check:production-readiness
```

## Lista previa al lanzamiento

1. La guarda pasa en verde (workflow manual o etiqueta `v*`).
2. El backup diario está configurado y el **ensayo de restauración** está hecho y registrado: `docs/operacion/BACKUP-Y-RESTAURACION.md`.
3. Criterio de salida de F8 verificado contra `docs/planning/04-PLAN.md`.
