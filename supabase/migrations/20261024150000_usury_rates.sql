-- Tasa de usura vigente (02-DOMINIO §2.3, decisión del 2026-10-24, a validar con abogado). La registra el
-- Super Admin con la fecha desde la que rige y su fuente (p. ej. la resolución de la Superintendencia
-- Financiera). Es un historial de solo agregado: una tasa nunca se edita; corregirla es registrar otra. La
-- vigente en una fecha es la de `valid_from` más reciente que no sea posterior a ella (a igual fecha, la
-- registrada más tarde).
create table public.usury_rates (
  id uuid primary key default gen_random_uuid(),
  -- Efectiva anual en puntos básicos enteros (28,59 % = 2859). El tope solo descarta errores de digitación.
  rate_bps integer not null check (rate_bps > 0 and rate_bps <= 100000),
  valid_from date not null,
  source text not null check (length(btrim(source)) > 0 and length(source) <= 300),
  registered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index usury_rates_valid_from_idx on public.usury_rates (valid_from desc, created_at desc);
select private.make_append_only('public.usury_rates');

-- Sin acceso por la API de datos: solo el servidor (pool privilegiado) la lee y la escribe. Nace sin
-- privilegios para anon/authenticated/service_role y no se concede ninguno.
alter table public.usury_rates enable row level security;
