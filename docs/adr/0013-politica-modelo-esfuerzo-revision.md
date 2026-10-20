# ADR 0013 — Esfuerzo y revisión agéntica según riesgo

- Estado: Aceptado
- Fecha: 2026-10-19
- Contexto: el equipo usa distintas herramientas y modelos. Las configuraciones exactas varían, pero el riesgo del cambio debe dirigir el esfuerzo y la revisión.

## Decisión

Usar tres niveles relativos; cada herramienta los mapea a las opciones de esfuerzo que soporta:

| Nivel | Uso típico | Revisión |
|---|---|---|
| T1 — bajo | Documentación, cambios visuales acotados, mantenimiento mecánico sin riesgo de dominio | Revisión normal del diff y checks aplicables |
| T2 — medio | Componentes/rutas rutinarios, pruebas y refactors acotados | Revisión independiente recomendada |
| T3 — alto | Dinero, transacciones, auditoría, autorización/RLS, migraciones, seguridad, concurrencia, arquitectura o cierre de fase | Esfuerzo alto que soporte la herramienta; revisión independiente recomendada y aprobación humana donde la política del repo la exige |

Una herramienta o modelo distinto del autor mejora independencia, pero no garantiza corrección ni reemplaza al humano. Si el modelo falla, limita el uso o no alcanza la capacidad requerida, no se cambia de proveedor ni se escala automáticamente: se conserva el checkpoint y se pregunta al humano. Los niveles de esfuerzo no conceden permisos; sandbox, permisos, hooks y checks se configuran por herramienta.

No se exige un nombre de modelo fijo: cada desarrollador puede usar las herramientas/modelos disponibles, manteniendo el mismo nivel de verificación por riesgo.

## Consecuencias

- El plan de cada tarea registra T1/T2/T3 y el motivo.
- Reviews T3 citan evidencia del diff y las reglas fuente; finanzas, auth y migraciones mantienen sus puertas humanas existentes.
- No hay fallback automático de modelo o proveedor.
