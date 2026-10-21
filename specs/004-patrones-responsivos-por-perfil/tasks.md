# Tareas: patrones responsivos por perfil

1. [x] **Auditar rutas incluidas por perfil.** Revisadas estáticamente las rutas delimitadas y sus composiciones responsive/datos variables. Se anotan solo defectos observables en código; sin sesión privada/renderizado no se afirma ausencia de defectos visuales.
2. [x] **Corregir flujos móviles del Cobrador.** Datos de intentos ahora pueden envolver contenido largo; se conservan objetivos táctiles ≥44 px de enlaces y botones existentes.
3. [x] **Corregir pantallas de Administrador.** Se habilitó wrapping de observaciones e identificadores, se limitó el ancho mínimo de pares de datos y se apilaron los importes del calendario en móvil.
4. [x] **Corregir pantallas de Super Admin.** Nombres y valores de identificación/cuenta pueden envolver sin empujar la página; la grilla de detalle limita el segundo carril.
5. [x] **Revisar shell compartido y preservar WIP.** El encabezado permite reflujo de marca, identidad y salida. Se compararon diffs iniciales y se preservó Caja Mayor y el resto del WIP preexistente.
6. [x] **Verificar y revisar independientemente.** Format, typecheck, lint, suite completa (55/298 con un worker) y build pasan; revisión independiente aprobada. El runner default Vitest produjo el ENOENT documentado. Multi-viewport automatizado se difiere a spec 006.
7. [x] **Cerrar documentación y memoria.** Resultado, límites y revisión registrados en spec/plan/tasks y `MEMORY.md`.
