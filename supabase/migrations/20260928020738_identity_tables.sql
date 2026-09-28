-- Identidad, negocios y suscripciones (F1-T1).
-- Fuentes: 02-DOMINIO §1.1–1.4 y §6.3; ADR 0002 (usuario) y ADR 0003 (estados).
-- Toda escritura llega por la conexión de la aplicación (pg, dueña de las tablas); los roles de
-- la API solo leen, y solo lo que permitan las políticas RLS (migración siguiente).

create or replace function private.is_valid_time_zone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz)
$$;

-- Planes (globales, sin business_id) ---------------------------------------------------------
create table public.plans (
  code text primary key check (code in ('SEMANAL', 'MENSUAL', 'ANUAL')),
  name text not null,
  max_active_collectors integer check (max_active_collectors > 0), -- null = sin límite práctico
  dashboard_configurable boolean not null,
  price_amount bigint not null check (price_amount >= 0)
);

comment on table public.plans is
  'Planes V1 (02-DOMINIO §1.1). price_amount son cifras de EJEMPLO para desarrollo: reemplazar por las reales antes de producción (05-PENDIENTES).';

insert into public.plans (code, name, max_active_collectors, dashboard_configurable, price_amount) values
  ('SEMANAL', 'Semanal', 5, false, 50000),
  ('MENSUAL', 'Mensual', null, true, 150000),
  ('ANUAL', 'Anual', null, true, 1440000); -- 20 % menos que 12 mensualidades (01-CONTEXTO)

-- Negocios ------------------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  owner_name text not null check (length(btrim(owner_name)) > 0),
  owner_identification text not null check (length(btrim(owner_identification)) > 0),
  phone text not null check (length(btrim(phone)) > 0),
  time_zone text not null default 'America/Bogota' check (private.is_valid_time_zone(time_zone)),
  access_status text not null default 'ACTIVO' check (access_status in ('ACTIVO', 'SUSPENDIDO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.businesses.access_status is
  'Única compuerta de acceso del negocio (ADR 0003); se cambia junto con subscriptions.status en una sola transacción.';

-- Perfiles de usuario (1 usuario = 1 negocio; ADR 0002) -----------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  business_id uuid references public.businesses (id),
  role text not null check (role in ('SUPER_ADMIN', 'ADMIN_NEGOCIO', 'COBRADOR')),
  -- El usuario se mapea a un email sintético: solo caracteres seguros para la parte local.
  username text not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (length(btrim(display_name)) > 0),
  status text not null default 'PENDIENTE_CAMBIO_CONTRASENA'
    check (status in ('ACTIVO', 'BLOQUEADO', 'PENDIENTE_CAMBIO_CONTRASENA')),
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Super Admin sin negocio; los demás roles pertenecen a uno (02-DOMINIO §1.4).
  constraint profiles_role_business_consistent check ((role = 'SUPER_ADMIN') = (business_id is null))
);

-- El nombre es minúsculas por CHECK, así que la unicidad global no distingue mayúsculas.
create unique index profiles_username_key on public.profiles (username);
-- V1: una sola cuenta administrativa principal por negocio.
create unique index profiles_one_admin_per_business on public.profiles (business_id)
  where role = 'ADMIN_NEGOCIO';
create index profiles_business_id_idx on public.profiles (business_id);

-- Suscripciones (una vigente por negocio; ADR 0003) --------------------------------------------
-- PROXIMA_A_VENCER y VENCIDA no se almacenan: se derivan de expires_on al leer.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id),
  plan_code text not null references public.plans (code),
  status text not null default 'ACTIVA' check (status in ('ACTIVA', 'SUSPENDIDA', 'ARCHIVADA')),
  starts_on date not null,
  expires_on date not null,
  note text,
  changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_valid check (expires_on > starts_on)
);

create index subscriptions_plan_code_idx on public.subscriptions (plan_code);

-- Auditoría (solo agregado; 02-DOMINIO §6.3) ---------------------------------------------------
-- Registra la acción, no el hecho financiero. `summary` nunca lleva secretos.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id),
  actor_id uuid references public.profiles (id),
  action text not null check (length(btrim(action)) > 0),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  result text not null default 'OK' check (result in ('OK', 'RECHAZADO')),
  summary jsonb not null default '{}'::jsonb
);

create index audit_events_business_occurred_idx on public.audit_events (business_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

select private.make_append_only('public.audit_events');

-- Privilegios y RLS -----------------------------------------------------------------------------
-- Supabase concede ALL a anon/authenticated en tablas nuevas de `public`: se retira lo que sobra.
revoke all on public.plans, public.businesses, public.profiles, public.subscriptions, public.audit_events
  from anon;
revoke insert, update, delete, truncate on
  public.plans, public.businesses, public.profiles, public.subscriptions, public.audit_events
  from authenticated;

alter table public.plans enable row level security;
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_events enable row level security;
