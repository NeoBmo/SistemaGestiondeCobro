-- Diferencia de liquidación asumida por el negocio (02 §5.5, decisión del 2026-10-24). No edita la migración
-- 20261017120000 (ya aplicada).
--
-- Una diferencia `CON_DIFERENCIA` se resuelve una sola vez, con motivo, de una de dos formas:
--   · REPOSICION — un `AJUSTE` de la Caja Mayor por el importe exacto (lo que ya existía);
--   · ASUMIDA    — se cierra sin mover dinero: la pérdida o el sobrante ya están en lo realmente entregado.
-- `REVISADA` sigue derivándose de que exista la fila; la unicidad por liquidación no cambia.

-- Las filas existentes son todas reposiciones con su AJUSTE: el valor por defecto las describe.
alter table public.settlement_resolutions
  add column kind text not null default 'REPOSICION'
    constraint settlement_resolutions_kind_check check (kind in ('REPOSICION', 'ASUMIDA'));

alter table public.settlement_resolutions alter column movement_id drop not null;
alter table public.settlement_resolutions
  add constraint settlement_resolutions_movement_by_kind
    check ((kind = 'REPOSICION') = (movement_id is not null));

-- La reposición sigue exigiendo un AJUSTE de la Caja Mayor; la asumida no lleva movimiento (lo exige el
-- CHECK anterior), pero igual solo cierra una liquidación CON_DIFERENCIA.
create or replace function private.check_settlement_resolution()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  settlement_status text;
  movement record;
begin
  select status into settlement_status from public.settlements where id = new.settlement_id for share;
  if settlement_status is distinct from 'CON_DIFERENCIA' then
    raise exception 'Solo se resuelve una liquidación CON_DIFERENCIA' using errcode = 'check_violation';
  end if;
  if new.kind = 'ASUMIDA' then
    return new;
  end if;
  select type, session_id into movement from public.cash_movements where id = new.movement_id;
  if movement.type is distinct from 'AJUSTE' or movement.session_id is not null then
    raise exception 'La diferencia se resuelve con un AJUSTE de la Caja Mayor' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
