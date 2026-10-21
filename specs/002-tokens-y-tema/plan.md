# Plan: tokens y tema visual V1

## Estrategia

Una sola capa CSS es la fuente de verdad. :root contiene valores claros y @media (prefers-color-scheme: dark) los sobrescribe; @theme inline de Tailwind 4 publica esos valores como utilities semánticas. Se usan media queries en lugar de depender de light-dark() para mantener compatibilidad con navegadores Android/WebView que puedan ser antiguos. No se añade una preferencia persistida ni JavaScript de tema.

IBM Plex Sans variable e IBM Plex Mono regular se configuran una vez con `next/font/local` y exponen variables CSS al layout raíz. Los archivos TTF y su licencia OFL viven en `src/app/_fonts/`, descargados del repositorio oficial `google/fonts`; no se añade paquete ni se requiere red al compilar. Los radios convencionales de Tailwind referencian --radius-base; rounded-full se reserva para círculos funcionales. La escala de espaciado usa unidad de 4 px y la tipografía se define en rem según la escala aprobada.

Los fondos de control serán surface (claro blanco / oscuro #111815) y sus bordes border-strong para satisfacer 3:1. Los contenedores y separadores decorativos conservan border sutil. La auditoría de controles cubre src/shared/ui/, cartera, clientes, dashboard settings, filtros de Super Admin y soporte.

## Cambios

1. Declarar temas, escala esmeralda y tokens semánticos en src/app/globals.css, incluidos pares foreground/fondo accesibles, foco, tipografía, forma y movimiento.
2. Añadir src/app/fonts.ts con las dos familias aprobadas; aplicar sus variables sin reemplazar el skip link ni metadata actual del layout.
3. Actualizar botón y campos compartidos para usar superficie y borde fuerte donde el borde identifica un control; cambiar su feedback a transición de transform/opacity solamente.
4. Cambiar clases de borde/superficie en filtros y controles nativos existentes identificados por la auditoría. No modificar la página de Caja Mayor, aunque esté modificada localmente.
5. Añadir casos Playwright smoke para visitar landing con preferencia clara y oscura, comprobar CSS computado y carga local de fuente, y revisar landing/login a 360, 768 y 1280 px con capturas adjuntas, teclado y movimiento reducido. El webServer E2E usa Webpack de Next 16 para evitar el fallo de subproceso reproducido en Turbopack en este entorno.

## Verificación

- Calcular ratios de todos los pares declarados contra sus superficies reales, sin confiar en redondeo de la tabla de diseño.
- Ejecutar el e2e smoke para desktop y mobile con preferencia clara/oscura.
- Ejecutar en este orden: npm run format:check, npm run typecheck, npm run lint, npm test, npm run build.
- Inspeccionar visualmente landing, login, caja y filtros/listados de los tres perfiles en 360, 768 y 1280 px; comprobar foco, campos, botón primario y reduced motion.

## Riesgos

Los archivos locales evitan solicitudes externas de fuentes durante build y runtime. Conservar el archivo de licencia OFL al mantener o actualizar los binarios.
