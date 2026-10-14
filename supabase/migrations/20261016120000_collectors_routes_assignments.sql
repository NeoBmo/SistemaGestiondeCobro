-- Cobradores, rutas y asignaciones de clientes (F5-T2). Fuentes: 02-DOMINIO §4.1–4.3 y §9, ADR 0009.
-- Los cambios de estado son las únicas mutaciones permitidas (nada se borra): un cobrador pasa de ACTIVO a
-- INACTIVO y viceversa; una ruta o una asignación solo pasan de ACTIVA a CERRADA. El historial queda.

-- 1. Cobradores -------------------------------------------------------------------------------------
create table public.collectors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  user_id uuid not null,
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  status text not null default 'ACTIVO' check (status in ('ACTIVO', 'INACTIVO')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint collectors_id_business_key unique (id, business_id),
  -- Un usuario es a lo sumo un cobrador, y pertenece al mismo negocio (02 §4.1).
  constraint collectors_user_key unique (user_id),
  constraint collectors_user_business_fk
    foreign key (user_id, business_id) references public.profiles (id, business_id),
  constraint collectors_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

create index collectors_business_status_idx on public.collectors (business_id, status);
select private.make_append_only('public.collectors', array['status']);

-- Solo un usuario con rol COBRADOR puede ser cobrador, y el cambio de estado solo alterna ACTIVO/INACTIVO.
-- Activar (o crear activo) respeta el tope del plan (02 §1.1): se serializa con el bloqueo del negocio para
-- que dos activaciones simultáneas no superen el límite (el tope de plan es una invariante de BD, no de UI).
create or replace function private.check_collector()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  user_role text;
  max_active integer;
  active_count integer;
begin
  if tg_op = 'INSERT' then
    select role into user_role from public.profiles where id = new.user_id;
    if user_role is distinct from 'COBRADOR' then
      raise exception 'Solo un usuario con rol COBRADOR puede ser cobrador' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'ACTIVO' and (tg_op = 'INSERT' or old.status <> 'ACTIVO') then
    perform 1 from public.businesses where id = new.business_id for no key update;
    select p.max_active_collectors into max_active
      from public.subscriptions s join public.plans p on p.code = s.plan_code
     where s.business_id = new.business_id;
    if max_active is not null then
      select count(*) into active_count
        from public.collectors where business_id = new.business_id and status = 'ACTIVO' and id <> new.id;
      if active_count + 1 > max_active then
        raise exception 'El plan del negocio no admite más cobradores activos (máximo %)', max_active
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger collectors_valid
  before insert or update of status on public.collectors
  for each row execute function private.check_collector();

-- Desactivar exige que el cobrador no tenga una ruta activa (se cierra antes; 02 §4.1, ADR 0009). La
-- comprobación de jornadas abiertas la añade la migración de la Caja Menor.
create or replace function private.check_collector_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'INACTIVO' and old.status = 'ACTIVO'
     and exists (select 1 from public.routes where collector_id = new.id and status = 'ACTIVA') then
    raise exception 'El cobrador tiene una ruta activa: ciérrala antes de desactivarlo'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 2. Rutas ------------------------------------------------------------------------------------------
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  collector_id uuid not null,
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  started_on date not null,
  status text not null default 'ACTIVA' check (status in ('ACTIVA', 'CERRADA')),
  closed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint routes_id_business_key unique (id, business_id),
  -- La asignación referencia (ruta, cobrador): la ruta solo la usa su cobrador.
  constraint routes_id_collector_key unique (id, collector_id),
  constraint routes_closed_consistent check ((status = 'CERRADA') = (closed_at is not null)),
  constraint routes_collector_fk
    foreign key (collector_id, business_id) references public.collectors (id, business_id),
  constraint routes_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

-- 02 §4.2: como máximo una ruta ACTIVA por cobrador.
create unique index routes_one_active_per_collector on public.routes (collector_id) where status = 'ACTIVA';
select private.make_append_only('public.routes', array['status', 'closed_at']);

create trigger collectors_deactivation
  before update of status on public.collectors
  for each row execute function private.check_collector_deactivation();

-- 3. Asignaciones -----------------------------------------------------------------------------------
create table public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  client_id uuid not null,
  route_id uuid not null,
  collector_id uuid not null,
  status text not null default 'ACTIVA' check (status in ('ACTIVA', 'CERRADA')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid not null,
  constraint client_assignments_id_business_key unique (id, business_id),
  constraint client_assignments_ended_consistent check ((status = 'CERRADA') = (ended_at is not null)),
  constraint client_assignments_client_fk
    foreign key (client_id, business_id) references public.clients (id, business_id),
  constraint client_assignments_route_fk
    foreign key (route_id, business_id) references public.routes (id, business_id),
  constraint client_assignments_route_collector_fk
    foreign key (route_id, collector_id) references public.routes (id, collector_id),
  constraint client_assignments_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

-- 02 §4.3: un cliente tiene como máximo una asignación ACTIVA.
create unique index client_assignments_one_active_per_client
  on public.client_assignments (client_id) where status = 'ACTIVA';
create index client_assignments_route_idx on public.client_assignments (route_id) where status = 'ACTIVA';
create index client_assignments_collector_idx on public.client_assignments (collector_id, status);
select private.make_append_only('public.client_assignments', array['status', 'ended_at']);

-- Una asignación nueva solo cuelga de una ruta ACTIVA de un cobrador ACTIVO.
create or replace function private.check_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  route_status text;
  collector_status text;
begin
  select status into route_status from public.routes where id = new.route_id;
  select status into collector_status from public.collectors where id = new.collector_id;
  if route_status is distinct from 'ACTIVA' then
    raise exception 'Solo se asigna a una ruta ACTIVA' using errcode = 'check_violation';
  end if;
  if collector_status is distinct from 'ACTIVO' then
    raise exception 'Solo se asigna a un cobrador ACTIVO' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger client_assignments_valid
  before insert on public.client_assignments
  for each row execute function private.check_assignment();

-- 4. Transiciones de estado -------------------------------------------------------------------------
-- Rutas y asignaciones solo se cierran (nunca se reabren); cerrar una ruta exige que no queden clientes
-- asignados (se reasignan antes: 02 §4.3, la reasignación crea otra asignación sin borrar historia).
create or replace function private.check_close_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'CERRADA' and new.status <> 'CERRADA' then
    raise exception 'Una % cerrada no se reabre', case tg_table_name when 'routes' then 'ruta' else 'asignación' end
      using errcode = 'restrict_violation';
  end if;
  if tg_table_name = 'routes' and new.status = 'CERRADA' and old.status = 'ACTIVA'
     and exists (select 1 from public.client_assignments where route_id = new.id and status = 'ACTIVA') then
    raise exception 'La ruta aún tiene clientes asignados: reasígnalos antes de cerrarla'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger routes_close_transition
  before update of status on public.routes
  for each row execute function private.check_close_transition();
create trigger client_assignments_close_transition
  before update of status on public.client_assignments
  for each row execute function private.check_close_transition();

-- 5. Tope del plan al cambiar de plan --------------------------------------------------------------
-- Bajar a un plan con menos cobradores activos de los que ya hay se rechaza (ADR 0009); nunca se desactiva
-- a nadie automáticamente.
create or replace function private.check_plan_collector_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_active integer;
  active_count integer;
begin
  if new.plan_code is distinct from old.plan_code then
    perform 1 from public.businesses where id = new.business_id for no key update;
    select max_active_collectors into max_active from public.plans where code = new.plan_code;
    if max_active is not null then
      select count(*) into active_count
        from public.collectors where business_id = new.business_id and status = 'ACTIVO';
      if active_count > max_active then
        raise exception 'El negocio tiene % cobradores activos y el plan admite %', active_count, max_active
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger subscriptions_collector_limit
  before update of plan_code on public.subscriptions
  for each row execute function private.check_plan_collector_limit();

-- 6. Privilegios y RLS ------------------------------------------------------------------------------
-- La API de datos solo lee: el Admin ve todo su negocio y el cobrador solo lo suyo.
grant select on public.collectors, public.routes, public.client_assignments to authenticated;

alter table public.collectors enable row level security;
alter table public.routes enable row level security;
alter table public.client_assignments enable row level security;

create policy collectors_select on public.collectors
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (
      (select private.jwt_role()) = 'ADMIN_NEGOCIO'
      or ((select private.jwt_role()) = 'COBRADOR' and user_id = (select auth.uid()))
    )
  );

create policy routes_select on public.routes
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (
      (select private.jwt_role()) = 'ADMIN_NEGOCIO'
      or ((select private.jwt_role()) = 'COBRADOR'
          and collector_id in (select id from public.collectors where user_id = (select auth.uid())))
    )
  );

create policy client_assignments_select on public.client_assignments
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (
      (select private.jwt_role()) = 'ADMIN_NEGOCIO'
      or ((select private.jwt_role()) = 'COBRADOR'
          and collector_id in (select id from public.collectors where user_id = (select auth.uid())))
    )
  );
