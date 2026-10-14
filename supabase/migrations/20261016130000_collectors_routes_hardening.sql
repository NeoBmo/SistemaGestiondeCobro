-- Endurecimiento de cobradores, rutas y asignaciones (F5-T2, revisión). Corrige carreras y huecos de la
-- migración anterior sin editarla (ya aplicada).

-- 1. Carreras entre asignar/crear ruta y cerrar/desactivar ------------------------------------------
-- Las claves foráneas solo toman KEY SHARE, que no impide un UPDATE de `status`: sin bloqueo, una
-- asignación nueva podía colarse junto a un cierre de ruta (o una ruta junto a una desactivación) y dejar
-- un cobrador o ruta inactivos con hijos activos. `FOR SHARE` los serializa: el UPDATE de estado espera
-- a la inserción (y su trigger, con una instantánea nueva, ve la fila nueva) o la inserción espera al
-- cierre y lo ve (READ COMMITTED; la garantía depende de ese nivel, que es el de la aplicación).
create or replace function private.check_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  route_status text;
  collector_status text;
begin
  select status into route_status from public.routes where id = new.route_id for share;
  select status into collector_status from public.collectors where id = new.collector_id for share;
  if route_status is distinct from 'ACTIVA' then
    raise exception 'Solo se asigna a una ruta ACTIVA' using errcode = 'check_violation';
  end if;
  if collector_status is distinct from 'ACTIVO' then
    raise exception 'Solo se asigna a un cobrador ACTIVO' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Una ruta nueva exige un cobrador ACTIVO (antes se podía crear sobre uno inactivo).
create or replace function private.check_route_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  collector_status text;
begin
  select status into collector_status from public.collectors where id = new.collector_id for share;
  if collector_status is distinct from 'ACTIVO' then
    raise exception 'Solo se crea una ruta para un cobrador ACTIVO' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger routes_valid
  before insert on public.routes
  for each row execute function private.check_route_insert();

-- 2. Las fechas de cierre son hechos: no se reescriben --------------------------------------------
create or replace function private.check_close_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  closed_column timestamptz;
  old_closed timestamptz;
  opened_at timestamptz;
begin
  if tg_table_name = 'routes' then
    closed_column := new.closed_at; old_closed := old.closed_at; opened_at := old.created_at;
  else
    closed_column := new.ended_at; old_closed := old.ended_at; opened_at := old.started_at;
  end if;

  if old.status = 'CERRADA' then
    if new.status <> 'CERRADA' then
      raise exception 'Una % cerrada no se reabre', case tg_table_name when 'routes' then 'ruta' else 'asignación' end
        using errcode = 'restrict_violation';
    end if;
    if closed_column is distinct from old_closed then
      raise exception 'La fecha de cierre no se modifica' using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if new.status = 'CERRADA' then
    if closed_column < opened_at then
      raise exception 'El cierre no puede ser anterior al inicio' using errcode = 'check_violation';
    end if;
    if tg_table_name = 'routes'
       and exists (select 1 from public.client_assignments where route_id = new.id and status = 'ACTIVA') then
      raise exception 'La ruta aún tiene clientes asignados: reasígnalos antes de cerrarla'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger routes_close_transition on public.routes;
drop trigger client_assignments_close_transition on public.client_assignments;
create trigger routes_close_transition
  before update on public.routes
  for each row execute function private.check_close_transition();
create trigger client_assignments_close_transition
  before update on public.client_assignments
  for each row execute function private.check_close_transition();

-- 3. El cobrador pierde acceso al cliente al cerrarse la asignación (ADR 0009) ----------------------
drop policy client_assignments_select on public.client_assignments;
create policy client_assignments_select on public.client_assignments
  for select to authenticated
  using (
    (select private.is_session_active())
    and business_id = (select private.jwt_business_id())
    and (
      (select private.jwt_role()) = 'ADMIN_NEGOCIO'
      or ((select private.jwt_role()) = 'COBRADOR'
          and status = 'ACTIVA'
          and collector_id in (select id from public.collectors where user_id = (select auth.uid())))
    )
  );

-- 4. Sin suscripción no hay tope: se rechaza (falla cerrado) ---------------------------------------
create or replace function private.check_collector()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  user_role text;
  plan text;
  max_active integer;
  active_count integer;
begin
  if tg_op = 'INSERT' then
    select role into user_role from public.profiles where id = new.user_id;
    if user_role is distinct from 'COBRADOR' then
      raise exception 'Solo un usuario con rol COBRADOR puede ser cobrador' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'ACTIVO' and (tg_op = 'INSERT' or old.status <> 'ACTIVO') then
    perform 1 from public.businesses where id = new.business_id for no key update;
    select s.plan_code, p.max_active_collectors into plan, max_active
      from public.subscriptions s join public.plans p on p.code = s.plan_code
     where s.business_id = new.business_id;
    if plan is null then
      raise exception 'El negocio no tiene suscripción: no se puede activar un cobrador' using errcode = 'check_violation';
    end if;
    if max_active is not null then
      select count(*) into active_count
        from public.collectors where business_id = new.business_id and status = 'ACTIVO' and id <> new.id;
      if active_count + 1 > max_active then
        raise exception 'El plan del negocio no admite más cobradores activos (máximo %)', max_active
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
