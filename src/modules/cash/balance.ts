import type { Tx } from "@/shared/database/with-transaction";
import { money, type Money } from "@/shared/money/money";

/**
 * Saldo de una caja: Σ entradas − Σ salidas de sus movimientos (02 §5.1, §10). Nunca se guarda.
 * Para decidir algo a partir del saldo (rechazar una salida) hay que llamarlo dentro de un comando
 * que ya tomó el bloqueo de la caja (`runCashCommand`): si no, otra transacción puede cambiarlo.
 */
export async function getCashboxBalance(tx: Tx, cashboxId: string): Promise<Money> {
  const { rows } = await tx.query<{ balance: string }>(
    `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
       from public.cash_movements where cashbox_id = $1 and session_id is null`,
    [cashboxId],
  );
  return money(rows[0]!.balance);
}
