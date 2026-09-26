# 07 — Flujo de trabajo con Claude Code

> Objetivo: que las reglas de `CLAUDE.md`, `02-DOMINIO.md` y `03-ARQUITECTURA.md` se cumplan en la práctica, sesión a sesión — no solo que existan en un archivo. La mayoría del código espagueti no nace de reglas mal escritas, nace de sesiones mal delimitadas.

## 1. Unidad de trabajo: una tarea, una sesión

Nunca pedir "implementa la fase F3" en un solo prompt. Se pide una unidad concreta y verificable:

- **Una entidad de dominio** (ej. "implementa `Cliente` siguiendo `02-DOMINIO.md` §2.1") → tipos + validación + migración + servicio + pruebas.
- **Un comando financiero completo** (ej. "implementa el comando de registrar pago siguiendo `03-ARQUITECTURA.md` §3") → Route Handler + servicio + transacción + auditoría + idempotencia + prueba de integración.

Por qué: el contexto de una sesión larga se degrada — cuanto más crece la conversación, más se diluye la adherencia a las reglas exactas de `02-DOMINIO.md`. Una tarea acotada es revisable de principio a fin en una sola sentada.

## 2. Ritual de inicio de sesión

Antes de que Claude Code escriba una sola línea:

1. Confirmar qué tarea es (de `04-PLAN.md`) y qué documento la gobierna.
2. Pedir el plan primero (modo plan / "explícame tu plan antes de implementar"), citando la sección exacta de `02-DOMINIO.md` o `03-ARQUITECTURA.md` en la que se basa.
3. Revisar ese plan contra el documento **antes** de autorizar la implementación. Si el plan no cita una regla concreta para algo que decide, es una señal de que está por inventar comportamiento.

## 3. Disciplina de control de versiones

- Rama por tarea, nunca directo a `main`.
- Commits atómicos: un commit = un cambio coherente y probado, no "varios avances mezclados".
- **Migraciones y lógica de negocio en commits separados** — si algo sale mal, se necesita poder revertir una sin arrastrar la otra.
- Pull request por tarea, con el diff completo leído por un humano antes de mergear. Esto es innegociable para todo lo que toque `modules/portfolio`, `modules/cash` o `modules/collections`: que los tests pasen no es sustituto de leer la lógica.

## 4. Puerta de pruebas obligatoria

Ningún comando financiero se da por terminado sin su prueba (unitaria y/o de integración, según `03-ARQUITECTURA.md` §6) pasando. Antes de pasar a la siguiente tarea:

- correr la prueba nueva;
- correr **toda** la suite, no solo la nueva (para detectar que algo antiguo se rompió);
- si algo antiguo se rompe, se arregla antes de continuar — no se acumula deuda "para después".

## 5. Cierre de fase

Al llegar al final de una fase de `04-PLAN.md`, usar el criterio de salida de esa fase como checklist literal (el subagente `verificador-de-fase` de `06-AGENTES-HABILIDADES.md` existe justo para esto). No se avanza a la fase siguiente con criterios pendientes "porque ya casi está" — eso es exactamente cómo F4 termina construyéndose sobre una F3 rota.

## 6. Cuándo detenerse y preguntar al humano

- Cuando la tarea toca algo listado en `05-PENDIENTES.md`.
- Cuando Claude Code propone una regla, permiso o fórmula que no está textualmente en `02-DOMINIO.md` — "parece razonable" no es una fuente válida en este proyecto.
- Cuando quiere adelantar trabajo de una fase futura para "dejarlo preparado".
- Cuando una prueba falla y la solución propuesta es debilitar la prueba en vez de corregir el código.

## 7. Documentación viva

Si durante una sesión una decisión de negocio o técnica cambia respecto a lo escrito, el documento correspondiente (`02-DOMINIO.md`, `03-ARQUITECTURA.md`, `05-PENDIENTES.md`) se actualiza **en el mismo PR** — nunca "después". Al cerrar cada fase, revisar de paso que `05-PENDIENTES.md` sigue reflejando la realidad (que nada resuelto siga ahí, que nada nuevo haya quedado fuera).

## 8. Anti-patrones a evitar explícitamente

- Prompts gigantes tipo "implementa todo el módulo de cobradores".
- Aceptar código financiero sin leer el diff porque "los tests están en verde".
- Dejar crecer una sesión indefinidamente en vez de abrir una nueva al cambiar de tarea.
- Resolver un ítem de `05-PENDIENTES.md` dentro del código en lugar de preguntar.
- Mezclar migración de esquema con lógica de negocio en el mismo commit.
- Dar una fase por cerrada sin correr su checklist de criterios de aceptación completo.
