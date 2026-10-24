# Spec 017 — Demostración local multi-negocio

## Problema

Las pruebas E2E y `scripts/perf/seed-volume.sql` sirven para verificar recorridos aislados y medir consultas, pero no dejan un entorno pequeño, autenticable y reutilizable para que el dueño recorra la app desde escritorio y móvil. El seed de rendimiento crea un solo negocio y desactiva disparadores, por lo que no es una base segura para una demostración interactiva.

## Objetivo

Preparar, solo en Supabase local, una demostración persistente con una cuenta Super Admin del dueño y cinco negocios sintéticos. Cada negocio tendrá su administrador, dos cobradores, clientes, cartera y movimientos suficientes para recorrer las pantallas existentes y comprobar el aislamiento entre negocios.

## Decisiones de alcance

- Es una tarea local de F8 adelantada con autorización del dueño. No cierra F7/F8 ni habilita producción.
- Se usan solo datos inventados y los comandos/servicios actuales. No se cambian reglas financieras ni se incluyen los casos aún abiertos en `docs/planning/05-PENDIENTES.md`.
- El escenario cubre operaciones felices ya implementadas: negocios activos, clientes asignados, préstamos regulares, cuotas pagadas/parciales/vencidas, cobros válidos, gastos y una jornada de cobrador sin diferencia pendiente. No incluye reversos, pagos futuros, mora, refinanciaciones, diferencias de liquidación ni otros bordes ambiguos.
- Los importes y fechas son plausibles y reproducibles; las fechas se anclan al día de ejecución y se interpretan en `America/Bogota`.
- Se propone una escala de demostración de cinco negocios, dos cobradores y diez clientes por negocio, con cartera y actividad en cada uno. No es un benchmark ni fija metas de rendimiento.
- La cuenta Super Admin personal se crea/reutiliza mediante el mecanismo oficial ya existente; nunca se añade una contraseña propia al repositorio. Las cuentas sintéticas de negocio reciben claves temporales generadas en el momento y mostradas una sola vez en la terminal local, sin archivo de credenciales.

## Requisitos funcionales (EARS)

1. Cuando el comando de preparación se ejecute, deberá comprobar que Supabase y PostgreSQL apuntan a loopback antes de crear o modificar datos.
2. Si el entorno es remoto, no puede verificarse o hay configuración incompleta, el comando deberá detenerse antes de escribir y explicar la condición sin mostrar secretos.
3. Cuando se prepare la demo, el sistema deberá crear cinco negocios sintéticos activos, cada uno con un administrador, dos cobradores, clientes asignados, cartera y movimientos coherentes con los comandos actuales.
4. Cuando se repita la preparación sobre una demo completa, el comando deberá reconocerla y evitar duplicar cuentas, negocios o hechos financieros.
5. Cuando una preparación falle parcialmente, deberá informar qué conjunto quedó incompleto y cómo recuperarlo sin borrar datos ajenos a la demo.
6. Cuando se creen hechos financieros, deberán generarse mediante los servicios/comandos de dominio y conservar sus transacciones, idempotencia, auditoría e invariantes.
7. El proceso no deberá desactivar disparadores, insertar hechos directamente en tablas financieras ni modificar migraciones.
8. Cuando el dueño use la cuenta Super Admin, deberá poder ver los cinco negocios sin acceder a sus operaciones financieras.
9. Cuando se use cada cuenta de Administrador, sus vistas deberán mostrar solo los datos de su negocio; la cuenta de Cobrador deberá mostrar solo su ruta/asignaciones.
10. Cuando el dueño navegue desde un dispositivo conectado a la misma red local, deberá poder abrir la app con la dirección LAN del servidor de desarrollo y recorrer las pantallas sin exponer el servidor a Internet.
11. La preparación deberá incluir una guía con el arranque local, acceso desde red local, usuarios de demostración, escenarios disponibles y recuperación segura.

## Criterios de aceptación

- Hay exactamente cinco negocios de demo y todos los datos asociados son sintéticos, identificables por nombres/namespaces reservados.
- Las cuentas de negocio permiten iniciar sesión y sus credenciales temporales no quedan en archivos versionados ni en logs de aplicación.
- Los datos muestran actividad útil en vistas de Super Admin, Administrador y Cobrador y permiten probar aislamiento entre negocios.
- Las fechas y montos presentados son consistentes con la zona del negocio y las reglas implementadas; las vistas derivadas coinciden con los hechos registrados.
- El seed solo acepta el Supabase local; una comprobación automatizada demuestra que rechaza un host no local sin escrituras.
- Ejecutarlo dos veces no duplica datos; una interrupción deja un diagnóstico y una recuperación documentada que no borra información ajena.
- No se cambia lógica productiva, esquema, RLS ni Route Handlers para habilitar la demo.
- La guía permite abrir la app desde escritorio y un dispositivo móvil en la misma red; no requiere túneles ni port-forwarding.

## Fuera de alcance

- Usuarios, información o credenciales reales; Supabase alojado, preview o producción.
- Nuevos flujos de negocio, migraciones, cambios de permisos/RLS o modificaciones de los Route Handlers.
- Decidir reglas que siguen abiertas en `05-PENDIENTES.md`.
- Cambiar la cuenta Super Admin personal o guardar sus credenciales.
- Presupuestos, benchmarks de carga o metas de Web Vitals.
- Garantizar operación sin conexión, app nativa o acceso desde fuera de la red local.

## Dependencias y autoridad

- `docs/planning/02-DOMINIO.md` para entidades, estados, aislamiento y reglas financieras.
- `docs/planning/03-ARQUITECTURA.md` §§2–5 para límites modulares, comandos y aislamiento.
- `docs/planning/04-PLAN.md` F8 para flujos sintéticos y prueba manual.
- Pendientes F8 de `docs/planning/05-PENDIENTES.md`: se mantienen abiertos; los casos de demostración los evitan.
- La cuenta Super Admin requiere que el dueño complete el mecanismo oficial de creación ya existente antes de iniciar sesión.

## Verificación propuesta

- Pruebas del guard local y de idempotencia del seed.
- Pruebas de integración para las invariantes y aislamiento creados por la demo.
- Recorrido E2E con los tres perfiles y verificación de que los datos visibles concuerdan con movimientos registrados.
- Checklist manual en escritorio y teléfono a través de la red local; registrar dispositivo/navegador usado, sin fijar un presupuesto de rendimiento.
- Ejecutar la cadena de calidad del repo y la suite E2E con Supabase local según `AGENTS.md`.

## Estado

Borrador para revisión humana. No autoriza implementación hasta aprobar spec, plan y tareas.
