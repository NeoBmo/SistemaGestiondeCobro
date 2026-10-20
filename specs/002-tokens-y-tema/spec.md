# Spec: tokens y tema visual V1

## Estado

**Implementada y aprobada en revisión independiente.** Identidad visual V1 aprobada por el desarrollador el 2026-10-16. El logo definitivo queda para futuro; el marcador temporal aprobado es un cuadrado esmeralda compartido por headers y favicon. IBM Plex Sans variable e IBM Plex Mono regular se autoalojan desde `src/app/_fonts/` junto con la licencia OFL. Tema según el sistema operativo (sin selector manual), verde de éxito separado, vidrio limitado a capas flotantes y movimiento animado solo con transform/opacity. `format:check` y los 34 smoke E2E pasaron. La escala tipográfica queda centralizada para usarla en componentes nuevos o modificados, sin migrar masivamente páginas existentes, expresamente fuera de alcance.

## Objetivo

Centralizar la identidad aprobada en un tema claro/oscuro, escalas y tokens reutilizables para que los cambios visuales se expresen desde CSS/tema y no con valores duplicados por pantalla. Mantener el funcionamiento actual de los flujos y el dinero.

## Alcance

- Tokens globales en src/app/globals.css: colores semánticos de marca/estado, geometría, escala tipográfica, espacio y movimiento; incluir el marcador cuadrado como logo provisional y favicon.
- Carga compartida de IBM Plex Sans variable e IBM Plex Mono regular desde el layout raíz usando next/font de Next.js; sin dependencia nueva.
- Tokenización de las variantes base de botón/campo que necesitan el par superficie + borde de control de contraste suficiente para ambos temas.
- Prueba e2e inocua de render de tokens claro/oscuro en una página pública, sin datos de negocio.

Fuera de alcance: diseñar el logo/favicon definitivo; rehacer layouts o páginas; selector de tema; cambiar reglas financieras, datos, APIs, Route Handlers, módulos, migraciones, RLS o dependencias; vidrio/blur; cambios de contenido.

## Requisitos funcionales (EARS)

- **RF-01 — Fuente única:** Cuando una vista consume un color, radio, tipografía, tamaño tipográfico, unidad de espaciado o duración cubiertos por esta spec, entonces el valor proviene de un token central de src/app/globals.css.
- **RF-02 — Tema del sistema:** Cuando el navegador prefiere claro u oscuro, entonces la página usa el juego semántico correspondiente y declara el color-scheme concordante; si no hay preferencia oscura, usa claro.
- **RF-03 — Marca primaria:** Cuando se presenta la acción primaria o el enlace de marca, entonces usa esmeralda 600 en claro (#00674F) y esmeralda adaptado en oscuro (#3F9278); el texto del control conserva contraste mínimo 4.5:1.
- **RF-04 — Estados:** Cuando se presenta éxito, aviso, peligro/mora o información, entonces usa sus tokens semánticos de tema y conserva una etiqueta, texto o icono que comunique el estado sin depender solo del color.
- **RF-05 — Tipografía:** Cuando la app renderiza texto normal o datos financieros, entonces usa IBM Plex Sans variable o IBM Plex Mono regular respectivamente, servidas desde el mismo origen mediante el cargador integrado de Next.js; no se carga una tercera familia.
- **RF-06 — Escala:** Cuando un componente nuevo o modificado elige tamaños tipográficos o espaciado de la identidad, entonces usa los pasos 12/14/16/20/24/32/40 px y la unidad base de 4 px, expuestos como tokens reutilizables y expresados en unidades relativas. Esta spec centraliza y expone los tokens; no migra masivamente la jerarquía tipográfica de páginas existentes.
- **RF-07 — Forma:** Cuando un componente usa radios convencionales de Tailwind, entonces derivan de --radius-base; el valor V1 es 0 y produce esquinas rectas. Las formas circulares necesarias para indicadores/spinners conservan su geometría.
- **RF-08 — Movimiento:** Cuando una interacción se anima, entonces solo transiciona transform u opacity, con duraciones tokenizadas entre 150–250 ms; cuando está activo prefers-reduced-motion, no hay desplazamiento ni rebote.
- **RF-09 — Bordes de control:** Cuando un borde distingue un control interactivo de su superficie, entonces alcanza contraste no textual 3:1 como mínimo en ambos temas; los controles usan la superficie blanca/clara u oscura definida y el token de borde fuerte.
- **RF-10 — Privacidad de fuentes:** Cuando se sirve la aplicación, entonces el navegador obtiene las fuentes desde el dominio de la app, sin solicitud a Google en tiempo de navegación.
- **RF-11 — Marca provisional:** Cuando se muestra el nombre de Cuadre en los headers públicos o privados, entonces aparece junto a un cuadrado esmeralda sin forma decorativa adicional; el navegador recibe un favicon cuadrado equivalente. Cuando llegue el activo definitivo, ambos puntos se reemplazan sin reestructurar pantallas.

## Tokens aprobados

Los pares de marca/estado y la escala completa se registran en docs/frontend/01-PLAN-FRONTEND.md, sección “Mapa cromático aprobado para V1”. Los nombres semánticos públicos para el tema deben cubrir: background, surface, surface-2, border, border-strong, foreground, muted, primary, primary-hover, primary-subtle, primary-foreground, success/success-subtle/success-strong, warning/warning-subtle/warning-strong, danger/danger-subtle/danger-strong, info/info-subtle/info-strong, focus, fuentes sans/mono, escala y movimiento.

Los valores de placeholder de logo/activos usan el comentario literal /* PLACEHOLDER-IDENTIDAD */; no se inventa un símbolo gráfico.

## Criterios de aceptación

1. prefers-color-scheme: light y dark producen los colores de fondo, superficie, texto, primario, estados y foco documentados para ese tema.
2. Se verifica el contraste de texto normal ≥4.5:1, texto grande ≥3:1 y bordes de control ≥3:1 sobre las superficies reales que se renderizan; ratios redondeados que queden por debajo no pasan.
3. Controles compartidos y filtros de lista existentes usan surface + border-strong, sin alterar sus nombres, valores, eventos o semántica.
4. Las fuentes se importan en layout raíz una sola vez, usan subset latin y variable para Sans/400 para Mono, y el navegador no hace fetch externo de fuentes.
5. El radio V1 cuadrado se aplica a radios Tailwind convencionales; spinner e iconografía mantienen la forma necesaria.
6. La regla global de movimiento reducido sigue activa; las transiciones de colores y sombras se eliminan del botón compartido y no se agregan efectos de vidrio.
7. La prueba e2e ejercita ambos temas en landing y confirma valores computados sin autenticación ni base de datos.
8. La marca provisional aparece en headers públicos/privados y como favicon; sus dos puntos de sustitución están centralizados y el logo definitivo no se inventa.
9. No cambia el contenido ni las operaciones de cobro; se conserva intacto el cambio previo de src/app/negocio/caja/page.tsx.

## Riesgos y límites

- IBM Plex se autoaloja desde binarios TTF con licencia OFL, incluida junto a los archivos. Si se actualizan los binarios, conservar la licencia y comprobar el tamaño de los activos.
- Un borde fuerte de 3:1 aplicado a tarjetas/listas puede agregar ruido; solo se aplica a controles. Las superficies decorativas conservan el borde sutil.
- El cuadrado esmeralda es un marcador transitorio aprobado por el desarrollador; el diseño propio futuro reemplaza el componente y favicon.
