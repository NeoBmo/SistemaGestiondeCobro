import {
  assumeDifference,
  confirmSettlement,
  resolveDifference,
} from "@/modules/collections/settlements";
import {
  collectionsIdSchema,
  confirmSettlementSchema,
  resolveDifferenceSchema,
} from "@/modules/collections/validation";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import { requireSession } from "@/modules/identity/require-session";
import { getPool } from "@/shared/database/pg-pool";
import { AppError } from "@/shared/errors/app-error";
import {
  assertSameOrigin,
  commandResponse,
  errorResponse,
  parseBody,
  readJsonBody,
} from "@/shared/http/command-response";
import { parseIdempotencyKey } from "@/shared/ids/idempotency-key";

type RouteContext = { params: Promise<{ settlementId: string; action: string }> };

const COMMAND = {
  confirmar: "ConfirmarLiquidacion",
  resolver: "ResolverDiferencia",
  asumir: "AsumirDiferencia",
} as const;

/**
 * El Admin confirma una liquidación (`confirmar`, con lo que realmente recibió) o resuelve su diferencia:
 * por reposición (`resolver`, con un ajuste de la Caja Mayor) o asumida por el negocio (`asumir`, sin mover
 * dinero). Se autoriza antes de validar el id, la clave y el cuerpo.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { settlementId: rawId, action } = await context.params;
    const actor = await requireSession();
    const db = getPool();
    const known = Object.hasOwn(COMMAND, action);
    await authorizeBusinessAdmin(
      db,
      actor,
      known ? COMMAND[action as keyof typeof COMMAND] : "ConfirmarLiquidacion",
    );

    const settlementId = collectionsIdSchema.safeParse(rawId);
    if (!known || !settlementId.success) {
      throw new AppError("SETTLEMENT_NOT_FOUND", "La liquidación no existe", 404);
    }
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const body = await readJsonBody(request);
    const outcome =
      action === "confirmar"
        ? await confirmSettlement({ db }, actor, {
            ...parseBody(confirmSettlementSchema, body),
            settlementId: settlementId.data,
            idempotencyKey,
          })
        : await (action === "resolver" ? resolveDifference : assumeDifference)({ db }, actor, {
            ...parseBody(resolveDifferenceSchema, body),
            settlementId: settlementId.data,
            idempotencyKey,
          });
    return commandResponse({ ...outcome.result, replayed: outcome.replayed });
  } catch (error) {
    return errorResponse(error, request);
  }
}
