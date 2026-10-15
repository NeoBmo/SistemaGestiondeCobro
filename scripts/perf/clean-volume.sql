-- Borra el negocio «Volumen» del seed de volumen (solo base local de desarrollo).
begin;
set local session_replication_role = replica;
delete from public.payment_applications where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.payments where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.installments where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.loans where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.contracts where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.clients where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.cash_movements where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.main_cashboxes where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.subscriptions where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.audit_events where business_id in (select id from public.businesses where name = 'Volumen');
delete from public.profiles where username = 'volumen.admin';
delete from auth.users where email = 'volumen-admin@test.invalid';
delete from public.businesses where name = 'Volumen';
commit;
