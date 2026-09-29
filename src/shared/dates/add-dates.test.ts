import { describe, expect, it } from "vitest";
import { addDays, addMonthsClamped, isoDate } from "./dates";

// 02-DOMINIO §1.3: vencimiento por calendario; si el día no existe se usa el último del mes.

const d = isoDate;

describe("addDays", () => {
  it("suma días cruzando meses y años", () => {
    expect(addDays(d("2026-09-28"), 7)).toBe("2026-10-05");
    expect(addDays(d("2026-12-30"), 5)).toBe("2027-01-04");
    expect(addDays(d("2028-02-27"), 2)).toBe("2028-02-29");
  });

  it("acepta cero y negativos", () => {
    expect(addDays(d("2026-09-28"), 0)).toBe("2026-09-28");
    expect(addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
  });
});

describe("addMonthsClamped", () => {
  it("mismo día del mes siguiente", () => {
    expect(addMonthsClamped(d("2026-09-15"), 1)).toBe("2026-10-15");
    expect(addMonthsClamped(d("2026-12-15"), 1)).toBe("2027-01-15");
  });

  it("si el día no existe usa el último del mes (31 ene → 28/29 feb)", () => {
    expect(addMonthsClamped(d("2026-01-31"), 1)).toBe("2026-02-28");
    expect(addMonthsClamped(d("2028-01-31"), 1)).toBe("2028-02-29");
    expect(addMonthsClamped(d("2026-03-31"), 1)).toBe("2026-04-30");
  });

  it("un año son 12 meses; 29 de febrero pasa al 28 en año no bisiesto", () => {
    expect(addMonthsClamped(d("2026-09-28"), 12)).toBe("2027-09-28");
    expect(addMonthsClamped(d("2028-02-29"), 12)).toBe("2029-02-28");
    expect(addMonthsClamped(d("2028-02-29"), 48)).toBe("2032-02-29");
  });

  it("cada suma parte de la fecha original (no acumula el ajuste)", () => {
    expect(addMonthsClamped(d("2026-01-31"), 2)).toBe("2026-03-31");
  });
});
