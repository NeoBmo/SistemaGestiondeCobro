-- Eventos de intento de cobro (F5-T5). Fuente: 02-DOMINIO §4.4 y §8, ADR 0009.
-- Un intento fallido o un «volver a cobrar» no altera la deuda ni crea cuotas: es un hecho de solo agregado
-- que el cobrador registra sobre un cliente de su cartera.

create table public.collection_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  client_id uuid not null,
  collector_id uuid not null,
  type text not null check (type in ('INTENTO_FALLIDO', 'VOLVER_A_COBRAR')),
  reason text check (reason in ('CLIENTE_AUSENTE', 'LUGAR_CERRADO', 'SIN_DINERO', 'DIRECCION_INCORRECTA', 'OTRO')),
  note text check (note is null or length(note) <= 500),
  retry_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint collection_attempts_id_business_key unique (id, business_id),
  constraint collection_attempts_client_fk
    foreign key (client_id, business_id) references public.clients (id, business_id),
  constraint collection_attempts_collector_fk
    foreign key (collector_id, business_id) references public.collectors (id, business_id),
  constraint collection_attempts_creator_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id),
  -- Un intento fallido nombra su motivo; «volver a cobrar» no. El motivo OTRO exige observación (02 §4.4).
  constraint collection_attempts_reason_by_type check ((type = 'INTENTO_FALLIDO') = (reason is not null)),
  constraint collection_attempts_other_requires_note check (
    reason is distinct from 'OTRO' or length(btrim(coalesce(note, ''))) > 0
  ),
  -- La fecha de reintento solo tiene sentido al volver a cobrar o tras un intento fallido, y es futura.
  constraint collection_attempts_retry_after check (retry_at is null or retry_at > created_at)
);

create index collection_attempts_client_idx on public.collection_attempts (client_id, created_at desc);
create index collection_attempts_collector_idx on public.collection_attempts (collector_id, created_at desc);
select private.make_append_only('public.collection_attempts');

-- Solo el cobrador ACTIVO, sobre un cliente que tiene asignado ahora (02 §8: solo su cartera).
create or replace function private.check_collection_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  collector_user uuid;
  collector_status text;
begin
  select user_id, status into collector_user, collector_status
    from public.collectors where id = new.collector_id for share;
  if collector_status is distinct from 'ACTIVO' or collector_user is distinct from new.created_by then
    raise exception 'El intento lo registra su cobrador, activo' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.client_assignments a
     where a.client_id = new.client_id and a.collector_id = new.collector_id and a.status = 'ACTIVA'
       for share
  ) then
    raise exception 'El cobrador solo registra intentos de clientes de su cartera'
      using errcode = 'check_violation', constraint = 'attempt_client_not_assigned';
  end if;
  return new;
end;
$$;

create trigger collection_attempts_valid
  before insert on public.collection_attempts
  for each row execute function private.check_collection_attempt();

grant select on public.collection_attempts to authenticated;
alter table public.collection_attempts enable row level security;

-- El Admin ve todos los de su negocio; el cobrador, los suyos de clientes que sigue teniendo asignados.
create policy collection_attempts_select on public.collection_attempts
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (
      (select private.jwt_role()) = 'ADMIN_NEGOCIO'
      or ((select private.jwt_role()) = 'COBRADOR'
          and collector_id in (select id from public.collectors where user_id = (select auth.uid()))
          and exists (
            select 1 from public.client_assignments a
             where a.client_id = collection_attempts.client_id
               and a.collector_id = collection_attempts.collector_id and a.status = 'ACTIVA'
          ))
    )
  );
