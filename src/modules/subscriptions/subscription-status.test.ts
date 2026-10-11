import { describe, expect, it } from "vitest";
import { isoDate } from "@/shared/dates/dates";
import { deriveSubscriptionStatus } from "./subscription-status";

// 02-DOMINIO §1.3 y ADR 0003: PROXIMA_A_VENCER y VENCIDA se derivan de la fecha al leer; no se almacenan.
// «Próxima» = una suscripción ACTIVA a 5 días o menos del vencimiento; «vencida» = vencimiento ya pasado
// (el día del vencimiento aún no está vencida, igual que una cuota que vence hoy tiene 0 días de mora).

const d = isoDate;
const expiresOn = d("2026-10-31");

describe("deriveSubscriptionStatus", () => {
  it("ACTIVA lejos del vencimiento sigue ACTIVA", () => {
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-10-01"))).toBe(
      "ACTIVA",
    );
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-10-25"))).toBe(
      "ACTIVA",
    );
  });

  it("a 5 días o menos del vencimiento es PROXIMA_A_VENCER, incluido el propio día de vencimiento", () => {
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-10-26"))).toBe(
      "PROXIMA_A_VENCER",
    );
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-10-30"))).toBe(
      "PROXIMA_A_VENCER",
    );
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-10-31"))).toBe(
      "PROXIMA_A_VENCER",
    );
  });

  it("pasado el vencimiento es VENCIDA", () => {
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2026-11-01"))).toBe(
      "VENCIDA",
    );
    expect(deriveSubscriptionStatus({ status: "ACTIVA", expiresOn }, d("2027-03-01"))).toBe(
      "VENCIDA",
    );
  });

  it("SUSPENDIDA y ARCHIVADA no se derivan: conservan su estado aunque haya vencido", () => {
    for (const status of ["SUSPENDIDA", "ARCHIVADA"] as const) {
      for (const today of ["2026-10-01", "2026-10-30", "2026-12-01"]) {
        expect(
          deriveSubscriptionStatus({ status, expiresOn }, d(today)),
          `${status} ${today}`,
        ).toBe(status);
      }
    }
  });

  it("una semana recién creada (7 días) no nace próxima a vencer", () => {
    expect(
      deriveSubscriptionStatus({ status: "ACTIVA", expiresOn: d("2026-10-18") }, d("2026-10-11")),
    ).toBe("ACTIVA");
  });
});
