-- Precios V1 reales (02-DOMINIO §1.1, decisión del 2026-10-24), en COP enteros. Sustituyen las cifras
-- de ejemplo de 20260928020738_identity_tables.sql, que no se edita por estar ya aplicada.
-- El precio de referencia del anual (12 × mensual = 1.200.000) se deriva del mensual: no se guarda una
-- segunda cifra que pueda desincronizarse.

update public.plans
   set price_amount = case code
     when 'SEMANAL' then 25000
     when 'MENSUAL' then 100000
     when 'ANUAL' then 960000 -- 12 × 100.000 con 20 % de descuento (plan recomendado)
   end
 where code in ('SEMANAL', 'MENSUAL', 'ANUAL');

comment on table public.plans is
  'Planes V1 (02-DOMINIO §1.1). price_amount en COP enteros: semanal 25.000, mensual 100.000, anual 960.000 (12 mensualidades con 20 % de descuento).';
