-- Endurecimiento del libro de Caja Mayor (F2-T1), a raíz de la revisión independiente de la migración
-- anterior. Va en una migración nueva porque la anterior ya estaba aplicada en local.

-- 1. El saldo no negativo resiste transacciones concurrentes -------------------------------------
-- La barrera diferida sumaba al confirmar sin bloquear: en READ COMMITTED dos transacciones que
-- insertan salidas a la vez podían ver cada una solo la suya y dejar el saldo negativo en conjunto.
-- Ahora toma primero un bloqueo sobre la fila de la caja (`FOR NO KEY UPDATE`, que no choca con el
-- `FOR KEY SHARE` que toma la clave foránea al insertar; `FOR UPDATE` sí provocaría interbloqueos) y
-- recién entonces suma: la sentencia posterior al bloqueo ve ya lo que confirmó la otra transacción.
create or replace function private.check_cashbox_balance_not_negative()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  balance bigint;
begin
  perform 1 from public.main_cashboxes where id = new.cashbox_id for no key update;

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

-- 2. Quien registra un movimiento pertenece al mismo negocio -------------------------------------
-- `created_by references profiles(id)` no ataba al autor con el negocio de la fila (02 §9.1).
alter table public.profiles add constraint profiles_id_business_key unique (id, business_id);

alter table public.cash_movements
  add constraint cash_movements_creator_business_fk
  foreign key (created_by, business_id) references public.profiles (id, business_id);

alter table public.expenses
  add constraint expenses_creator_business_fk
  foreign key (created_by, business_id) references public.profiles (id, business_id);

-- 3. Un gasto describe exactamente su movimiento ---------------------------------------------------
-- Si no, el gasto y el libro podrían divergir (un gasto apuntando a un ingreso, o con otro importe).
create or replace function private.check_expense_matches_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked public.cash_movements;
begin
  select * into linked from public.cash_movements where id = new.movement_id;
  if linked.type is distinct from 'GASTO_CAJA_MAYOR'
     or linked.amount is distinct from new.amount
     or linked.cashbox_id is distinct from new.cashbox_id then
    raise exception 'El gasto debe coincidir con su movimiento GASTO_CAJA_MAYOR (mismo importe y misma caja)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger expenses_match_movement
  before insert on public.expenses
  for each row execute function private.check_expense_matches_movement();

-- 4. El resultado de una clave de idempotencia se fija una sola vez --------------------------------
create or replace function private.forbid_idempotency_result_overwrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.result is not null then
    raise exception 'El resultado de una clave de idempotencia no se puede sobrescribir'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger idempotency_keys_result_once
  before update on public.idempotency_keys
  for each row execute function private.forbid_idempotency_result_overwrite();

-- Las funciones nuevas de `private` ya nacen sin EXECUTE para los roles de la API (endurecimiento F1).
