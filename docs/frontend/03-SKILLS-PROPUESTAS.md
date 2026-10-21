# 03 — Skills frontend: reutilizar y proponer

## Recursos existentes que se reutilizan

| Recurso | Uso frontend |
| --- | --- |
| `.claude/rules/frontend-design.md` | Norma de responsividad mobile-first, WCAG 2.1 AA, movimiento, jerarquía tipográfica, cuatro estados y semántica de color. Consultarla antes de cualquier cambio en `src/app/` o `src/shared/ui/`. |
| `.claude/agents/code-reviewer.md` | Revisión independiente posterior de diff UI: reglas frontend, montos, estados, pruebas y dependencias. Recibe explícitamente las rutas cambiadas; no implementa ni escoge identidad. |
| `.claude/agents/verificador-de-fase.md` | Verifica los criterios de salida de fase descritos en `docs/planning/04-PLAN.md`; se invoca al cerrar fase, no para cada componente. |
| `docs/planning/06-AGENTES-HABILIDADES.md` | Define el papel y límite de subagentes/skills y la convivencia con `CLAUDE.md`. No contiene skills de creación de UI. |
| `AGENTS.md` / `CLAUDE.md` | Seguridad, fases, calidad y límites del repositorio; prevalecen ante cualquier contradicción de una skill. |

## Skills nuevas propuestas

Las siguientes son propuestas de instrucciones reutilizables, no skills ya instaladas. Las especificaciones de su sintaxis y ubicación se redactarán al aprobar la skill correspondiente; no se crea automatización que añada dependencias o modifique archivos fuera de una tarea autorizada.

### `crear-componente-ui`

- **Cuándo:** crear o extender un componente compartido de `src/shared/ui/`.
- **Pasos:** leer reglas frontend y patrones cercanos; definir responsabilidades y API mínima; preferir semántica nativa; reutilizar tokens y estados; añadir prueba enfocada si está en el alcance aprobado.
- **Checklist:** API clara; teclado/foco/labels; tamaños táctiles pertinentes; estilos sin valores de marca; clases consistentes; responsive revisado; no se añadió dependencia no aprobada.

### `pantalla-cuatro-estados`

- **Cuándo:** crear o modificar pantalla/componente que consulta o escribe datos.
- **Pasos:** identificar origen de datos y rol; describir carga, vacío, error y éxito; seguir `useCommand` y los servicios existentes; comunicar error en lenguaje del rol; confirmar acción irreversible conforme al flujo existente.
- **Checklist:** cuatro estados verificables; éxito muestra resultado relevante; errores asociados y anunciados; UI no calcula reglas financieras; seguridad y comandos permanecen en capas existentes.

### `auditar-accesibilidad-ui`

- **Cuándo:** revisar una pantalla o un cambio que afecta interacción, formularios, color o movimiento.
- **Pasos:** comprobar landmarks y encabezados; tab/shift-tab/enter/escape; foco; nombre y etiqueta; anuncio de errores y feedback; contraste y redundancia de color; movimiento reducido; correr axe si la dependencia fue aprobada y está disponible.
- **Checklist:** WCAG 2.1 AA revisado; hallazgos con `archivo:línea` o pasos reproducibles; limitaciones indicadas; sin cambiar reglas normativas.

### `verificar-responsividad-3-anchos`

- **Cuándo:** auditar o revisar una pantalla adaptable.
- **Pasos:** correr la pantalla en 360, 768 y 1280 px; revisar scroll horizontal, orden, foco visible, lectura y controles; comprobar acciones del Cobrador con objetivos táctiles de al menos 44 px; adjuntar capturas a la revisión.
- **Checklist:** tres anchos cubiertos; no se oculta información/acción esencial; overflow explicado o resuelto; capturas identifican ruta y viewport.

### `revisar-seo-publico`

- **Cuándo:** crear o modificar landing, planes u otra página indexable.
- **Pasos:** clasificar pública/privada; verificar title/description, canonical/social metadata cuando corresponda, estructura de encabezados, enlaces, sitemap/robots, noindex privado; medir LCP/CLS/INP contra baseline.
- **Checklist:** rutas públicas rastreables; privadas explícitamente no indexables; metadata coherente; métricas reportadas sin inventar presupuesto.

### `aplicar-tokens-identidad`

- **Cuándo:** solo después de recibir decisiones y activos de identidad aprobados.
- **Pasos:** mapear cada decisión a token o archivo central; reemplazar placeholders únicamente con valores provistos; comprobar contraste/foco/estados; revisar landing y una vista por perfil; escanear usos duplicados o hardcodeados.
- **Checklist:** nombre/logo/paleta/tipo/iconos/tono/ilustración conectados según alcance; sin rediseño componente por componente; ratios accesibles; placeholders restantes inventariados; ninguna decisión de marca inferida.

## Límites comunes

Una skill guía trabajo repetitivo; no es fuente de verdad, no reabre decisiones cerradas y no reemplaza la aprobación de una spec. Si una propuesta contradice `CLAUDE.md`, `AGENTS.md`, `docs/planning/02-DOMINIO.md`, `03-ARQUITECTURA.md` o la regla frontend, prevalecen esos documentos según su orden de autoridad. No se instalará `@axe-core/playwright` ni otra dependencia como efecto de estas propuestas.
