-- Endurecimiento de jornadas y liquidación (F5-T4, revisión). Corrige regresiones y huecos de la migración
-- anterior sin editarla (ya aplicada).

-- 1. Saldo nunca negativo: restaurar el bloqueo de la caja (regresión) y bloquear la jornada ----------
-- Sin bloqueo, dos transacciones concurrentes suman sin verse (READ COMMITTED) y dejan la caja negativa.
-- La Mayor se bloquea por la fila de su caja; la Menor, por la fila de su jornada (que el movimiento ya
-- toma al insertarse, ver §2). Los bloqueos son del mismo nivel (NO KEY UPDATE), así que no hay mejora
-- de bloqueo entre dos transacciones que cause un interbloqueo.
create or replace function private.check_cashbox_balance_not_negative()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  balance bigint;
begin
  if new.session_id is null then
    perform 1 from public.main_cashboxes where id = new.cashbox_id for no key update;
  else
    perform 1 from public.cash_sessions where id = new.session_id for no key update;
  end if;
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

-- 2. Estado de la jornada: FOR NO KEY UPDATE (dos FOR SHARE no se excluyen) y mismo negocio -----------
create or replace function private.check_session_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_status text;
  target_session uuid := coalesce(new.session_id, case when new.reference_type = 'session' then new.reference_id end);
begin
  if new.session_id is null then
    if new.type in ('FONDO_OPERATIVO', 'LIQUIDACION') and (new.reference_type is distinct from 'session') then
      raise exception 'El fondo y la liquidación de la Caja Mayor referencian su jornada' using errcode = 'check_violation';
    end if;
    if new.type not in ('FONDO_OPERATIVO', 'LIQUIDACION') then
      return new;
    end if;
  end if;

  select status into session_status from public.cash_sessions
   where id = target_session and business_id = new.business_id for no key update;
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
  if new.session_id is not null and new.type in ('FONDO_OPERATIVO', 'LIQUIDACION')
     and (new.reference_type is distinct from 'session' or new.reference_id is distinct from new.session_id) then
    raise exception 'El fondo y la liquidación referencian su jornada' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- El espejo solo cuenta movimientos del mismo negocio.
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
   where business_id = new.business_id and type = new.type and session_id is null
     and reference_type = 'session' and reference_id = target_session;
  select coalesce(sum(amount), 0) into menor from public.cash_movements
   where business_id = new.business_id and type = new.type and session_id = target_session;
  if mayor <> menor then
    raise exception 'El % de la Caja Mayor y el de la jornada deben coincidir', lower(new.type)
      using errcode = 'check_violation', constraint = 'session_mirror';
  end if;
  return null;
end;
$$;

-- 3. Reversos: no se reversan los espejos ni la diferencia; una jornada ya liquidada se corrige en la Mayor
-- Reversar el fondo de la Mayor crearía dinero (la Menor lo conserva) y reversar la liquidación lo destruiría.
-- ADR 0009: un cobro de una jornada ya liquidada se corrige con un REVERSO de la Caja Mayor (la jornada no se
-- reabre); mientras la jornada esté ABIERTA o PENDIENTE el reverso va en la misma jornada.
create or replace function private.check_cash_reversal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original public.cash_movements;
  original_session_status text;
begin
  if new.type <> 'REVERSO' then
    return new;
  end if;
  select * into original from public.cash_movements where id = new.reverses_movement_id;
  if original.type = 'REVERSO' then
    raise exception 'Un reverso no se puede reversar' using errcode = 'check_violation';
  end if;
  if original.type in ('FONDO_OPERATIVO', 'LIQUIDACION', 'DIFERENCIA_CAJA') then
    raise exception 'El fondo, la liquidación y la diferencia de caja no se reversan: se corrigen con un ajuste'
      using errcode = 'check_violation';
  end if;
  if original.cashbox_id <> new.cashbox_id
     or original.amount <> new.amount
     or original.direction = new.direction then
    raise exception 'Un reverso debe anular por completo el movimiento original (mismo importe, dirección contraria, misma caja)'
      using errcode = 'check_violation';
  end if;
  if original.session_id is distinct from new.session_id then
    -- Solo un COBRO de una jornada ya liquidada se corrige desde la Caja Mayor.
    select status into original_session_status from public.cash_sessions where id = original.session_id;
    if not (new.session_id is null and original.type = 'COBRO'
            and original_session_status in ('LIQUIDADA', 'LIQUIDADA_CON_DIFERENCIA')) then
      raise exception 'Un reverso debe estar en la misma caja que el original (salvo un cobro de una jornada ya liquidada, que se corrige en la Caja Mayor)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- 4. Un cobrador siempre cobra dentro de una jornada ------------------------------------------------
-- Un perfil que es cobrador no puede registrar un COBRO en la Caja Mayor (saltaría la verificación de su
-- cartera): su cobro entra a su jornada.
create or replace function private.check_collector_payment_in_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  movement_session uuid;
begin
  select session_id into movement_session from public.cash_movements where id = new.movement_id;
  if movement_session is null
     and exists (select 1 from public.collectors where user_id = new.registered_by) then
    raise exception 'Un cobrador registra sus cobros dentro de su jornada' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payments_collector_in_session
  before insert on public.payments
  for each row execute function private.check_collector_payment_in_session();

-- 5. El gasto describe exactamente su movimiento, también el del cobrador -------------------------------
create or replace function private.check_expense_matches_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked public.cash_movements;
begin
  select * into linked from public.cash_movements where id = new.movement_id;
  if linked.type is distinct from (case when new.session_id is null then 'GASTO_CAJA_MAYOR' else 'GASTO_COBRADOR' end)
     or linked.amount is distinct from new.amount
     or linked.cashbox_id is distinct from new.cashbox_id
     or linked.session_id is distinct from new.session_id then
    raise exception 'El gasto debe coincidir con su movimiento (tipo, importe, caja y jornada)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
