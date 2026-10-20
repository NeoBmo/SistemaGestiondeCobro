# Spec 010 — Invariantes financieras de aplicación de pagos

## Problema

La UI y el comando servidor mantienen por separado la misma distribución de pago por cuota. Los casos de integración prueban montos representativos, pero no recorren suficientes particiones y pagos para comprobar conservación y orden en la asignación. Agregar casos sin compartir el algoritmo podría dejar el backend aún sin cubrir.

## Alcance

- Extraer una función pura de asignación cronológica reutilizada por preview de UI y comando servidor.
- Añadir pruebas generativas deterministas con múltiples calendarios/saldos/importes, sin una dependencia nueva.
- Afirmar solamente reglas explícitas de `02-DOMINIO.md` §3.2 e invariantes 4–6: conservación del importe, no sobreaplicación, cuotas anteriores primero, saldo pendiente conservado en la cuota y rechazo de excedente.
- Mantener las pruebas de integración existentes como prueba de persistencia, caja, auditoría, autorización e idempotencia.

## Fuera de alcance

Supuestos aún listados en `05-PENDIENTES.md` que requieren decisión (reversos, mora, descuentos por anticipación, liquidación, límites/rate limit), cambios al esquema, cubrir todos los comandos financieros o introducir `fast-check`/nuevas dependencias.

## Criterios de aceptación

1. El comando y la explicación de UI usan el mismo asignador puro.
2. Los casos generativos cubren distintos números de cuotas, saldos parciales, orden de entrada arbitrario, cuotas cerradas y pagos desde 1 hasta el saldo exacto.
3. Cada resultado válido conserva el monto, respeta el saldo máximo de cada cuota y deja el saldo total esperado; las cuotas se completan cronológicamente.
4. Exceder el saldo devuelve la misma clase de rechazo de dominio que existe hoy.
5. No se debilitan ni se omiten pruebas de integración actuales; no se cubren reglas abiertas.

## Verificación

Ejecutar la prueba unitaria nueva y la suite de Vitest según el flujo del repositorio; revisar los escenarios de integración existentes y `git diff --check`. No tocar reglas abiertas de `05-PENDIENTES.md`.
