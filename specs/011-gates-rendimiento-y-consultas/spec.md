# Spec 011 — Baseline y gates de rendimiento

## Estado

Diferida hasta F8. Volumen, dispositivos objetivo, entorno de medición y budgets siguen abiertos en `docs/planning/05-PENDIENTES.md`; no fijarlos en esta spec ni convertir los valores de laboratorio en SLO.

## Alcance futuro

Medir LCP, INP, CLS y bundle en rutas representativas; medir consultas/índices con datos semilla acordados; revisar límites Server/Client y planes SQL; fijar budgets solo tras baseline reproducible. No agrega umbrales CI hasta que el dueño resuelva los supuestos F8.

## Criterios de salida

- [ ] Resolver los pendientes de F8 que definen volumen, dispositivos, riesgos y condiciones de medición.
- [ ] Capturar baseline reproducible de Web Vitals, bundle y consultas.
- [ ] Acordar budgets y tolerancias por ruta con evidencia.
- [ ] Añadir medición/gate CI y documentar ruido, entorno y mecanismo de actualización.
