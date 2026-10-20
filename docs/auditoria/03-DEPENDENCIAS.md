# Evidencia de dependencias — 2026-10-19

## Resultado observado

`npm-audit-report.json` entregado inicialmente mostró 547 dependencias y 7 nodos altos. Tras actualizar Next y eslint-config-next a 16.4.2 en `codex/security-updates`, la corrida actual reporta 5 nodos altos, todos vinculados al advisory transitivo `braces` GHSA-vfj7-8cjw-p6xm; Next y source-map-js ya no aparecen.\n\nLa rama `codex/security-updates` actualiza `next` y `eslint-config-next` de `16.3.6` a `16.4.2`, y el lockfile ya no reporta `source-map-js`. La corrida actual de `npm audit --json` devuelve 5 hallazgos altos en cinco nodos: `@next/eslint-plugin-next`, `braces`, `eslint-config-next`, `fast-glob` y `micromatch`; todos convergen en el advisory de `braces` GHSA-vfj7-8cjw-p6xm (DoS por patrones profundamente anidados). No se debe interpretar el conteo de nodos como cinco causas independientes.

Tras subir Next y su configuración a `16.4.2`, la corrida actual ya no reporta avisos de Next ni `source-map-js`. Persiste el grupo de lint: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. `braces` vulnerable hasta `3.0.3` causa DoS por patrones profundamente anidados. npm propone `eslint-config-next@14.2.35`, downgrade major incompatible con Next 16; no se aplicó. Falta identificar y validar una resolución compatible.

La actualización compatible de Next se aplicó en `codex/security-updates`; TypeScript, ESLint, build y format/type checks pasaron en esa rama. La corrida actual de `npm audit --json` sigue mostrando los cinco nodos transitivos del advisory de `braces`. No ejecutar `npm audit fix --force`. La suite completa de Vitest tuvo fallos del entorno Windows al crear temporales SSR (ENOENT), por lo que el checkpoint no equivale a certificación completa.

Un segundo intento falló al resolver `registry.npmjs.org` (`ENOTFOUND`) y el modo `--offline` produjo un mapa de vulnerabilidades vacío, que no sirve como confirmación. Por tanto, el hallazgo inicial requiere repetición con conectividad y reporte íntegro antes de aceptar mitigaciones. No se debe aplicar automáticamente el fix sugerido: validar compatibilidad con los topes de TypeScript/ESLint documentados en AGENTS y ejecutar CI.

## Evidencia local

- Versiones directas exactas y `package-lock.json`: `package.json` y `package-lock.json`.
- `npm ls --depth=0 --json` confirmó que las 20 dependencias directas instaladas coinciden con las versiones declaradas; no garantiza integridad más allá del lockfile.
- Corrida actual de `npm audit --json` en `codex/security-updates`: 5 high / 0 critical, cinco nodos afectados, todos relacionados con un advisory de `braces`; Next y source-map-js no aparecen.
- La salida actual de `npm audit` mantiene 5 high; la solución sugerida para el grupo de lint requiere downgrade major de `eslint-config-next`, no aplicado.
- La resolución del lockfile en la rama de seguridad elimina `source-map-js@1.2.1` y los avisos de Next 16.3.6. Sigue el camino de lint reportado por npm hasta `braces` (GHSA-vfj7-8cjw-p6xm).
- Reintento de contraste: fallo DNS; `npm audit --offline` no encontró advisory local.
- El intento inicial de dry-run falló por DNS y no cambió manifiestos. Después, la rama de seguridad aplicó actualizaciones compatibles de Next; la auditoría actual confirma que queda el grupo `braces`.
- `.gitignore` excluye `.env` y `.env.*`, permitiendo solo `.env.example`; búsqueda de nombres en `git ls-files` no encontró archivos rastreados con nombres `.env`, `secret`, `credential` o `service-role` (excepto el ejemplo permitido). No se leyeron archivos secretos ni se inspeccionaron valores.
- CI (`.github/workflows/ci.yml`) hace `npm ci`, pero no ejecuta `npm audit` ni un escáner de secretos. `gitleaks`, `trufflehog` y `detect-secrets` no están disponibles localmente.
- Revisión de alto nivel del manifiesto no encontró nombres de paquetes evidentemente alucinados; no se ha completado un análisis automatizado de imports/paquetes sin uso.

## Opción de escaneo de secretos

El dueño confirmó el 2026-10-20 que el secret scanning de GitHub está activado. No se verificó independientemente por API. El estado de push protection sigue sin confirmación. No añadí un action/dependencia para duplicar el escaneo nativo. GitHub documenta secret scanning gratuito para repos públicos y push protection disponible; si se requiere un escáner local/CI adicional, evaluar Gitleaks v3 (v2 dejó de funcionar en runners GitHub-hosted al retirarse Node 20 en septiembre de 2026) y fijar el action a SHA completa, no tag flotante. Fuentes: [GitHub secret scanning](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning), [Gitleaks Action v3](https://github.com/gitleaks/gitleaks-action/releases).

## Decisión pendiente

Resolver el advisory residual de `braces` sin downgrade incompatible; registrar el JSON íntegro como artifact CI y repetir la suite Vitest en entorno que no falle creando temporales. Confirmar en Settings el estado de push protection y verificar cobertura efectiva de secret scanning. Revisar uso de paquetes antes de retirar alguno.
