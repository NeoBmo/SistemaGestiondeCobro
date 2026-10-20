# 01 — Plan frontend y propuestas de specs

## Objetivo

Preparar el frontend para aplicar la identidad V1 decidida por el desarrollador. El trabajo se divide en cambios pequeños: la identidad debe cambiar valores centrales y activos de marca, no reescribir pantallas. Se aprobó la propuesta el 2026-10-16; siguen abiertas únicamente las decisiones de activos de logo e iconografía.

## Capas de trabajo

1. **Tokens y tema.** Ampliar `src/app/globals.css` y el `@theme` de Tailwind 4 como fuente única para color semántico, tipografía, espaciado, radios, sombras y movimiento. La identidad V1 fue aprobada el 2026-10-16 y su implementación comenzó en `specs/002-tokens-y-tema`. Toda decisión todavía desconocida llevará el comentario literal `/* PLACEHOLDER-IDENTIDAD */`. No usar valores visuales duplicados en componentes.
2. **Componentes base accesibles.** Consolidar variantes y estados de `src/shared/ui/` (botones, campos, alertas, spinner y shell) conservando HTML semántico, foco visible, nombres accesibles, errores anunciados y objetivo táctil de 44 px donde aplica. Patrones complejos deben seguir un patrón ARIA establecido.
3. **Estados y lenguaje financiero.** Documentar y normalizar carga, vacío, error y éxito para lectura y escritura. Montos COP como enteros formateados con utilidad compartida y `font-mono tabular-nums`; fechas según utilidades existentes y zona horaria del negocio. Confirmar acciones irreversibles con resumen y motivo cuando lo exige el flujo; mora, faltantes y diferencias siempre se describen además del color. La capa visual no calcula reglas de dominio.
4. **Patrones por perfil.** Cobrador: mobile-first, una mano, acciones frecuentes a alcance y enlaces de contacto con objetivo táctil mínimo. Administrador: filtros, formularios y listas legibles con densidad de escritorio; usar tabla accesible solo donde la información realmente sea tabular y sin perder usabilidad móvil. Super Admin: estados operativos, soporte y salud con texto/estado explícito y jerarquía escaneable.
5. **Verificación.** Playwright debe cubrir rutas representativas de cada perfil a 360, 768 y 1280 px, capturar artefactos de viewport y detectar desbordamiento. Añadir checks de teclado y axe a los flujos elegidos. Se propone evaluar `@axe-core/playwright`; su instalación es una propuesta explícita y requiere aprobación antes de añadirla. Lighthouse o medición equivalente para landing y planes reportará LCP, CLS e INP; el borrador aporta objetivos LCP ≤ 2,5 s e INP ≤ 200 ms. CLS se medirá, pero no se fija su presupuesto hasta acordarlo. Los objetivos se validan contra baseline y entorno antes de declararlos criterio automatizado.

## Ranura de identidad

El desarrollador proporcionó y aprobó la identidad V1. Su esencia es **«precisión financiera con tacto físico»**: sólida, rápida y silenciosa; prioriza claridad financiera/accesibilidad, consistencia, simplicidad y rendimiento en ese orden. Los tokens visuales aprobados son valores de marca, no placeholders.

| Decisión de marca | Punto de conexión previsto |
| --- | --- |
| Nombre y logo (variantes clara/oscura si se requieren) | Nombre actual: Cuadre, en metadata de `src/app/layout.tsx`. Marcador temporal: cuadrado esmeralda compartido por `src/shared/ui/brand-mark.tsx` en `src/app/(public)/layout.tsx` y `src/shared/ui/private-shell.tsx`; favicon SVG en `src/app/icon.svg`. Se reemplazan esos dos puntos cuando el desarrollador entregue el logo propio. |
| Paleta de marca y contraste | Tokens semánticos `--color-primary`, `--color-background`, superficies, bordes, foco y estados en `src/app/globals.css`. La propuesta usa esmeralda `#00674F` en claro y `#3F9278` como primario oscuro, con neutros y estados semánticos separados por tema. |
| Tipografía de marca y texto | Tokens tipográficos y carga central con `next/font`; se aprueba IBM Plex Sans + Plex Mono, con un peso variable para sans y regular para mono. |
| Iconografía | Sistema compartido y sus nombres/activos; no introducir iconos o una dependencia sin decisión de identidad y aprobación. |
| Tono y voz | Guía de contenido asociada a textos públicos, labels, ayuda, vacíos y mensajes de feedback; no cambiar vocabulario de dominio. |
| Ilustración y recursos visuales | Activos públicos controlados, con alternativa textual/alt apropiado; el pilar minimalista no propone ilustración decorativa en vistas operativas. |

### Mapa cromático aprobado para V1

Los pares son los valores entregados por el desarrollador para tema claro/oscuro. Deben preservarse al convertirlos a variables; no se deben intercambiar foreground/background ni inferir colores de estado de la escala de marca.

| Token semántico | Claro | Oscuro |
| --- | --- | --- |
| `background` | `#F6FBF9` | `#0A100E` |
| `surface` | `#FFFFFF` | `#111815` |
| `surface-2` | `#EFF5F2` | `#1A211E` |
| `border` | `#D9E0DD` | `#2B322F` |
| `border-strong` | `#8D9692` | `#5D6662` |
| `text` | `#111E19` | `#E8F1ED` |
| `text-muted` | `#67726D` | `#7E8985` |
| `primary` | `#00674F` | `#3F9278` |
| `primary-hover` | `#005742` | `#4FA187` |
| `primary-subtle` | `#E6EFEB` | `#073125` |
| `on-primary` | `#FFFFFF` | `#06120E` |
| `success` / fondo | `#007F38` / `#E0F7E4` | `#4CB86A` / `#122D19` |
| `warning` / fondo | `#8F6500` / `#FDEED6` | `#CB9317` / `#332305` |
| `danger` / fondo | `#C9302D` / `#FFEBE8` | `#FF655A` / `#3B1C19` |
| `info` / fondo | `#2470B5` / `#E5F2FF` | `#5AA3EC` / `#12283E` |

Escala esmeralda aprobada: 50 `#F3F8F6`, 100 `#E6EFEB`, 200 `#C8DCD4`, 300 `#A6C5B9`, 400 `#7CA998`, 500 `#4A8773`, 600 `#00674F`, 700 `#004E3B`, 800 `#003628`, 900 `#002319`, 950 `#00130C`. El paso 600 identifica marca; el 500 no se usará como texto pequeño sobre blanco porque su contraste es 4,2:1. Los estados usan los colores semánticos arriba y se acompañan de texto/ícono.

El cálculo WCAG 2.1 de los tokens aplicados confirma bordes fuertes/control de 3,04:1 en ambos temas; foco/página de 6,58:1 (claro) y 5,12:1 (oscuro); texto atenuado/superficie-2 de 4,52:1 y 4,53:1; y los estados semánticos entre 4,54:1 y 5,92:1. Aún se deben comprobar los valores renderizados en estados hover, disabled y capas superpuestas.

### Reglas aprobadas para la implementación

- El tema sigue `prefers-color-scheme` y usa pares semánticos claro/oscuro con media query; no hay selector manual en V1. El comportamiento en Android/WebView queda sujeto a verificación.
- El esmeralda identifica marca/acción primaria; éxito usa el verde separado propuesto. Mora, pago, faltante y éxito siempre conservan texto o icono además del color.
- Las superficies son sólidas y de elevación mínima; el vidrio se limita a capas flotantes. La interfaz base no depende de blur.
- Movimiento: animar solo `transform` y `opacity`. No se transicionan color, borde ni sombra. `prefers-reduced-motion` reduce el movimiento y elimina desplazamientos.
- Las dimensiones entregadas en px sirven como proporciones de referencia, no como CSS fijo: el repo prohíbe anchos/altos fijos salvo iconografía puntual (`.claude/rules/frontend-design.md`, §1). Modales, tarjetas y tablas usarán límites relativos y layout adaptable; las medidas se expresarán como tokens/escala. En 360 px no se permite que una medida nominal provoque overflow.
- Los objetivos aprobados de LCP ≤ 2,5 s e INP ≤ 200 ms se medirán en un entorno representativo. No se reinterpretan como garantía ni se optimiza a costa de accesibilidad o legibilidad financiera; CLS se medirá sin presupuesto fijado.

### Decisiones de identidad para V1

### Decisiones aprobadas para V1

- Tipografía IBM Plex Sans + Plex Mono; máximo dos familias, usando sans variable y mono regular.
- El tema sigue al dispositivo; no se añade selector manual en V1.
- Éxito conserva un verde semántico distinto del esmeralda de marca.
- Vidrio limitado a capas flotantes.
- Movimiento limitado a `transform` y `opacity`, con `prefers-reduced-motion` respetado.
- La escala propuesta (12 / 14 / 16 / 20 / 24 / 32 / 40), geometría y objetivos de rendimiento se toman como requisitos; su expresión no puede contradecir accesibilidad ni adaptación móvil.

### Pendiente no bloqueante

- Diseño y activo definitivos del logo/favicon. El cuadrado esmeralda cubre temporalmente la marca visual; no se inventa un símbolo adicional y se conserva `/* PLACEHOLDER-IDENTIDAD */` en la documentación hasta su reemplazo.

## Lista ordenada de specs aprobadas

La carpeta `specs/001-reparar-mcp-local/` fue eliminada por solicitud humana. Las specs frontend existentes conservan los IDs `002` y `003`; la secuencia continúa en `004` y se redacta/ejecuta por separado.

| ID y título | Qué y por qué | RF clave en EARS | Dependencias |
| --- | --- | --- | --- |
| `specs/002-tokens-y-tema` | Centralizar tema, tokens, tipografía y movimiento con los valores de identidad aprobados. | **RF-01:** Cuando se aplica un token visual, entonces su valor proviene de la fuente central. | Ninguna |
| `specs/003-estados-y-presentacion-financiera` | Normalizar estados de consulta/escritura y presentación financiera sin lógica de dominio en UI. | **RF-01:** Cuando una pantalla consulta o modifica datos, entonces comunica sus estados aplicables y presenta los valores con formatos compartidos. | 002 |
| `specs/004-patrones-responsivos-por-perfil` | Establecer patrones responsive por rol y corregir las inconsistencias verificadas en las rutas incluidas. | **RF-01:** Cuando una ruta incluida se presenta a 360, 768 o 1280 CSS px, entonces sus acciones y contenido siguen utilizables sin desbordamiento horizontal de página. | 002–003 |
| `specs/005-seo-y-rendimiento-publico` | Completar metadata pública, rastreo/indexación y medición de rendimiento; declarar privadas las rutas autenticadas. | **RF-01:** Cuando se sirve una página privada, entonces declara que no debe indexarse. | 002 |
| `specs/006-verificacion-frontend` | Automatizar evidencia multi-viewport, accesibilidad, estados y rendimiento en rutas representativas. Evaluar dependencias de test por separado antes de instalarlas. | **RF-01:** Cuando se verifica una pantalla, entonces se comprueban viewports y criterios acordados. | 003–005 |

## Criterio para abrir cada spec

La spec concreta debe fijar alcance de rutas, interfaces afectadas, aceptación observable y verificación; registrar cualquier dependencia propuesta; y mantener reemplazable el marcador temporal de marca. `specs/002-tokens-y-tema`, `specs/003-estados-y-presentacion-financiera` y `specs/004-patrones-responsivos-por-perfil` están implementadas y revisadas. La siguiente propuesta es `specs/005-seo-y-rendimiento-publico`; cada implementación espera aprobación de su spec, plan y tareas.
