import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error";
import { daysBetween, formatDateTimeInZone, isoDate, localDateIn } from "./dates";

describe("isoDate", () => {
  it("acepta fechas calendario válidas YYYY-MM-DD", () => {
    expect(isoDate("2026-09-27")).toBe("2026-09-27");
    expect(isoDate("2028-02-29")).toBe("2028-02-29"); // bisiesto
  });

  it("rechaza formatos y fechas inexistentes", () => {
    const invalid = [
      "2026-9-27",
      "27/09/2026",
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "",
      "2026-09-27T00:00:00Z",
    ];
    for (const bad of invalid) {
      expect(() => isoDate(bad)).toThrow(AppError);
    }
  });
});

describe("localDateIn (fecha de hoy en la zona del negocio)", () => {
  it("una misma instancia UTC cae en días distintos según la zona", () => {
    const instant = new Date("2026-09-28T03:30:00Z");

    expect(localDateIn(instant, "UTC")).toBe("2026-09-28");
    expect(localDateIn(instant, "America/Bogota")).toBe("2026-09-27"); // UTC-5
  });

  it("respeta el límite de medianoche local", () => {
    expect(localDateIn(new Date("2026-09-28T04:59:59Z"), "America/Bogota")).toBe("2026-09-27");
    expect(localDateIn(new Date("2026-09-28T05:00:00Z"), "America/Bogota")).toBe("2026-09-28");
  });

  it("rechaza zonas horarias inválidas", () => {
    expect(() => localDateIn(new Date(), "Mars/Olympus")).toThrow(AppError);
  });
});

describe("daysBetween", () => {
  it("cuenta días completos entre fechas calendario", () => {
    expect(daysBetween(isoDate("2026-09-27"), isoDate("2026-09-27"))).toBe(0);
    expect(daysBetween(isoDate("2026-09-27"), isoDate("2026-09-30"))).toBe(3);
    expect(daysBetween(isoDate("2026-09-30"), isoDate("2026-09-27"))).toBe(-3);
  });

  it("cruza meses, años y bisiestos sin errores", () => {
    expect(daysBetween(isoDate("2028-02-28"), isoDate("2028-03-01"))).toBe(2);
    expect(daysBetween(isoDate("2026-12-31"), isoDate("2027-01-01"))).toBe(1);
  });
});

describe("formatDateTimeInZone", () => {
  it("muestra fecha y hora locales del negocio en dd/mm/aaaa hh:mm", () => {
    const instant = new Date("2026-09-28T00:55:00Z");

    expect(formatDateTimeInZone(instant, "America/Bogota")).toBe("27/09/2026 19:55");
    expect(formatDateTimeInZone(instant, "UTC")).toBe("28/09/2026 00:55");
  });
});
