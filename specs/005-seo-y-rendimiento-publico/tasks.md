# Tareas: SEO y rendimiento público

1. [x] **Auditar metadata y superficie rastreable.** Se confirmó la herencia actual para landing, login/cambio de contraseña y segmentos privados; robots/sitemap no existían y `/` es la única URL pública indexable.
2. [x] **Definir y validar origen público.** `PUBLIC_SITE_URL` se valida como origen absoluto HTTP(S), sin ruta, credenciales, query ni fragmento. Se añadió un ejemplo `.invalid` a `.env.example` sin leer archivos de entorno.
3. [x] **Completar metadata pública.** La landing declara title/description, canonical y Open Graph; `metadataBase` usa el origen validado. No se añadieron claims ni imágenes.
4. [x] **Excluir autenticación y áreas privadas de resultados.** Layouts de auth, Cobrador, Negocio y Super Admin declaran `noindex,nofollow`; las páginas hijas actuales solo sobrescriben títulos.
5. [x] **Publicar robots y sitemap mínimos.** `robots.txt` anuncia el sitemap y deja rastreables las rutas noindex; `sitemap.xml` lista solo la landing. Se inspeccionaron el HTML generado y ambos archivos del build.
6. [x] **Verificar y revisar.** `format:check`, `typecheck`, `lint`, `npm test -- --pool=threads --maxWorkers=1` (55 suites/299 pruebas) y build con Webpack pasan. El build Turbopack no puede crear un junction en el sandbox; `npm test` predeterminado falla por `ENOENT` en temporales de Vitest. Sin dependencias nuevas; las pruebas SEO automatizadas y las mediciones LCP/INP/CLS se consolidan en spec 006.
7. [x] **Cerrar documentación y memoria.** Requisito de despliegue, resultados y límites registrados aquí y en `MEMORY.md`; el valor real de producción debe configurarse fuera del repositorio.
