import type { StockTransfer } from "@/types";

/**
 * Uma OPERAÇÃO de transferência: a viagem, com os sabores dentro.
 *
 * O banco guarda uma linha por sabor, porque é por sabor que o estoque se
 * mexe. Mas quem lê a Entrada não quer oito linhas — quer "saíram 42 un. para
 * São Paulo", e os sabores quando perguntar. O `batch_id` é quem junta; linha
 * antiga (anterior ao lote) não tem nenhum, e aí ela é uma operação de um item
 * só — que é exatamente o que ela era.
 */
export interface TransferOperation {
  /** `batchId` quando existe, senão o id da própria linha. */
  key: string;
  fromBranchId: string;
  toBranchId: string;
  /** Vendedores de cuja caixa saiu alguma unidade desta operação. */
  fromSellerIds: string[];
  /** Alguma unidade saiu do estoque da casa. */
  fromHouse: boolean;
  date: string;
  notes?: string;
  units: number;
  items: StockTransfer[];
}

/** As operações de um dia, com o saldo daquele dia para a filial de referência. */
export interface TransferDay {
  /** `YYYY-MM-DD`. */
  dateKey: string;
  operations: TransferOperation[];
  /** Unidades que SAÍRAM da filial de referência naquele dia. */
  out: number;
  /** Unidades que CHEGARAM nela. */
  in: number;
}

/**
 * Agrupa as linhas em operação e depois em dia, do mais recente para o mais
 * antigo — a ordem da tela.
 *
 * `branchId` é a filial de referência, e é o que dá sentido a "saiu" e
 * "chegou": a mesma transferência é saída de um lado e entrada do outro. Em
 * "Todas as filiais" (`null`) os dois saldos ficam zerados de propósito —
 * somar as duas pontas contaria a mesma caixa duas vezes.
 */
export function groupTransfers(rows: StockTransfer[], branchId: string | null): TransferDay[] {
  const ops = new Map<string, TransferOperation>();

  for (const t of rows) {
    const key = t.batchId ?? t.id;
    const cur = ops.get(key);
    if (cur) {
      cur.units += t.quantity;
      cur.items.push(t);
      if (t.fromSellerId) {
        if (!cur.fromSellerIds.includes(t.fromSellerId)) cur.fromSellerIds.push(t.fromSellerId);
      } else {
        cur.fromHouse = true;
      }
      if (!cur.notes && t.notes) cur.notes = t.notes;
    } else {
      ops.set(key, {
        key,
        fromBranchId: t.fromBranchId,
        toBranchId: t.toBranchId,
        fromSellerIds: t.fromSellerId ? [t.fromSellerId] : [],
        fromHouse: !t.fromSellerId,
        date: t.date,
        notes: t.notes,
        units: t.quantity,
        items: [t],
      });
    }
  }

  const days = new Map<string, TransferDay>();

  for (const op of ops.values()) {
    const dateKey = op.date.slice(0, 10);
    let day = days.get(dateKey);
    if (!day) {
      day = { dateKey, operations: [], out: 0, in: 0 };
      days.set(dateKey, day);
    }
    day.operations.push(op);
    if (branchId && op.fromBranchId === branchId) day.out += op.units;
    if (branchId && op.toBranchId === branchId) day.in += op.units;
  }

  return Array.from(days.values())
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .map(day => ({
      ...day,
      // Dentro do dia, a mais recente primeiro. `date` é o dia inteiro na
      // maioria dos lançamentos (a pessoa escolhe a data, não a hora), então
      // o id desempata para a ordem não trocar a cada render.
      operations: [...day.operations].sort(
        (a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key),
      ),
    }));
}

/** O que a filial de referência ganhou e perdeu no conjunto todo. */
export function transferTotals(rows: StockTransfer[], branchId: string | null) {
  let out = 0;
  let inn = 0;
  for (const t of rows) {
    if (branchId && t.fromBranchId === branchId) out += t.quantity;
    if (branchId && t.toBranchId === branchId) inn += t.quantity;
  }
  const operations = new Set(rows.map(t => t.batchId ?? t.id)).size;
  return { out, in: inn, operations };
}
