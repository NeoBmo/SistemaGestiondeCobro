-- Libro de Caja Mayor (F2-T1). Fuentes: 02-DOMINIO §5.1, §5.3, §5.4 y §9 (invariantes 10 y 14),
-- 03-ARQUITECTURA §3 y §4, y ADR 0006.
-- Importes en `bigint` (COP sin decimales, regla 8). Las tablas de hechos son de solo agregado.

-- 1. Sesión activa para las políticas -------------------------------------------------------------
-- Cierra dos brechas de F1 (03 §4 puntos 7 y 10): un usuario con la contraseña temporal pendiente
-- o de un negocio suspendido conserva un JWT vigente hasta que caduca, y la RLS solo miraba los
-- claims. Ahora toda política de lectura de datos de negocio exige también que, en este momento, el
-- perfil esté ACTIVO y su negocio ACTIVO. SECURITY DEFINER: lee `profiles`/`businesses` sin RLS.
create or replace function private.is_session_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      left join public.businesses b on b.id = p.business_id
     where p.id = auth.uid()
       and p.status = 'ACTIVO'
       and (p.business_id is null or b.access_status = 'ACTIVO')
  )
$$;

revoke all on function private.is_session_active() from public, anon;
grant execute on function private.is_session_active() to authenticated;

alter policy businesses_select on public.businesses
  using (
    (select private.is_session_active())
    and (
      (select private.jwt_role()) = 'SUPER_ADMIN'
      or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and id = (select private.jwt_business_id()))
    )
  );

alter policy profiles_select_business_admin on public.profiles
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

alter policy profiles_select_super_admin on public.profiles
  using ((select private.is_session_active()) and (select private.jwt_role()) = 'SUPER_ADMIN');

alter policy subscriptions_select on public.subscriptions
  using (
    (select private.is_session_active())
    and (
      (select private.jwt_role()) = 'SUPER_ADMIN'
      or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
    )
  );

alter policy audit_events_select on public.audit_events
  using (
    (select private.is_session_active())
    and (
      (select private.jwt_role()) = 'SUPER_ADMIN'
      or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
    )
  );

-- 2. Caja Mayor: una por negocio -------------------------------------------------------------------
create table public.main_cashboxes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id),
  created_at timestamptz not null default now(),
  -- Referencia compuesta de las tablas hijas: una entidad hija es siempre del mismo negocio (02 §9.1).
  constraint main_cashboxes_id_business_key unique (id, business_id)
);

select private.make_append_only('public.main_cashboxes');

-- Los negocios que ya existen reciben su caja (los nuevos la crean en la transacción de alta).
insert into public.main_cashboxes (business_id) select id from public.businesses;

-- 3. Movimientos de caja ---------------------------------------------------------------------------
-- Sin estado: todo movimiento registrado es definitivo y cuenta en el saldo (ADR 0006).
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  cashbox_id uuid not null,
  type text not null check (type in (
    'SALDO_APERTURA', 'INGRESO_CAPITAL', 'DESEMBOLSO_PRESTAMO', 'FONDO_OPERATIVO', 'COBRO',
    'GASTO_COBRADOR', 'GASTO_CAJA_MAYOR', 'LIQUIDACION', 'DIFERENCIA_CAJA', 'AJUSTE', 'REVERSO'
  )),
  direction text not null check (direction in ('ENTRADA', 'SALIDA')),
  amount bigint not null check (amount > 0),
  -- Causa de negocio identificable (02 §5.3): la entidad que originó el movimiento.
  reference_type text,
  reference_id uuid,
  reverses_movement_id uuid,
  reason text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint cash_movements_id_business_key unique (id, business_id),
  constraint cash_movements_cashbox_fk
    foreign key (cashbox_id, business_id) references public.main_cashboxes (id, business_id),
  constraint cash_movements_reverses_fk
    foreign key (reverses_movement_id, business_id) references public.cash_movements (id, business_id),
  constraint cash_movements_reference_pair check ((reference_type is null) = (reference_id is null)),
  -- Cada tipo fijo tiene su dirección; AJUSTE, REVERSO y DIFERENCIA_CAJA llevan la que corresponda.
  constraint cash_movements_direction_by_type check (
    case type
      when 'SALDO_APERTURA' then direction = 'ENTRADA'
      when 'INGRESO_CAPITAL' then direction = 'ENTRADA'
      when 'COBRO' then direction = 'ENTRADA'
      when 'LIQUIDACION' then direction = 'ENTRADA'
      when 'DESEMBOLSO_PRESTAMO' then direction = 'SALIDA'
      when 'FONDO_OPERATIVO' then direction = 'SALIDA'
      when 'GASTO_COBRADOR' then direction = 'SALIDA'
      when 'GASTO_CAJA_MAYOR' then direction = 'SALIDA'
      else true
    end
  ),
  -- Un AJUSTE o REVERSO exige motivo; un REVERSO referencia al original y nada más lo hace.
  constraint cash_movements_reason_required check (
    type not in ('AJUSTE', 'REVERSO') or length(btrim(coalesce(reason, ''))) > 0
  ),
  constraint cash_movements_reversal_link check ((type = 'REVERSO') = (reverses_movement_id is not null))
);

create index cash_movements_cashbox_idx on public.cash_movements (cashbox_id, created_at desc);
create index cash_movements_business_idx on public.cash_movements (business_id, created_at desc);
-- Un negocio registra un solo saldo de apertura, y un movimiento se reversa una sola vez (ADR 0006).
create unique index cash_movements_one_opening_balance
  on public.cash_movements (business_id) where type = 'SALDO_APERTURA';
create unique index cash_movements_reversed_once
  on public.cash_movements (reverses_movement_id) where reverses_movement_id is not null;

select private.make_append_only('public.cash_movements');

-- Un reverso anula por completo un movimiento: mismo importe, dirección contraria, misma caja, y no
-- se reversa un reverso. (La unicidad de «una sola vez» la da el índice de arriba.)
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
     or original.direction = new.direction then
    raise exception 'Un reverso debe anular por completo el movimiento original (mismo importe, dirección contraria, misma caja)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger cash_movements_reversal_matches
  before insert on public.cash_movements
  for each row execute function private.check_cash_reversal();

-- Invariante 14: el saldo de Caja Mayor nunca es negativo. La aplicación ya lo comprueba bajo el
-- bloqueo de la caja; esta barrera lo garantiza aunque algo la rodee. Diferida: se evalúa al confirmar
-- la transacción, con todos los movimientos del comando ya insertados.
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
   where cashbox_id = new.cashbox_id;
  if balance < 0 then
    raise exception 'El saldo de la Caja Mayor no puede quedar negativo'
      using errcode = 'check_violation', constraint = 'cashbox_balance_not_negative';
  end if;
  return null;
end;
$$;

create constraint trigger cash_movements_balance_not_negative
  after insert on public.cash_movements
  deferrable initially deferred
  for each row execute function private.check_cashbox_balance_not_negative();

-- 4. Gastos ----------------------------------------------------------------------------------------
-- Entidad separada del movimiento (regla 2). En F2 solo gastos directos de Caja Mayor; la jornada
-- opcional llega con F5. Corregir un gasto es un AJUSTE: este registro nunca cambia.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  cashbox_id uuid not null,
  movement_id uuid not null unique,
  category text not null check (category in ('GASOLINA', 'ALIMENTACION', 'REPARACION', 'MEDICINA', 'OTRO')),
  amount bigint not null check (amount > 0),
  spent_on date not null,
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint expenses_cashbox_fk
    foreign key (cashbox_id, business_id) references public.main_cashboxes (id, business_id),
  constraint expenses_movement_fk
    foreign key (movement_id, business_id) references public.cash_movements (id, business_id),
  constraint expenses_other_requires_note check (category <> 'OTRO' or length(btrim(coalesce(note, ''))) > 0)
);

create index expenses_business_idx on public.expenses (business_id, spent_on desc);

select private.make_append_only('public.expenses');

-- 5. Claves de idempotencia ------------------------------------------------------------------------
-- Única por (negocio, comando, clave). Se inserta al empezar el comando (reserva) y `result` se
-- completa al terminar, dentro de la misma transacción: es la única columna modificable.
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  command text not null check (length(btrim(command)) > 0),
  key uuid not null,
  payload_hash text not null check (length(payload_hash) > 0),
  result jsonb,
  created_at timestamptz not null default now(),
  constraint idempotency_keys_unique unique (business_id, command, key)
);

select private.make_append_only('public.idempotency_keys', array['result']);

-- 6. Privilegios y RLS -----------------------------------------------------------------------------
-- Las tablas nuevas nacen sin privilegios (migración de endurecimiento). Solo se lee por la API de
-- datos y solo el Admin de su negocio; `idempotency_keys` es interna de la aplicación.
grant select on public.main_cashboxes, public.cash_movements, public.expenses to authenticated;

alter table public.main_cashboxes enable row level security;
alter table public.cash_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.idempotency_keys enable row level security;

create policy main_cashboxes_select on public.main_cashboxes
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy expenses_select on public.expenses
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );
