-- Orden del historial de un ticket (F7-T3). Varios eventos de un mismo comando comparten la fecha de la
-- transacción: `seq` da el orden total en que se registraron.
alter table public.support_ticket_events add column seq bigint generated always as identity;
create index support_ticket_events_seq_idx on public.support_ticket_events (ticket_id, seq);
