import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { assertTransition, type LifecycleCommand } from "./lifecycle-rules";

// 02-DOMINIO §1.3 y ADR 0003/0005: transiciones permitidas por comando sobre la suscripción vigente.

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : "NO_APPERROR";
  }
  return undefined;
}

describe("assertTransition", () => {
  const allowed: [LifecycleCommand, "ACTIVA" | "SUSPENDIDA" | "ARCHIVADA" | null][] = [
    ["SUSPEND", "ACTIVA"],
    ["ACTIVATE", "SUSPENDIDA"],
    ["ARCHIVE", "ACTIVA"],
    ["ARCHIVE", "SUSPENDIDA"],
    ["CHANGE_PLAN", "ACTIVA"],
    ["CHANGE_PLAN", "SUSPENDIDA"],
    ["RESUBSCRIBE", null],
  ];

  for (const [command, status] of allowed) {
    it(`${command} se permite desde ${status ?? "sin suscripción vigente"}`, () => {
      expect(codeOf(() => assertTransition(command, status))).toBeUndefined();
    });
  }

  const forbidden: [LifecycleCommand, "ACTIVA" | "SUSPENDIDA" | null][] = [
    ["SUSPEND", "SUSPENDIDA"],
    ["SUSPEND", null],
    ["ACTIVATE", "ACTIVA"],
    ["ACTIVATE", null],
    ["ARCHIVE", null],
    ["CHANGE_PLAN", null],
    ["RESUBSCRIBE", "ACTIVA"],
    ["RESUBSCRIBE", "SUSPENDIDA"],
  ];

  for (const [command, status] of forbidden) {
    it(`${command} se rechaza desde ${status ?? "sin suscripción vigente"} con INVALID_STATE_TRANSITION (409)`, () => {
      try {
        assertTransition(command, status);
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_STATE_TRANSITION", status: 409 });
      }
    });
  }

  it("el mensaje orienta: un negocio archivado solo vuelve por re-suscripción", () => {
    try {
      assertTransition("ACTIVATE", null);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).message).toContain("re-suscri");
    }
  });
});
