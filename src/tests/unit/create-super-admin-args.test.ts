import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../../scripts/create-super-admin.mjs";

// 02 §1.4 (decisión del 2026-10-24): el alta de Super Admin exige un motivo.

describe("create-super-admin.mjs: argumentos", () => {
  it("acepta --motivo y lo recorta", () => {
    expect(parseCliArgs(["--motivo", "  Alta del soporte de guardia "])).toEqual({
      reason: "Alta del soporte de guardia",
    });
    expect(parseCliArgs(["--motivo=Reemplazo del titular"])).toEqual({
      reason: "Reemplazo del titular",
    });
  });

  it("sin motivo, o con un motivo en blanco, falla antes de pedir nada", () => {
    for (const argv of [[], ["--motivo", "   "], ["--motivo="]]) {
      expect(() => parseCliArgs(argv), JSON.stringify(argv)).toThrow(/motivo/);
    }
  });

  it("rechaza argumentos desconocidos (un error de tipeo no se ignora)", () => {
    expect(() => parseCliArgs(["--motvo", "x"])).toThrow();
  });
});
