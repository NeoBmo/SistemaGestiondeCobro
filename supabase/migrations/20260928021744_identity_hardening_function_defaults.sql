-- Corrige identity_hardening: el EXECUTE implícito de PUBLIC sobre funciones nuevas es un privilegio
-- por defecto GLOBAL (no pertenece a un schema), así que revocarlo `in schema` no tenía efecto.
-- Las funciones nuevas creadas por las migraciones nacen sin EXECUTE para PUBLIC; los grants a
-- roles concretos se hacen explícitamente (p. ej. helpers de RLS y el hook de Auth).
alter default privileges for role postgres revoke execute on functions from public;
