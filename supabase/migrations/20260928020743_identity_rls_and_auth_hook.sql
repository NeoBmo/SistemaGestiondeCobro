-- Políticas RLS de identidad y hook de Auth (F1-T1).
-- Fuentes: 03-ARQUITECTURA §4 (RLS por negocio y rol; business_id y role en el JWT) y ADR 0003.
-- Claims propios: `app_role` y `business_id` (el claim `role` de Supabase es 'authenticated' y no se toca).

-- Helpers que leen los claims del JWT ya validado por Supabase -----------------------------------
create or replace function private.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'app_role', '')
$$;

create or replace function private.jwt_business_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'business_id', '')::uuid
$$;

-- Las políticas se evalúan con el rol que consulta: necesita ejecutar los helpers.
grant usage on schema private to authenticated;
revoke all on function private.jwt_role() from public, anon;
revoke all on function private.jwt_business_id() from public, anon;
grant execute on function private.jwt_role() to authenticated;
grant execute on function private.jwt_business_id() to authenticated;

-- Políticas (solo SELECT: las escrituras no salen por la API de datos) ---------------------------
create policy plans_select on public.plans
  for select to authenticated
  using (true);

create policy businesses_select on public.businesses
  for select to authenticated
  using (private.jwt_role() = 'SUPER_ADMIN' or id = private.jwt_business_id());

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_business_admin on public.profiles
  for select to authenticated
  using (private.jwt_role() = 'ADMIN_NEGOCIO' and business_id = private.jwt_business_id());

create policy profiles_select_super_admin on public.profiles
  for select to authenticated
  using (private.jwt_role() = 'SUPER_ADMIN');

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (
    private.jwt_role() = 'SUPER_ADMIN'
    or (private.jwt_role() = 'ADMIN_NEGOCIO' and business_id = private.jwt_business_id())
  );

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    private.jwt_role() = 'SUPER_ADMIN'
    or (private.jwt_role() = 'ADMIN_NEGOCIO' and business_id = private.jwt_business_id())
  );

-- Hook de token de acceso ------------------------------------------------------------------------
-- Se ejecuta al emitir y al refrescar cada token: añade `app_role` y `business_id`, y rechaza con
-- 403 a usuarios sin perfil, bloqueados o de un negocio suspendido. Así una suspensión corta las
-- sesiones en el siguiente refresco (además de la comprobación por petición en la aplicación).
-- SECURITY DEFINER: lee profiles/businesses sin depender de RLS.
create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_profile record;
  claims jsonb := event -> 'claims';
begin
  select p.role, p.business_id, p.status, b.access_status
    into user_profile
    from public.profiles p
    left join public.businesses b on b.id = p.business_id
   where p.id = (event ->> 'user_id')::uuid;

  if not found
     or user_profile.status = 'BLOQUEADO'
     or (user_profile.business_id is not null and user_profile.access_status <> 'ACTIVO') then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'Acceso no permitido')
    );
  end if;

  claims := jsonb_set(claims, '{app_role}', to_jsonb(user_profile.role));
  claims := jsonb_set(claims, '{business_id}', coalesce(to_jsonb(user_profile.business_id), 'null'::jsonb));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema private to supabase_auth_admin;
revoke all on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
