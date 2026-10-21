# Spec: SEO y rendimiento público

## Estado

**Implementada.** Depende de `specs/002-tokens-y-tema`, implementada y revisada. `specs/006-verificacion-frontend` cubrirá la automatización de comprobaciones de SEO y rendimiento.

## Objetivo

Hacer explícito qué superficie pública puede aparecer en buscadores, asegurar metadata útil para compartir la landing, excluir autenticación y áreas privadas de resultados, y conservar una base rápida sin añadir optimizaciones o dependencias sin medición.

## Alcance

- **Público:** `/` y su sección de planes, que hoy pertenece a la misma página; metadata de `src/app/layout.tsx`, layout público y landing.
- **Autenticación:** `/login` y `/cambiar-contrasena`.
- **Áreas privadas:** layouts de `/cobrador`, `/negocio` y `/super-admin`, incluidos descendientes de esas áreas.
- **Archivos de rastreo:** `robots.txt` y `sitemap.xml` servidos desde convenciones App Router.
- **Rendimiento público:** landing y sección de planes. Se revisa la ruta de renderizado, fuentes/imágenes y JavaScript cliente existente; solo se optimiza una causa medida y dentro de los límites de arquitectura.

Fuera de alcance: cambiar textos comerciales o precios, crear páginas nuevas, datos estructurados para contenido que no existe, analítica/telemetría de visitantes, dominios o configuración DNS, campañas de indexación, SEO de contenido autenticado, rediseño o nuevos activos de identidad, cambios a módulos, APIs/Route Handlers, sesiones, middleware, permisos o RLS. No se instala Lighthouse, `web-vitals` ni otra dependencia en esta spec; la automatización adicional se evalúa en la spec 006.

## Decisiones que fija esta propuesta

- Solo `/` es una URL pública indexable en V1; “Planes” es un ancla (`/#planes`), no una URL independiente. Login, cambio de contraseña y todas las rutas privadas llevan `noindex, nofollow`.
- El sitemap contiene exclusivamente la URL canónica de `/`; no incluye anclas, login, cambios de contraseña, rutas privadas, API ni datos por negocio/cliente.
- `robots.txt` anuncia el sitemap y **no bloquea** el rastreo de rutas a las que se aplica `noindex`. Robots.txt no es control de acceso ni sustituto de `noindex`.
- El origen canónico se obtiene de una única variable de servidor validada `PUBLIC_SITE_URL`, con una URL absoluta por entorno. No se codifica un dominio ni se usa un origen inferido de `Host`; el valor de producción lo aporta quien configure el despliegue.
- Los metadatos sociales reutilizan el nombre y la descripción ya definidos; no se inventa texto comercial ni una imagen Open Graph. El activo social queda fuera hasta que exista y se apruebe uno.
- Presupuesto de rendimiento para landing/planes en una medición de producción-like acordada: **LCP ≤ 2,5 s** e **INP ≤ 200 ms**. CLS se mide y se informa, pero no se fija umbral en esta spec. Estos presupuestos se validan en `specs/006`; no se afirma que una compilación local los garantice.

Estas decisiones no cambian la protección de rutas: el acceso continúa dependiendo de sesión y autorización del servidor. Las instrucciones a buscadores solo gobiernan indexación/rastreo.

## Requisitos funcionales (EARS)

- **RF-01 — Metadata de página pública:** Cuando se solicita `/`, entonces el documento expone título y descripción en español coherentes con la metadata y contenido existentes, sin placeholders técnicos ni claims nuevos.
- **RF-02 — Compartir públicamente:** Cuando se comparte `/`, entonces la respuesta incluye Open Graph para título, descripción, nombre de sitio y tipo `website`, con URL absoluta y canónica formada a partir de `PUBLIC_SITE_URL`.
- **RF-03 — URL canónica:** Cuando se sirve la landing, entonces su URL canónica apunta a la raíz pública del origen configurado; la sección de planes no crea una segunda URL canónica.
- **RF-04 — Sitemap público:** Cuando un rastreador solicita `/sitemap.xml`, entonces recibe un sitemap válido que contiene solo la URL canónica pública aprobada y no incluye datos privados ni endpoints.
- **RF-05 — Política de rastreo:** Cuando un rastreador solicita `/robots.txt`, entonces encuentra la referencia al sitemap y no existe una regla que impida leer directivas `noindex` de páginas autenticadas/privadas.
- **RF-06 — No indexación de autenticación y áreas privadas:** Cuando se sirve una página de login, cambio de contraseña o una página privada autenticada, entonces su metadata efectiva declara `noindex, nofollow`, aunque un segmento inferior defina su propio título.
- **RF-07 — Origen único validado:** Cuando se construyen canonical, Open Graph o sitemap, entonces todas las URL se originan de `PUBLIC_SITE_URL` validada; si el valor está ausente o no es una URL absoluta válida, la configuración falla de forma explícita y sin imprimir credenciales.
- **RF-08 — Rendimiento público:** Cuando se mide la landing y planes en el entorno de referencia acordado, entonces se reportan LCP, INP y CLS; se busca LCP ≤ 2,5 s e INP ≤ 200 ms, y CLS se informa sin umbral. Una desviación se investiga antes de optimizar.
- **RF-09 — Carga controlada:** Cuando la landing renderiza, entonces conserva renderizado de servidor y fuentes locales, no incorpora JavaScript cliente ni recursos externos nuevos sin necesidad demostrada y aprobación de dependencia cuando corresponda.
- **RF-10 — Sin filtración por SEO:** Cuando se generan metadata, `robots.txt` o sitemap, entonces no se exponen nombres de negocio, identificadores, datos financieros, contenido de tickets ni rutas de comandos.

## Criterios de aceptación

1. `/` tiene título, descripción, canonical y Open Graph en el HTML renderizado; la información deriva del contenido aprobado ya existente.
2. `/sitemap.xml` es válido y contiene solo la raíz pública en el origen configurado. `/#planes` no aparece como URL separada.
3. `/robots.txt` referencia el sitemap y no usa `Disallow` como sustituto de las directivas de no indexación.
4. La metadata efectiva de login, cambio de contraseña y cada ruta en los tres segmentos privados es `noindex, nofollow`; una metadata de página no la elimina accidentalmente por sobrescritura.
5. La configuración de origen es una única URL absoluta validada y no hay dominios inventados/hardcodeados.
6. No hay nuevas imágenes o dependencias de runtime/compilación por defecto. La landing sigue siendo Server Component y no introduce fetch externo de fuentes.
7. Las comprobaciones automatizadas de metadata/rastreo y las mediciones LCP/INP/CLS se implementarán en la spec 006. Esta spec no declara una medición de rendimiento hecha si no existe evidencia del entorno de referencia.
8. No cambia la autenticación, la privacidad de datos, el contenido de negocio ni la disponibilidad de rutas.

## Verificación prevista

- En la implementación: `format:check`, `typecheck`, `lint`, suite completa y `build` en el orden de `AGENTS.md`; confirmar rutas generadas por Next y evaluar metadata efectiva sin una sesión falsa que altere permisos.
- En `specs/006-verificacion-frontend`: validar respuestas y directivas de landing, login, rutas privadas, `robots.txt` y `sitemap.xml`; medir LCP/INP/CLS con perfil reproducible y registrar navegador, dispositivo/CPU, red, modo producción y versión de build.
- Si el entorno de verificación aún no ofrece una medición INP válida/reproducible, documentar la limitación y no sustituir INP por una métrica diferente bajo el mismo nombre.

## Fuentes de autoridad

- Metadata y renderizado: `src/app/layout.tsx`, `src/app/(public)/layout.tsx`, `src/app/(public)/page.tsx`.
- Acceso por rol: `src/app/{cobrador,negocio,super-admin}/layout.tsx`; la política de robots no reemplaza estos controles.
- Entorno: `src/shared/validation/env.ts` y la política de variables de `AGENTS.md`.
- Next.js Metadata API: [Metadata y OG](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), [Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap).
- Indexación Google: [noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing) y [robots.txt y rastreo](https://developers.google.com/search/docs/fundamentals/get-started-developers).
