import type { z } from "zod";
import {
  registerAdjustment,
  registerCapitalIncome,
  registerMainCashboxExpense,
  registerOpeningBalance,
  reverseMovement,
} from "@/modules/cash/commands";
import { authorizeCashActor } from "@/modules/cash/run-cash-command";
import {
  adjustmentSchema,
  capitalIncomeSchema,
  expenseSchema,
  openingBalanceSchema,
  reversalSchema,
} from "@/modules/cash/validation";
import { requireSession } from "@/modules/identity/require-session";
import type { SessionContext } from "@/modules/identity/session";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey, type IdempotencyKey } from "@/shared/ids/idempotency-key";

type RouteContext = { params: Promise<{ command: string }> };

type Outcome = { result: unknown; replayed: boolean };
type Deps = { db: ReturnType<typeof getPool> };

type Handler = {
  /** Nombre del comando, el mismo con el que el servicio audita un rechazo. */
  name: string;
  schema: z.ZodType;
  run: (
    deps: Deps,
    actor: SessionContext,
    input: { idempotencyKey: IdempotencyKey } & Record<string, unknown>,
  ) => Promise<Outcome>;
};

// `run` recibe la entrada ya validada por su `schema`; el cast lo deja a la vista en un solo sitio.
const handler = <S extends z.ZodType>(
  name: string,
  schema: S,
  run: (
    deps: Deps,
    actor: SessionContext,
    input: { idempotencyKey: IdempotencyKey } & z.output<S>,
  ) => Promise<Outcome>,
): Handler => ({ name, schema, run: run as Handler["run"] });

const HANDLERS: Record<string, Handler | undefined> = {
  apertura: handler("RegistrarSaldoApertura", openingBalanceSchema, registerOpeningBalance),
  capital: handler("RegistrarIngresoCapital", capitalIncomeSchema, registerCapitalIncome),
  gastos: handler("RegistrarGastoCajaMayor", expenseSchema, registerMainCashboxExpense),
  ajustes: handler("RegistrarAjusteCaja", adjustmentSchema, registerAdjustment),
  reversos: handler("ReversarMovimientoCaja", reversalSchema, reverseMovement),
};

/**
 * Comandos de Caja Mayor del Admin de negocio: `apertura`, `capital`, `gastos`, `ajustes` y `reversos`.
 * Clave de idempotencia en la cabecera `Idempotency-Key` (la genera el cliente por intento de usuario y la
 * mantiene al reintentar). Se autoriza antes de validar la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { command } = await context.params;
    const actor = await requireSession();

    const selected = HANDLERS[command];
    if (!selected) throw new AppError("UNKNOWN_COMMAND", "La operación solicitada no existe", 404);

    const deps = { db: getPool() };
    await authorizeCashActor(deps, actor, selected.name);

    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const input = parseBody(selected.schema, await readJsonBody(request)) as object;
    const outcome = await selected.run(deps, actor, { ...input, idempotencyKey });

    return commandResponse(
      { ...(outcome.result as object), replayed: outcome.replayed },
      outcome.replayed ? 200 : 201,
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
