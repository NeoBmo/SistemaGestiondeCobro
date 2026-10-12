-- Cartera importada (F3-T6, 02 §6.1): el monto ya pagado antes de entrar al sistema se guarda solo como
-- dato de referencia. No es un pago ni mueve ninguna caja; los pagos posteriores a la importación siguen
-- las reglas normales. Es nulo en los préstamos nuevos. Una columna nueva y nula no modifica ningún hecho
-- ya registrado.
alter table public.loans
  add column historical_paid_amount bigint check (historical_paid_amount is null or historical_paid_amount >= 0);

comment on column public.loans.historical_paid_amount is
  'Importado: monto ya pagado antes de la importación (solo referencia, 02 §6.1). Nulo en préstamos nuevos.';
