import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { CreateClientInput, UpdateClientInput } from "./client-validation";

/**
 * Clientes (02 §2.1). Sin acceso de usuario en V1; solo los administra el Admin de negocio. No son
 * comandos financieros: una transacción y su auditoría, sin clave de idempotencia (un doble envío de
 * un alta lo frena la unicidad de la identificación por negocio).
 */

export type ClientDeps = { db: Pick<Pool, "connect" | "query"> };

export type ClientRecord = {
  id: string;
  name: string;
  nickname: string | null;
  identification: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ClientRow = {
  id: string;
  name: string;
  nickname: string | null;
  identification: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS =
  "id, name, nickname, identification, address, phone, whatsapp, notes, created_at, updated_at";

const toRecord = (row: ClientRow): ClientRecord => ({
  id: row.id,
  name: row.name,
  nickname: row.nickname,
  identification: row.identification,
  address: row.address,
  phone: row.phone,
  whatsapp: row.whatsapp,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const identificationTaken = () =>
  new AppError(
    "CLIENT_IDENTIFICATION_EXISTS",
    "Ya existe un cliente con esa identificación en tu negocio",
    409,
  );

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === "23505" && candidate.constraint === constraint;
}

export async function createClient(
  deps: ClientDeps,
  actor: SessionContext,
  input: CreateClientInput,
): Promise<ClientRecord> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "ClienteCreado");

  try {
    return await withTransaction(async (tx) => {
      const { rows } = await tx.query<ClientRow>(
        `insert into public.clients
           (business_id, name, nickname, identification, address, phone, whatsapp, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${COLUMNS}`,
        [
          businessId,
          input.name,
          input.nickname ?? null,
          input.identification,
          input.address ?? null,
          input.phone ?? null,
          input.whatsapp ?? null,
          input.notes ?? null,
          actor.userId,
        ],
      );
      const created = toRecord(rows[0]!);
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "ClienteCreado",
        entityType: "client",
        entityId: created.id,
        summary: { name: created.name, identification: created.identification },
      });
      return created;
    }, deps.db);
  } catch (error) {
    if (isUniqueViolation(error, "clients_identification_key")) throw identificationTaken();
    throw error;
  }
}

const EDITABLE = ["name", "nickname", "address", "phone", "whatsapp", "notes"] as const;
type Editable = (typeof EDITABLE)[number];

/**
 * Edita el contacto y deja en la auditoría qué campos cambiaron, con su valor anterior y el nuevo
 * (02 §2.1: «datos de contacto editables y auditados»). La identificación no se edita nunca. Si no
 * cambia nada no se escribe ni se audita. El cliente se busca siempre dentro del negocio de la sesión:
 * el de otro negocio es «no encontrado».
 */
export async function updateClient(
  deps: ClientDeps,
  actor: SessionContext,
  clientId: string,
  input: UpdateClientInput,
): Promise<{ client: ClientRecord; changed: Editable[] }> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "ClienteActualizado");

  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const current = await tx.query<ClientRow>(
        `select ${COLUMNS} from public.clients where id = $1 and business_id = $2 for update`,
        [clientId, businessId],
      );
      const before = current.rows[0];
      if (!before) throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);

      const next: Record<Editable, string | null> = {
        name: input.name,
        nickname: input.nickname ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        whatsapp: input.whatsapp ?? null,
        notes: input.notes ?? null,
      };
      const changed = EDITABLE.filter((field) => before[field] !== next[field]);
      if (changed.length === 0) return { client: toRecord(before), changed };

      const { rows } = await tx.query<ClientRow>(
        `update public.clients
            set name = $3, nickname = $4, address = $5, phone = $6, whatsapp = $7, notes = $8
          where id = $1 and business_id = $2
          returning ${COLUMNS}`,
        [
          clientId,
          businessId,
          next.name,
          next.nickname,
          next.address,
          next.phone,
          next.whatsapp,
          next.notes,
        ],
      );
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "ClienteActualizado",
        entityType: "client",
        entityId: clientId,
        summary: {
          changes: Object.fromEntries(
            changed.map((field) => [field, { from: before[field], to: next[field] }]),
          ),
        },
      });
      return { client: toRecord(rows[0]!), changed };
    }, deps.db);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}
