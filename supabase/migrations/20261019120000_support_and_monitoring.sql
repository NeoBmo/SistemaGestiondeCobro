-- Tickets de soporte y monitoreo de plataforma (F7-T2). Fuentes: 02-DOMINIO §6.2, ADR 0011.
-- Los hechos (eventos del ticket, errores, chequeos y verificaciones de backup) son de solo agregado; el ticket
-- conserva únicamente su estado vigente (estado, prioridad, respuesta) y cada cambio deja su evento.

-- 1. Tickets ----------------------------------------------------------------------------------------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  created_by uuid not null,
  description text not null check (length(btrim(description)) > 0 and length(description) <= 2000),
  priority text not null default 'MEDIA' check (priority in ('ALTA', 'MEDIA', 'BAJA')),
  status text not null default 'ABIERTO' check (status in ('ABIERTO', 'EN_ATENCION', 'RESUELTO', 'CERRADO')),
  response text check (response is null or (length(btrim(response)) > 0 and length(response) <= 2000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_id_business_key unique (id, business_id),
  constraint support_tickets_creator_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

create index support_tickets_business_idx on public.support_tickets (business_id, created_at desc);
create index support_tickets_open_idx on public.support_tickets (priority, created_at)
  where status <> 'CERRADO';

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  ticket_id uuid not null,
  actor_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('CREADO', 'ESTADO', 'PRIORIDAD', 'RESPUESTA')),
  from_value text,
  to_value text,
  created_at timestamptz not null default now(),
  constraint support_ticket_events_ticket_fk
    foreign key (ticket_id, business_id) references public.support_tickets (id, business_id)
);

create index support_ticket_events_ticket_idx on public.support_ticket_events (ticket_id, created_at);
select private.make_append_only('public.support_ticket_events');
select private.make_append_only(
  'public.support_tickets',
  array['priority', 'status', 'response', 'updated_at']
);

-- El estado avanza solo por las transiciones del ADR 0011 (el actor lo decide la aplicación): ABIERTO →
-- EN_ATENCION | RESUELTO; EN_ATENCION → RESUELTO; RESUELTO → CERRADO | ABIERTO (reabrir); CERRADO es final.
create or replace function private.check_ticket_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'ABIERTO' and new.status in ('EN_ATENCION', 'RESUELTO'))
    or (old.status = 'EN_ATENCION' and new.status = 'RESUELTO')
    or (old.status = 'RESUELTO' and new.status in ('CERRADO', 'ABIERTO'))
  ) then
    raise exception 'Transición de ticket inválida: % a %', old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'CERRADO' and (
    new.priority <> old.priority or new.response is distinct from old.response
  ) then
    raise exception 'Un ticket cerrado no se modifica' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger support_tickets_transition
  before update on public.support_tickets
  for each row execute function private.check_ticket_update();

-- Todo cambio del ticket deja su evento en la misma transacción (el historial no puede quedar incompleto).
create or replace function private.check_ticket_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.support_ticket_events
       where ticket_id = new.id and kind = 'CREADO' and created_at = transaction_timestamp()
    ) then
      raise exception 'Un ticket nuevo exige su evento CREADO' using errcode = 'check_violation';
    end if;
    return null;
  end if;
  if new.status <> old.status and not exists (
    select 1 from public.support_ticket_events
     where ticket_id = new.id and kind = 'ESTADO' and to_value = new.status
       and created_at = transaction_timestamp()
  ) then
    raise exception 'El cambio de estado exige su evento' using errcode = 'check_violation';
  end if;
  if new.priority <> old.priority and not exists (
    select 1 from public.support_ticket_events
     where ticket_id = new.id and kind = 'PRIORIDAD' and to_value = new.priority
       and created_at = transaction_timestamp()
  ) then
    raise exception 'El cambio de prioridad exige su evento' using errcode = 'check_violation';
  end if;
  if new.response is distinct from old.response and not exists (
    select 1 from public.support_ticket_events
     where ticket_id = new.id and kind = 'RESPUESTA' and to_value is not distinct from new.response
       and created_at = transaction_timestamp()
  ) then
    raise exception 'El cambio de respuesta exige su evento' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger support_tickets_history
  after insert or update on public.support_tickets
  deferrable initially deferred
  for each row execute function private.check_ticket_history();

-- 2. Monitoreo de plataforma ------------------------------------------------------------------------
-- Sin datos de negocios ni de usuarios: solo qué falló y cuándo (03 §7).
create table public.platform_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ERROR_500')),
  route text not null check (length(route) <= 200),
  error_name text check (error_name is null or length(error_name) <= 100),
  occurred_at timestamptz not null default now()
);
create index platform_events_occurred_idx on public.platform_events (occurred_at desc);
select private.make_append_only('public.platform_events');

create table public.health_checks (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  ok boolean not null,
  database_ok boolean not null,
  auth_ok boolean not null,
  latency_ms integer not null check (latency_ms >= 0),
  constraint health_checks_ok_consistent check (ok = (database_ok and auth_ok))
);
create index health_checks_checked_idx on public.health_checks (checked_at desc);
select private.make_append_only('public.health_checks');

create table public.backup_checks (
  id uuid primary key default gen_random_uuid(),
  checked_on date not null,
  result text not null check (result in ('OK', 'FALLO')),
  note text check (note is null or length(note) <= 500),
  registered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index backup_checks_checked_idx on public.backup_checks (checked_on desc);
select private.make_append_only('public.backup_checks');

-- 3. Privilegios y RLS ------------------------------------------------------------------------------
-- La API de datos solo lee: el Admin los tickets de su negocio y el Super Admin todo lo de plataforma.
grant select on public.support_tickets, public.support_ticket_events, public.platform_events,
  public.health_checks, public.backup_checks to authenticated;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.platform_events enable row level security;
alter table public.health_checks enable row level security;
alter table public.backup_checks enable row level security;

create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (
    (select private.is_session_active())
    and (
      (select private.jwt_role()) = 'SUPER_ADMIN'
      or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
    )
  );

create policy support_ticket_events_select on public.support_ticket_events
  for select to authenticated
  using (
    (select private.is_session_active())
    and (
      (select private.jwt_role()) = 'SUPER_ADMIN'
      or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
    )
  );

create policy platform_events_select on public.platform_events
  for select to authenticated
  using ((select private.is_session_active()) and (select private.jwt_role()) = 'SUPER_ADMIN');

create policy health_checks_select on public.health_checks
  for select to authenticated
  using ((select private.is_session_active()) and (select private.jwt_role()) = 'SUPER_ADMIN');

create policy backup_checks_select on public.backup_checks
  for select to authenticated
  using ((select private.is_session_active()) and (select private.jwt_role()) = 'SUPER_ADMIN');
