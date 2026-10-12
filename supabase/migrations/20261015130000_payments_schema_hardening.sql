-- Endurecimiento del esquema de pagos (F4-T2), a raíz de la revisión independiente. Va en una migración
-- nueva porque la anterior ya estaba aplicada en local.

-- 1. Bloqueo del préstamo: las barreras diferidas ven lo que confirman otras transacciones ------------
-- Con READ COMMITTED, dos transacciones que pagan la misma cuota, o un reverso y un pago nuevo del mismo
-- préstamo, no se veían entre sí y ambas podían confirmar. Cada operación toma primero `FOR NO KEY UPDATE`
-- sobre la fila del préstamo (no choca con el `FOR KEY SHARE` de las claves foráneas): la segunda espera
-- a la primera y sus lecturas posteriores ya incluyen lo confirmado.

create or replace function private.check_late_fee_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  loan_status text;
  installment_loan uuid;
begin
  select status into loan_status from public.loans where id = new.loan_id for no key update;
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

create or replace function private.check_late_fee_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.loans
   where id = (select loan_id from public.late_fee_charges where id = new.charge_id)
     for no key update;
  if private.charge_applied(new.charge_id) > 0 then
    raise exception 'El cargo de mora tiene pagos vigentes: reversa primero sus pagos'
      using errcode = 'check_violation', constraint = 'late_fee_void_without_payments';
  end if;
  return new;
end;
$$;

-- 2. Pago: préstamo bloqueado, COBRO sin reverso previo y del mismo autor ---------------------------
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
  -- El dinero del pago entra a la caja como un COBRO de entrada, del mismo importe y autor, que ningún
  -- reverso haya compensado ya (si no, el pago nacería imposible de reversar).
  select type, direction, amount, created_by into movement from public.cash_movements where id = new.movement_id;
  if movement.type is distinct from 'COBRO' or movement.direction is distinct from 'ENTRADA'
     or movement.amount is distinct from new.amount
     or movement.created_by is distinct from new.registered_by then
    raise exception 'El movimiento del pago debe ser un COBRO de entrada del mismo importe y autor'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cash_movements where reverses_movement_id = new.movement_id) then
    raise exception 'El COBRO del pago ya fue reversado' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 3. Aplicación cronológica (02 §3.2, regla 5) y topes, con el préstamo bloqueado --------------------
-- Con lo aplicado por pagos vigentes, las cuotas del préstamo deben quedar en prefijo: completas…, a lo
-- sumo una parcial y el resto en cero; y dentro de un pago, la posición crece con el número de cuota.
create or replace function private.check_payment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_payment uuid :=
    (case when tg_table_name = 'payments' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'payment_id' end)::uuid;
  target_loan uuid;
  applied bigint;
  expected bigint;
  overpaid boolean;
  out_of_order boolean;
begin
  select amount, loan_id into expected, target_loan from public.payments where id = target_payment;
  perform 1 from public.loans where id = target_loan for no key update;

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

  select exists (
           select 1
             from public.installments earlier
             join public.installments later on later.loan_id = earlier.loan_id and later.number > earlier.number
            where earlier.loan_id = target_loan
              and private.installment_applied(earlier.id) < earlier.amount
              and private.installment_applied(later.id) > 0
         ) or exists (
           select 1
             from public.payment_applications a1
             join public.installments i1 on i1.id = a1.installment_id
             join public.payment_applications a2 on a2.payment_id = a1.payment_id and a2.position > a1.position
             join public.installments i2 on i2.id = a2.installment_id
            where a1.payment_id = target_payment and i1.number > i2.number
         )
    into out_of_order;
  if out_of_order then
    raise exception 'Los pagos se aplican a la cuota pendiente más antigua primero, en orden cronológico'
      using errcode = 'check_violation', constraint = 'payment_chronological';
  end if;
  return null;
end;
$$;

-- 4. Reverso de pago: préstamo ACTIVO y bloqueado, solo el último pago ------------------------------
create or replace function private.check_payment_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target record;
  loan_status text;
  reversal record;
begin
  select loan_id, seq, movement_id into target from public.payments where id = new.payment_id;
  select status into loan_status from public.loans where id = target.loan_id for no key update;
  if loan_status is distinct from 'ACTIVO' then
    raise exception 'Solo se reversan pagos de un préstamo ACTIVO' using errcode = 'check_violation';
  end if;
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

-- Un REVERSO de caja sobre el COBRO de un pago exige que el pago quede reversado en la misma transacción
-- (si no, la caja estaría compensada y el pago seguiría vigente).
create or replace function private.check_payment_cash_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  paid uuid;
begin
  select id into paid from public.payments where movement_id = new.reverses_movement_id;
  if paid is not null and not exists (
    select 1 from public.payment_reversals where payment_id = paid and movement_id = new.id
  ) then
    raise exception 'El reverso del cobro de un pago debe registrarse como reverso del pago'
      using errcode = 'check_violation', constraint = 'payment_cash_reversal_linked';
  end if;
  return null;
end;
$$;

create constraint trigger cash_movements_payment_reversal_linked
  after insert on public.cash_movements
  deferrable initially deferred
  for each row
  when (new.type = 'REVERSO')
  execute function private.check_payment_cash_reversal();

-- 5. Refinanciación -----------------------------------------------------------------------------------
-- Un préstamo solo pasa a REFINANCIADO con su fila en `refinancings`; un préstamo con `previous_loan_id`
-- exige esa fila; el anterior es del mismo cliente y el nuevo está ACTIVO; y el desembolso adicional (si lo
-- hay) existe como movimiento propio por el monto adicional (02 §3.5).
create unique index loans_previous_loan_key on public.loans (previous_loan_id) where previous_loan_id is not null;

create or replace function private.check_refinancing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_status text;
  pending bigint;
  fees bigint;
  new_loan record;
  previous_client uuid;
  new_client uuid;
begin
  select status into previous_status from public.loans where id = new.previous_loan_id for no key update;
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

  select principal_amount, previous_loan_id, status, contract_id into new_loan
    from public.loans where id = new.new_loan_id;
  if new_loan.principal_amount <> new.refinanced_balance + new.additional_amount
     or new_loan.previous_loan_id is distinct from new.previous_loan_id then
    raise exception 'El nuevo préstamo debe tener como principal el saldo refinanciado más el monto adicional y referenciar al anterior'
      using errcode = 'check_violation', constraint = 'refinancing_new_loan_matches';
  end if;
  if new_loan.status <> 'ACTIVO' then
    raise exception 'El nuevo préstamo de una refinanciación debe estar ACTIVO' using errcode = 'check_violation';
  end if;

  select k.client_id into previous_client
    from public.loans l join public.contracts k on k.id = l.contract_id where l.id = new.previous_loan_id;
  select k.client_id into new_client from public.contracts k where k.id = new_loan.contract_id;
  if previous_client is distinct from new_client then
    raise exception 'La refinanciación es del mismo cliente' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function private.check_refinancing_committed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_previous uuid;
  target_new uuid;
  additional bigint;
  disbursed bigint;
begin
  if tg_table_name = 'refinancings' then
    target_previous := new.previous_loan_id;
    target_new := new.new_loan_id;
    additional := new.additional_amount;

    if (select status from public.loans where id = target_previous) is distinct from 'REFINANCIADO' then
      raise exception 'El préstamo refinanciado debe quedar en estado REFINANCIADO'
        using errcode = 'check_violation', constraint = 'refinanced_loan_status';
    end if;
    -- El desembolso adicional existe como movimiento propio, y sin adicional no se desembolsa nada.
    select coalesce(sum(amount), 0) into disbursed
      from public.cash_movements
     where type = 'DESEMBOLSO_PRESTAMO' and reference_type = 'loan' and reference_id = target_new;
    if disbursed <> additional then
      raise exception 'El desembolso del nuevo préstamo debe ser exactamente el monto adicional'
        using errcode = 'check_violation', constraint = 'refinancing_additional_disbursed';
    end if;
  elsif tg_table_name = 'loans' then
    -- Un préstamo REFINANCIADO, o con préstamo anterior, tiene su refinanciación.
    if new.status = 'REFINANCIADO' and not exists (
      select 1 from public.refinancings where previous_loan_id = new.id
    ) then
      raise exception 'Un préstamo solo pasa a REFINANCIADO mediante una refinanciación'
        using errcode = 'check_violation', constraint = 'refinanced_loan_has_refinancing';
    end if;
    if new.previous_loan_id is not null and not exists (
      select 1 from public.refinancings where new_loan_id = new.id and previous_loan_id = new.previous_loan_id
    ) then
      raise exception 'Un préstamo con préstamo anterior exige su refinanciación'
        using errcode = 'check_violation', constraint = 'loan_previous_has_refinancing';
    end if;
  end if;
  return null;
end;
$$;

drop trigger refinancings_previous_refinanced on public.refinancings;
create constraint trigger refinancings_committed
  after insert on public.refinancings
  deferrable initially deferred
  for each row execute function private.check_refinancing_committed();

create constraint trigger loans_refinancing_committed
  after insert or update on public.loans
  deferrable initially deferred
  for each row
  when (new.status = 'REFINANCIADO' or new.previous_loan_id is not null)
  execute function private.check_refinancing_committed();

drop function private.check_refinanced_loan_status();
