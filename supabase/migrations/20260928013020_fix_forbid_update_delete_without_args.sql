-- Corrige private.forbid_update_delete() (F0-T5).
-- Sin columnas permitidas, tg_argv llega NULL y `jsonb - NULL` da NULL: el UPDATE que no cambia
-- nada se rechazaba en vez de tolerarse. Se normaliza a arreglo vacío.
create or replace function private.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_columns text[] := coalesce(tg_argv, '{}');
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - allowed_columns) = (to_jsonb(old) - allowed_columns) then
    return new;
  end if;

  raise exception 'La tabla %.% es de solo agregado: no se permite % (corrección = AJUSTE/REVERSO nuevo)',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;
