-- Observación del movimiento (02 §5.3 lista «observación» entre sus datos y la tabla aún no la tenía).
-- Es texto libre opcional escrito por quien registra el movimiento; `reason` sigue siendo el motivo
-- obligatorio de AJUSTE y REVERSO. Añadir una columna no modifica ningún hecho ya registrado.
alter table public.cash_movements
  add column note text check (note is null or length(note) <= 500);
