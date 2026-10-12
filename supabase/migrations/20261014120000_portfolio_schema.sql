-- Cartera: clientes, contratos, préstamos y cuotas (F3-T2). Fuentes: 02-DOMINIO §2.1–2.4 y §9, ADR 0007.
-- Importes en `bigint` (COP sin decimales, regla 8); interés en puntos básicos. La cartera importada
-- (02 §6.1) y los pagos (F4) amplían este esquema en sus propias migraciones.

-- 1. Clientes ---------------------------------------------------------------------------------------
-- Sin acceso de usuario en V1. Los datos de contacto se editan (y se auditan en el comando); la
-- identificación y el negocio no cambian nunca, y un cliente no se elimina.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  name text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  nickname text check (nickname is null or length(nickname) <= 120),
  identification text not null check (length(btrim(identification)) > 0 and length(identification) <= 40),
  address text check (address is null or length(address) <= 300),
  phone text check (phone is null or length(phone) <= 30),
  whatsapp text check (whatsapp is null or length(whatsapp) <= 30),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_id_business_key unique (id, business_id),
  -- 02 §2.1 / ADR 0007: la identificación es única por negocio.
  constraint clients_identification_key unique (business_id, identification),
  constraint clients_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

create index clients_business_name_idx on public.clients (business_id, lower(name));

create or replace function private.protect_client_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un cliente no se elimina (02 §2.1)' using errcode = 'restrict_violation';
  end if;
  if new.id is distinct from old.id
     or new.business_id is distinct from old.business_id
     or new.identification is distinct from old.identification
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'La identificación, el negocio y el origen de un cliente no se pueden cambiar'
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger clients_protect_identity
  before update or delete on public.clients
  for each row execute function private.protect_client_identity();

-- 2. Contador del número de contrato ----------------------------------------------------------------
-- Un contador por negocio, con bloqueo de fila al incrementar: sin huecos ni repetidos (03 §7).
-- Es interno de la aplicación: no se expone por la API de datos.
create table public.contract_counters (
  business_id uuid primary key references public.businesses (id),
  last_number bigint not null default 0 check (last_number >= 0)
);

-- 3. Contratos --------------------------------------------------------------------------------------
-- Solo existen CONFIRMADO y ANULADO: el flujo confirma en un solo paso (ADR 0007), así que un
-- borrador no se guarda. Un contrato confirmado es inmutable; lo único que cambia es su anulación.
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  client_id uuid not null,
  number text not null check (number ~ '^CT-[0-9]{6,}$'),
  origin text not null check (origin in ('NUEVO', 'IMPORTADO')),
  status text not null default 'CONFIRMADO' check (status in ('CONFIRMADO', 'ANULADO')),
  comment text check (comment is null or length(comment) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or length(void_reason) <= 500),
  constraint contracts_id_business_key unique (id, business_id),
  constraint contracts_number_key unique (business_id, number),
  constraint contracts_client_fk
    foreign key (client_id, business_id) references public.clients (id, business_id),
  constraint contracts_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id),
  constraint contracts_voider_business_fk
    foreign key (voided_by, business_id) references public.profiles (id, business_id),
  -- La anulación exige motivo, fecha y autor, y solo el contrato anulado los tiene.
  constraint contracts_void_consistent check (
    (status = 'ANULADO') = (voided_at is not null and voided_by is not null)
    and (status = 'ANULADO') = (length(btrim(coalesce(void_reason, ''))) > 0)
  )
);

create index contracts_client_idx on public.contracts (client_id);
create index contracts_business_created_idx on public.contracts (business_id, created_at desc);

select private.make_append_only(
  'public.contracts',
  array['status', 'voided_at', 'voided_by', 'void_reason']
);

-- Las únicas columnas modificables son las de la anulación, y solo de CONFIRMADO a ANULADO.
create or replace function private.check_contract_void_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'ANULADO' then
    raise exception 'Un contrato anulado no cambia más' using errcode = 'restrict_violation';
  end if;
  if new.status <> 'ANULADO' then
    raise exception 'Un contrato confirmado solo puede pasar a ANULADO' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger contracts_void_transition
  before update on public.contracts
  for each row
  when (old.status is distinct from new.status)
  execute function private.check_contract_void_transition();

-- 4. Préstamos --------------------------------------------------------------------------------------
-- Un contrato confirmado genera exactamente un préstamo (02 §9.3). Los importes nunca cambian tras
-- confirmar (02 §2.3); solo el estado, y solo de ACTIVO a ANULADO en esta fase.
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  contract_id uuid not null,
  principal_amount bigint not null check (principal_amount > 0),
  interest_bps integer not null check (interest_bps >= 0),
  interest_amount bigint not null check (interest_amount >= 0),
  total_amount bigint not null,
  -- Suma de las cuotas programadas: igual al total en un préstamo nuevo (02 §2.4).
  scheduled_amount bigint not null check (scheduled_amount > 0),
  disbursed_on date not null,
  first_due_on date not null,
  frequency text not null check (frequency in ('DIARIA', 'SEMANAL', 'MENSUAL')),
  installment_count integer not null check (installment_count > 0),
  status text not null default 'ACTIVO' check (status in ('ACTIVO', 'ANULADO')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint loans_id_business_key unique (id, business_id),
  constraint loans_contract_key unique (contract_id),
  constraint loans_contract_fk
    foreign key (contract_id, business_id) references public.contracts (id, business_id),
  constraint loans_creator_business_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id),
  constraint loans_total_consistent check (total_amount = principal_amount + interest_amount),
  constraint loans_scheduled_within_total check (scheduled_amount <= total_amount),
  constraint loans_first_due_not_before_disbursement check (first_due_on >= disbursed_on)
);

create index loans_business_status_idx on public.loans (business_id, status);

select private.make_append_only('public.loans', array['status']);

create or replace function private.check_loan_void_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'ACTIVO' or new.status <> 'ANULADO' then
    raise exception 'Un préstamo solo puede pasar de ACTIVO a ANULADO' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger loans_void_transition
  before update on public.loans
  for each row
  when (old.status is distinct from new.status)
  execute function private.check_loan_void_transition();

-- 5. Cuotas -----------------------------------------------------------------------------------------
-- El calendario se genera al confirmar y nunca se recalcula (02 §2.4). `amount` es el valor
-- esperado; el estado de una cuota se deriva (fecha, saldo) y el valor aplicado llega con F4.
create table public.installments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  loan_id uuid not null,
  number integer not null check (number > 0),
  due_on date not null,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint installments_id_business_key unique (id, business_id),
  constraint installments_loan_number_key unique (loan_id, number),
  constraint installments_loan_fk
    foreign key (loan_id, business_id) references public.loans (id, business_id)
);

create index installments_business_due_idx on public.installments (business_id, due_on);

select private.make_append_only('public.installments');

-- La suma y la cantidad de cuotas coinciden con las del préstamo, comprobado al confirmar la
-- transacción (diferido) para que el comando pueda insertar préstamo y cuotas en cualquier orden.
create or replace function private.check_loan_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_loan uuid := case tg_table_name when 'loans' then new.id else new.loan_id end;
  expected record;
  actual record;
begin
  select scheduled_amount, installment_count into expected from public.loans where id = target_loan;
  select coalesce(sum(amount), 0) as total, count(*) as n,
         coalesce(max(number), 0) as last_number
    into actual from public.installments where loan_id = target_loan;
  if actual.total <> expected.scheduled_amount
     or actual.n <> expected.installment_count
     or actual.last_number <> expected.installment_count then
    raise exception 'Las cuotas del préstamo no coinciden con su calendario (suma, cantidad y numeración)'
      using errcode = 'check_violation', constraint = 'loan_schedule_consistent';
  end if;
  return null;
end;
$$;

create constraint trigger loans_schedule_consistent
  after insert on public.loans
  deferrable initially deferred
  for each row execute function private.check_loan_schedule();

create constraint trigger installments_schedule_consistent
  after insert on public.installments
  deferrable initially deferred
  for each row execute function private.check_loan_schedule();

-- 6. Privilegios y RLS ------------------------------------------------------------------------------
-- Las tablas nuevas nacen sin privilegios (endurecimiento de F1). La API de datos solo lee, y solo el
-- Admin de su negocio con la sesión y el negocio activos; los cobradores acceden a su cartera en F5.
grant select on public.clients, public.contracts, public.loans, public.installments to authenticated;

alter table public.clients enable row level security;
alter table public.contract_counters enable row level security;
alter table public.contracts enable row level security;
alter table public.loans enable row level security;
alter table public.installments enable row level security;

create policy clients_select on public.clients
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy contracts_select on public.contracts
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy loans_select on public.loans
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy installments_select on public.installments
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );
