import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { daysLate, deriveInstallmentStatus } from "./installment-status";

const day = isoDate;

describe("estado derivado de una cuota", () => {
  it("antes del vencimiento y el mismo día está pendiente; al día siguiente, vencida", () => {
    const installment = { dueOn: day("2026-10-14"), pendingAmount: 100 };
    expect(deriveInstallmentStatus(installment, day("2026-10-13"))).toBe("PENDIENTE");
    expect(deriveInstallmentStatus(installment, day("2026-10-14"))).toBe("PENDIENTE");
    expect(deriveInstallmentStatus(installment, day("2026-10-15"))).toBe("VENCIDA");
    expect(deriveInstallmentStatus(installment, day("2027-01-01"))).toBe("VENCIDA");
  });

  it("sin saldo pendiente está pagada, vencida o no", () => {
    const paid = { dueOn: day("2026-10-14"), pendingAmount: 0 };
    expect(deriveInstallmentStatus(paid, day("2026-10-01"))).toBe("PAGADA");
    expect(deriveInstallmentStatus(paid, day("2026-12-01"))).toBe("PAGADA");
  });

  it("los días de mora son máximo(0, hoy − vencimiento)", () => {
    expect(daysLate(day("2026-10-14"), day("2026-10-13"))).toBe(0);
    expect(daysLate(day("2026-10-14"), day("2026-10-14"))).toBe(0);
    expect(daysLate(day("2026-10-14"), day("2026-10-20"))).toBe(6);
    expect(daysLate(day("2026-12-30"), day("2027-01-02"))).toBe(3);
  });
});
