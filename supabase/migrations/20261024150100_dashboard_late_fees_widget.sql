-- Indicador «Mora pendiente» del dashboard (02 §7, decisión del 2026-10-24). No edita la migración
-- 20261018120000 (ya aplicada): solo amplía la lista de indicadores válidos con `LATE_FEES`. La cartera
-- pendiente y vencida cuentan solo cuotas; los cargos de mora activos son un indicador aparte.

create or replace function private.valid_dashboard_widgets(widgets jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(widgets) = 'array'
     and jsonb_array_length(widgets) <= 8
     and not exists (
       select 1 from jsonb_array_elements_text(widgets) as w(id)
        where w.id not in (
          'CASH_BALANCE', 'PORTFOLIO_PENDING', 'PORTFOLIO_OVERDUE', 'LATE_FEES', 'COLLECTED', 'SPENT',
          'SETTLEMENTS', 'PROJECTION'
        )
     )
     and (select count(*) = count(distinct w.id) from jsonb_array_elements_text(widgets) as w(id))
$$;
