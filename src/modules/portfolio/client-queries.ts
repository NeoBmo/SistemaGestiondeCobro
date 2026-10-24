import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { isoDate, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { money, type Money } from "@/shared/money/money";
import {
  findClientDeletionBlocker,
  type ClientDeletionBlocker,
  type ClientRecord,
} from "./clients";

type Db = Pick<Pool, "query">;

/** Tope de la lista; la paginación llega cuando el volumen la necesite (02 no fija un tamaño). */
export const CLIENT_PAGE_SIZE = 50;
const SEARCH_MAX_LENGTH = 120;

function businessOf(actor: SessionContext): string {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  if (!actor.businessId)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  return actor.businessId;
}

/** Texto de búsqueda de la URL: recortado y acotado; vacío = sin filtro. */
export function parseClientSearch(
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  // El byte nulo no cabe en un `text` de Postgres: se descarta en vez de provocar un 500. Los demás
  // caracteres de control tampoco sirven: U+001F separa los campos de `clients.search_text`.
  const value = raw
    ?.replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
  return value ? value : undefined;
}

export type ClientListItem = Pick<
  ClientRecord,
  "id" | "name" | "nickname" | "identification" | "phone"
> & { activeLoans: number };

type ListRow = {
  id: string;
  name: string;
  nickname: string | null;
  identification: string;
  phone: string | null;
  active_loans: string;
};

/**
 * Clientes del negocio de la sesión, por nombre. La búsqueda ignora tildes y mayúsculas (02 §2.1:
 * `andres` encuentra `Andrés`) y coincide con una parte del nombre, el sobrenombre, la identificación o
 * el teléfono: un `like` sobre la columna generada `search_text`, normalizada igual que el término, que
 * usa su índice trigram. `\`, `%` y `_` se escapan para que el término nunca actúe como comodín.
 */
export async function listClients(
  db: Db,
  actor: SessionContext,
  search?: string,
): Promise<{ clients: ClientListItem[]; truncated: boolean }> {
  const businessId = businessOf(actor);
  const pattern = search?.replace(/[\\%_]/g, "\\$&");
  const { rows } = await db.query<ListRow>(
    `select c.id, c.name, c.nickname, c.identification, c.phone,
            (select count(*) from public.loans l
               join public.contracts k on k.id = l.contract_id
              where k.client_id = c.id and l.status = 'ACTIVO') as active_loans
       from public.clients c
      where c.business_id = $1
        and ($2::text is null
             or c.search_text like '%' || private.normalize_search($2::text) || '%')
      order by lower(c.name), c.id
      limit $3`,
    [businessId, pattern ?? null, CLIENT_PAGE_SIZE + 1],
  );
  return {
    truncated: rows.length > CLIENT_PAGE_SIZE,
    clients: rows.slice(0, CLIENT_PAGE_SIZE).map((row) => ({
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      identification: row.identification,
      phone: row.phone,
      activeLoans: Number(row.active_loans),
    })),
  };
}

export type ClientLoanSummary = {
  loanId: string;
  contractNumber: string;
  status: "ACTIVO" | "ANULADO";
  principal: Money;
  total: Money;
  installmentCount: number;
  frequency: "DIARIA" | "SEMANAL" | "MENSUAL";
  disbursedOn: IsoDate;
};

type LoanRow = {
  loan_id: string;
  contract_number: string;
  status: "ACTIVO" | "ANULADO";
  principal_amount: string;
  total_amount: string;
  installment_count: number;
  frequency: "DIARIA" | "SEMANAL" | "MENSUAL";
  disbursed_on: string;
};

/**
 * Ficha del cliente con sus préstamos y, si no se puede eliminar, el porqué; o `null` si no existe en el
 * negocio de la sesión.
 */
export async function getClientDetail(
  db: Db,
  actor: SessionContext,
  clientId: string,
): Promise<{
  client: ClientRecord;
  loans: ClientLoanSummary[];
  deletionBlocker: ClientDeletionBlocker | null;
} | null> {
  const businessId = businessOf(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
    return null;

  const found = await db.query<{
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
  }>(
    `select id, name, nickname, identification, address, phone, whatsapp, notes, created_at, updated_at
       from public.clients where id = $1 and business_id = $2`,
    [clientId, businessId],
  );
  const row = found.rows[0];
  if (!row) return null;

  const loans = await db.query<LoanRow>(
    `select l.id as loan_id, k.number as contract_number, l.status,
            l.principal_amount::text, l.total_amount::text, l.installment_count, l.frequency,
            l.disbursed_on::text
       from public.loans l join public.contracts k on k.id = l.contract_id
      where k.client_id = $1 and l.business_id = $2
      order by l.created_at desc, l.id`,
    [clientId, businessId],
  );
  const deletionBlocker = await findClientDeletionBlocker(db, clientId);

  return {
    deletionBlocker,
    client: {
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
    },
    loans: loans.rows.map((loan) => ({
      loanId: loan.loan_id,
      contractNumber: loan.contract_number,
      status: loan.status,
      principal: money(loan.principal_amount),
      total: money(loan.total_amount),
      installmentCount: loan.installment_count,
      frequency: loan.frequency,
      disbursedOn: isoDate(loan.disbursed_on),
    })),
  };
}
