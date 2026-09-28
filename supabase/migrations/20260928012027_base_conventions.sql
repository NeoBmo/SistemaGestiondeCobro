-- Base de convenciones (F0-T5).
-- Fuentes: 03-ARQUITECTURA §4 punto 8 (inmutabilidad en BD) y 02-DOMINIO §9 invariante 10
-- (ningún hecho financiero se elimina ni se edita: corrección = AJUSTE/REVERSO vinculado).

-- Schema interno: no está en [api].schemas, así que PostgREST no lo expone.
create schema if not exists private;
comment on schema private is 'Funciones internas de Cuadre; no expuesto por la API de datos.';

-- Trigger de solo agregado.
--   DELETE y TRUNCATE: siempre se rechazan.
--   UPDATE: se rechaza salvo que solo cambien columnas derivadas declaradas explícitamente
--   como argumentos del trigger (tg_argv). Un UPDATE que no cambia nada se tolera.
create or replace function private.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_columns text[] := tg_argv;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - allowed_columns) = (to_jsonb(old) - allowed_columns) then
    return new;
  end if;

  raise exception 'La tabla %.% es de solo agregado: no se permite % (corrección = AJUSTE/REVERSO nuevo)',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Marca una tabla como de solo agregado: dos triggers (fila y TRUNCATE) como barrera principal y
-- REVOKE a los roles de la API como segunda barrera. `allowed_update_columns` lista las únicas
-- columnas derivadas modificables (por defecto ninguna). La conexión de la aplicación (pg, dueña
-- de las tablas) pasa por los triggers, no por los privilegios.
create or replace function private.make_append_only(
  target regclass,
  allowed_update_columns text[] default '{}'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  trigger_args text := coalesce(
    (select string_agg(quote_literal(column_name), ', ') from unnest(allowed_update_columns) as column_name),
    ''
  );
begin
  execute format(
    'create trigger append_only_row before update or delete on %s '
    'for each row execute function private.forbid_update_delete(%s)',
    target, trigger_args
  );
  execute format(
    'create trigger append_only_truncate before truncate on %s '
    'for each statement execute function private.forbid_update_delete()',
    target
  );
  execute format('revoke update, delete, truncate on %s from public, anon, authenticated, service_role', target);
end;
$$;

revoke all on function private.forbid_update_delete() from public, anon, authenticated, service_role;
revoke all on function private.make_append_only(regclass, text[]) from public, anon, authenticated, service_role;
