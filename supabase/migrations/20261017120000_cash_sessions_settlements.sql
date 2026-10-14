-- Jornada de Caja Menor, liquidación y cobros del cobrador (F5-T4). Fuentes: 02-DOMINIO §3.1, §5.2–5.5 y
-- §9, ADR 0006 y ADR 0009.
--
-- Diseño: el libro `cash_movements` es de todas las cajas. Un movimiento sin `session_id` es de la Caja
-- Mayor; con `session_id`, de la Caja Menor de esa jornada. Cada caja tiene su saldo derivado (nunca
-- negativo) y su propia suma. El fondo operativo y la liquidación son dos movimientos espejo (uno en cada
-- caja) del mismo importe; el cobro de un cobrador es un COBRO en su jornada. Nada se edita ni se borra.

-- 1. Jornadas ---------------------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  collector_id uuid not null,
  business_date date not null,
  status text not null default 'ABIERTA'
    check (status in ('ABIERTA', 'PENDIENTE_LIQUIDACION', 'LIQUIDADA', 'LIQUIDADA_CON_DIFERENCIA')),
  opened_at timestamptz not null default now(),
  declared_at timestamptz,
  closed_at timestamptz,
  constraint cash_sessions_id_business_key unique (id, business_id),
  constraint cash_sessions_collector_fk
    foreign key (collector_id, business_id) references public.collectors (id, business_id),
  constraint cash_sessions_dates_consistent check (
    (status = 'ABIERTA') = (declared_at is null)
    and (status in ('LIQUIDADA', 'LIQUIDADA_CON_DIFERENCIA')) = (closed_at is not null)
  )
);

-- 02 §5.2: una jornada ABIERTA o PENDIENTE a la vez por cobrador (no se abre otra mientras haya una
-- pendiente de cualquier día, ni dos abiertas el mismo día).
create unique index cash_sessions_one_open_per_collector
  on public.cash_sessions (collector_id) where status in ('ABIERTA', 'PENDIENTE_LIQUIDACION');
create index cash_sessions_collector_date_idx on public.cash_sessions (collector_id, business_date desc);
select private.make_append_only('public.cash_sessions', array['status', 'declared_at', 'closed_at']);

-- 2. Liquidaciones ----------------------------------------------------------------------------------
-- La declara el cobrador (PENDIENTE_REVISION) y la confirma el Admin con lo que realmente recibió.
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  session_id uuid not null,
  collector_id uuid not null,
  declared_amount bigint not null check (declared_amount >= 0),
  declared_by uuid not null,
  declared_at timestamptz not null default now(),
  status text not null default 'PENDIENTE_REVISION'
    check (status in ('PENDIENTE_REVISION', 'CUADRADA', 'CON_DIFERENCIA')),
  expected_amount bigint check (expected_amount >= 0),
  received_amount bigint check (received_amount >= 0),
  difference bigint,
  observation text check (observation is null or length(observation) <= 500),
  confirmed_by uuid,
  confirmed_at timestamptz,
  constraint settlements_id_business_key unique (id, business_id),
  constraint settlements_session_key unique (session_id),
  constraint settlements_session_fk
    foreign key (session_id, business_id) references public.cash_sessions (id, business_id),
  constraint settlements_collector_fk
    foreign key (collector_id, business_id) references public.collectors (id, business_id),
  constraint settlements_declarer_fk
    foreign key (declared_by, business_id) references public.profiles (id, business_id),
  constraint settlements_confirmer_fk
    foreign key (confirmed_by, business_id) references public.profiles (id, business_id),
  constraint settlements_confirmation_consistent check (
    (status = 'PENDIENTE_REVISION') = (confirmed_at is null)
    and (status = 'PENDIENTE_REVISION') = (confirmed_by is null)
    and (status = 'PENDIENTE_REVISION') = (received_amount is null)
    and (status = 'PENDIENTE_REVISION') = (expected_amount is null)
    and (status = 'PENDIENTE_REVISION') = (difference is null)
  ),
  -- Cuadrada = diferencia cero; con diferencia exige observación (02 §5.5).
  constraint settlements_difference_status check (
    status = 'PENDIENTE_REVISION'
    or ((status = 'CUADRADA') = (difference = 0)
        and (difference = 0 or length(btrim(coalesce(observation, ''))) > 0))
  ),
  constraint settlements_difference_formula check (
    status = 'PENDIENTE_REVISION' or difference = expected_amount - received_amount
  )
);

select private.make_append_only(
  'public.settlements',
  array['status', 'expected_amount', 'received_amount', 'difference', 'observation', 'confirmed_by', 'confirmed_at']
);

-- Resolver una diferencia no cambia la liquidación: es un AJUSTE de la Caja Mayor vinculado (02 §5.5).
-- `REVISADA` se deriva de que exista esta fila.
create table public.settlement_resolutions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  settlement_id uuid not null,
  movement_id uuid not null,
  note text not null check (length(btrim(note)) > 0 and length(note) <= 500),
  resolved_by uuid not null,
  created_at timestamptz not null default now(),
  constraint settlement_resolutions_settlement_key unique (settlement_id),
  constraint settlement_resolutions_movement_key unique (movement_id),
  constraint settlement_resolutions_settlement_fk
    foreign key (settlement_id, business_id) references public.settlements (id, business_id),
  constraint settlement_resolutions_movement_fk
    foreign key (movement_id, business_id) references public.cash_movements (id, business_id),
  constraint settlement_resolutions_by_fk
    foreign key (resolved_by, business_id) references public.profiles (id, business_id)
);
select private.make_append_only('public.settlement_resolutions');

-- 3. Movimientos y gastos por caja ------------------------------------------------------------------
alter table public.cash_movements add column session_id uuid;
alter table public.cash_movements
  add constraint cash_movements_session_fk
  foreign key (session_id, business_id) references public.cash_sessions (id, business_id);
create index cash_movements_session_idx on public.cash_movements (session_id) where session_id is not null;

-- La dirección depende del tipo y, para el fondo y la liquidación, de la caja (espejo: SALIDA en la
-- Mayor es ENTRADA en la Menor y al revés).
alter table public.cash_movements drop constraint cash_movements_direction_by_type;
alter table public.cash_movements
  add constraint cash_movements_direction_by_type check (
    case type
      when 'SALDO_APERTURA' then direction = 'ENTRADA'
      when 'INGRESO_CAPITAL' then direction = 'ENTRADA'
      when 'COBRO' then direction = 'ENTRADA'
      when 'DESEMBOLSO_PRESTAMO' then direction = 'SALIDA'
      when 'GASTO_COBRADOR' then direction = 'SALIDA'
      when 'GASTO_CAJA_MAYOR' then direction = 'SALIDA'
      when 'FONDO_OPERATIVO' then direction = case when session_id is null then 'SALIDA' else 'ENTRADA' end
      when 'LIQUIDACION' then direction = case when session_id is null then 'ENTRADA' else 'SALIDA' end
      else true
    end
  );

-- Qué tipos existen en cada caja.
alter table public.cash_movements
  add constraint cash_movements_type_by_box check (
    case
      when session_id is null then type not in ('GASTO_COBRADOR', 'DIFERENCIA_CAJA')
      else type in ('FONDO_OPERATIVO', 'COBRO', 'GASTO_COBRADOR', 'LIQUIDACION', 'DIFERENCIA_CAJA', 'REVERSO')
    end
  );

alter table public.expenses add column session_id uuid;
alter table public.expenses
  add constraint expenses_session_fk
  foreign key (session_id, business_id) references public.cash_sessions (id, business_id);

-- El saldo de cada caja nunca es negativo (ADR 0006, ADR 0009): la Mayor suma los movimientos sin
-- jornada y cada Menor los de su jornada. Diferida: se evalúa al confirmar con el comando completo.
create or replace function private.check_cashbox_balance_not_negative()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  balance bigint;
begin
  select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)
    into balance
    from public.cash_movements
   where cashbox_id = new.cashbox_id
     and session_id is not distinct from new.session_id;
  if balance < 0 then
    raise exception 'El saldo de la caja no puede quedar negativo'
      using errcode = 'check_violation', constraint = 'cashbox_balance_not_negative';
  end if;
  return null;
end;
$$;

-- Un reverso anula por completo el movimiento original en la misma caja (y la misma jornada).
create or replace function private.check_cash_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original public.cash_movements;
begin
  if new.type <> 'REVERSO' then
    return new;
  end if;
  select * into original from public.cash_movements where id = new.reverses_movement_id;
  if original.type = 'REVERSO' then
    raise exception 'Un reverso no se puede reversar' using errcode = 'check_violation';
  end if;
  if original.cashbox_id <> new.cashbox_id
     or original.amount <> new.amount
     or original.direction = new.direction
     or original.session_id is distinct from new.session_id then
    raise exception 'Un reverso debe anular por completo el movimiento original (mismo importe, dirección contraria, misma caja)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 4. Reglas de la jornada sobre los movimientos -----------------------------------------------------
-- El estado de la jornada se lee con FOR SHARE: un movimiento y un cambio de estado (declarar, liquidar)
-- se serializan, así que no se registra un cobro en una jornada que otra transacción está cerrando.
create or replace function private.check_session_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_status text;
  target_session uuid := coalesce(new.session_id, case when new.reference_type = 'session' then new.reference_id end);
begin
  -- La Mayor solo participa en el fondo y la liquidación (espejo de la Menor): exigen su jornada.
  if new.session_id is null then
    if new.type in ('FONDO_OPERATIVO', 'LIQUIDACION') and (new.reference_type is distinct from 'session') then
      raise exception 'El fondo y la liquidación de la Caja Mayor referencian su jornada' using errcode = 'check_violation';
    end if;
    if new.type not in ('FONDO_OPERATIVO', 'LIQUIDACION') then
      return new;
    end if;
  end if;

  select status into session_status from public.cash_sessions where id = target_session for share;
  if session_status is null then
    raise exception 'La jornada no existe' using errcode = 'check_violation';
  end if;
  if new.type in ('COBRO', 'GASTO_COBRADOR', 'FONDO_OPERATIVO') and session_status <> 'ABIERTA' then
    raise exception 'Solo se registra en una jornada ABIERTA' using errcode = 'check_violation', constraint = 'session_not_open';
  end if;
  if new.type = 'REVERSO' and session_status not in ('ABIERTA', 'PENDIENTE_LIQUIDACION') then
    raise exception 'La jornada ya está liquidada: la corrección va a la Caja Mayor' using errcode = 'check_violation', constraint = 'session_not_open';
  end if;
  if new.type in ('LIQUIDACION', 'DIFERENCIA_CAJA') and session_status <> 'PENDIENTE_LIQUIDACION' then
    raise exception 'Solo se liquida una jornada PENDIENTE_LIQUIDACION' using errcode = 'check_violation', constraint = 'session_not_pending';
  end if;
  -- El fondo, el cobro y el gasto de la jornada deben referenciarla.
  if new.session_id is not null and new.type in ('FONDO_OPERATIVO', 'LIQUIDACION')
     and (new.reference_type is distinct from 'session' or new.reference_id is distinct from new.session_id) then
    raise exception 'El fondo y la liquidación referencian su jornada' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cash_movements_session_valid
  before insert on public.cash_movements
  for each row execute function private.check_session_movement();

-- El fondo y la liquidación son dos movimientos espejo: lo que sale de una caja entra en la otra, por el
-- mismo importe total. Diferida: se evalúa con el comando completo.
create or replace function private.check_session_mirror()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_session uuid := coalesce(new.session_id, new.reference_id);
  mayor bigint;
  menor bigint;
begin
  select coalesce(sum(amount), 0) into mayor from public.cash_movements
   where type = new.type and session_id is null and reference_type = 'session' and reference_id = target_session;
  select coalesce(sum(amount), 0) into menor from public.cash_movements
   where type = new.type and session_id = target_session;
  if mayor <> menor then
    raise exception 'El % de la Caja Mayor y el de la jornada deben coincidir', lower(new.type)
      using errcode = 'check_violation', constraint = 'session_mirror';
  end if;
  return null;
end;
$$;

create constraint trigger cash_movements_session_mirror
  after insert on public.cash_movements
  deferrable initially deferred
  for each row
  when (new.type in ('FONDO_OPERATIVO', 'LIQUIDACION'))
  execute function private.check_session_mirror();

-- 5. Apertura y transiciones de la jornada ----------------------------------------------------------
create or replace function private.check_session_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  collector_status text;
begin
  select status into collector_status from public.collectors where id = new.collector_id for share;
  if collector_status is distinct from 'ACTIVO' then
    raise exception 'Solo un cobrador ACTIVO abre una jornada' using errcode = 'check_violation';
  end if;
  if new.status <> 'ABIERTA' then
    raise exception 'Una jornada nace ABIERTA' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cash_sessions_valid
  before insert on public.cash_sessions
  for each row execute function private.check_session_insert();

create or replace function private.check_session_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    if new.declared_at is distinct from old.declared_at or new.closed_at is distinct from old.closed_at then
      raise exception 'Las fechas de la jornada no se reescriben' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;
  if not (
    (old.status = 'ABIERTA' and new.status = 'PENDIENTE_LIQUIDACION')
    or (old.status = 'PENDIENTE_LIQUIDACION' and new.status in ('LIQUIDADA', 'LIQUIDADA_CON_DIFERENCIA'))
  ) then
    raise exception 'Transición de jornada inválida: % a %', old.status, new.status using errcode = 'restrict_violation';
  end if;
  if new.status = 'PENDIENTE_LIQUIDACION'
     and not exists (select 1 from public.settlements where session_id = new.id) then
    raise exception 'Declarar la jornada exige su liquidación' using errcode = 'check_violation';
  end if;
  if new.status in ('LIQUIDADA', 'LIQUIDADA_CON_DIFERENCIA') then
    if not exists (
      select 1 from public.settlements s
       where s.session_id = new.id
         and s.status = case new.status when 'LIQUIDADA' then 'CUADRADA' else 'CON_DIFERENCIA' end
    ) then
      raise exception 'La jornada se liquida con la liquidación confirmada que corresponde' using errcode = 'check_violation';
    end if;
    -- Queda en cero (02 §5.2).
    if (select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)
          from public.cash_movements where session_id = new.id) <> 0 then
      raise exception 'Una jornada liquidada queda en cero' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger cash_sessions_transition
  before update on public.cash_sessions
  for each row execute function private.check_session_transition();

-- 6. Liquidaciones: declaración y confirmación ------------------------------------------------------
create or replace function private.check_settlement_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_row record;
  collector_user uuid;
begin
  select status, collector_id into session_row from public.cash_sessions where id = new.session_id for update;
  if session_row.status is distinct from 'ABIERTA' then
    raise exception 'Solo se declara una jornada ABIERTA' using errcode = 'check_violation';
  end if;
  if session_row.collector_id <> new.collector_id then
    raise exception 'La liquidación es del cobrador de la jornada' using errcode = 'check_violation';
  end if;
  select user_id into collector_user from public.collectors where id = new.collector_id;
  if collector_user <> new.declared_by then
    raise exception 'La liquidación la declara el propio cobrador' using errcode = 'check_violation';
  end if;
  if new.status <> 'PENDIENTE_REVISION' then
    raise exception 'Una liquidación nace PENDIENTE_REVISION' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger settlements_insert_valid
  before insert on public.settlements
  for each row execute function private.check_settlement_insert();

create or replace function private.check_settlement_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  confirmer_role text;
begin
  if old.status <> 'PENDIENTE_REVISION' then
    raise exception 'Una liquidación confirmada no se modifica' using errcode = 'restrict_violation';
  end if;
  if new.status = 'PENDIENTE_REVISION' then
    raise exception 'La liquidación solo avanza a confirmada' using errcode = 'restrict_violation';
  end if;
  select role into confirmer_role from public.profiles where id = new.confirmed_by;
  if confirmer_role is distinct from 'ADMIN_NEGOCIO' then
    raise exception 'La liquidación la confirma el Admin del negocio' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger settlements_update_valid
  before update on public.settlements
  for each row execute function private.check_settlement_update();

-- Al confirmar, los movimientos de la jornada cuadran con la liquidación: el esperado es lo acumulado, lo
-- recibido sale a la Caja Mayor y la diferencia se cierra en la jornada; la jornada queda en cero y en el
-- estado que corresponde. Diferida: se evalúa con el comando completo.
create or replace function private.check_settlement_confirmed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected bigint;
  delivered bigint;
  gap bigint;
  session_status text;
begin
  select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0) into expected
    from public.cash_movements where session_id = new.session_id and type not in ('LIQUIDACION', 'DIFERENCIA_CAJA');
  select coalesce(sum(amount), 0) into delivered
    from public.cash_movements where session_id = new.session_id and type = 'LIQUIDACION';
  select coalesce(sum(case direction when 'SALIDA' then amount else -amount end), 0) into gap
    from public.cash_movements where session_id = new.session_id and type = 'DIFERENCIA_CAJA';
  select status into session_status from public.cash_sessions where id = new.session_id;

  if new.expected_amount <> expected or new.received_amount <> delivered or new.difference <> gap then
    raise exception 'La liquidación no coincide con los movimientos de la jornada' using errcode = 'check_violation';
  end if;
  if session_status is distinct from (case when new.difference = 0 then 'LIQUIDADA' else 'LIQUIDADA_CON_DIFERENCIA' end) then
    raise exception 'La jornada debe quedar liquidada en el estado que corresponde' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger settlements_confirmed_consistent
  after update on public.settlements
  deferrable initially deferred
  for each row execute function private.check_settlement_confirmed();

create or replace function private.check_settlement_resolution()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  settlement_status text;
  movement record;
begin
  select status into settlement_status from public.settlements where id = new.settlement_id for share;
  if settlement_status is distinct from 'CON_DIFERENCIA' then
    raise exception 'Solo se resuelve una liquidación CON_DIFERENCIA' using errcode = 'check_violation';
  end if;
  select type, session_id into movement from public.cash_movements where id = new.movement_id;
  if movement.type is distinct from 'AJUSTE' or movement.session_id is not null then
    raise exception 'La diferencia se resuelve con un AJUSTE de la Caja Mayor' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger settlement_resolutions_valid
  before insert on public.settlement_resolutions
  for each row execute function private.check_settlement_resolution();

-- 7. Cobros del cobrador ----------------------------------------------------------------------------
-- Un cobro en una jornada lo registra el cobrador de esa jornada y solo sobre un cliente que tiene
-- asignado en ese momento (02 §8: solo su cartera). El cobro del Admin sigue entrando a la Caja Mayor.
create or replace function private.check_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  loan_status text;
  charge_loan uuid;
  movement record;
  session_collector uuid;
  session_user_id uuid;
begin
  select status into loan_status from public.loans where id = new.loan_id for no key update;
  if loan_status is distinct from 'ACTIVO' then
    raise exception 'Solo se registran pagos sobre un préstamo ACTIVO' using errcode = 'check_violation';
  end if;
  if new.late_fee_charge_id is not null then
    select loan_id into charge_loan from public.late_fee_charges where id = new.late_fee_charge_id;
    if charge_loan is distinct from new.loan_id then
      raise exception 'El cargo de mora debe ser del mismo préstamo del pago' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.late_fee_voids where charge_id = new.late_fee_charge_id) then
      raise exception 'El cargo de mora está anulado' using errcode = 'check_violation';
    end if;
  end if;
  select type, direction, amount, created_by, session_id into movement
    from public.cash_movements where id = new.movement_id;
  if movement.type is distinct from 'COBRO' or movement.direction is distinct from 'ENTRADA'
     or movement.amount is distinct from new.amount
     or movement.created_by is distinct from new.registered_by then
    raise exception 'El movimiento del pago debe ser un COBRO de entrada del mismo importe y autor'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cash_movements where reverses_movement_id = new.movement_id) then
    raise exception 'El COBRO del pago ya fue reversado' using errcode = 'check_violation';
  end if;

  if movement.session_id is not null then
    select s.collector_id, c.user_id into session_collector, session_user_id
      from public.cash_sessions s join public.collectors c on c.id = s.collector_id
     where s.id = movement.session_id;
    if session_user_id is distinct from new.registered_by then
      raise exception 'El cobro de una jornada lo registra el cobrador de esa jornada' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1
        from public.loans l
        join public.contracts k on k.id = l.contract_id
        join public.client_assignments a on a.client_id = k.client_id and a.status = 'ACTIVA'
       where l.id = new.loan_id and a.collector_id = session_collector
         for share of a
    ) then
      raise exception 'El cobrador solo cobra a clientes de su cartera' using errcode = 'check_violation',
        constraint = 'payment_client_not_assigned';
    end if;
  end if;
  return new;
end;
$$;

-- 8. Desactivar un cobrador exige que no tenga jornada abierta o pendiente (ADR 0009) --------------
create or replace function private.check_collector_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'INACTIVO' and old.status = 'ACTIVO' then
    if exists (select 1 from public.routes where collector_id = new.id and status = 'ACTIVA') then
      raise exception 'El cobrador tiene una ruta activa: ciérrala antes de desactivarlo'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.cash_sessions
       where collector_id = new.id and status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')
    ) then
      raise exception 'El cobrador tiene una jornada abierta o pendiente de liquidación'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- 9. Privilegios y RLS ------------------------------------------------------------------------------
-- La API de datos solo lee: el Admin todo su negocio y el cobrador solo su jornada y su liquidación.
grant select on public.cash_sessions, public.settlements, public.settlement_resolutions to authenticated;

alter table public.cash_sessions enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_resolutions enable row level security;

create policy cash_sessions_select on public.cash_sessions
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

create policy settlements_select on public.settlements
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

create policy settlement_resolutions_select on public.settlement_resolutions
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

-- El cobrador lee los movimientos de su propia jornada.
create policy cash_movements_select_collector on public.cash_movements
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (select private.jwt_role()) = 'COBRADOR'
    and session_id in (
      select s.id from public.cash_sessions s
        join public.collectors c on c.id = s.collector_id
       where c.user_id = (select auth.uid())
    )
  );
