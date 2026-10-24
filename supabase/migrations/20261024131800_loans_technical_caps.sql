-- Topes técnicos del préstamo también en la base de datos (02-DOMINIO §2.3, decisión del 2026-10-24).
-- Son los mismos que aplica `calculateLoan` (ADR 0007, `src/modules/portfolio/loan-calculation.ts`):
-- interés ≤ 1.000.000 puntos básicos y entre 1 y 1.000 cuotas. Los mínimos ya existían
-- (`interest_bps >= 0`, `installment_count > 0`). Si algún préstamo existente los incumple, la
-- migración falla al validar la restricción y no cambia nada.
alter table public.loans
  add constraint loans_interest_bps_max check (interest_bps <= 1000000),
  add constraint loans_installment_count_max check (installment_count <= 1000);
