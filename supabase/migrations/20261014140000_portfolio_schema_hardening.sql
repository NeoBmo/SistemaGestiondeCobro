-- Endurecimiento del esquema de cartera (F3-T2), a raíz de la revisión independiente. Va en una
-- migración nueva porque las anteriores ya estaban aplicadas en local.

-- 1. Identificación normalizada ------------------------------------------------------------------
-- '123' y '123 ' no pueden coexistir en un mismo negocio: el comando recorta y la base lo exige.
alter table public.clients
  add constraint clients_identification_trimmed check (identification = btrim(identification));

-- 2. TRUNCATE de clientes -------------------------------------------------------------------------
create or replace function private.forbid_client_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Un cliente no se elimina (02 §2.1)' using errcode = 'restrict_violation';
end;
$$;

create trigger clients_forbid_truncate
  before truncate on public.clients
  for each statement execute function private.forbid_client_truncate();

-- 3. Número de contrato ----------------------------------------------------------------------------
-- Siguiente número del negocio (03 §7): el UPSERT bloquea la fila del contador hasta el final de la
-- transacción que lo pidió, así que dos confirmaciones simultáneas se serializan, y si la
-- transacción se revierte el número no se consume (sin huecos). Se llama dentro de la transacción
-- que inserta el contrato.
create or replace function private.next_contract_number(target_business uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  assigned bigint;
begin
  insert into public.contract_counters as c (business_id, last_number)
  values (target_business, 1)
  on conflict (business_id) do update set last_number = c.last_number + 1
  returning c.last_number into assigned;
  return 'CT-' || lpad(assigned::text, 6, '0');
end;
$$;

-- 4. El interés guardado es el que da la fórmula de 02 §2.4 ----------------------------------------
-- redondeo half-up(principal × bps / 10000) en aritmética exacta (numeric: sin desbordar bigint).
alter table public.loans
  add constraint loans_interest_formula check (
    interest_amount::numeric = floor((principal_amount::numeric * interest_bps * 2 + 10000) / 20000)
  );

-- 5. Coherencia contrato ↔ préstamo -----------------------------------------------------------------
-- Un préstamo solo nace de un contrato CONFIRMADO, y ambos se anulan juntos (02 §2.2).
create or replace function private.check_loan_contract_confirmed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  contract_status text;
begin
  select status into contract_status from public.contracts where id = new.contract_id;
  if contract_status is distinct from 'CONFIRMADO' then
    raise exception 'Un préstamo solo se crea sobre un contrato CONFIRMADO' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger loans_contract_confirmed
  before insert on public.loans
  for each row execute function private.check_loan_contract_confirmed();

create or replace function private.check_contract_loan_voided_together()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_contract uuid :=
    (case when tg_table_name = 'contracts' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'contract_id' end)::uuid;
  mismatched boolean;
begin
  select (c.status = 'ANULADO') <> (l.status = 'ANULADO') into mismatched
    from public.contracts c join public.loans l on l.contract_id = c.id
   where c.id = target_contract;
  if coalesce(mismatched, false) then
    raise exception 'El contrato y su préstamo se anulan juntos (02 §2.2)'
      using errcode = 'check_violation', constraint = 'contract_loan_voided_together';
  end if;
  return null;
end;
$$;

create constraint trigger contracts_loan_voided_together
  after update on public.contracts
  deferrable initially deferred
  for each row execute function private.check_contract_loan_voided_together();

create constraint trigger loans_contract_voided_together
  after update on public.loans
  deferrable initially deferred
  for each row execute function private.check_contract_loan_voided_together();

-- 6. La anulación: fecha propia y tolerancia a UPDATE vacíos -----------------------------------------
create or replace function private.check_contract_void_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) = to_jsonb(old) then
    return new; -- un UPDATE que no cambia nada se tolera, como en make_append_only
  end if;
  if old.status = 'ANULADO' then
    raise exception 'Un contrato anulado no cambia más' using errcode = 'restrict_violation';
  end if;
  if new.status <> 'ANULADO' then
    raise exception 'Un contrato confirmado solo puede pasar a ANULADO' using errcode = 'restrict_violation';
  end if;
  new.voided_at := now(); -- la fecha de la anulación la pone la base, no el llamador
  return new;
end;
$$;

-- 7. El calendario es cronológico y empieza donde dice el préstamo ----------------------------------
-- La aplicación de pagos (02 §3.2) depende de este orden: el número crece con la fecha, y la
-- primera cuota vence en la primera fecha de cobro.
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
  out_of_order integer;
  first_due date;
begin
  select scheduled_amount, installment_count, first_due_on
    into expected from public.loans where id = target_loan;
  select coalesce(sum(amount), 0) as total, count(*) as n,
         coalesce(max(number), 0) as last_number
    into actual from public.installments where loan_id = target_loan;
  if actual.total <> expected.scheduled_amount
     or actual.n <> expected.installment_count
     or actual.last_number <> expected.installment_count then
    raise exception 'Las cuotas del préstamo no coinciden con su calendario (suma, cantidad y numeración)'
      using errcode = 'check_violation', constraint = 'loan_schedule_consistent';
  end if;

  select count(*) into out_of_order
    from (
      select due_on, lag(due_on) over (order by number) as previous_due
        from public.installments where loan_id = target_loan
    ) ordered
   where previous_due is not null and due_on <= previous_due;
  select due_on into first_due from public.installments where loan_id = target_loan and number = 1;
  if out_of_order > 0 or first_due is distinct from expected.first_due_on then
    raise exception 'Las fechas de las cuotas deben crecer con su número y la primera debe vencer en la primera fecha de cobro'
      using errcode = 'check_violation', constraint = 'loan_schedule_chronological';
  end if;
  return null;
end;
$$;
