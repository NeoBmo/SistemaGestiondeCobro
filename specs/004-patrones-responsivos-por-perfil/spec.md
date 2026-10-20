# Spec: patrones responsivos por perfil

## Estado

**Implementada y aprobada en revisión independiente.** Depende de `specs/002-tokens-y-tema` y `specs/003-estados-y-presentacion-financiera`, ambas implementadas y revisadas. La automatización de capturas/overflow multi-viewport sigue en la spec 006, conforme a la decisión del usuario.

## Objetivo

Hacer que las rutas operativas existentes se puedan usar en móvil, tableta y escritorio, aplicando patrones distintos a cada perfil sin duplicar pantallas ni cambiar operaciones, información o reglas de negocio.

## Alcance

Se auditan y, tras aprobar esta spec, se corrigen solo inconsistencias verificables de layout/interacción responsive en:

- **Cobrador:** `/cobrador` y `/cobrador/clientes/[clientId]`, incluyendo acciones de llamada, mensajería, pago, gasto e intento disponibles en esos recorridos.
- **Administrador:** dashboard, Caja Mayor, cartera, clientes/lista y detalle/formulario, préstamos/lista y detalle/alta/importación, cobradores, jornadas, rutas/lista y detalle, y soporte/lista y detalle.
- **Super Admin:** inicio/lista de negocios, creación y detalle de negocio, soporte/lista y detalle, y monitoreo.
- **Estructura compartida:** shell privado y navegación por rol solo donde el cambio sea necesario para cumplir los criterios de esta spec.

No se crean rutas ni datos, no se introducen tablas donde hoy no existen, y no se cambian flujos, orden de negocio, permisos, comandos, etiquetas de dominio ni contenido financiero. Las vistas conservan la misma información en todos los anchos; cualquier ocultamiento de columna/contenido exige demostrar que la misma información sigue disponible en una presentación accesible.

Fuera de alcance: capturas automatizadas y suites Playwright multi-viewport, axe, auditoría visual integral, cambios de metadata/SEO, rediseño de marca o nuevas dependencias; se agrupan en `specs/006-verificacion-frontend`. También quedan fuera cambios a `src/modules/**`, APIs/Route Handlers, migraciones, RLS y lógica financiera.

## Requisitos funcionales (EARS)

- **RF-01 — Viewports acordados:** Cuando una ruta incluida se representa en viewports de 360, 768 o 1280 CSS px, entonces su contenido y acciones permanecen utilizables y la página no presenta desbordamiento horizontal.
- **RF-02 — Cobrador móvil:** Cuando el perfil Cobrador usa una pantalla de 360 CSS px, entonces las acciones de sus recorridos incluidos siguen visibles, alcanzables y operables con una mano, con objetivos táctiles de al menos 44 × 44 CSS px.
- **RF-03 — Contenido adaptable:** Cuando el espacio horizontal se reduce, entonces los textos, identificadores y datos extensos pueden envolver o reorganizarse sin recorte, solapamiento ni pérdida de asociación entre etiqueta y valor.
- **RF-04 — Formularios:** Cuando un formulario incluido se presenta en cualquiera de los viewports, entonces etiquetas, campos, ayudas, errores y acciones conservan orden de lectura y operación por teclado, y los controles no fuerzan un ancho mayor que el contenedor.
- **RF-05 — Administrador en escritorio:** Cuando una ruta de Administrador se muestra a 1280 CSS px, entonces filtros, formularios, resúmenes y listas aprovechan el espacio disponible con jerarquía y agrupación consistentes, sin ampliar innecesariamente el ancho de lectura.
- **RF-06 — Super Admin escaneable:** Cuando una ruta de Super Admin se muestra a 768 o 1280 CSS px, entonces listas, filtros y estados operativos mantienen jerarquía escaneable y las acciones asociadas a cada registro permanecen identificables.
- **RF-07 — Tablas anchas:** Cuando información verdaderamente tabular requiera más ancho que su contenedor, entonces el desbordamiento queda limitado a una región identificable y operable, con encabezados/asociaciones accesibles; no se desplaza toda la página horizontalmente. No se agrega una tabla si la información actual no lo justifica.
- **RF-08 — Coherencia funcional:** Cuando cambia la presentación entre viewports, entonces se preservan los mismos datos, acciones autorizadas, confirmaciones, estados y secuencia funcional; el diseño responsive no introduce lógica de dominio.
- **RF-09 — Tokens y movimiento:** Cuando una corrección responsive define espacio, tipografía, radio o movimiento, entonces reutiliza los tokens aprobados y respeta `prefers-reduced-motion`; no agrega valores de identidad locales ni animaciones fuera de `transform` y `opacity`.

## Criterios de aceptación

1. El inventario de rutas del alcance queda marcado como revisado, con defectos confirmados y correcciones vinculadas a ruta/archivo; una ruta sin defecto observado no recibe cambios por uniformidad artificial.
2. En los tres anchos acordados no hay scroll horizontal de página, contenido esencial recortado, controles solapados ni acciones inaccesibles; las excepciones tabulares cumplen RF-07.
3. En las pantallas del Cobrador incluidas, cada acción interactiva mide como mínimo 44 × 44 CSS px o queda dentro de un objetivo táctil de esa dimensión.
4. Las listas y formularios de Administrador y Super Admin conservan lectura, contexto de registro y asociación de acciones; no se insertan tablas por anticipado.
5. Se mantienen contenido, rutas, permisos, estados, datos financieros y comportamiento de comandos.
6. Esta spec no agrega dependencias ni contiene evidencia simulada de pruebas visuales. La verificación automatizada multi-viewport y capturas se realizará en la spec 006.

## Verificación prevista

- Durante esta implementación: revisar estáticamente las rutas incluidas y ejecutar la cadena de calidad del repositorio según `AGENTS.md`; inspección manual dirigida de los cambios responsive, sin declarar una cobertura visual completa.
- Al cierre de `specs/006-verificacion-frontend`: capturas/playwright y detección de overflow a 360, 768 y 1280 px para rutas representativas de cada rol; controles táctiles de Cobrador; teclado y axe conforme al alcance de esa spec.

## Fuentes de autoridad

- Reglas responsive y táctiles: `.claude/rules/frontend-design.md` §1.
- Semántica, estados y restricciones financieras: `docs/planning/02-DOMINIO.md`, `docs/planning/03-ARQUITECTURA.md` §§3 y 5.
- Identidad, tokens y decisiones visuales: `specs/002-tokens-y-tema/spec.md` y `docs/frontend/01-PLAN-FRONTEND.md`.
- Presentación financiera y estados: `specs/003-estados-y-presentacion-financiera/spec.md`.
