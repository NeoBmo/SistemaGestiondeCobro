# 00 — Diagnóstico del frontend

## Resumen ejecutivo

La interfaz ya tiene una base coherente: Tailwind CSS 4, tokens semánticos de color, componentes compartidos accesibles, layouts separados por rol, importe financiero tabular y movimiento reducido. La superficie actual comprende **26 rutas `page.tsx`**, 94 archivos TSX en `src/app/` y 8 componentes TSX en `src/shared/ui/` (inventario del árbol al 2026-10-16).

La identidad visual aún no está definida y no se debe inferir. La principal deuda antes de aplicarla es convertir estilos dispersos en decisiones centralizadas, medir pantallas en viewports reales, completar una política explícita de indexación y hacer repetible la auditoría de accesibilidad. Esta revisión es estática: no se levantó la aplicación ni se realizaron capturas nuevas o una auditoría axe.

## Inventario por perfil

| Superficie | Rutas y responsabilidades observadas | Base actual |
| --- | --- | --- |
| Pública y autenticación | Landing y planes (`src/app/(public)/page.tsx`); login y cambio de contraseña (`src/app/(auth)/`) | Layouts separados, metadata de título y formularios cliente puntuales. |
| Super Admin | Negocios, alta/detalle, soporte y monitoreo (`src/app/super-admin/`) | Navegación del área, carga/error y pantallas de salud de plataforma. |
| Administrador | Dashboard, caja, cartera, clientes, préstamos, cobradores, rutas, jornadas y soporte (`src/app/negocio/`) | Shell común, filtros, formularios de comandos, listados y resúmenes financieros. |
| Cobrador | Jornada/meta, clientes asignados y ficha de cliente (`src/app/cobrador/`) | Shell de una columna (`max-w-lg`), resumen de jornada y acciones táctiles; hay estados de marcador en páginas aún no implementadas. |

En el estado actual hay 13 archivos `loading.tsx`, 13 `error.tsx` y 8 `not-found.tsx`. Las lecturas resueltas presentan el contenido como estado normal; las mutaciones tienen estados de comando mediante `useCommand` y componentes de feedback. La cobertura de estos estados debe verificarse pantalla por pantalla, no inferirse del número de archivos de segmento.

## Lo que está bien

- Los colores semánticos viven en un solo `@theme`; el comentario documenta ratios AA de los colores de texto y estados. El foco visible y `prefers-reduced-motion` tienen reglas globales (`src/app/globals.css:9-49`).
- Los componentes de campos asocian etiqueta, ayuda y error; alertas distinguen `alert`/`status`, y el spinner anuncia carga (`src/shared/ui/text-field.tsx:17-37`, `src/shared/ui/alert.tsx:33-50`, `src/shared/ui/spinner.tsx:18-26`).
- Los botones compartidos y los campos comunes establecen altura mínima de 44 px; el shell del cobrador reduce el ancho y la ficha conserva acciones táctiles (`src/shared/ui/button.tsx:34-45`, `src/app/cobrador/layout.tsx:11-13`, `src/app/cobrador/clientes/[clientId]/page.tsx:27-31`).
- La mayoría de montos se presenta con `font-mono tabular-nums`, usando el formateador compartido de dinero (`src/app/cobrador/page.tsx:47-60`, `src/app/negocio/caja/page.tsx:35-40`, `src/shared/money/money.ts`).
- La landing usa secciones y encabezados semánticos; el layout global incluye idioma español y enlace para saltar al contenido (`src/app/(public)/page.tsx:15-20`, `src/app/layout.tsx:9-18`).
- Los layouts privados resuelven y validan la sesión por rol en servidor (`src/app/negocio/layout.tsx:6-11`, `src/app/super-admin/layout.tsx:13-18`, `src/app/cobrador/layout.tsx:6-12`).

## Hallazgos priorizados

### Alto

1. **No hay directiva explícita de no indexación para áreas privadas.** No existen `src/app/robots.ts` ni `src/app/robots.txt`, y los layouts privados no exportan `robots: { index: false, follow: false }`. La autenticación del servidor protege los datos, pero la intención para motores de búsqueda no está expresada. Evidencia: `src/app/negocio/layout.tsx:6-11`, `src/app/super-admin/layout.tsx:13-18`, `src/app/cobrador/layout.tsx:6-12`; búsqueda de `robots` sin resultados en `src/app/`.

2. **La validación visual en 360, 768 y 1280 px no está automatizada ni registrada.** Hay clases responsive y alturas táctiles, pero no hay cobertura que capture los tres tamaños o detecte desbordamiento/solapamiento. Este diagnóstico no afirma que las pantallas fallen: no fueron renderizadas a esos anchos. Evidencia: `src/app/(public)/page.tsx:58-68`, `src/app/cobrador/page.tsx:92-125`; la configuración Playwright actual se encuentra en `playwright.config.ts`.

### Medio

1. **La capa de tema solo centraliza colores.** `@theme` define 17 valores hexadecimales en 17 líneas; tipografía, escala de espaciado, radios y sombras siguen en clases Tailwind distribuidas por las pantallas. Esto dificulta sustituir la identidad desde un mapa controlado. Evidencia: `src/app/globals.css:9-28`, `src/shared/ui/button.tsx:38`, `src/app/(public)/page.tsx:19-30`.

2. **No hay política SEO completa para páginas públicas.** La metadata raíz incluye título y descripción; no encontré metadata Open Graph, `sitemap` ni rutas de robots. La landing no exporta metadata propia. Evidencia: `src/app/layout.tsx:4-7`, `src/app/(public)/page.tsx:1-15`; ausencia de `src/app/sitemap.ts` y `src/app/robots.ts`.

3. **Los estados y fallos no tienen cobertura de auditoría accesible automatizada.** Hay buenas bases `aria-live`, `role=status` y `role=alert`, pero no se encontró configuración de axe ni pruebas de teclado/contraste para páginas. Los límites de segmento cubren solo parte del inventario (13 loaders y 13 errores para 26 rutas). Evidencia: `src/shared/ui/alert.tsx:33-50`, `src/shared/ui/spinner.tsx:18-26`; inventario de archivos `loading.tsx`/`error.tsx`.

4. **No hay patrón de tablas densas en la interfaz observada.** Las vistas encontradas favorecen listas y tarjetas, lo cual funciona en móvil pero deja por definir la presentación densa para el administrador en escritorio. La auditoría de estructura debe confirmar si el producto necesita tablas en las pantallas existentes antes de incorporar un patrón. Evidencia: `src/app/negocio/cartera/page.tsx:143-205`, `src/app/super-admin/page.tsx:99-124`; no se encontró elemento HTML `<table>` en `src/app/`.

### Bajo

1. **La carga de fuentes e imágenes no se puede cuantificar con el código actual revisado.** No encontré uso de `next/font`, `next/image` ni etiquetas `<img>` en `src/app/`; la tipografía efectiva depende de las fuentes del navegador. No se corrió análisis de bundle o Core Web Vitals y no hay base para atribuir exceso de JavaScript a los 38 archivos con directiva cliente. Evidencia: búsqueda de `next/font`, `Image`, `<img>` en `src/app/` y conteo de 38 archivos `use client`.

2. **El nombre “Cuadre” está repetido en la interfaz.** La identidad futura debe conectar nombre/logo a un punto único en vez de reemplazar texto pantalla por pantalla. Evidencia: `src/app/layout.tsx:4-6`, `src/app/(public)/layout.tsx:8-24`, `src/shared/ui/private-shell.tsx:28-30`.

## Cumplimiento de reglas frontend

| Regla | Estado observado |
| --- | --- |
| Mobile-first y 44 px para Cobrador | Parcial: shell y varios controles cumplen en el código; no se validó cada acción ni viewport renderizado. |
| WCAG 2.1 AA | Parcial: tokens de contraste documentados, foco global y semántica de formularios presentes; falta verificación manual y automatizada por pantalla. |
| Movimiento reducido | Implementado globalmente en `globals.css`. |
| Jerarquía tipográfica y montos tabulares | Clases de jerarquía presentes y montos en general usan `font-mono tabular-nums`; falta inventario de excepciones. |
| Cuatro estados visuales | Los patrones compartidos y varios segmentos los cubren; falta una matriz de aceptación por ruta/acción. |
| Color no como único significado | Alertas usan texto e icono; la consistencia de badges de estado requiere auditoría por pantalla. |
| Paleta semántica única | Cumplida para color vía `@theme`; no existe aún un contrato equivalente para tipografía, espaciado, radios y sombras. |

## Alcance y límites de esta revisión

La revisión no leyó secretos, no cambió código y no modificó los cambios locales existentes. Los conteos se refieren al árbol de trabajo y pueden incluir archivos con cambios no confirmados. Las observaciones de responsive, contraste en contexto, teclado y Core Web Vitals requieren las verificaciones propuestas; no se presentan como resultados de ejecución.
