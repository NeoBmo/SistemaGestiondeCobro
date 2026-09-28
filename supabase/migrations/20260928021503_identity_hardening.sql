-- Endurecimiento de identidad (F1-T1), a raíz de la revisión independiente del esquema y la RLS.
-- Las migraciones anteriores ya estaban aplicadas en local, por eso los cambios van en una nueva.

-- 1. Privilegios mínimos por defecto -------------------------------------------------------------
-- Supabase concede ALL a anon/authenticated/service_role en toda tabla nueva de `public`, y
-- EXECUTE a PUBLIC en toda función nueva. Se invierte: lo nuevo nace sin acceso y cada migración
-- concede explícitamente lo que necesita (normalmente SELECT a `authenticated` con RLS).
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- Tablas ya creadas: `authenticated` solo lee (sin REFERENCES/TRIGGER); ningún rol de la API
-- escribe (la escritura sale por la conexión de la aplicación, regla 9), tampoco service_role.
revoke all on public.plans, public.businesses, public.profiles, public.subscriptions, public.audit_events
  from authenticated;
grant select on public.plans, public.businesses, public.profiles, public.subscriptions, public.audit_events
  to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.plans, public.businesses, public.profiles, public.subscriptions, public.audit_events
  from service_role;

revoke all on function private.is_valid_time_zone(text) from public;

-- 2. Políticas: los cobradores no leen la fila del negocio (lleva datos del responsable) y los
--    helpers se envuelven en (select …) para que Postgres los evalúe una vez por consulta. ------
alter policy businesses_select on public.businesses
  using (
    (select private.jwt_role()) = 'SUPER_ADMIN'
    or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and id = (select private.jwt_business_id()))
  );

alter policy profiles_select_self on public.profiles
  using (id = (select auth.uid()));

alter policy profiles_select_business_admin on public.profiles
  using (
    (select private.jwt_role()) = 'ADMIN_NEGOCIO'
    and business_id = (select private.jwt_business_id())
  );

alter policy profiles_select_super_admin on public.profiles
  using ((select private.jwt_role()) = 'SUPER_ADMIN');

alter policy subscriptions_select on public.subscriptions
  using (
    (select private.jwt_role()) = 'SUPER_ADMIN'
    or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
  );

alter policy audit_events_select on public.audit_events
  using (
    (select private.jwt_role()) = 'SUPER_ADMIN'
    or ((select private.jwt_role()) = 'ADMIN_NEGOCIO' and business_id = (select private.jwt_business_id()))
  );

-- 3. La identidad de un perfil no cambia ------------------------------------------------------
-- 02 §1.4/§9.2: un usuario pertenece a un único negocio. Además el JWT lleva rol y negocio
-- congelados hasta el refresco, y el nombre de usuario respalda el email sintético de Auth.
create or replace function private.forbid_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.business_id is distinct from old.business_id
     or new.username is distinct from old.username then
    raise exception 'El id, el rol, el negocio y el nombre de usuario de un perfil no se pueden cambiar'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_identity_immutable
  before update on public.profiles
  for each row execute function private.forbid_profile_identity_change();

-- 4. Coherencia negocio ↔ suscripción (ADR 0003) -----------------------------------------------
-- Acceso ACTIVO ⇔ suscripción ACTIVA. Se comprueba al confirmar la transacción (diferido) para
-- que un comando pueda cambiar ambas filas; un negocio sin suscripción todavía no se valida.
create or replace function private.check_business_subscription_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_business uuid :=
    (case when tg_table_name = 'businesses' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'business_id' end)::uuid;
  business_status text;
  subscription_status text;
begin
  select b.access_status, s.status
    into business_status, subscription_status
    from public.businesses b
    join public.subscriptions s on s.business_id = b.id
   where b.id = target_business;

  if found and ((business_status = 'ACTIVO') <> (subscription_status = 'ACTIVA')) then
    raise exception 'El negocio % con acceso % es incoherente con su suscripción %',
      target_business, business_status, subscription_status
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger businesses_subscription_consistent
  after insert or update on public.businesses
  deferrable initially deferred
  for each row execute function private.check_business_subscription_consistency();

create constraint trigger subscriptions_business_consistent
  after insert or update on public.subscriptions
  deferrable initially deferred
  for each row execute function private.check_business_subscription_consistency();
