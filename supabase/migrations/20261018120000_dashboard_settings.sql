-- Configuración de presentación del dashboard (F6-T2). Fuente: 02-DOMINIO §7, ADR 0010.
-- Es solo presentación (qué indicadores ver, su orden y el periodo): no es un hecho financiero y nunca escribe
-- balances. Solo los planes mensual y anual pueden guardarla (el semanal ve el dashboard predeterminado).

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
          'CASH_BALANCE', 'PORTFOLIO_PENDING', 'PORTFOLIO_OVERDUE', 'COLLECTED', 'SPENT',
          'SETTLEMENTS', 'PROJECTION'
        )
     )
     and (select count(*) = count(distinct w.id) from jsonb_array_elements_text(widgets) as w(id))
$$;

create table public.dashboard_settings (
  business_id uuid primary key references public.businesses (id),
  period text not null default '7D' check (period in ('7D', '30D', 'MONTH', 'YEAR')),
  -- Indicadores visibles, en el orden en que se muestran.
  widgets jsonb not null check (private.valid_dashboard_widgets(widgets)),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_settings_updater_fk
    foreign key (updated_by, business_id) references public.profiles (id, business_id)
);

create or replace function private.check_dashboard_settings_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan text;
begin
  select plan_code into plan from public.subscriptions
   where business_id = new.business_id and status <> 'ARCHIVADA';
  if plan is distinct from 'MENSUAL' and plan is distinct from 'ANUAL' then
    raise exception 'El dashboard solo es configurable en los planes mensual y anual'
      using errcode = 'check_violation', constraint = 'dashboard_plan_not_allowed';
  end if;
  return new;
end;
$$;

create trigger dashboard_settings_plan
  before insert or update on public.dashboard_settings
  for each row execute function private.check_dashboard_settings_plan();

-- La configuración no se borra ni cambia de negocio.
create or replace function private.protect_dashboard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'La configuración del dashboard no se elimina' using errcode = 'restrict_violation';
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception 'La configuración no cambia de negocio' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger dashboard_settings_protect
  before update or delete on public.dashboard_settings
  for each row execute function private.protect_dashboard_settings();

grant select on public.dashboard_settings to authenticated;
alter table public.dashboard_settings enable row level security;

create policy dashboard_settings_select on public.dashboard_settings
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );
