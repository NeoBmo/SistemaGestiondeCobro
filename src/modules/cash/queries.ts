import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import { money, type Money } from "@/shared/money/money";

type Db = Pick<Pool, "query">;

export type CashMovementView = {
  id: string;
  type: string;
  direction: "ENTRADA" | "SALIDA";
  amount: Money;
  reason: string | null;
  note: string | null;
  category: string | null;
  createdByName: string;
  createdAt: Date;
  /** Si es un REVERSO: el movimiento que anula. */
  reversesMovementId: string | null;
  /** Si ya fue reversado: el reverso que lo anula. */
  reversedByMovementId: string | null;
};

export type CashSummary = {
  balance: Money;
  hasOpeningBalance: boolean;
  /** Más recientes primero. */
  movements: CashMovementView[];
  /** `true` si hay más movimientos que los devueltos. */
  truncated: boolean;
};

/** Tope de la lista del historial; la paginación llega cuando el volumen la necesite. */
export const MOVEMENT_PAGE_SIZE = 100;

type MovementRow = {
  id: string;
  type: string;
  direction: "ENTRADA" | "SALIDA";
  amount: string;
  reason: string | null;
  note: string | null;
  category: string | null;
  created_by_name: string;
  created_at: Date;
  reverses_movement_id: string | null;
  reversed_by_movement_id: string | null;
};

/**
 * Saldo derivado e historial de la Caja Mayor del negocio de la sesión (solo el Admin lo ve). El saldo
 * se suma en la base sobre todos los movimientos; la lista es solo la parte reciente. Son dos consultas sin
 * instantánea compartida: bajo escrituras simultáneas pueden diferir un instante hasta la siguiente lectura.
 */
export async function getCashSummary(db: Db, actor: SessionContext): Promise<CashSummary> {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  const businessId = actor.businessId;
  if (!businessId) throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);

  const totals = await db.query<{ balance: string; opening: boolean }>(
    `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance,
            coalesce(bool_or(type = 'SALDO_APERTURA'), false) as opening
       from public.cash_movements where business_id = $1`,
    [businessId],
  );
  const list = await db.query<MovementRow>(
    `select m.id, m.type, m.direction, m.amount::text as amount, m.reason, m.note, e.category,
            p.display_name as created_by_name, m.created_at,
            m.reverses_movement_id, r.id as reversed_by_movement_id
       from public.cash_movements m
       join public.profiles p on p.id = m.created_by
       left join public.expenses e on e.movement_id = m.id
       left join public.cash_movements r on r.reverses_movement_id = m.id
      where m.business_id = $1
      order by m.created_at desc, m.id desc
      limit $2`,
    [businessId, MOVEMENT_PAGE_SIZE + 1],
  );

  return {
    balance: money(totals.rows[0]!.balance),
    hasOpeningBalance: totals.rows[0]!.opening,
    truncated: list.rows.length > MOVEMENT_PAGE_SIZE,
    movements: list.rows.slice(0, MOVEMENT_PAGE_SIZE).map((row) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      amount: money(row.amount),
      reason: row.reason,
      note: row.note,
      category: row.category,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      reversesMovementId: row.reverses_movement_id,
      reversedByMovementId: row.reversed_by_movement_id,
    })),
  };
}
