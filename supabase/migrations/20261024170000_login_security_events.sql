-- Eventos de seguridad del inicio de sesión y base del límite de intentos (02-DOMINIO §1.4, decisión del
-- 2026-10-24). Separados de la auditoría de negocio (§6.3): no pertenecen a un negocio ni a un actor
-- autenticado. Nunca guardan la contraseña.
--
-- Cada petición de login deja UNA fila. Se inserta `EN_CURSO` antes de llamar a Supabase Auth (cuenta como
-- fallo mientras tanto: así dos peticiones simultáneas no pueden superar el límite) y se cierra con su
-- resultado. Es de solo agregado salvo ese cierre y la purga de retención (90 días).
create table public.login_security_events (
  id uuid primary key default gen_random_uuid(),
  -- Usuario intentado ya normalizado (puede no existir: el límite no revela si existe).
  username text not null check (length(username) <= 64),
  -- IP del cliente según la plataforma; nula fuera de Vercel (sin IP fiable no hay límite por IP).
  ip inet,
  result text not null check (result in (
    'EN_CURSO',
    'EXITOSO',
    'CREDENCIALES_INVALIDAS',
    'USUARIO_BLOQUEADO_TEMPORALMENTE',
    'IP_BLOQUEADA_TEMPORALMENTE',
    'CUENTA_BLOQUEADA',
    'NEGOCIO_SUSPENDIDO',
    'ACCESO_DENEGADO',
    'LIMITE_AUTH',
    'AUTH_NO_DISPONIBLE',
    'ERROR_INTERNO'
  )),
  occurred_at timestamptz not null
);

-- Solo cuentan para el límite los intentos que llegaron (o están llegando) a la verificación de contraseña
-- y no la superaron. Los índices parciales mantienen acotadas las consultas del límite aunque un ataque
-- acumule filas de peticiones ya bloqueadas.
create index login_security_events_user_counted_idx on public.login_security_events (username, occurred_at)
  where result in ('EN_CURSO', 'CREDENCIALES_INVALIDAS');
create index login_security_events_ip_counted_idx on public.login_security_events (ip, occurred_at)
  where result in ('EN_CURSO', 'CREDENCIALES_INVALIDAS');
create index login_security_events_user_success_idx on public.login_security_events (username, occurred_at)
  where result = 'EXITOSO';
create index login_security_events_occurred_idx on public.login_security_events (occurred_at);

-- Solo agregado, con dos excepciones: cerrar un intento EN_CURSO (solo cambia `result`) y purgar lo que
-- tenga más de 90 días (retención: usuario e IP son datos personales, Ley 1581).
create or replace function private.guard_login_security_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.result = 'EN_CURSO' and new.result <> 'EN_CURSO'
       and (to_jsonb(new) - 'result') = (to_jsonb(old) - 'result') then
      return new;
    end if;
  elsif tg_op = 'DELETE' then
    if old.occurred_at < now() - interval '90 days' then
      return old;
    end if;
  end if;
  raise exception 'La tabla %.% es de solo agregado: solo se cierra un intento EN_CURSO o se purgan eventos de más de 90 días',
    tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger append_only_row before update or delete on public.login_security_events
  for each row execute function private.guard_login_security_event();
create trigger append_only_truncate before truncate on public.login_security_events
  for each statement execute function private.forbid_update_delete();

revoke all on function private.guard_login_security_event() from public, anon, authenticated, service_role;

-- Solo el servidor (pool privilegiado) lee y escribe: ningún rol de la API la ve.
revoke all on public.login_security_events from public, anon, authenticated, service_role;
alter table public.login_security_events enable row level security;
