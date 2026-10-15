-- Seed de volumen para medir las consultas del dashboard y la cartera (F6). SOLO base local de desarrollo:
-- crea un negocio «Volumen» con ~3.000 clientes, ~3.000 préstamos de 12 cuotas diarias (~36.000 cuotas) y
-- ~21.600 pagos con sus aplicaciones, repartidos en los últimos 60 días. Se carga sin disparadores
-- (`session_replication_role = replica`) para ir rápido: los datos son coherentes por construcción, no por
-- las barreras de BD. Se borra con scripts/perf/clean-volume.sql.
--
--   docker exec -i supabase_db_SistemaGestiondeCobro psql -U postgres < scripts/perf/seed-volume.sql

begin;
set local session_replication_role = replica;

do $$
declare
  biz uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  box uuid := gen_random_uuid();
  base_date date := current_date - 40;
begin
  insert into auth.users (id, email) values (admin, 'volumen-admin@test.invalid');
  insert into public.businesses (id, name, owner_name, owner_identification, phone)
    values (biz, 'Volumen', 'Dueño', '1', '3000000000');
  insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
    values (biz, 'MENSUAL', current_date - 5, current_date + 25);
  insert into public.profiles (id, business_id, role, username, display_name, status)
    values (admin, biz, 'ADMIN_NEGOCIO', 'volumen.admin', 'Admin Volumen', 'ACTIVO');
  insert into public.main_cashboxes (id, business_id) values (box, biz);
  insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by)
    values (biz, box, 'INGRESO_CAPITAL', 'ENTRADA', 5000000000, admin);

  -- Clientes, contratos y préstamos.
  insert into public.clients (id, business_id, name, identification, created_by)
    select gen_random_uuid(), biz, 'Cliente ' || n, 'V' || n, admin from generate_series(1, 3000) n;

  create temp table seed_loans on commit drop as
    select row_number() over (order by c.identification) as n, c.id as client_id,
           gen_random_uuid() as contract_id, gen_random_uuid() as loan_id
      from public.clients c where c.business_id = biz;

  insert into public.contracts (id, business_id, client_id, number, origin, created_by)
    select contract_id, biz, client_id, 'CT-' || lpad(n::text, 6, '0'), 'NUEVO', admin from seed_loans;

  insert into public.loans (id, business_id, contract_id, principal_amount, interest_bps, interest_amount,
                            total_amount, scheduled_amount, disbursed_on, first_due_on, frequency,
                            installment_count, created_by)
    select loan_id, biz, contract_id, 120000, 0, 0, 120000, 120000, base_date, base_date + 1 + ((n % 20)::int),
           'DIARIA', 12, admin from seed_loans;

  insert into public.installments (business_id, loan_id, number, due_on, amount)
    select biz, s.loan_id, k, base_date + 1 + ((s.n % 20)::int) + (k - 1), 10000
      from seed_loans s, generate_series(1, 12) k;

  -- Pagos: cada cuota vencida (hasta hoy) de ~60 % de los préstamos se paga, un pago por cuota.
  create temp table seed_pay on commit drop as
    select gen_random_uuid() as payment_id, gen_random_uuid() as movement_id, i.loan_id, i.id as installment_id,
           i.due_on, row_number() over (order by i.loan_id, i.number) as seq
      from public.installments i
      join seed_loans s on s.loan_id = i.loan_id
     where i.business_id = biz and i.due_on <= current_date and s.n % 10 < 6;

  insert into public.cash_movements (id, business_id, cashbox_id, type, direction, amount, created_by, created_at)
    select movement_id, biz, box, 'COBRO', 'ENTRADA', 10000, admin,
           (due_on + time '15:00') at time zone 'America/Bogota' from seed_pay;
  insert into public.payments (id, business_id, loan_id, kind, amount, movement_id, registered_by, created_at)
    select payment_id, biz, loan_id, 'CUOTAS', 10000, movement_id, admin,
           (due_on + time '15:00') at time zone 'America/Bogota' from seed_pay;
  insert into public.payment_applications (business_id, payment_id, installment_id, amount, position)
    select biz, payment_id, installment_id, 10000, 1 from seed_pay;

  -- Gastos de Caja Mayor en el periodo.
  insert into public.cash_movements (business_id, cashbox_id, type, direction, amount, created_by, created_at)
    select biz, box, 'GASTO_CAJA_MAYOR', 'SALIDA', 5000, admin, now() - (g || ' hours')::interval
      from generate_series(1, 400) g;
end
$$;

commit;
analyze;
