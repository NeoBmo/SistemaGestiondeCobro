# Tareas: tokens y tema visual V1

1. [x] **Establecer baseline de estado del repo.** Confirmar rama y diff; conservar intactos los cambios preexistentes y el WIP en Caja Mayor.
   **Hecho cuando:** los archivos ajenos a la spec quedan identificados para comparación final.

2. [x] **Implementar tokens semánticos y temas CSS.** Definir tokens claros/oscuros, escalas, superficie/bordes, foco y estados desde globals.css, con @theme inline.
   **Hecho cuando:** Tailwind genera utilities semánticas y los valores computados siguen prefers-color-scheme.

3. [x] **Cargar tipografías centrales.** Configurar IBM Plex Sans variable y IBM Plex Mono regular en src/app/fonts.ts y conectarlas al layout raíz con subset latin.
   **Hecho cuando:** los elementos usan variables sans/mono desde el origen local de la app y el build termina sin fallo de descarga.

4. [x] **Aplicar radio y movimiento base.** Mapear radios Tailwind a --radius-base: 0; conservar el círculo de spinner; tokenizar duraciones/easing; cambiar el botón compartido para animar solo transform/opacity.
   **Hecho cuando:** clases normales de radio son cuadradas, el botón no transiciona color/sombra y reduced motion sigue respetado.

5. [x] **Asegurar contraste en controles.** Usar superficie y borde fuerte en campos compartidos y filtros nativos existentes que dependen de un borde.
   **Hecho cuando:** cada pareja de borde/control supera 3:1 en claro y oscuro y el estado de error sigue comunicado con texto.

6. [x] **Añadir y ejecutar pruebas de UI sin sesión.** El smoke e2e cubre ambos temas, carga de fuentes locales, foco por teclado y login; landing/login se prueban a 360, 768 y 1280 px con detección de overflow y capturas adjuntas, además de `prefers-reduced-motion`. Los 34 casos pasan en desktop y mobile, sin Supabase.
   **Hecho cuando:** ambos temas, viewports, foco y movimiento reducido pasan en desktop y mobile sin Supabase, y las capturas aparecen como adjuntos.

7. [x] **Verificar presentación y calidad.** Contraste recalculado en la implementación; viewports 360/768/1280 sin overflow, navegación por teclado, foco visible, controles táctiles y movimiento reducido comprobados. Cadena CI ejecutada en orden: `format:check`, `typecheck`, `lint`, 55 suites/298 pruebas Vitest con un worker, y build de producción; todo pasa. Prettier omite snapshots de página generados en `.playwright-mcp/` sin cambiarlos.
   **Hecho cuando:** todas las verificaciones pasan o cada fallo se informa y corrige en código, nunca debilitando pruebas.

8. [x] **Evaluación y memoria.** Actualizar `MEMORY.md` y terminar una revisión final del diff contra la spec.
   **Hecho:** revisión independiente final aprobada; memoria y límites actualizados. La escala tipográfica queda preparada para componentes nuevos o modificados y no migra masivamente páginas existentes.

9. [x] **Añadir marca provisional reemplazable.** Mostrar el cuadrado esmeralda junto al nombre en headers públicos/privados y servirlo como favicon adaptado al tema del sistema.
   **Implementado y verificado:** `BrandMark` centraliza el elemento UI, `src/app/icon.svg` cubre el favicon y Playwright contiene aserciones del marcador en tema claro/oscuro. Los 34 smoke E2E pasan en desktop y mobile.

## Evidencia de ejecución (2026-10-16)

- Contraste calculado con WCAG 2.1: borde fuerte/control 3,04:1 en claro y oscuro; foco/página 6,58:1 y 5,12:1; texto atenuado/superficie-2 4,52:1 y 4,53:1; éxito, aviso, peligro e info entre 4,54:1 y 5,92:1.
- `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test -- --pool=threads --maxWorkers=1`, `npm run build`, los 34 smoke E2E desktop/mobile, Prettier focalizado y `git diff --check`: pasan. El runner E2E usa el backend Webpack; ambos backends de build ahora pasan con los binarios locales.
- Se inspeccionaron las capturas de landing/login para 360, 768 y 1280 px. Los artefactos se conservan en `playwright-report/` (ignorado por Git). El login 360 mantiene campos y acciones dentro del ancho; las tarjetas de planes fluyen en columna en móvil y en fila en escritorio. No se ejercitaron vistas privadas con sesión real, fuera del smoke sin Supabase de esta spec.
- La dirección posterior del logo propio queda explícitamente fuera de V1: el desarrollador aprobó un cuadrado esmeralda sin glifo como marcador temporal.
