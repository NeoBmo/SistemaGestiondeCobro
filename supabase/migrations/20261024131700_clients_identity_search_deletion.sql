-- Clientes: decisiones del 2026-10-24 (02-DOMINIO §2.1, protección de datos personales).
--   1. La unicidad de la identificación compara su forma normalizada (NFC, minúsculas, solo letras y
--      dígitos): `ABC-1`, `abc 1` y `abc1` son el mismo documento. Se guarda tal como se escribió.
--   2. La búsqueda por nombre, sobrenombre, identificación o teléfono ignora tildes y mayúsculas.
--   3. Un cliente sin ningún contrato (y por tanto sin préstamo) puede eliminarse.

-- 0. Extensiones -------------------------------------------------------------------------------------
-- `unaccent` quita las tildes; `pg_trgm` permite que un `LIKE '%texto%'` use un índice GIN. Ambas son
-- extensiones de confianza de Postgres incluidas en Supabase, en el schema `extensions`.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- 1. Normalizaciones -----------------------------------------------------------------------------------
-- IMMUTABLE para poder usarlas en columnas generadas e índices. `unaccent` es STABLE porque su
-- diccionario podría cambiar; aquí se fija el diccionario por nombre, y si alguien lo cambiara habría que
-- regenerar la columna. Nacen sin EXECUTE para PUBLIC (privilegios por defecto de F1).
-- La collation ICU fija qué es «letra o dígito» con las propiedades Unicode, sin depender de la locale
-- con la que se creó la base: con la collation C, `[:alnum:]` solo reconoce ASCII y borraría la ñ.
create function private.normalize_identification(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select regexp_replace(lower(normalize(value, NFC) collate "und-x-icu"), '[^[:alnum:]]', '', 'g')
$$;

create function private.normalize_search(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, normalize(value, NFC)))
$$;

-- 2. Unicidad normalizada ----------------------------------------------------------------------------
-- Antes de cambiar la restricción se comprueba que los datos existentes la cumplen. Si no, la migración
-- falla y los duplicados se corrigen a mano: nunca se fusionan ni se borran aquí. El mensaje lleva ids,
-- no la identificación, para no copiar datos personales a los registros de despliegue.
do $$
declare
  offenders text;
begin
  select string_agg(format('negocio %s: clientes %s', business_id, ids), '; ')
    into offenders
    from (
      select business_id, string_agg(id::text, ', ' order by id) as ids
        from public.clients
       group by business_id, private.normalize_identification(identification)
      having count(*) > 1
    ) duplicated;
  if offenders is not null then
    raise exception 'Hay clientes con la misma identificación normalizada en un mismo negocio (%). Corrígelos antes de aplicar esta migración.', offenders
      using errcode = 'unique_violation';
  end if;

  select string_agg(id::text, ', ' order by id)
    into offenders
    from public.clients
   where private.normalize_identification(identification) = '';
  if offenders is not null then
    raise exception 'Hay clientes cuya identificación no tiene ninguna letra ni dígito (%). Corrígelos antes de aplicar esta migración.', offenders
      using errcode = 'check_violation';
  end if;
end;
$$;

alter table public.clients
  add column identification_key text not null
    generated always as (private.normalize_identification(identification)) stored,
  add constraint clients_identification_key_not_empty check (identification_key <> '');

-- Se conserva el nombre de la restricción: el servicio traduce su violación a un 409.
alter table public.clients drop constraint clients_identification_key;
alter table public.clients
  add constraint clients_identification_key unique (business_id, identification_key);

-- 3. Búsqueda sin tildes ni mayúsculas ----------------------------------------------------------------
-- Una sola columna con los campos buscables separados por un carácter de control (U+001F) que la
-- búsqueda descarta, para que un término no coincida a caballo entre dos campos.
alter table public.clients
  add column search_text text not null
    generated always as (
      private.normalize_search(
        name || chr(31) || coalesce(nickname, '') || chr(31) || identification || chr(31)
          || coalesce(phone, '')
      )
    ) stored;

create index clients_search_text_trgm_idx
  on public.clients using gin (search_text extensions.gin_trgm_ops);

-- 4. Eliminación de un cliente sin historial ------------------------------------------------------------
-- Antes ningún cliente se eliminaba. Ahora sí, si no tiene ningún contrato (un préstamo siempre cuelga de
-- un contrato). Las asignaciones e intentos de cobro siguen protegidos por sus claves foráneas. TRUNCATE
-- sigue prohibido.
create or replace function private.protect_client_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.contracts where client_id = old.id) then
      raise exception 'Un cliente con contratos o préstamos no se elimina (02 §2.1)'
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id
     or new.business_id is distinct from old.business_id
     or new.identification is distinct from old.identification
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'La identificación, el negocio y el origen de un cliente no se pueden cambiar'
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
