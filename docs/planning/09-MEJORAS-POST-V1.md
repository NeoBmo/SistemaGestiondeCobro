# 09 — Mejoras posteriores a V1

> Lista viva de mejoras **decididas para después de V1**. No son pendientes (eso es `05-PENDIENTES.md`): la decisión ya está tomada — no entran en V1 — y aquí queda constancia de qué, por qué y qué lo desbloquea. Nada de esta lista se construye «como preparación» (`01-CONTEXTO.md`).
>
> Criterio de V1 (decisión del 2026-10-24): V1 opera en planes gratuitos y con el alcance mínimo para una jornada real segura. Lo que exige pago o no es imprescindible para lanzar se registra aquí.

## Seguridad

| Mejora | Por qué no entra en V1 | Notas |
| --- | --- | --- |
| 2FA (TOTP) obligatorio para Super Admin | Alcance mínimo de V1 | Gratuito en Supabase Auth; solo trabajo de implementación. Primera mejora de seguridad tras V1. |
| 2FA para Admin de negocio | Fricción en el alta de cada negocio | Tras el 2FA del Super Admin. |
| CAPTCHA en inicio de sesión | Servicio externo y revisión de privacidad | El límite de intentos por usuario e IP cubre V1. |
| Recuperación punto-en-el-tiempo (PITR) | De pago (requiere Supabase Pro + complemento) | V1 usa backup diario cifrado propio. |
| Supabase Pro (backups gestionados, sin pausas, soporte) | De pago | Revisar cuando haya ingresos de suscripciones. |

## Cumplimiento legal

| Mejora | Por qué no entra en V1 | Notas |
| --- | --- | --- |
| Registrar en la ficha del deudor los canales autorizados y la autorización expresa de visitas (Ley 2300 de 2023, arts. 2 y 6), mostrando solo los canales autorizados | El dueño eligió que en V1 el cumplimiento sea responsabilidad del negocio por términos | Deja evidencia a favor del negocio ante una queja. Prioridad alta tras la revisión del abogado. |
| Desactivar llamar/WhatsApp fuera del horario legal de cobranza (art. 3), con calendario de festivos | Ídem | — |
| Bloquear (no solo advertir) préstamos por encima de la tasa de usura | El dueño eligió advertir en V1 | Revaluar según la opinión del abogado. |

## Operación del cobrador

| Mejora | Por qué no entra en V1 | Notas |
| --- | --- | --- |
| Operación sin conexión | Sincronización y conflictos: complejidad alta (`01-CONTEXTO.md`) | V1 asume conectividad. |

## Cartera, mora y caja

| Mejora | Por qué no entra en V1 | Notas |
| --- | --- | --- |
| Elegir la cuota al crear un cargo de mora desde la pantalla | La operación funciona a nivel de préstamo | La API ya admite `installmentId`. |
| Vista de mora agregada por cliente | No imprescindible para la jornada | — |
| Resolver diferencias de liquidación en parcialidades | Añade estado y saldo a la diferencia | V1: reposición o asumida. |
