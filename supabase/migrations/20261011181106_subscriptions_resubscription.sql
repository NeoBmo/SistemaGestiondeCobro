-- Re-suscripción (F1-T4). Fuente: ADR 0005 y 02-DOMINIO §1.3.
-- Un negocio archivado puede volver con una suscripción NUEVA; la fila ARCHIVADA no se reactiva ni se
-- modifica y queda como historial. Por eso `business_id` deja de ser único y pasa a serlo solo entre
-- las suscripciones vigentes (las no archivadas).

alter table public.subscriptions drop constraint subscriptions_business_id_key;

create unique index subscriptions_one_current_per_business
  on public.subscriptions (business_id)
  where status <> 'ARCHIVADA';

-- Las consultas por negocio ahora devuelven varias filas (historial): índice para listarlas.
create index subscriptions_business_id_idx on public.subscriptions (business_id, created_at desc);

-- Coherencia negocio ↔ suscripción (ADR 0003, ajustada por ADR 0005): se compara contra la
-- suscripción VIGENTE; las ARCHIVADA se ignoran (con varias filas un join sin filtro compararía contra
-- una arbitraria).
--   · hay vigente        → negocio ACTIVO ⇔ vigente ACTIVA
--   · solo hay archivadas → el negocio debe estar SUSPENDIDO
--   · sin ninguna fila    → no se valida (el negocio aún no tiene suscripción dentro de su transacción)
create or replace function private.check_business_subscription_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_business uuid :=
    (case when tg_table_name = 'businesses' then to_jsonb(new) ->> 'id' else to_jsonb(new) ->> 'business_id' end)::uuid;
  business_status text;
  current_status text;
  has_archived boolean;
begin
  select b.access_status into business_status from public.businesses b where b.id = target_business;
  if not found then
    return null;
  end if;

  select s.status into current_status
    from public.subscriptions s
   where s.business_id = target_business and s.status <> 'ARCHIVADA';

  if found then
    if (business_status = 'ACTIVO') <> (current_status = 'ACTIVA') then
      raise exception 'El negocio % con acceso % es incoherente con su suscripción %',
        target_business, business_status, current_status
        using errcode = 'check_violation';
    end if;
    return null;
  end if;

  select exists (
    select 1 from public.subscriptions s where s.business_id = target_business and s.status = 'ARCHIVADA'
  ) into has_archived;

  if has_archived and business_status <> 'SUSPENDIDO' then
    raise exception 'El negocio % está archivado (sin suscripción vigente) pero su acceso es %',
      target_business, business_status
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
