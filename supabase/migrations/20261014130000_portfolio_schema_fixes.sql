-- Correcciones de la migración de cartera (F3-T2), a raíz de sus propias pruebas. Va aparte porque la
-- anterior ya estaba aplicada en local.

-- 1. La comprobación del calendario falló al leer `new.loan_id` en `loans`: plpgsql resuelve los
--    campos del registro al ejecutar la sentencia, aunque la rama del CASE no se use. Se lee por JSON.
create or replace function private.check_loan_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_loan uuid :=
    (case when tg_table_name = 'loans' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'loan_id' end)::uuid;
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

-- 2. Un contrato anulado no vuelve a cambiar: la transición se comprobaba solo cuando cambiaba el
--    estado, así que el motivo de un contrato ya anulado se podía reescribir. Ahora se comprueba en
--    todo UPDATE.
drop trigger contracts_void_transition on public.contracts;

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
  for each row execute function private.check_contract_void_transition();
