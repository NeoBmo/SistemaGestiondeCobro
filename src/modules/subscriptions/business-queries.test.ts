import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUSES, parseListFilters } from "./business-queries";
import { STATUS_PRESENTATION } from "./status-presentation";

describe("parseListFilters", () => {
  it("lee nombre, plan y estado de la URL", () => {
    expect(parseListFilters({ q: "  Tienda ", plan: "ANUAL", estado: "VENCIDA" })).toEqual({
      search: "Tienda",
      planCode: "ANUAL",
      status: "VENCIDA",
    });
  });

  it("ignora valores desconocidos o vacíos: la URL la escribe el usuario, no es un error", () => {
    expect(parseListFilters({ q: "   ", plan: "TRIMESTRAL", estado: "BORRADA" })).toEqual({});
    expect(parseListFilters({})).toEqual({});
  });

  it("con un parámetro repetido usa el primero y acota la longitud del texto", () => {
    expect(parseListFilters({ plan: ["SEMANAL", "ANUAL"] })).toEqual({ planCode: "SEMANAL" });
    expect(parseListFilters({ q: "x".repeat(500) }).search).toHaveLength(120);
  });
});

describe("presentación de estados", () => {
  it("todo estado filtrable tiene texto e ícono (el color nunca va solo)", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(STATUS_PRESENTATION[status].label.length).toBeGreaterThan(0);
      expect(STATUS_PRESENTATION[status].icon.length).toBeGreaterThan(0);
    }
  });
});
