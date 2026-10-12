-- Pagos, reversos, cargos de mora y refinanciación (F4-T2). Fuentes: 02-DOMINIO §3 y §9, ADR 0008.
-- Todo hecho es de solo agregado y el estado se DERIVA (un pago está reversado si tiene un reverso; una
-- cuota o un cargo tienen saldo = valor − aplicaciones de pagos no reversados). Importes en `bigint`.

-- 2. Cargos de mora ---------------------------------------------------------------------------------
-- Penalización decidida a mano por el Admin (02 §3.4): nunca automática. Su estado
-- (ACTIVO/PAGADO/ANULADO) se deriva de sus pagos y de su anulación.
create table public.late_fee_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  loan_id uuid not null,
  installment_id uuid,
  amount bigint not null check (amount > 0),
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint late_fee_charges_id_business_key unique (id, business_id),
  constraint late_fee_charges_loan_fk
    foreign key (loan_id, business_id) references public.loans (id, business_id),
  constraint late_fee_charges_installment_fk
    foreign key (installment_id, business_id) references public.installments (id, business_id),
  constraint late_fee_charges_creator_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id)
);

create index late_fee_charges_loan_idx on public.late_fee_charges (loan_id);
select private.make_append_only('public.late_fee_charges');

-- Un cargo solo se crea sobre un préstamo ACTIVO y, si nombra una cuota, que sea de ese préstamo.
create or replace function private.check_late_fee_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  loan_status text;
  installment_loan uuid;
begin
  select status into loan_status from public.loans where id = new.loan_id;
  if loan_status is distinct from 'ACTIVO' then
    raise exception 'Un cargo de mora solo se crea sobre un préstamo ACTIVO' using errcode = 'check_violation';
  end if;
  if new.installment_id is not null then
    select loan_id into installment_loan from public.installments where id = new.installment_id;
    if installment_loan is distinct from new.loan_id then
      raise exception 'La cuota del cargo de mora debe ser del mismo préstamo' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger late_fee_charges_valid
  before insert on public.late_fee_charges
  for each row execute function private.check_late_fee_charge();

-- 3. Anulación de cargos ----------------------------------------------------------------------------
create table public.late_fee_voids (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  charge_id uuid not null,
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 500),
  voided_by uuid not null,
  created_at timestamptz not null default now(),
  -- Un cargo se anula una sola vez.
  constraint late_fee_voids_charge_key unique (charge_id),
  constraint late_fee_voids_charge_fk
    foreign key (charge_id, business_id) references public.late_fee_charges (id, business_id),
  constraint late_fee_voids_voider_fk
    foreign key (voided_by, business_id) references public.profiles (id, business_id)
);

select private.make_append_only('public.late_fee_voids');

-- Un cargo con pagos vigentes no se anula: primero se reversan sus pagos (ADR 0008).
create or replace function private.check_late_fee_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.charge_applied(new.charge_id) > 0 then
    raise exception 'El cargo de mora tiene pagos vigentes: reversa primero sus pagos'
      using errcode = 'check_violation', constraint = 'late_fee_void_without_payments';
  end if;
  return new;
end;
$$;

create trigger late_fee_voids_valid
  before insert on public.late_fee_voids
  for each row execute function private.check_late_fee_void();

-- 4. Pagos ------------------------------------------------------------------------------------------
-- `seq` da el orden total de los pagos de un préstamo: el reverso solo alcanza al último (ADR 0008).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  business_id uuid not null references public.businesses (id),
  loan_id uuid not null,
  kind text not null check (kind in ('CUOTAS', 'CARGO_MORA')),
  late_fee_charge_id uuid,
  amount bigint not null check (amount > 0),
  movement_id uuid not null,
  note text check (note is null or length(note) <= 500),
  registered_by uuid not null,
  created_at timestamptz not null default now(),
  constraint payments_id_business_key unique (id, business_id),
  constraint payments_seq_key unique (seq),
  constraint payments_movement_key unique (movement_id),
  constraint payments_loan_fk
    foreign key (loan_id, business_id) references public.loans (id, business_id),
  constraint payments_charge_fk
    foreign key (late_fee_charge_id, business_id) references public.late_fee_charges (id, business_id),
  constraint payments_movement_fk
    foreign key (movement_id, business_id) references public.cash_movements (id, business_id),
  constraint payments_registered_by_fk
    foreign key (registered_by, business_id) references public.profiles (id, business_id),
  -- Un pago de cargo de mora nombra su cargo; uno de cuotas no.
  constraint payments_kind_charge check ((kind = 'CARGO_MORA') = (late_fee_charge_id is not null))
);

create index payments_loan_seq_idx on public.payments (loan_id, seq desc);
select private.make_append_only('public.payments');

create or replace function private.check_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  loan_status text;
  charge_loan uuid;
  movement record;
begin
  select status into loan_status from public.loans where id = new.loan_id;
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
  -- El dinero del pago entra a la caja como un COBRO del mismo importe.
  select type, direction, amount into movement from public.cash_movements where id = new.movement_id;
  if movement.type is distinct from 'COBRO' or movement.direction is distinct from 'ENTRADA'
     or movement.amount is distinct from new.amount then
    raise exception 'El movimiento del pago debe ser un COBRO de entrada por el mismo importe'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payments_valid
  before insert on public.payments
  for each row execute function private.check_payment();

-- 5. Aplicaciones de pago ---------------------------------------------------------------------------
create table public.payment_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  payment_id uuid not null,
  installment_id uuid,
  late_fee_charge_id uuid,
  amount bigint not null check (amount > 0),
  -- Orden de aplicación dentro del pago (02 §3.2).
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  constraint payment_applications_position_key unique (payment_id, position),
  constraint payment_applications_payment_fk
    foreign key (payment_id, business_id) references public.payments (id, business_id),
  constraint payment_applications_installment_fk
    foreign key (installment_id, business_id) references public.installments (id, business_id),
  constraint payment_applications_charge_fk
    foreign key (late_fee_charge_id, business_id) references public.late_fee_charges (id, business_id),
  -- Cada aplicación va a una cuota o a un cargo, nunca a ambos.
  constraint payment_applications_one_target check ((installment_id is null) <> (late_fee_charge_id is null))
);

create index payment_applications_installment_idx on public.payment_applications (installment_id)
  where installment_id is not null;
create index payment_applications_charge_idx on public.payment_applications (late_fee_charge_id)
  where late_fee_charge_id is not null;
select private.make_append_only('public.payment_applications');

create or replace function private.check_payment_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pay record;
  target_loan uuid;
begin
  select kind, loan_id, late_fee_charge_id into pay from public.payments where id = new.payment_id;
  if new.installment_id is not null then
    if pay.kind <> 'CUOTAS' then
      raise exception 'Un pago de cargo de mora no se aplica a cuotas' using errcode = 'check_violation';
    end if;
    select loan_id into target_loan from public.installments where id = new.installment_id;
    if target_loan is distinct from pay.loan_id then
      raise exception 'La cuota debe ser del préstamo del pago' using errcode = 'check_violation';
    end if;
  else
    if pay.kind <> 'CARGO_MORA' or new.late_fee_charge_id is distinct from pay.late_fee_charge_id then
      raise exception 'Un pago de cuotas no se aplica a cargos, y uno de cargo solo a su cargo'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger payment_applications_valid
  before insert on public.payment_applications
  for each row execute function private.check_payment_application();

-- Al confirmar la transacción: lo aplicado suma exactamente el pago (no hay saldo a favor, 02 §3.2) y
-- ninguna cuota ni cargo recibe más que su saldo (02 §9.4).
create or replace function private.check_payment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_payment uuid :=
    (case when tg_table_name = 'payments' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'payment_id' end)::uuid;
  applied bigint;
  expected bigint;
  overpaid boolean;
begin
  select amount into expected from public.payments where id = target_payment;
  select coalesce(sum(amount), 0) into applied from public.payment_applications where payment_id = target_payment;
  if applied <> expected then
    raise exception 'Las aplicaciones del pago deben sumar exactamente su importe'
      using errcode = 'check_violation', constraint = 'payment_fully_applied';
  end if;

  select exists (
           select 1 from public.payment_applications a
            join public.installments i on i.id = a.installment_id
           where a.payment_id = target_payment
             and private.installment_applied(i.id) > i.amount
         ) or exists (
           select 1 from public.payment_applications a
            join public.late_fee_charges c on c.id = a.late_fee_charge_id
           where a.payment_id = target_payment
             and private.charge_applied(c.id) > c.amount
         )
    into overpaid;
  if overpaid then
    raise exception 'Un pago no puede aplicar a una cuota o cargo más que su saldo pendiente'
      using errcode = 'check_violation', constraint = 'payment_within_balance';
  end if;
  return null;
end;
$$;

create constraint trigger payments_fully_applied
  after insert on public.payments
  deferrable initially deferred
  for each row execute function private.check_payment_totals();

create constraint trigger payment_applications_totals
  after insert on public.payment_applications
  deferrable initially deferred
  for each row execute function private.check_payment_totals();

-- 6. Reversos de pago -------------------------------------------------------------------------------
create table public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  payment_id uuid not null,
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 500),
  movement_id uuid not null,
  reversed_by uuid not null,
  created_at timestamptz not null default now(),
  -- Un pago se reversa una sola vez.
  constraint payment_reversals_payment_key unique (payment_id),
  constraint payment_reversals_movement_key unique (movement_id),
  constraint payment_reversals_payment_fk
    foreign key (payment_id, business_id) references public.payments (id, business_id),
  constraint payment_reversals_movement_fk
    foreign key (movement_id, business_id) references public.cash_movements (id, business_id),
  constraint payment_reversals_reverser_fk
    foreign key (reversed_by, business_id) references public.profiles (id, business_id)
);

select private.make_append_only('public.payment_reversals');

-- Solo el pago más reciente no reversado del préstamo se reversa (ADR 0008), y su movimiento de caja es
-- el REVERSO del COBRO original.
create or replace function private.check_payment_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target record;
  reversal record;
begin
  select loan_id, seq, movement_id into target from public.payments where id = new.payment_id;
  if exists (
    select 1 from public.payments later
     where later.loan_id = target.loan_id and later.seq > target.seq
       and not exists (select 1 from public.payment_reversals r where r.payment_id = later.id)
  ) then
    raise exception 'Solo se reversa el pago más reciente del préstamo: reversa antes los posteriores'
      using errcode = 'check_violation', constraint = 'payment_reversal_latest_only';
  end if;
  select type, reverses_movement_id into reversal from public.cash_movements where id = new.movement_id;
  if reversal.type is distinct from 'REVERSO' or reversal.reverses_movement_id is distinct from target.movement_id then
    raise exception 'El movimiento del reverso debe revertir el COBRO del pago' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payment_reversals_valid
  before insert on public.payment_reversals
  for each row execute function private.check_payment_reversal();

-- 6b. Funciones de saldo (se crean aquí porque leen las tablas de pagos) (derivan lo aplicado a una cuota o a un cargo) -------------------------------
-- Una aplicación cuenta mientras su pago no tenga reverso (02 §3.1: el pago nunca se borra).
create or replace function private.installment_applied(target uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(a.amount), 0)::bigint
    from public.payment_applications a
    join public.payments p on p.id = a.payment_id
   where a.installment_id = target
     and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
$$;

create or replace function private.charge_applied(target uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(a.amount), 0)::bigint
    from public.payment_applications a
    join public.payments p on p.id = a.payment_id
   where a.late_fee_charge_id = target
     and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
$$;

-- 7. Refinanciación ---------------------------------------------------------------------------------
-- El préstamo anterior pasa a REFINANCIADO (su deuda queda cancelada sin mover efectivo) y el nuevo
-- referencia al anterior.
alter table public.loans drop constraint loans_status_check;
alter table public.loans
  add constraint loans_status_check check (status in ('ACTIVO', 'ANULADO', 'REFINANCIADO'));
alter table public.loans add column previous_loan_id uuid;
alter table public.loans
  add constraint loans_previous_loan_fk
  foreign key (previous_loan_id, business_id) references public.loans (id, business_id);

create or replace function private.check_loan_void_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'ACTIVO' or new.status not in ('ANULADO', 'REFINANCIADO') then
    raise exception 'Un préstamo solo puede pasar de ACTIVO a ANULADO o REFINANCIADO'
      using errcode = 'restrict_violation';
  end if;
  -- Anular exige que no haya pagos vigentes (02 §2.2): primero se reversan.
  if new.status = 'ANULADO' and exists (
    select 1 from public.payments p
     where p.loan_id = new.id
       and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
  ) then
    raise exception 'El préstamo tiene pagos vigentes: reversa primero sus pagos'
      using errcode = 'check_violation', constraint = 'loan_annul_without_payments';
  end if;
  return new;
end;
$$;

create table public.refinancings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  previous_loan_id uuid not null,
  new_loan_id uuid not null,
  refinanced_balance bigint not null check (refinanced_balance > 0),
  additional_amount bigint not null check (additional_amount >= 0),
  note text check (note is null or length(note) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint refinancings_previous_key unique (previous_loan_id),
  constraint refinancings_new_key unique (new_loan_id),
  constraint refinancings_previous_fk
    foreign key (previous_loan_id, business_id) references public.loans (id, business_id),
  constraint refinancings_new_fk
    foreign key (new_loan_id, business_id) references public.loans (id, business_id),
  constraint refinancings_creator_fk
    foreign key (created_by, business_id) references public.profiles (id, business_id),
  constraint refinancings_distinct_loans check (previous_loan_id <> new_loan_id)
);

select private.make_append_only('public.refinancings');

-- Reglas de la refinanciación (02 §3.5): el saldo refinanciado es exactamente el saldo pendiente de las
-- cuotas del préstamo anterior, no hay cargos de mora activos con saldo (ADR 0008) y el principal del
-- nuevo préstamo es saldo + monto adicional.
create or replace function private.check_refinancing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_status text;
  pending bigint;
  fees bigint;
  new_principal bigint;
  new_previous uuid;
begin
  select status into previous_status from public.loans where id = new.previous_loan_id;
  if previous_status is distinct from 'ACTIVO' then
    raise exception 'Solo se refinancia un préstamo ACTIVO' using errcode = 'check_violation';
  end if;

  select coalesce(sum(i.amount - private.installment_applied(i.id)), 0) into pending
    from public.installments i where i.loan_id = new.previous_loan_id;
  if pending <> new.refinanced_balance then
    raise exception 'El saldo refinanciado debe ser el saldo pendiente de las cuotas'
      using errcode = 'check_violation', constraint = 'refinancing_balance_matches';
  end if;

  select coalesce(sum(c.amount - private.charge_applied(c.id)), 0) into fees
    from public.late_fee_charges c
   where c.loan_id = new.previous_loan_id
     and not exists (select 1 from public.late_fee_voids v where v.charge_id = c.id);
  if fees > 0 then
    raise exception 'El préstamo tiene cargos de mora activos: págalos o anúlalos antes de refinanciar'
      using errcode = 'check_violation', constraint = 'refinancing_without_active_fees';
  end if;

  select principal_amount, previous_loan_id into new_principal, new_previous
    from public.loans where id = new.new_loan_id;
  if new_principal <> new.refinanced_balance + new.additional_amount
     or new_previous is distinct from new.previous_loan_id then
    raise exception 'El nuevo préstamo debe tener como principal el saldo refinanciado más el monto adicional y referenciar al anterior'
      using errcode = 'check_violation', constraint = 'refinancing_new_loan_matches';
  end if;
  return new;
end;
$$;

create trigger refinancings_valid
  before insert on public.refinancings
  for each row execute function private.check_refinancing();

-- El préstamo anterior queda REFINANCIADO en la misma transacción en que se registra la refinanciación.
create or replace function private.check_refinanced_loan_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_status text;
begin
  select status into previous_status from public.loans where id = new.previous_loan_id;
  if previous_status is distinct from 'REFINANCIADO' then
    raise exception 'El préstamo refinanciado debe quedar en estado REFINANCIADO'
      using errcode = 'check_violation', constraint = 'refinanced_loan_status';
  end if;
  return null;
end;
$$;

create constraint trigger refinancings_previous_refinanced
  after insert on public.refinancings
  deferrable initially deferred
  for each row execute function private.check_refinanced_loan_status();

-- 8. Privilegios y RLS ------------------------------------------------------------------------------
grant select on public.late_fee_charges, public.late_fee_voids, public.payments,
  public.payment_applications, public.payment_reversals, public.refinancings to authenticated;

alter table public.late_fee_charges enable row level security;
alter table public.late_fee_voids enable row level security;
alter table public.payments enable row level security;
alter table public.payment_applications enable row level security;
alter table public.payment_reversals enable row level security;
alter table public.refinancings enable row level security;

create policy late_fee_charges_select on public.late_fee_charges
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy late_fee_voids_select on public.late_fee_voids
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy payments_select on public.payments
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy payment_applications_select on public.payment_applications
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy payment_reversals_select on public.payment_reversals
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

create policy refinancings_select on public.refinancings
  for select to authenticated
  using (
    (select private.is_session_active())
    and (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );
