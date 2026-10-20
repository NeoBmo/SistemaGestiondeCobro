# Plan — 010 Invariantes de aplicación de pagos

1. Extraer el algoritmo puro de `payment-explanation.ts` a `payment-allocation.ts` con referencia a 02 §3.2.
2. Mantener una API de explicación compatible para la UI.
3. Reemplazar el bucle duplicado del servicio de pagos por el mismo asignador; preservar el error y el mensaje actuales para excedentes.
4. Añadir una prueba determinista de propiedades para cuotas completas/parciales, entrada desordenada, saldo cero y monto excedente.
5. Ejecutar primero la prueba focalizada y luego la suite según el flujo del repo; no cambiar ni saltar casos existentes.
