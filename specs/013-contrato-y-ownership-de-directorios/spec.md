# Spec 013 — Contrato y ownership de directorios

## Propiedad acordada

- Frontend: `@NeoBmo` (`src/app/**`, excepto `src/app/api/**`; `docs/frontend/**`).
- Backend: `@Lballest25` (`src/app/api/**`, `src/modules/**`, `supabase/**`).
- Compartido: ambos revisan `src/shared/**`, `src/tests/**`, planificación, instrucciones y configuración CI.
- CODEOWNERS propone revisores; solo la protección de rama de GitHub los vuelve requisito de merge. GitHub confirmó `NeoBmo` como admin y `Lballest25` con write en el repositorio.

## Contrato de trabajo

- Backend es responsable de Route Handlers, esquemas de request/response y migraciones. Frontend integra contratos publicados por backend; los cambios incompatibles requieren coordinación de ambos.
- Tipos compartidos y validación reutilizable viven en `src/shared/` cuando no importan detalles de UI ni de una base de datos específica.
- Migraciones son propiedad backend y se revisan separadas de la lógica de dominio según AGENTS.
- No se crea una capa API/tipos duplicada: el contrato actual se obtiene de esquemas Zod y respuestas de Route Handler; evaluar generación formal solo si la duplicación real lo justifica.

## Estado

CODEOWNERS añadido con los nicknames proporcionados y acceso confirmado para ambos. Falta que el archivo llegue al branch base y probar la asignación; GitHub reporta `main` sin protección efectiva (ver spec 014).
