# Plan: SEO y rendimiento público

## Estrategia

Separar metadata pública de las directivas de autenticación/áreas privadas usando Metadata API de App Router. Definir un solo origen público validado para canonical, Open Graph y sitemap. No usar robots.txt para reemplazar `noindex`, para seguridad, ni para ocultar páginas privadas. El sitemap se mantiene pequeño y explícito porque la única URL pública indexable actual es `/`.

Preservar landing pública como Server Component y reutilizar el título/descripción existentes. Revisar los presupuestos de rendimiento contra evidencia reproducible antes de optimizar; no agregar dependencias ni contenido/activos para social sharing sin aprobación. No leer `.env*` ni valores de credenciales durante la implementación; la variable de URL es pública/no secreta, pero su valor de despliegue se proporcionará por el usuario/entorno.

## Inventario delimitado

- Raíz y página pública: `src/app/layout.tsx`, `src/app/(public)/layout.tsx`, `src/app/(public)/page.tsx`.
- Autenticación: `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/cambiar-contrasena/page.tsx`.
- Segmentos privados: `src/app/cobrador/layout.tsx`, `src/app/negocio/layout.tsx`, `src/app/super-admin/layout.tsx`; sus páginas actuales conservan metadata de título local.
- Integración de variable: `src/shared/validation/env.ts`, su prueba de validación y `.env.example` (sin leer ni revelar ningún archivo de entorno local).
- Archivos de convención nuevos: `src/app/robots.ts`, `src/app/sitemap.ts`.

No cambiar layouts de sesión ni redirects salvo que una prueba demuestre un problema de metadata; no tocar APIs, Route Handlers, módulos de dominio, middleware, permisos o RLS. Preservar todo diff local preexistente en esos archivos.

## Secuencia

1. Confirmar la metadata actual, herencia por layouts, lista exacta de páginas públicas/autenticadas/privadas y ausencia de sitemap/robots/Open Graph en el baseline.
2. Añadir `PUBLIC_SITE_URL` como una URL absoluta validada en el esquema de entorno de servidor; documentar su placeholder no secreto en `.env.example` sin leer valores locales y asegurar que los errores solo nombren la variable.
3. Añadir metadata pública explícita y `metadataBase`/canonical/Open Graph con origen único, preservando los títulos y descripciones vigentes.
4. Declarar `noindex,nofollow` en layout de autenticación y en los tres layouts privados; revisar metadata final porque hijos pueden reemplazar claves anidadas.
5. Añadir `robots.ts` y `sitemap.ts` con una lista explícita de URL públicas. No crear `Disallow` para las páginas noindex.
6. Ejecutar la cadena de calidad y revisar el diff; diferir tests automatizados de rastreo/metadata y medición de rendimiento a spec 006.
7. Registrar el cierre, las limitaciones de SEO/performance y la revisión independiente en `tasks.md` y `MEMORY.md`.

## Verificación

- En implementación: pruebas dirigidas de validación de `PUBLIC_SITE_URL`, cadena de calidad del repo y comprobación del build/generación de rutas; no imprimir valores de entorno.
- En spec 006: recorrer las rutas públicas y privadas con Playwright, inspeccionar `<title>`, `description`, canonical, OG y robots; comprobar XML y robots generados; mediciones Lighthouse/DevTools comparables para LCP/INP/CLS.
- Cualquier incorporación de Lighthouse CI, `web-vitals` u otra dependencia se propone aparte y requiere aprobación explícita antes de instalarse.

## Riesgos

- Metadata en Next se combina por segmentos; el campo `robots` se puede reemplazar si se declara en un hijo. Debe verificarse el resultado efectivo de cada ruta privada.
- Google requiere poder rastrear una página para procesar su meta `noindex`; bloquear esa página en robots.txt puede impedir la lectura de la directiva. Los controles de sesión siguen siendo la barrera de privacidad.
- LCP, INP y CLS varían por entorno; el presupuesto no se da por aprobado a partir de `next build` ni de una corrida local aislada.
- La URL de producción aún no está escrita en el repo. El valor concreto debe entrar por configuración del despliegue, no en el código.

## Resultado de implementación (2026-10-17)

- `PUBLIC_SITE_URL` quedó como requisito del esquema de servidor y se añadió un ejemplo reservado (`https://example.invalid`) en `.env.example`; el valor de producción sigue pendiente de configuración del despliegue.
- El build confirmó las rutas `/robots.txt` y `/sitemap.xml`; se inspeccionaron los artefactos generados con el origen temporal reservado y solo incluyen la landing en el sitemap. La metadata de la landing incluye canonical y OG.
- `format:check`, `typecheck`, `lint`, 55 suites/299 pruebas (`--pool=threads --maxWorkers=1`) y build con Webpack pasan. El modo de build Turbopack falló al intentar crear un junction bloqueado por el sandbox; Vitest predeterminado tuvo `ENOENT` en temporales y la suite pasó con un worker.
- No se midieron LCP, INP ni CLS, ni se automatizó aún la inspección de metadata por ruta; queda para `specs/006-verificacion-frontend`.
