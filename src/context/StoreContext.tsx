import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseReceiptItemInput,
  Product,
  StockEntry,
  Sale,
  Expense,
  Investor,
  Dividend,
  Partner,
  PartnerPayment,
  Seller,
  ProductAssignment,
  SellerDebtPayment,
  SellerManualDebt,
  StockLoss,
  StockTransfer,
  CommissionPayment,
  ProLaborePayment,
  PartnerContribution,
  Loan,
  LoanPayment,
  FinancialEvent,
  FinancialEventKind,
  ArchivedModel,
} from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useBranch } from "@/context/BranchContext";
import { toast } from "sonner";
import { localDateToISO, formatDateBR } from "@/lib/date-utils";
import { sortCatalog, sortByName } from "@/lib/catalog-order";
import { numberPurchaseOrders, type UnnumberedOrder } from "@/lib/purchase-order-number";
import { hiddenModelKeys, isProductHidden } from "@/lib/archived-models";
import { fetchAllRows } from "@/lib/fetch-all-rows";

/**
 * Escrever exige uma filial concreta.
 *
 * "Todas as filiais" é somente leitura, e essa é a regra que apaga a pergunta
 * "em qual filial isso entrou?" de todo caminho de escrita. As telas que
 * operam já desabilitam a ação primária nesse modo; este guard é a rede por
 * baixo — um caminho novo que esqueça a regra falha aqui, com aviso, em vez de
 * gravar numa cidade escolhida por acaso.
 */
function requireBranch(branchId: string | null): branchId is string {
  if (!branchId) {
    toast.error("Escolha uma filial para lançar");
    return false;
  }
  return true;
}

/**
 * Onde o carregamento está, para a barra (src/components/BootProgress.tsx).
 *
 * `core` é a primeira onda — produtos, vendas, entradas, vendedores,
 * atribuições, perdas —, sem a qual as telas mostrariam zero no lugar dos
 * números. `secondary` é a financeira, que chega depois sem travar a tela.
 * `done`/`total` contam CONSULTAS terminadas, então a barra anda por fato
 * acontecido, não por relógio.
 */
export type LoadProgress = { phase: "core" | "secondary" | "done"; done: number; total: number };

/** Quantas consultas cada onda dispara — o tamanho de cada `track([...])`. */
const CORE_QUERIES = 7;
const SECONDARY_QUERIES = 14;

/** A posição do razão: a soma de cada coluna `*_delta` de `financial_events`. */
type LedgerPosition = {
  cash: number;
  inventory: number;
  receivable: number;
  partnerCapital: number;
  loan: number;
  accumulatedProfit: number;
  distributedProfit: number;
};

const EMPTY_LEDGER: LedgerPosition = {
  cash: 0,
  inventory: 0,
  receivable: 0,
  partnerCapital: 0,
  loan: 0,
  accumulatedProfit: 0,
  distributedProfit: 0,
};

/**
 * A posição somada NO BANCO, pela `ledger_position()` (migration
 * 20260924120000). Antes o front baixava o razão inteiro para somar aqui — e
 * o razão cresce várias linhas por dia, então era a primeira consulta a
 * passar do teto de 1000 linhas e a mais cara de rebaixar a cada venda.
 *
 * `null` em caso de erro: quem chama mantém o último número bom em vez de
 * zerar o Caixa na tela por causa de uma queda de rede.
 *
 * A function ainda não está no types.ts gerado: o cast é no CLIENTE e a
 * chamada continua sendo método dele (ver "Gotchas de front" no CLAUDE.md).
 */
async function fetchLedgerPosition(): Promise<LedgerPosition | null> {
  const client = supabase as unknown as SupabaseClient;
  const { data, error } = await client.rpc("ledger_position");
  if (error) {
    console.error("ledger_position:", error);
    return null;
  }
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return EMPTY_LEDGER;
  return {
    cash: Number(r.cash) || 0,
    inventory: Number(r.inventory) || 0,
    receivable: Number(r.receivable) || 0,
    partnerCapital: Number(r.partner_capital) || 0,
    loan: Number(r.loan) || 0,
    accumulatedProfit: Number(r.accumulated_profit) || 0,
    distributedProfit: Number(r.distributed_profit) || 0,
  };
}

/**
 * A recusa do gatilho `validate_assignment_fits_stock`, em português.
 *
 * O banco manda o número que ele viu junto do código (`erro:N`), e é isso que
 * permite dizer "cabem 3" em vez de "não deu" — a pessoa aprende o limite sem
 * precisar abrir outra tela para descobrir.
 */
function assignmentError(message?: string): string {
  const m = message ?? "";
  if (m.includes("atribuicao_maior_que_estoque")) {
    const cabem = m.match(/:(\d+)/)?.[1] ?? "0";
    return `A filial não tem tudo isso livre — cabem ${cabem} un.`;
  }
  if (m.includes("produto_nao_vendido_nesta_filial")) {
    return "Esta filial não vende esse produto";
  }
  return "Erro ao atribuir produto";
}

/**
 * As functions de estoque da migration 20260924130000 ainda não estão no
 * types.ts gerado. O cast é no CLIENTE e a chamada continua sendo método dele
 * (ver "Gotchas de front" no CLAUDE.md).
 */
const stockDb = supabase as unknown as SupabaseClient;

/**
 * SOMA unidades ao estoque de um sabor NUMA cidade, criando a linha de
 * `product_branch` quando aquela cidade ainda não vendia esse sabor.
 *
 * A tabela é esparsa de propósito — produto sem linha é produto que a cidade
 * não vende —, então toda entrada precisa saber criar a linha. É aqui que
 * `sale_price` e `min_stock` de referência entram como semente.
 *
 * Quem soma é o BANCO (`add_branch_stock`), num UPDATE só. Antes era
 * ler-somar-gravar daqui, e uma venda confirmada pela loja entre a leitura e a
 * escrita era sobrescrita: a unidade vendida voltava para a prateleira. Só
 * soma — tirar estoque tem regra (livre, caixa do vendedor) e mora em
 * `register_stock_loss` e `delete_stock_entry`.
 */
async function addBranchStock(
  productId: string,
  branchId: string,
  quantity: number,
  seed: { unitCost?: number; salePrice?: number; minStock?: number } = {},
): Promise<boolean> {
  const { error } = await stockDb.rpc("add_branch_stock", {
    p_product_id: productId,
    p_branch_id: branchId,
    p_quantity: quantity,
    p_unit_cost: seed.unitCost ?? null,
    p_sale_price: seed.salePrice ?? null,
    p_min_stock: seed.minStock ?? null,
  });
  if (error) {
    console.error("add_branch_stock:", error);
    toast.error(stockErrorMessage(error.message, "Erro ao atualizar o estoque da filial"));
    return false;
  }
  return true;
}

/**
 * As recusas das functions de estoque, em português. O banco manda o número
 * que viu junto do código (`codigo:N`) — é o que deixa a tela dizer o limite
 * em vez de "não deu".
 */
function stockErrorMessage(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  const n = m.match(/:(\d+)/)?.[1] ?? "0";
  if (m.includes("estoque_livre_insuficiente")) {
    return `Só ${n} un. livres no estoque da casa — o resto está com os vendedores. Escolha de quem saiu.`;
  }
  if (m.includes("estoque_vendedor_insuficiente")) return `Esse vendedor tem apenas ${n} un. deste produto`;
  if (m.includes("entrada_ja_consumida")) {
    return `Essas unidades já saíram (vendidas, perdidas ou distribuídas) — só ${n} un. livres agora. Registre uma perda em vez de excluir a entrada.`;
  }
  if (m.includes("estoque_insuficiente")) return "Estoque insuficiente nesta filial";
  if (m.includes("vendedor_de_outra_filial")) return "Esse vendedor não é desta filial";
  if (m.includes("produto_nao_vendido_nesta_filial")) return "Esta filial não vende esse produto";
  if (m.includes("filial_obrigatoria")) return "Escolha uma filial para lançar";
  if (m.includes("nao_autorizado")) return "Você não tem acesso a esta filial";
  if (m.includes("quantidade_invalida")) return "Quantidade inválida";
  return fallback;
}

interface StoreContextType {
  /** O catálogo inteiro — inclusive o que está fora de linha. Use para RESOLVER NOME. */
  products: Product[];
  /**
   * O catálogo sem os modelos arquivados (e sem estoque). É o que toda lista de
   * ESCOLHA deve ler: seletor, diálogo em lote, conta de reposição.
   */
  activeProducts: Product[];
  archivedModels: ArchivedModel[];
  /** Chaves `marca|modelo` escondidas na filial de referência. */
  hiddenModels: Set<string>;
  /** Tira modelos de linha nesta filial. Só com estoque zero — quem recusa é o banco. */
  archiveModels: (models: { brand: string; model: string }[]) => Promise<boolean>;
  unarchiveModel: (brand: string, model: string) => Promise<boolean>;
  stockEntries: StockEntry[];
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  dividends: Dividend[];
  partners: Partner[];
  sellers: Seller[];
  productAssignments: ProductAssignment[];
  sellerDebtPayments: SellerDebtPayment[];
  partnerPayments: PartnerPayment[];
  purchaseOrders: PurchaseOrder[];
  addPurchaseOrder: (o: {
    date: string;
    notes?: string;
    freightCost?: number;
    items: { brand: string; model: string; expectedQuantity: number; unitPrice?: number }[];
  }) => Promise<void>;
  deletePurchaseOrder: (id: string) => Promise<void>;
  receivePurchaseOrder: (id: string, items: PurchaseReceiptItemInput[], date: string) => Promise<boolean>;
  loading: boolean;
  loadProgress: LoadProgress;
  addProduct: (p: Omit<Product, "id" | "createdAt" | "stock">) => Promise<void>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addStockEntry: (e: Omit<StockEntry, "id" | "totalCost">) => Promise<void>;
  deleteStockEntry: (id: string) => Promise<void>;
  /** Só as que tocam a filial ativa — de um lado ou do outro. */
  stockTransfers: StockTransfer[];
  /**
   * A origem é SEMPRE a filial ativa: é o estoque dela que está na tela, e é
   * dela que as unidades saem. Para mandar no sentido contrário, troque de
   * filial — é a mesma regra de todo o resto do app.
   */
  transferBranchStock: (t: {
    toBranchId: string;
    date: string;
    notes?: string;
    /**
     * Os sabores da MESMA viagem. É uma operação só: ou vai tudo, ou não vai
     * nada — a function percorre os itens dentro de uma transação. A origem é
     * por ITEM porque juntar o que sobrou com dois vendedores continua sendo
     * uma viagem só.
     */
    items: {
      productId: string;
      quantity: number;
      /** De quem a unidade saiu. Ausente = estoque da casa. */
      fromSellerId?: string;
    }[];
  }) => Promise<boolean>;
  stockLosses: StockLoss[];
  /** `true` se a perda entrou; a recusa (teto, filial) já vira toast aqui dentro. */
  addStockLoss: (l: Omit<StockLoss, "id" | "totalCost" | "unitCost">) => Promise<boolean>;
  deleteStockLoss: (id: string) => Promise<void>;
  getTotalLossValue: () => number;
  addSale: (s: Omit<Sale, "id" | "totalPrice">) => Promise<void>;
  updateSale: (id: string, updates: Partial<Sale>) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
  addExpense: (e: Omit<Expense, "id">) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addInvestor: (i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => Promise<void>;
  updateInvestor: (id: string, i: Partial<Investor>) => Promise<void>;
  deleteInvestor: (id: string) => Promise<void>;
  addDividend: (d: Omit<Dividend, "id">) => Promise<void>;
  deleteDividend: (id: string) => Promise<void>;
  addPartner: (p: Omit<Partner, "id" | "createdAt">) => Promise<void>;
  updatePartner: (id: string, p: Partial<Partner>) => Promise<void>;
  deletePartner: (id: string) => Promise<void>;
  addPartnerPayment: (p: Omit<PartnerPayment, "id">) => Promise<void>;
  deletePartnerPayment: (id: string) => Promise<void>;
  getPartnerPaidForMonth: (partnerId: string, month: string) => number;
  addSeller: (s: Omit<Seller, "id" | "createdAt">) => Promise<void>;
  updateSeller: (id: string, s: Partial<Seller>) => Promise<void>;
  deleteSeller: (id: string) => Promise<void>;
  addProductAssignment: (a: Omit<ProductAssignment, "id" | "createdAt">) => Promise<void>;
  deleteProductAssignment: (id: string) => Promise<void>;
  transferProductAssignment: (assignmentId: string, toSellerId: string, quantity: number) => Promise<void>;
  addSellerDebtPayment: (p: Omit<SellerDebtPayment, "id">) => Promise<void>;
  deleteSellerDebtPayment: (id: string) => Promise<void>;
  sellerManualDebts: SellerManualDebt[];
  addSellerManualDebt: (d: Omit<SellerManualDebt, "id">) => Promise<void>;
  deleteSellerManualDebt: (id: string) => Promise<void>;
  commissionPayments: CommissionPayment[];
  addCommissionPayment: (p: Omit<CommissionPayment, "id">) => Promise<void>;
  deleteCommissionPayment: (id: string) => Promise<void>;
  proLaborePayments: ProLaborePayment[];
  addProLaborePayment: (p: Omit<ProLaborePayment, "id">) => Promise<void>;
  deleteProLaborePayment: (id: string) => Promise<void>;
  getSellerName: (id: string) => string;
  getTotalRevenue: () => number;
  getTotalCosts: () => number;
  getTotalExpenses: () => number;
  getTotalInvested: () => number;
  getNetProfit: () => number;
  getTotalPartnerPayments: () => number;
  getProductName: (id: string) => string;
  getInvestorName: (id: string) => string;
  getPaidToInvestor: (id: string) => number;
  getRemainingForInvestor: (id: string) => number;
  getSellerDebt: (id: string) => number;
  getSellerPaid: (id: string) => number;
  getSellerBalance: (id: string) => number;
  /** Custo unitário congelado da venda (ou o de hoje, se ela não tem). Todo CPV passa por aqui. */
  saleUnitCost: (sale: Sale) => number;
  // ---- Novo modelo financeiro ----
  partnerContributions: PartnerContribution[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  /**
   * O razão linha a linha, lido do banco NA HORA e em páginas. Não fica em
   * memória: quem precisa das linhas é só o relatório em Excel, e as posições
   * (getCash e companhia) já vêm somadas pelo banco.
   */
  loadFinancialEvents: () => Promise<FinancialEvent[]>;
  addPartnerContribution: (c: Omit<PartnerContribution, "id" | "createdAt">) => Promise<void>;
  deletePartnerContribution: (id: string) => Promise<void>;
  addLoan: (l: Omit<Loan, "id" | "createdAt">) => Promise<void>;
  updateLoan: (id: string, l: Partial<Loan>) => Promise<void>;
  deleteLoan: (id: string) => Promise<void>;
  addLoanPayment: (p: Omit<LoanPayment, "id" | "createdAt">) => Promise<void>;
  deleteLoanPayment: (id: string) => Promise<void>;
  refreshFinancialEvents: () => Promise<void>;
  refreshSales: () => Promise<void>;

  // Selectors do novo modelo (contabilidade simplificada)
  getCash: () => number;
  getInventoryCostValue: () => number;
  getReceivables: () => number;
  getPartnerCapital: () => number;
  getLoansOutstanding: () => number;
  getAccumulatedProfit: () => number;
  getDistributedProfit: () => number;
  getRetainedEarnings: () => number;
  getDistributableProfit: (pendingCommissions?: number) => number;
  getLoanPaid: (loanId: string) => number;
  getLoanRemaining: (loanId: string) => number;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [productAssignments, setProductAssignments] = useState<ProductAssignment[]>([]);
  const [sellerDebtPayments, setSellerDebtPayments] = useState<SellerDebtPayment[]>([]);
  const [partnerPayments, setPartnerPayments] = useState<PartnerPayment[]>([]);
  const [sellerManualDebts, setSellerManualDebts] = useState<SellerManualDebt[]>([]);
  const [stockLosses, setStockLosses] = useState<StockLoss[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>([]);
  const [archivedModels, setArchivedModels] = useState<ArchivedModel[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [proLaborePayments, setProLaborePayments] = useState<ProLaborePayment[]>([]);
  const [partnerContributions, setPartnerContributions] = useState<PartnerContribution[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>([]);
  const [purchaseOrdersRaw, setPurchaseOrdersRaw] = useState<UnnumberedOrder[]>([]);
  /** Quem é exposto (e quem as ações leem) é sempre o numerado — ver `numberPurchaseOrders`. */
  const purchaseOrders = useMemo(() => numberPurchaseOrders(purchaseOrdersRaw), [purchaseOrdersRaw]);
  const [ledgerTotals, setLedgerTotals] = useState<LedgerPosition>(EMPTY_LEDGER);
  /** Custo unitário CONGELADO de cada venda, por id (tabela `sale_costs`). */
  const [saleCosts, setSaleCosts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ phase: "core", done: 0, total: CORE_QUERIES });
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { branchId, branches } = useBranch();

  /**
   * A lista de produtos vem de `get_branch_products`, não mais de um SELECT em
   * `products`: preço, estoque e mínimo passaram para `product_branch`, e é a
   * function que junta identidade e números da cidade na FORMA que o front já
   * consumia. É por isso que o tipo `Product` não mudou — `ProductsPage`,
   * `InsightsPage`, `restock.ts` e `seller-stock.ts` continuam lendo
   * `product.stock` e `product.salePrice` como sempre.
   *
   * Com `branchId` nulo ("Todas") a function agrega: estoque somado, preço o
   * maior, mais `price_varies` avisando que aquele preço é um teto, não uma
   * etiqueta.
   */
  const fetchProductsList = useCallback(async (): Promise<Product[]> => {
    // As duas RPCs em paralelo: uma não depende da outra, e em fila cada
    // recarga do catálogo (a abertura e toda venda vinda do realtime) pagava
    // duas idas ao banco uma atrás da outra.
    const [{ data, error }, costsRes] = await Promise.all([
      supabase.rpc("get_branch_products", { p_branch_id: branchId }),
      isAdmin ? supabase.rpc("get_product_costs", { p_branch_id: branchId }) : Promise.resolve(null),
    ]);
    if (error) throw error;
    if (!data) return [];
    let costs: Record<string, number> = {};
    const c = costsRes?.data;
    if (c) costs = Object.fromEntries(c.map((r) => [r.product_id, Number(r.purchase_price)]));
    return data.map((r: any) => ({
      id: r.id,
      name: r.name,
      brand: r.brand,
      model: r.model || "",
      flavor: r.flavor,
      purchasePrice: costs[r.id] ?? 0,
      salePrice: Number(r.sale_price),
      stock: Number(r.stock ?? 0),
      minStock: Number(r.min_stock ?? 0),
      imageUrl: r.image_url || undefined,
      createdAt: r.created_at,
      priceVaries: r.price_varies === true,
    }));
  }, [isAdmin, branchId]);

  /**
   * O filtro de filial na consulta, para as tabelas que têm `branch_id`
   * próprio. Com `branchId` nulo ("Todas") nada é acrescentado e a RLS já
   * garante que só vem o que a pessoa alcança — "todas" quer dizer "todas as
   * minhas", nunca "todas as do banco".
   */
  const scoped = useCallback(
    // O `as any` aqui é CARREGADOR, não resíduo de tipo faltando. Com a
    // restrição escrita à mão (`T extends { eq(...): T }`) o TypeScript tenta
    // resolver o tipo do query builder do supabase-js, que é recursivo, e
    // estoura com "Type instantiation is excessively deep" em toda chamada de
    // `scoped` — dez erros de uma vez, medidos. O genérico externo preserva o
    // tipo de quem chama; o que se perde é só a checagem de que o builder tem
    // `.eq`, e todo uso desta função passa um builder.
    <T,>(q: T): T => (branchId ? ((q as any).eq("branch_id", branchId) as T) : q),
    [branchId],
  );

  /**
   * As transferências que TOCAM a filial ativa, de um lado ou do outro — a
   * que saiu daqui e a que chegou aqui contam as duas. Por isso não dá para
   * usar o `scoped`: o filtro é um OR entre duas colunas, não uma igualdade
   * em `branch_id`.
   */
  const fetchTransfers = useCallback(async () => {
    let q: any = supabase
      .from("stock_transfers")
      .select("*")
      .order("date", { ascending: false })
      .limit(200);
    if (branchId) q = q.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
    const { data } = await q;
    if (data) setStockTransfers(data.map(mapStockTransfer));
  }, [branchId]);

  /**
   * Os modelos arquivados de TODAS as filiais que a pessoa alcança, não só os
   * da ativa: em "Todas as filiais" a tela só esconde o que as duas cidades
   * arquivaram, e para saber isso é preciso ter as duas na mão. A RLS já corta
   * pelo que ela administra, e a tabela é de uma linha por modelo fora de linha
   * — não há o que paginar.
   */
  const fetchArchivedModels = useCallback(async () => {
    const { data } = await supabase.from("archived_models").select("*");
    if (data) setArchivedModels(data.map(mapArchivedModel));
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Wave 1: dados essenciais para as telas de operação (produtos, vendas, estoque, vendedores).
    //
    // `product_assignments` NÃO leva filtro na consulta: ela não tem
    // `branch_id` — a filial dela vem do vendedor. A RLS já corta pelo que a
    // pessoa alcança, e o recorte pela filial ATIVA é feito em memória, pelo
    // conjunto de `seller_id` da cidade (ver `branchSellerIds` mais abaixo).
    // A tabela vem inteira hoje e é pequena; consultar por uma lista de ids
    // seria uma consulta a mais para o mesmo resultado.
    // Cada consulta que termina (bem ou mal) anda um passo da barra de
    // carregamento — ver `loadProgress`. `Promise.resolve` porque o builder do
    // supabase é thenable, não Promise, e não tem `.finally`.
    const track = (items: unknown[]) =>
      items.map((p) =>
        Promise.resolve(p).finally(() => {
          if (!cancelled) setLoadProgress((prev) => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));
        }),
      );

    const fetchCore = async () => {
      const [prodList, stockRes, salesRes, selRes, paRes, slRes, costRes] = (await Promise.all(track([
        fetchProductsList(),
        // Histórico passa por `fetchAllRows`: cresce com o uso e um dia passa
        // do teto de 1000 linhas por consulta, que corta sem avisar.
        fetchAllRows(() =>
          scoped(supabase.from("stock_entries").select("*")).order("created_at", { ascending: true }).order("id"),
        ),
        fetchAllRows(() =>
          scoped(supabase.from("sales").select("*")).order("created_at", { ascending: true }).order("id"),
        ),
        scoped(supabase.from("sellers").select("*")).order("created_at", { ascending: true }),
        supabase
          .from("product_assignments")
          .select("*")
          .order("created_at", { ascending: true }),
        fetchAllRows(() =>
          scoped(supabase.from("stock_losses").select("*")).order("created_at", { ascending: true }).order("id"),
        ),
        // O custo congelado de cada venda (`sale_costs`, só admin — a RLS
        // corta pelas filiais dele). Sem ele o CPV usa o custo de HOJE e cada
        // lote novo reescreve o lucro do passado. Falha (tabela ainda não
        // criada, vendedor) é lista vazia: o custo cai no do produto, que é a
        // leitura antiga.
        isAdmin
          ? fetchAllRows(() => stockDb.from("sale_costs").select("sale_id, unit_cost").order("sale_id"))
          : Promise.resolve({ data: [], error: null }),
      // `as any`: o `track` devolve `unknown[]`, e cada `.data` é mapeado logo
      // abaixo por uma função que valida a forma da linha. (Tipar a tupla
      // estourava com "Type instantiation is excessively deep" nos tipos
      // recursivos do query builder — o mesmo motivo do `scoped` acima.)
      ]))) as any;
      if (cancelled) return;
      setProducts(prodList);
      // Junto da primeira onda de propósito: chega depois, a lista de produtos
      // pisca com os arquivados dentro antes de se corrigir sozinha.
      void fetchArchivedModels();
      if (stockRes.data) setStockEntries(stockRes.data.map(mapStockEntry));
      if (salesRes.data) setSales(salesRes.data.map(mapSale));
      if (selRes.data) setSellers(selRes.data.map(mapSeller));
      if (paRes.data) setProductAssignments(paRes.data.map(mapProductAssignment));
      if (slRes?.data) setStockLosses(slRes.data.map(mapStockLoss));
      if (costRes?.data) {
        setSaleCosts(new Map(costRes.data.map((r: any) => [r.sale_id as string, Number(r.unit_cost)])));
      }
    };

    // Wave 2: dados financeiros/administrativos, carregados logo em seguida sem travar a tela.
    const fetchSecondary = async () => {
      const [
        expRes,
        invRes,
        divRes,
        partRes,
        sdpRes,
        ppRes,
        smdRes,
        cpRes,
        plRes,
        pcRes,
        loanRes,
        lpRes,
        feRes,
        poRes,
      ] = (await Promise.all(track([
        fetchAllRows(() =>
          scoped(supabase.from("expenses").select("*")).order("created_at", { ascending: true }).order("id"),
        ),
        supabase.from("investors").select("*").order("created_at", { ascending: true }),
        supabase.from("dividends").select("*").order("created_at", { ascending: true }),
        supabase.from("partners").select("*").order("created_at", { ascending: true }),
        supabase
          .from("seller_debt_payments")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("partner_payments")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("seller_manual_debts")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("commission_payments")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("pro_labore_payments")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("partner_contributions")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("loans")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase
          .from("loan_payments")
          .select("*")
          .order("created_at", { ascending: true }),
        // Só a POSIÇÃO, já somada pelo banco — o razão linha a linha não
        // entra na memória (ver `fetchLedgerPosition`).
        fetchLedgerPosition(),
        supabase
          .from("purchase_orders")
          .select("*, purchase_order_items(*)")
          .order("created_at", { ascending: false }),
      // `as any`: mesmo motivo da primeira onda.
      ]))) as any;
      if (cancelled) return;
      if (expRes.data) setExpenses(expRes.data.map(mapExpense));
      if (invRes.data) setInvestors(invRes.data.map(mapInvestor));
      if (divRes.data) setDividends(divRes.data.map(mapDividend));
      if (partRes.data) setPartners(partRes.data.map(mapPartner));
      if (sdpRes.data) setSellerDebtPayments(sdpRes.data.map(mapSellerDebtPayment));
      if (ppRes.data) setPartnerPayments(ppRes.data.map(mapPartnerPayment));
      if (smdRes.data) setSellerManualDebts(smdRes.data.map(mapSellerManualDebt));
      if (cpRes?.data) setCommissionPayments(cpRes.data.map(mapCommissionPayment));
      if (plRes?.data) setProLaborePayments(plRes.data.map(mapProLaborePayment));
      if (pcRes?.data) setPartnerContributions(pcRes.data.map(mapPartnerContribution));
      if (loanRes?.data) setLoans(loanRes.data.map(mapLoan));
      if (lpRes?.data) setLoanPayments(lpRes.data.map(mapLoanPayment));
      if (feRes) setLedgerTotals(feRes);
      if (poRes?.data) setPurchaseOrdersRaw(poRes.data.map(mapPurchaseOrder));
      // Fora do Promise.all porque o filtro é um OR entre duas colunas, e a
      // consulta é só de admin (a RLS de stock_transfers exige o papel).
      if (isAdmin) await fetchTransfers();
    };

    // As fases andam nos `finally`: erro numa consulta não pode deixar a barra
    // parada para sempre — tela presa carregando é pior que qualquer aviso.
    const fetchAll = async () => {
      setLoading(true);
      setLoadProgress({ phase: "core", done: 0, total: CORE_QUERIES });
      try {
        await fetchCore();
      } catch (err) {
        console.error("Error fetching data:", err);
        toast.error("Erro ao carregar dados");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadProgress({ phase: "secondary", done: 0, total: SECONDARY_QUERIES });
        }
      }
      try {
        await fetchSecondary();
      } catch (err) {
        console.error("Error fetching financial data:", err);
      } finally {
        if (!cancelled) setLoadProgress((prev) => ({ ...prev, phase: "done", done: prev.total }));
      }
    };
    fetchAll();

    // ---- Realtime sync: any change in shared tables refreshes the affected slice ----
    let feTimer: ReturnType<typeof setTimeout> | null = null;
    const refetchFinancialEvents = () => {
      if (feTimer) clearTimeout(feTimer);
      // Reler a posição custa sete números, não o razão inteiro — é o que
      // cada venda de outra aba dispara.
      feTimer = setTimeout(async () => {
        const position = await fetchLedgerPosition();
        if (position && !cancelled) setLedgerTotals(position);
      }, 400);
    };

    // Aplica a linha recebida no evento em vez de recarregar a tabela inteira.
    const patch = <T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      payload: any,
      mapper: (r: any) => T,
    ) => {
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row?.id) return;
      if (payload.eventType === "DELETE") {
        setter((prev) => prev.filter((x) => x.id !== row.id));
        return;
      }
      const mapped = mapper(row);
      setter((prev) =>
        prev.some((x) => x.id === mapped.id)
          ? prev.map((x) => (x.id === mapped.id ? { ...x, ...mapped } : x))
          : [...prev, mapped],
      );
    };

    // Só chega evento da filial ativa. O `filter` do realtime é do Postgres,
    // não do cliente: sem ele, a venda feita na outra cidade entraria na lista
    // desta — e o `patch` acrescenta a linha sem perguntar de onde ela veio.
    const onBranch = (table: string) =>
      branchId
        ? { event: "*" as const, schema: "public", table, filter: `branch_id=eq.${branchId}` }
        : { event: "*" as const, schema: "public", table };

    // Com espera, como a posição do razão: um pedido de catálogo com cinco
    // sabores confirmado gera cinco UPDATEs em `product_branch`, e cada um
    // recarregava o catálogo inteiro. Agora a rajada vira uma recarga só.
    let productsTimer: ReturnType<typeof setTimeout> | null = null;
    const reloadProducts = () => {
      if (productsTimer) clearTimeout(productsTimer);
      productsTimer = setTimeout(async () => {
        try {
          const list = await fetchProductsList();
          if (!cancelled) setProducts(list);
        } catch (err) {
          // Falha aqui mantém o catálogo que já está na tela; a próxima
          // mudança tenta de novo.
          console.error("reloadProducts:", err);
        }
      }, 400);
    };

    let channel = supabase
      .channel(isAdmin ? "admin:store-sync" : "store-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, async (payload: any) => {
        // Produtos precisam do custo (RPC de admin), então recarregamos a lista completa.
        if (payload.eventType === "DELETE") {
          setProducts((prev) => prev.filter((p) => p.id !== payload.old?.id));
        } else {
          reloadProducts();
        }
        refetchFinancialEvents();
      })
      // Estoque e preço não moram mais em `products`: sem esta assinatura a
      // tela pararia de reagir à venda feita em outra aba, que é justamente o
      // que o realtime existe para cobrir. Recarrega a lista inteira pelo mesmo
      // motivo de sempre — o custo vem de outra RPC, e remendar meia linha aqui
      // deixaria a margem da tela mentindo.
      .on("postgres_changes", onBranch("product_branch"), () => {
        reloadProducts();
        refetchFinancialEvents();
      })
      .on("postgres_changes", onBranch("sales"), (payload: any) => {
        patch(setSales, payload, mapSale);
        refetchFinancialEvents();
      })
      .on("postgres_changes", onBranch("stock_entries"), (payload: any) => {
        patch(setStockEntries, payload, mapStockEntry);
        refetchFinancialEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "product_assignments" }, (payload: any) => {
        patch(setProductAssignments, payload, mapProductAssignment);
      })
      .on("postgres_changes", onBranch("sellers"), (payload: any) => {
        patch(setSellers, payload, mapSeller);
      })
      .on("postgres_changes", onBranch("stock_losses"), (payload: any) => {
        patch(setStockLosses, payload, mapStockLoss);
        refetchFinancialEvents();
      });

    // Tabelas financeiras são restritas a administradores: só assinamos quando o usuário é admin.
    if (isAdmin) {
      channel = channel
        // Sem `filter`: o realtime só filtra por igualdade numa coluna, e aqui
        // interessam as duas pontas. A RLS já entrega só o que toca uma filial
        // alcançável, então o recorte acontece do lado do banco de qualquer
        // jeito — o `fetchTransfers` reaplica o da filial ATIVA.
        .on("postgres_changes", { event: "*", schema: "public", table: "stock_transfers" }, () => {
          void fetchTransfers();
        })
        // Recarrega a lista inteira: a chave é composta (filial + marca +
        // modelo), e o `patch` remenda por `id`, que esta tabela não tem.
        .on("postgres_changes", { event: "*", schema: "public", table: "archived_models" }, () => {
          void fetchArchivedModels();
        })
        .on("postgres_changes", onBranch("expenses"), refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "commission_payments" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "pro_labore_payments" }, refetchFinancialEvents)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "partner_contributions" },
          refetchFinancialEvents,
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "loans" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "loan_payments" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "seller_manual_debts" }, refetchFinancialEvents)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "seller_debt_payments" },
          refetchFinancialEvents,
        );
    }

    channel.subscribe();

    return () => {
      cancelled = true;
      if (feTimer) clearTimeout(feTimer);
      if (productsTimer) clearTimeout(productsTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchProductsList, isAdmin, branchId, scoped, fetchTransfers, fetchArchivedModels]);

  const mapArchivedModel = (r: any): ArchivedModel => ({
    branchId: r.branch_id,
    brand: r.brand,
    model: r.model,
    archivedAt: r.archived_at,
  });

  const mapStockEntry = (r: any): StockEntry => ({
    id: r.id,
    productId: r.product_id,
    quantity: r.quantity,
    unitCost: Number(r.unit_cost),
    totalCost: Number(r.total_cost),
    date: r.date,
    notes: r.notes,
    branchId: r.branch_id ?? undefined,
  });

  const mapSale = (r: any): Sale => ({
    id: r.id,
    productId: r.product_id,
    quantity: r.quantity,
    unitPrice: Number(r.unit_price),
    totalPrice: Number(r.total_price),
    date: r.date,
    notes: r.notes,
    installments: r.installments ?? 1,
    paidAmount: Number(r.paid_amount ?? 0),
    paidAt: r.paid_at || undefined,
    sellerId: r.seller_id || undefined,
    type: r.type === "retirada_funcionario" ? "retirada_funcionario" : "venda",
    paymentMethod: [
      "pix",
      "dinheiro",
      "pix_pendente",
      "dinheiro_pendente",
      "dinheiro_com_vendedor",
      "pendente",
    ].includes(r.payment_method)
      ? r.payment_method
      : undefined,
  });

  const mapSeller = (r: any): Seller => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    debtPercentage: r.debt_percentage != null ? Number(r.debt_percentage) : 10,
    branchId: r.branch_id ?? undefined,
    slug: r.slug ?? undefined,
  });

  const mapProductAssignment = (r: any): ProductAssignment => ({
    id: r.id,
    sellerId: r.seller_id,
    productId: r.product_id,
    quantity: r.quantity,
    notes: r.notes,
    createdAt: r.created_at,
  });

  const mapSellerDebtPayment = (r: any): SellerDebtPayment => ({
    id: r.id,
    sellerId: r.seller_id,
    saleId: r.sale_id || undefined,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapSellerManualDebt = (r: any): SellerManualDebt => ({
    id: r.id,
    sellerId: r.seller_id,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapStockLoss = (r: any): StockLoss => ({
    id: r.id,
    productId: r.product_id,
    quantity: r.quantity,
    unitCost: Number(r.unit_cost),
    totalCost: Number(r.total_cost),
    reason: r.reason || undefined,
    date: r.date,
    sellerId: r.seller_id || undefined,
    branchId: r.branch_id ?? undefined,
  });

  const mapStockTransfer = (r: any): StockTransfer => ({
    id: r.id,
    productId: r.product_id,
    fromBranchId: r.from_branch_id,
    toBranchId: r.to_branch_id,
    fromSellerId: r.from_seller_id ?? undefined,
    batchId: r.batch_id ?? undefined,
    quantity: Number(r.quantity ?? 0),
    unitCost: Number(r.unit_cost ?? 0),
    date: r.date,
    notes: r.notes || undefined,
    createdAt: r.created_at,
  });

  const mapExpense = (r: any): Expense => ({
    id: r.id,
    description: r.description,
    category: r.category,
    amount: Number(r.amount),
    date: r.date,
  });

  const mapInvestor = (r: any): Investor => ({
    id: r.id,
    name: r.name,
    investedAmount: Number(r.invested_amount),
    returnPercentage: Number(r.return_percentage),
    totalReturn: Number(r.total_return),
    createdAt: r.created_at,
  });

  const mapDividend = (r: any): Dividend => ({
    id: r.id,
    investorId: r.investor_id,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapPartner = (r: any): Partner => ({
    id: r.id,
    name: r.name,
    percentage: Number(r.percentage),
    monthlyProLabore: Number(r.monthly_pro_labore ?? 0),
    createdAt: r.created_at,
  });

  const mapPartnerPayment = (r: any): PartnerPayment => ({
    id: r.id,
    partnerId: r.partner_id,
    month: r.month,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapCommissionPayment = (r: any): CommissionPayment => ({
    id: r.id,
    sellerId: r.seller_id,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapProLaborePayment = (r: any): ProLaborePayment => ({
    id: r.id,
    partnerId: r.partner_id,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
  });

  const mapPartnerContribution = (r: any): PartnerContribution => ({
    id: r.id,
    partnerId: r.partner_id,
    amount: Number(r.amount),
    date: r.date,
    notes: r.notes,
    createdAt: r.created_at,
  });

  const mapLoan = (r: any): Loan => ({
    id: r.id,
    lenderName: r.lender_name,
    principal: Number(r.principal),
    interestAmount: Number(r.interest_amount ?? 0),
    receivedDate: r.received_date,
    notes: r.notes,
    createdAt: r.created_at,
  });

  const mapLoanPayment = (r: any): LoanPayment => ({
    id: r.id,
    loanId: r.loan_id,
    principalAmount: Number(r.principal_amount ?? 0),
    interestAmount: Number(r.interest_amount ?? 0),
    date: r.date,
    notes: r.notes,
    createdAt: r.created_at,
  });

  const mapFinancialEvent = (r: any): FinancialEvent => ({
    id: r.id,
    kind: r.kind as FinancialEventKind,
    date: r.event_date,
    createdAt: r.created_at,
    description: r.description,
    amount: Number(r.amount),
    cashDelta: Number(r.cash_delta),
    inventoryDelta: Number(r.inventory_delta),
    receivableDelta: Number(r.receivable_delta),
    loanDelta: Number(r.loan_delta),
    partnerCapitalDelta: Number(r.partner_capital_delta),
    accumulatedProfitDelta: Number(r.accumulated_profit_delta),
    distributedProfitDelta: Number(r.distributed_profit_delta),
    refTable: r.ref_table,
    refId: r.ref_id,
    notes: r.notes ?? undefined,
  });

  const mapPurchaseOrder = (r: any): UnnumberedOrder => ({
    id: r.id,
    status: r.status === "received" ? "received" : "pending",
    date: r.date,
    notes: r.notes ?? undefined,
    paidAmount: Number(r.paid_amount ?? 0),
    freightCost: Number(r.freight_cost ?? 0),
    receivedAt: r.received_at ?? undefined,
    createdAt: r.created_at,
    items: (r.purchase_order_items ?? []).map(
      (i): PurchaseOrderItem => ({
        id: i.id,
        purchaseOrderId: i.purchase_order_id,
        brand: i.brand ?? "",
        model: i.model ?? "",
        expectedQuantity: Number(i.expected_quantity ?? 0),
        unitPrice: Number(i.unit_price ?? 0),
        receivedFlavors: Array.isArray(i.received_flavors)
          ? i.received_flavors.map((f) => ({
              flavor: String(f.flavor ?? ""),
              quantity: Number(f.quantity ?? 0),
            }))
          : [],
      }),
    ),
  });

  // ---- Compras aguardando recebimento ----
  const addPurchaseOrder = useCallback(
    async (o: {
      date: string;
      notes?: string;
      freightCost?: number;
      items: { brand: string; model: string; expectedQuantity: number; unitPrice?: number }[];
    }) => {
      const items = o.items.filter((i) => i.brand.trim() && i.model.trim() && i.expectedQuantity > 0);
      if (items.length === 0) {
        toast.error("Informe ao menos um item com quantidade maior que zero");
        return;
      }
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({
          date: o.date,
          notes: o.notes ?? null,
          status: "pending",
          paid_amount: items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.expectedQuantity, 0),
          freight_cost: o.freightCost ?? 0,
        })
        .select("*")
        .single();
      if (error || !data) {
        toast.error("Erro ao criar compra");
        return;
      }
      const orderId = data.id;
      const { data: itemRows, error: itemErr } = await supabase
        .from("purchase_order_items")
        .insert(
          items.map((i) => ({
            purchase_order_id: orderId,
            brand: i.brand.trim(),
            model: i.model.trim(),
            expected_quantity: i.expectedQuantity,
            unit_price: i.unitPrice ?? 0,
            received_flavors: [],
          })),
        )
        .select("*");
      if (itemErr) {
        await supabase
          .from("purchase_orders")
          .delete()
          .eq("id", orderId);
        toast.error("Erro ao salvar itens da compra");
        return;
      }
      setPurchaseOrdersRaw((prev) => [
        mapPurchaseOrder({ ...data, purchase_order_items: itemRows ?? [] }),
        ...prev,
      ]);
      toast.success("Compra registrada (aguardando recebimento)");
    },
    [],
  );

  const deletePurchaseOrder = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("purchase_orders")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir compra");
      return;
    }
    setPurchaseOrdersRaw((prev) => prev.filter((o) => o.id !== id));
    toast.success("Compra excluída");
  }, []);

  // Recebimento: só aqui o estoque é movimentado. A troca de status é atômica
  // (só ocorre se a compra ainda estiver "pending"), impedindo entrada duplicada.
  //
  // A compra é CENTRAL — `purchase_orders` não tem filial, porque o fornecedor
  // entrega uma vez e o frete é da compra inteira, não de uma cidade. Quem
  // divide é o recebimento, que já era a única porta que mexia em estoque por
  // aqui: cada linha de sabor diz para qual filial aquelas unidades foram.
  // A validação que existe (soma === esperado) continua valendo sobre a SOMA
  // das linhas, então dividir 10 em 6/4 passa e 6/3 não.
  const receivePurchaseOrder = useCallback(
    async (id: string, receiptItems: PurchaseReceiptItemInput[], date: string): Promise<boolean> => {
      const order = purchaseOrders.find((o) => o.id === id);
      if (!order) {
        toast.error("Compra não encontrada");
        return false;
      }
      if (order.status === "received") {
        toast.error("Esta compra já foi recebida");
        return false;
      }

      for (const item of order.items) {
        const input = receiptItems.find((r) => r.itemId === item.id);
        const total = (input?.flavors ?? []).reduce((s, f) => s + (Number(f.quantity) || 0), 0);
        if ((input?.flavors ?? []).some((f) => !f.flavor.trim() || Number(f.quantity) < 0)) {
          toast.error("Verifique os sabores e quantidades informados");
          return false;
        }
        // Filial por linha, e a checagem vem ANTES do claim atômico: recusar
        // depois de carimbar a compra como recebida deixaria estoque pela
        // metade e a compra fechada.
        if ((input?.flavors ?? []).some((f) => !(f.branchId ?? branchId))) {
          toast.error("Escolha a filial de cada sabor recebido");
          return false;
        }
        if (total !== item.expectedQuantity) {
          toast.error(`${item.brand} ${item.model}: recebido ${total} de ${item.expectedQuantity}`);
          return false;
        }
      }

      // O catálogo é COMPARTILHADO, e a identidade do sabor é procurada no
      // catálogo INTEIRO — não na lista da tela. A lista vem filtrada pela
      // filial ativa, e um sabor que hoje só existe na outra cidade não estaria
      // nela: cadastrar de novo criaria uma segunda linha do mesmo sabor em
      // `products` (não há unique em marca+modelo+sabor), e a partir daí o
      // catálogo teria duas identidades para o mesmo produto.
      //
      // Vem ANTES do claim de propósito: falhar aqui depois de carimbar a
      // compra como recebida deixaria a compra fechada e o estoque não lançado.
      const { data: catalog, error: catalogErr } = await supabase
        .from("products")
        .select("id,brand,model,flavor");
      if (catalogErr) {
        toast.error("Erro ao ler o catálogo");
        return false;
      }
      const identity = new Map<string, { id: string; salePrice: number; minStock: number }>();
      for (const row of catalog ?? []) {
        const known = products.find((p) => p.id === row.id);
        identity.set(`${row.brand}|${row.model || ""}|${row.flavor}`.toLowerCase(), {
          id: row.id,
          // Preço e mínimo são DA CIDADE: só chegam aqui quando o sabor já é
          // vendido na filial ATIVA. Zero significa "não sei ainda", e quem
          // resolve isso é o `seedPrice` lá embaixo — linha de
          // `product_branch` criada com preço zero venderia de graça.
          salePrice: known?.salePrice ?? 0,
          minStock: known?.minStock ?? 0,
        });
      }

      // Claim atômico do recebimento
      const { data: claimed, error: claimErr } = await supabase
        .from("purchase_orders")
        .update({ status: "received", received_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("*");
      if (claimErr || !claimed || claimed.length === 0) {
        toast.error("Esta compra já foi recebida");
        return false;
      }

      const newEntries: StockEntry[] = [];

      for (const item of order.items) {
        const input = receiptItems.find((r) => r.itemId === item.id);
        if (!input) continue;
        const unitCost = Number(input.unitCost) || 0;
        for (const f of input.flavors) {
          const flavor = f.flavor.trim();
          const qty = Number(f.quantity) || 0;
          const lineBranch = f.branchId ?? branchId;
          if (!flavor || qty <= 0 || !lineBranch) continue;

          const key = `${item.brand}|${item.model}|${flavor}`.toLowerCase();
          // Um sabor do mesmo modelo serve de referência para preço e mínimo —
          // é o que evita a linha nova de `product_branch` nascer valendo zero,
          // que na loja é vender de graça.
          const reference = products.find(
            (p) =>
              p.brand.toLowerCase() === item.brand.toLowerCase() &&
              (p.model || "").toLowerCase() === item.model.toLowerCase(),
          );
          let product = identity.get(key);
          if (!product) {
            const { data: created, error: prodErr } = await supabase
              .from("products")
              .insert({
                name: item.model,
                brand: item.brand,
                model: item.model,
                flavor,
              })
              .select("id")
              .single();
            if (prodErr || !created) {
              toast.error(`Erro ao criar produto ${item.model} · ${flavor}`);
              continue;
            }
            product = {
              id: created.id,
              salePrice: input.salePrice ?? reference?.salePrice ?? 0,
              minStock: reference?.minStock ?? 0,
            };
            identity.set(key, product);
          }

          const totalCost = qty * unitCost;
          const { data: entry, error: entryErr } = await supabase
            .from("stock_entries")
            .insert({
              product_id: product.id,
              quantity: qty,
              unit_cost: unitCost,
              total_cost: totalCost,
              branch_id: lineBranch,
              date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? localDateToISO(date) : date,
              // A data, e não o "#N": o número é posicional e muda quando uma
              // compra anterior é excluída. Gravado num texto que fica para
              // sempre, ele passaria a apontar para a compra errada — a data da
              // compra não se mexe. (Entradas antigas guardam o "#N" de antes.)
              notes: `Compra de ${formatDateBR(order.date)}`,
            })
            .select()
            .single();
          if (entryErr || !entry) {
            toast.error(`Erro ao registrar entrada de ${flavor}`);
            continue;
          }
          if (lineBranch === branchId || !branchId) newEntries.push(mapStockEntry(entry));

          // Só é USADO quando a linha de `product_branch` ainda não existe
          // naquela cidade. O preço da própria filial ativa manda; depois o
          // que a tela informou no recebimento; depois o de outro sabor do
          // mesmo modelo. Zero é o último recurso e significa que ninguém
          // sabia — e é por isso que existe o aviso de preço na tela.
          const seedPrice = product.salePrice || input.salePrice || reference?.salePrice || 0;
          await addBranchStock(product.id, lineBranch, qty, {
            unitCost,
            salePrice: seedPrice,
            minStock: product.minStock || reference?.minStock || 0,
          });
        }
        await supabase
          .from("purchase_order_items")
          .update({
            received_flavors: input.flavors
              .filter((f) => f.flavor.trim())
              .map((f) => ({ ...f, branchId: f.branchId ?? branchId })),
          })
          .eq("id", item.id);
      }

      // A lista inteira, e não um remendo linha a linha: o recebimento pode
      // ter tocado uma cidade que nem está na tela, e o custo vem de outra RPC.
      setProducts(await fetchProductsList());
      setStockEntries((prev) => [...prev, ...newEntries]);
      setPurchaseOrdersRaw((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                status: "received",
                receivedAt: new Date().toISOString(),
                items: o.items.map((it) => ({
                  ...it,
                  receivedFlavors: (receiptItems.find((r) => r.itemId === it.id)?.flavors ?? []).filter((f) =>
                    f.flavor.trim(),
                  ),
                })),
              }
            : o,
        ),
      );
      toast.success(`Compra #${order.number} recebida e estoque atualizado`);
      return true;
    },
    [purchaseOrders, products, branchId, fetchProductsList],
  );

  // ---- Products ----
  // Cadastrar um sabor passa a escrever em DUAS tabelas: a identidade em
  // `products` (compartilhada pela rede) e o dinheiro em `product_branch` (da
  // cidade ativa). O produto nasce existindo só onde foi cadastrado — é a
  // esparsidade funcionando: a outra cidade não vende o que não recebeu preço.
  const addProduct = useCallback(
    async (p: Omit<Product, "id" | "createdAt" | "stock">) => {
      if (!requireBranch(branchId)) return;
      const { data, error } = await supabase
        .from("products")
        .insert({
          name: p.name,
          brand: p.brand,
          model: p.model,
          flavor: p.flavor,
          image_url: p.imageUrl || null,
        })
        .select("id")
        .single();
      if (error || !data) {
        toast.error("Erro ao adicionar produto");
        return;
      }
      const { error: pbErr } = await supabase.from("product_branch").insert({
        product_id: data.id,
        branch_id: branchId,
        purchase_price: p.purchasePrice,
        sale_price: p.salePrice,
        stock: 0,
        min_stock: p.minStock ?? 0,
      });
      if (pbErr) {
        // A identidade sem preço é um produto que não existe em cidade
        // nenhuma: desfaz, em vez de deixar um sabor fantasma no catálogo.
        await supabase.from("products").delete().eq("id", data.id);
        toast.error("Erro ao cadastrar o produto nesta filial");
        return;
      }
      setProducts(await fetchProductsList());
    },
    [branchId, fetchProductsList],
  );

  const updateProduct = useCallback(
    async (id: string, updates: Partial<Product>) => {
      // Identidade vai para `products` (vale na rede); dinheiro e estoque vão
      // para `product_branch` da cidade ativa. Em "Todas" a edição nem é
      // oferecida pela tela — mudar um preço ali significaria mudar dois.
      const identity: any = {};
      if (updates.name !== undefined) identity.name = updates.name;
      if (updates.brand !== undefined) identity.brand = updates.brand;
      if (updates.flavor !== undefined) identity.flavor = updates.flavor;
      if (updates.model !== undefined) identity.model = updates.model;
      if (updates.imageUrl !== undefined) identity.image_url = updates.imageUrl || null;

      const branchFields: any = {};
      if (updates.purchasePrice !== undefined) branchFields.purchase_price = updates.purchasePrice;
      if (updates.salePrice !== undefined) branchFields.sale_price = updates.salePrice;
      if (updates.stock !== undefined) branchFields.stock = updates.stock;
      if (updates.minStock !== undefined) branchFields.min_stock = updates.minStock;

      if (Object.keys(identity).length > 0) {
        const { error } = await supabase.from("products").update(identity).eq("id", id);
        if (error) {
          toast.error("Erro ao atualizar produto");
          return;
        }
      }

      if (Object.keys(branchFields).length > 0) {
        if (!requireBranch(branchId)) return;
        const { error } = await supabase
          .from("product_branch")
          .update(branchFields)
          .eq("product_id", id)
          .eq("branch_id", branchId);
        if (error) {
          toast.error("Erro ao atualizar produto");
          return;
        }
      }

      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    },
    [branchId],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      const product = products.find((p) => p.id === id);
      /**
       * Primeiro excluir, DEPOIS fotografar. Produto com histórico (venda,
       * entrada, perda, transferência, pedido) não sai mais — a chave de
       * produto nessas tabelas é RESTRICT desde a migration 20260924140000,
       * porque o CASCADE de antes apagava junto todo o passado dele. Com a
       * fotografia antes, cada recusa deixaria um registro de "excluído" de um
       * produto que continua existindo.
       */
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) {
        // 23503 = foreign_key_violation: tem histórico preso a ele.
        if (error.code === "23503") {
          toast.error("Este produto tem histórico (vendas, entradas ou perdas) — arquive o modelo em vez de excluir", {
            description: "Em Produtos › Modelos. Arquivar tira das listas sem apagar o passado.",
          });
        } else {
          toast.error("Erro ao excluir produto");
        }
        return;
      }
      if (product) {
        const { data: userData } = await supabase.auth.getUser();
        // A fotografia é dos números DA FILIAL ATIVA — que é o que estava na
        // tela quando alguém apertou excluir. Em "Todas" seriam os somados, e
        // a tela não oferece exclusão nesse modo.
        await supabase.from("deleted_products").insert({
          original_id: product.id,
          name: product.name,
          brand: product.brand,
          model: product.model,
          flavor: product.flavor,
          purchase_price: product.purchasePrice,
          sale_price: product.salePrice,
          stock: product.stock,
          original_created_at: product.createdAt,
          deleted_by: userData.user?.id ?? null,
        });
      }
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Produto excluído");
    },
    [products],
  );

  /**
   * Tira modelos de linha NESTA filial. Vários de uma vez porque a faxina é
   * assim que acontece — a pessoa abre o painel uma vez por trimestre e marca
   * os dez que morreram —, e um INSERT de N linhas é uma transação só: ou todos
   * entram, ou nenhum. Na auditoria isso vira um movimento só, pelo `tx`.
   *
   * A regra do estoque zero NÃO está aqui: ela é do banco (gatilho
   * `archived_model_guard`), senão não existiria para quem chega pelo
   * PostgREST. Daqui sai só a tradução do erro dele.
   */
  const archiveModels = useCallback(
    async (models: { brand: string; model: string }[]): Promise<boolean> => {
      if (!requireBranch(branchId)) return false;
      if (models.length === 0) return false;
      const { error } = await supabase.from("archived_models").insert(
        // `brand_key`/`model_key` são NOT NULL e o tipo gerado os exige, mas
        // quem os preenche é o gatilho `archived_model_guard` — o gerador lê o
        // esquema, não os gatilhos. Mandar as chaves daqui duplicaria a
        // normalização (lower/btrim) que o banco é dono, e é justamente essa
        // duplicação que abriria a porta para uma chave que não corresponde ao
        // texto. O cast fica, com nome de coluna conferido acima: o resto do
        // payload é verificado normalmente.
        models.map((m) => ({ branch_id: branchId, brand: m.brand, model: m.model })) as never,
      );
      if (error) {
        // O gatilho manda junto quanto sobrou e QUAL modelo travou — num lote
        // de dez, "ainda tem estoque" sem nome não diria o que fazer.
        const stuck = /modelo_com_estoque:(\d+)@(.+)/.exec(error.message || "");
        if (stuck) toast.error(`${stuck[2]} ainda tem ${stuck[1]} un. — venda ou dê baixa antes de arquivar`);
        else if (error.code === "23505") toast.error("Esse modelo já está arquivado nesta filial");
        else toast.error("Erro ao arquivar");
        return false;
      }
      await fetchArchivedModels();
      toast.success(models.length === 1 ? "Modelo arquivado" : `${models.length} modelos arquivados`);
      return true;
    },
    [branchId, fetchArchivedModels],
  );

  /** Volta o modelo para as listas desta filial. Desarquivar é apagar a linha. */
  const unarchiveModel = useCallback(
    async (brand: string, model: string): Promise<boolean> => {
      if (!requireBranch(branchId)) return false;
      const { error } = await supabase
        .from("archived_models")
        .delete()
        .eq("branch_id", branchId)
        // Pelas colunas normalizadas: é o que o gatilho gravou, e é o que a
        // tela usa para esconder.
        .eq("brand_key", brand.trim().toLowerCase())
        .eq("model_key", model.trim().toLowerCase());
      if (error) {
        toast.error("Erro ao desarquivar");
        return false;
      }
      await fetchArchivedModels();
      toast.success("Modelo de volta nas listas");
      return true;
    },
    [branchId, fetchArchivedModels],
  );

  // ---- Stock Entries ----
  const addStockEntry = useCallback(
    async (e: Omit<StockEntry, "id" | "totalCost">) => {
      if (!requireBranch(branchId)) return;
      const totalCost = e.quantity * e.unitCost;
      const { data, error } = await supabase
        .from("stock_entries")
        .insert({
          product_id: e.productId,
          quantity: e.quantity,
          unit_cost: e.unitCost,
          total_cost: totalCost,
          branch_id: branchId,
          date: e.date,
          notes: e.notes,
        })
        .select()
        .single();
      if (error) {
        toast.error("Erro ao registrar entrada");
        return;
      }
      setStockEntries((prev) => [...prev, mapStockEntry(data)]);
      const product = products.find((p) => p.id === e.productId);
      const ok = await addBranchStock(e.productId, branchId, e.quantity, {
        unitCost: e.unitCost,
        salePrice: product?.salePrice ?? 0,
        minStock: product?.minStock ?? 0,
      });
      if (ok) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === e.productId ? { ...p, stock: p.stock + e.quantity, purchasePrice: e.unitCost } : p,
          ),
        );
      }
    },
    [products, branchId],
  );

  /**
   * Excluir entrada = apagar a linha E tirar as unidades, numa transação só
   * (`delete_stock_entry`), na filial GRAVADA NA ENTRADA. Se as unidades já
   * saíram (vendidas, perdidas, distribuídas), o banco recusa com o livre que
   * existe: antes a linha sumia e o estoque ia a zero calado.
   */
  const deleteStockEntry = useCallback(
    async (id: string) => {
      const entry = stockEntries.find((e) => e.id === id);
      const { error } = await stockDb.rpc("delete_stock_entry", { p_entry_id: id });
      if (error) {
        toast.error(stockErrorMessage(error.message, "Erro ao excluir entrada"));
        return;
      }
      setStockEntries((prev) => prev.filter((e) => e.id !== id));
      if (entry) {
        setProducts((prev) =>
          prev.map((p) => (p.id === entry.productId ? { ...p, stock: p.stock - entry.quantity } : p)),
        );
      }
    },
    [stockEntries],
  );

  // ---- Stock Losses ----
  /**
   * A perda inteira acontece no banco (`register_stock_loss`), numa transação:
   * confere o teto, tira da caixa do vendedor quando saiu dele, tira do
   * estoque da filial e grava o registro com o custo lido lá dentro.
   *
   * O teto depende da origem. Da CASA é o LIVRE (estoque menos o distribuído),
   * não o total: com tudo distribuído, a perda da casa derrubava o estoque
   * abaixo das atribuições e a loja do vendedor passava a oferecer unidade
   * que a cidade não tinha. Do VENDEDOR é a caixa dele.
   */
  const addStockLoss = useCallback(
    async (l: Omit<StockLoss, "id" | "totalCost" | "unitCost">): Promise<boolean> => {
      if (!requireBranch(branchId)) return false;
      const { data, error } = await stockDb.rpc("register_stock_loss", {
        p_branch_id: branchId,
        p_product_id: l.productId,
        p_quantity: l.quantity,
        p_seller_id: l.sellerId ?? null,
        p_reason: l.reason ?? null,
        p_date: l.date,
      });
      if (error) {
        toast.error(stockErrorMessage(error.message, "Erro ao registrar perda"));
        return false;
      }
      setStockLosses((prev) => [...prev, mapStockLoss(data)]);
      setProducts((prev) =>
        prev.map((p) => (p.id === l.productId ? { ...p, stock: p.stock - l.quantity } : p)),
      );
      if (l.sellerId) {
        const { data: refreshed } = await supabase
          .from("product_assignments")
          .select("*")
          .order("created_at", { ascending: true });
        if (refreshed) setProductAssignments(refreshed.map(mapProductAssignment));
      }
      toast.success("Perda registrada");
      return true;
    },
    [branchId],
  );

  /**
   * Excluir perda devolve a unidade para onde ela estava — o estoque da filial
   * GRAVADA NA PERDA e, se saiu de um vendedor, a caixa dele —, tudo numa
   * transação (`delete_stock_loss`).
   */
  const deleteStockLoss = useCallback(
    async (id: string) => {
      const loss = stockLosses.find((l) => l.id === id);
      const { error } = await stockDb.rpc("delete_stock_loss", { p_loss_id: id });
      if (error) {
        toast.error(stockErrorMessage(error.message, "Erro ao excluir perda"));
        return;
      }
      setStockLosses((prev) => prev.filter((l) => l.id !== id));
      if (loss) {
        setProducts((prev) =>
          prev.map((p) => (p.id === loss.productId ? { ...p, stock: p.stock + loss.quantity } : p)),
        );
        if (loss.sellerId) {
          const { data: refreshed } = await supabase
            .from("product_assignments")
            .select("*")
            .order("created_at", { ascending: true });
          if (refreshed) setProductAssignments(refreshed.map(mapProductAssignment));
        }
      }
    },
    [stockLosses],
  );

  // ---- Transferência entre filiais ----
  // A origem é a filial ATIVA, sempre: é o estoque dela que está na tela, e é
  // a única de que temos os números carregados. Mandar no sentido contrário é
  // trocar de filial — a mesma regra que vale para lançar qualquer coisa.
  //
  // As três escritas (debita origem, credita destino, registra) moram na
  // function: aqui só passamos o pedido e sincronizamos a tela com o que ficou.
  //
  // E o pedido é um LOTE, sempre — um sabor só é um lote de um. A viagem leva
  // vários sabores e é um movimento só: em N chamadas, a quinta podia falhar
  // por estoque com as quatro anteriores já gravadas, e a caixa física já
  // fechada. `transfer_branch_stock_batch` percorre tudo numa transação.
  const transferBranchStock = useCallback(
    async (t: {
      toBranchId: string;
      date: string;
      notes?: string;
      items: { productId: string; quantity: number; fromSellerId?: string }[];
    }) => {
      if (!requireBranch(branchId)) return false;
      if (t.items.length === 0) return false;

      const { data, error } = await supabase.rpc("transfer_branch_stock_batch", {
        p_from_branch_id: branchId,
        p_to_branch_id: t.toBranchId,
        p_items: t.items.map((i) => ({
          product_id: i.productId,
          quantity: i.quantity,
          from_seller_id: i.fromSellerId ?? null,
        })),
        p_date: t.date,
        p_notes: t.notes ?? null,
      });

      if (error) {
        const m = error.message ?? "";
        // O banco manda o número que ele viu junto do código (`erro:N`) — é o
        // que permite dizer "só 3 livre" em vez de "não deu" — e, no lote, o
        // produto que derrubou a operação (`...@<product_id>`): sem ele o
        // aviso falaria de dez sabores sem dizer qual.
        const quanto = m.match(/:(\d+)/)?.[1];
        const culpado = m.match(/@([0-9a-f-]{36})/i)?.[1];
        const p = culpado ? products.find((x) => x.id === culpado) : undefined;
        const qual = p ? ` (${p.flavor || p.name})` : "";
        if (m.includes("estoque_livre_insuficiente")) {
          toast.error(
            `Só ${quanto ?? 0} un. livres nesta filial${qual} — o resto está com os vendedores. Escolha de quem sai.`,
          );
        } else if (m.includes("estoque_vendedor_insuficiente")) {
          toast.error(`Esse vendedor tem apenas ${quanto ?? 0} un.${qual}`);
        } else if (m.includes("vendedor_de_outra_filial")) {
          toast.error("Esse vendedor não é desta filial");
        } else if (m.includes("estoque_insuficiente")) {
          toast.error(`Estoque insuficiente nesta filial${qual}`);
        } else if (m.includes("mesma_filial")) {
          toast.error("Escolha uma filial diferente da atual");
        } else if (m.includes("nao_autorizado")) {
          toast.error("Você não tem acesso a uma das filiais");
        } else if (m.includes("quantidade_invalida")) {
          toast.error(`Quantidade inválida${qual}`);
        } else if (m.includes("itens_demais")) {
          toast.error("Transferência longa demais: separe em mais de uma viagem");
        } else if (m.includes("itens_invalidos")) {
          toast.error("Nenhum produto na transferência");
        } else {
          toast.error("Erro ao transferir");
        }
        return false;
      }

      // A tela monta a lista do que o BANCO gravou, nunca do que ela mandou.
      const rows = (data ?? []).map(mapStockTransfer);
      setStockTransfers((prev) => [...rows.reverse(), ...prev]);
      // A lista inteira: o destino também mudou, e o custo vem de outra RPC.
      setProducts(await fetchProductsList());
      // Saiu da caixa de um vendedor: a atribuição dele mudou junto, e é o que
      // a Distribuição e o catálogo dele leem.
      if (t.items.some((i) => i.fromSellerId)) {
        const { data: refreshed } = await supabase
          .from("product_assignments")
          .select("*")
          .order("created_at", { ascending: true });
        if (refreshed) setProductAssignments(refreshed.map(mapProductAssignment));
      }
      const un = rows.reduce((s, r) => s + r.quantity, 0);
      toast.success(
        rows.length > 1
          ? `${un} un. de ${rows.length} sabores transferidas`
          : "Estoque transferido",
      );
      return true;
    },
    [branchId, fetchProductsList, products],
  );

  const getTotalLossValue = useCallback(() => {
    return stockLosses.reduce((sum, l) => sum + l.totalCost, 0);
  }, [stockLosses]);

  // ---- Sales ----
  const addSale = useCallback(
    async (s: Omit<Sale, "id" | "totalPrice">) => {
      const saleType = s.type || "venda";
      if (!requireBranch(branchId)) return;

      const { data, error } = await supabase.rpc("create_sale", {
        p_product_id: s.productId,
        p_quantity: s.quantity,
        p_unit_price: s.unitPrice,
        p_date: s.date,
        p_notes: s.notes ?? null,
        p_installments: s.installments || 1,
        p_paid_amount: s.paidAmount || 0,
        p_type: saleType,
        p_seller_id: s.sellerId ?? null,
        p_payment_method: saleType === "venda" ? (s.paymentMethod ?? null) : null,
        // Com vendedor a filial é derivada dele no banco e este valor só é
        // CONFERIDO; sem vendedor (venda manual, retirada) é este aqui que
        // manda. Nos dois casos quem decide é o banco.
        p_branch_id: branchId,
      });

      if (error) {
        if (error.message.includes("estoque_insuficiente")) {
          toast.error(`Estoque insuficiente`);
        } else if (error.message.includes("estoque_vendedor_insuficiente")) {
          toast.error("Vendedor não possui estoque suficiente deste produto");
        } else if (error.message.includes("filial_divergente")) {
          toast.error("Este vendedor é de outra filial");
        } else if (error.message.includes("filial_obrigatoria")) {
          toast.error("Escolha uma filial para lançar");
        } else if (error.message.includes("nao_autorizado")) {
          toast.error("Você não tem permissão para registrar essa venda");
        } else if (error.message.includes("quantidade_invalida")) {
          toast.error("Quantidade inválida");
        } else {
          toast.error("Erro ao registrar venda");
        }
        throw error;
      }

      const newSale = mapSale(data);
      setSales((prev) => [...prev, newSale]);

      // A function já debitou o estoque no banco; aqui só sincronizamos
      // o estado local (products / product_assignments) com o que ficou.
      setProducts(await fetchProductsList());
      if (s.sellerId) {
        const { data: refreshedAssignments } = await supabase
          .from("product_assignments")
          .select("*")
          .order("created_at", { ascending: true });
        if (refreshedAssignments) {
          setProductAssignments(refreshedAssignments.map(mapProductAssignment));
        }
      }
    },
    [branchId, fetchProductsList],
  );

  const updateSale = useCallback(
    async (id: string, updates: Partial<Sale>) => {
      const existing = sales.find((s) => s.id === id);
      // A quantidade de uma venda gravada não muda por aqui: este UPDATE vai
      // direto na tabela e não mexe no estoque nem na caixa do vendedor —
      // editar 2 → 5 deixava 3 unidades sobrando no estoque, caladas. Corrigir
      // quantidade é excluir (`delete_sale` devolve o estoque) e lançar de novo.
      if (updates.quantity !== undefined && existing && updates.quantity !== existing.quantity) {
        toast.error("Para mudar a quantidade, exclua a venda e lance de novo");
        return;
      }
      const dbUpdates: any = {};
      if (updates.quantity !== undefined) dbUpdates.quantity = updates.quantity;
      if (updates.unitPrice !== undefined) dbUpdates.unit_price = updates.unitPrice;
      if (updates.totalPrice !== undefined) dbUpdates.total_price = updates.totalPrice;
      if (updates.date !== undefined) dbUpdates.date = updates.date;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
      if (updates.installments !== undefined) dbUpdates.installments = updates.installments;
      if (updates.paidAmount !== undefined) dbUpdates.paid_amount = updates.paidAmount;
      if (updates.sellerId !== undefined) dbUpdates.seller_id = updates.sellerId || null;
      if (updates.type !== undefined) dbUpdates.type = updates.type;
      if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod || null;

      // Data de recebimento: setada quando a venda passa a estar quitada, limpa quando volta a ficar em aberto.
      let nextPaidAt: string | null | undefined;
      if (updates.paidAmount !== undefined || updates.paidAt !== undefined || updates.totalPrice !== undefined) {
        const total = updates.totalPrice ?? existing?.totalPrice ?? 0;
        const paid = updates.paidAmount ?? existing?.paidAmount ?? 0;
        const type = updates.type ?? existing?.type ?? "venda";
        const isPaid = type === "venda" && paid >= total - 0.01;
        nextPaidAt = isPaid ? updates.paidAt || existing?.paidAt || new Date().toISOString() : null;
        dbUpdates.paid_at = nextPaidAt;
      }

      const { error } = await supabase.from("sales").update(dbUpdates).eq("id", id);
      if (error) {
        toast.error("Erro ao atualizar venda");
        return;
      }
      setSales((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, ...updates, ...(nextPaidAt !== undefined ? { paidAt: nextPaidAt || undefined } : {}) }
            : s,
        ),
      );
    },
    [sales],
  );

  const deleteSale = useCallback(
    async (id: string) => {
      const sale = sales.find((s) => s.id === id);

      const { error } = await supabase.rpc("delete_sale", { p_sale_id: id });
      if (error) {
        toast.error("Erro ao excluir venda");
        return;
      }

      setSales((prev) => prev.filter((s) => s.id !== id));

      if (sale) {
        // `delete_sale` devolveu o estoque na filial GRAVADA NA VENDA, que não
        // é necessariamente a do vendedor hoje. Recarregar a lista é o jeito de
        // a tela ver o que o banco de fato fez.
        setProducts(await fetchProductsList());
        if (sale.sellerId) {
          const { data: refreshedAssignments } = await supabase
            .from("product_assignments")
            .select("*")
            .order("created_at", { ascending: true });
          if (refreshedAssignments) {
            setProductAssignments(refreshedAssignments.map(mapProductAssignment));
          }
        }
      }
    },
    [sales, fetchProductsList],
  );

  // ---- Expenses ----
  const addExpense = useCallback(async (e: Omit<Expense, "id">) => {
    if (!requireBranch(branchId)) return;
    const { data, error } = await supabase
      .from("expenses")
      .insert({
        description: e.description,
        category: e.category,
        amount: e.amount,
        date: e.date,
        branch_id: branchId,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao adicionar despesa");
      return;
    }
    setExpenses((prev) => [...prev, mapExpense(data)]);
  }, [branchId]);

  const deleteExpense = useCallback(async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir despesa");
      return;
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ---- Investors ----
  const addInvestor = useCallback(async (i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => {
    const totalReturn = i.investedAmount * (1 + i.returnPercentage / 100);
    const { data, error } = await supabase
      .from("investors")
      .insert({
        name: i.name,
        invested_amount: i.investedAmount,
        return_percentage: i.returnPercentage,
        total_return: totalReturn,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao adicionar investidor");
      return;
    }
    setInvestors((prev) => [...prev, mapInvestor(data)]);
  }, []);

  const updateInvestor = useCallback(
    async (id: string, updates: Partial<Investor>) => {
      const current = investors.find((i) => i.id === id);
      if (!current) return;
      const updated = { ...current, ...updates };
      if (updates.investedAmount !== undefined || updates.returnPercentage !== undefined) {
        updated.totalReturn = updated.investedAmount * (1 + updated.returnPercentage / 100);
      }
      const { error } = await supabase
        .from("investors")
        .update({
          name: updated.name,
          invested_amount: updated.investedAmount,
          return_percentage: updated.returnPercentage,
          total_return: updated.totalReturn,
        })
        .eq("id", id);
      if (error) {
        toast.error("Erro ao atualizar investidor");
        return;
      }
      setInvestors((prev) => prev.map((i) => (i.id === id ? updated : i)));
    },
    [investors],
  );

  const deleteInvestor = useCallback(async (id: string) => {
    const { error } = await supabase.from("investors").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir investidor");
      return;
    }
    setInvestors((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // ---- Dividends ----
  const addDividend = useCallback(async (d: Omit<Dividend, "id">) => {
    const { data, error } = await supabase
      .from("dividends")
      .insert({
        investor_id: d.investorId,
        amount: d.amount,
        date: d.date,
        notes: d.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar pagamento");
      return;
    }
    setDividends((prev) => [...prev, mapDividend(data)]);
  }, []);

  const deleteDividend = useCallback(async (id: string) => {
    const { error } = await supabase.from("dividends").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir pagamento");
      return;
    }
    setDividends((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // ---- Partners ----
  const addPartner = useCallback(async (p: Omit<Partner, "id" | "createdAt">) => {
    const { data, error } = await supabase
      .from("partners")
      .insert({
        name: p.name,
        percentage: p.percentage,
        monthly_pro_labore: p.monthlyProLabore ?? 0,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao adicionar sócio");
      return;
    }
    setPartners((prev) => [...prev, mapPartner(data)]);
  }, []);

  const updatePartner = useCallback(async (id: string, updates: Partial<Partner>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.percentage !== undefined) dbUpdates.percentage = updates.percentage;
    if (updates.monthlyProLabore !== undefined) dbUpdates.monthly_pro_labore = updates.monthlyProLabore;
    const { error } = await supabase.from("partners").update(dbUpdates).eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar sócio");
      return;
    }
    setPartners((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const deletePartner = useCallback(async (id: string) => {
    const { error } = await supabase.from("partners").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir sócio");
      return;
    }
    setPartners((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- Partner Payments ----
  const addPartnerPayment = useCallback(async (p: Omit<PartnerPayment, "id">) => {
    const { data, error } = await supabase
      .from("partner_payments")
      .insert({
        partner_id: p.partnerId,
        month: p.month,
        amount: p.amount,
        date: p.date,
        notes: p.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar pagamento");
      return;
    }
    setPartnerPayments((prev) => [...prev, mapPartnerPayment(data)]);
    toast.success("Pagamento registrado");
  }, []);

  const deletePartnerPayment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("partner_payments")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir pagamento");
      return;
    }
    setPartnerPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const getPartnerPaidForMonth = useCallback(
    (partnerId: string, month: string) => {
      return partnerPayments
        .filter((p) => p.partnerId === partnerId && p.month === month)
        .reduce((sum, p) => sum + p.amount, 0);
    },
    [partnerPayments],
  );

  const getTotalPartnerPayments = useCallback(() => {
    return partnerPayments.reduce((sum, p) => sum + p.amount, 0);
  }, [partnerPayments]);

  // ---- Sellers ----
  // O vendedor nasce na filial ativa, e não troca de filial depois: tudo o que
  // é dele (atribuições, pedidos, comissões) herda a cidade desta linha, então
  // mudá-la reescreveria o passado. Quem muda de cidade ganha cadastro novo.
  const addSeller = useCallback(
    async (s: Omit<Seller, "id" | "createdAt">) => {
      if (!requireBranch(branchId)) return;
      const { data, error } = await supabase
        .from("sellers")
        .insert({
          name: s.name,
          debt_percentage: s.debtPercentage ?? 10,
          branch_id: branchId,
        })
        .select()
        .single();
      if (error) {
        toast.error("Erro ao adicionar vendedor");
        return;
      }
      setSellers((prev) => [...prev, mapSeller(data)]);
    },
    [branchId],
  );

  const updateSeller = useCallback(async (id: string, updates: Partial<Seller>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.debtPercentage !== undefined) dbUpdates.debt_percentage = updates.debtPercentage;
    // Apelido vazio é NULL, não string vazia: no banco, duas strings vazias
    // colidiriam no índice único do slug.
    if (updates.slug !== undefined) dbUpdates.slug = updates.slug?.trim() || null;
    // Lê de volta o que o banco GRAVOU: o gatilho normaliza o apelido
    // (minúsculas, sem acento, espaço vira hífen), e refazer essa conta aqui
    // seria a mesma regra escrita em dois lugares — o dia em que divergissem, a
    // tela mostraria um link que não existe.
    const { data, error } = await supabase
      .from("sellers")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) {
      // O gatilho `seller_slug_guard` recusa o que não vira endereço, e o
      // índice único recusa o apelido repetido. As duas frases dizem o que
      // fazer; "erro ao atualizar" não diria.
      if ((error.message || "").includes("slug_invalido")) {
        toast.error("Use só letras, números e hífen — de 2 a 32 caracteres");
      } else if (error.code === "23505") {
        toast.error("Esse apelido já é de outro vendedor");
      } else {
        toast.error("Erro ao atualizar vendedor");
      }
      return;
    }
    const saved = data ? mapSeller(data) : null;
    setSellers((prev) => prev.map((s) => (s.id === id ? (saved ?? { ...s, ...updates }) : s)));
  }, []);

  const deleteSeller = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("sellers")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir vendedor");
      return;
    }
    setSellers((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // ---- Product Assignments ----
  const addProductAssignment = useCallback(async (a: Omit<ProductAssignment, "id" | "createdAt">) => {
    const { data: existingAssignments = [], error: fetchError } = await supabase
      .from("product_assignments")
      .select("*")
      .eq("seller_id", a.sellerId)
      .eq("product_id", a.productId)
      .order("created_at", { ascending: true });

    if (fetchError) {
      toast.error(assignmentError(fetchError.message));
      return;
    }

    if (existingAssignments.length > 0) {
      const [primaryAssignment, ...duplicateAssignments] = existingAssignments;
      const mergedQuantity = existingAssignments.reduce((sum, item) => sum + item.quantity, 0) + a.quantity;

      const { data: updatedAssignment, error: updateError } = await supabase
        .from("product_assignments")
        .update({
          quantity: mergedQuantity,
          notes: a.notes ?? primaryAssignment.notes,
        })
        .eq("id", primaryAssignment.id)
        .select()
        .single();

      if (updateError || !updatedAssignment) {
        toast.error(assignmentError(updateError?.message));
        return;
      }

      if (duplicateAssignments.length > 0) {
        const duplicateIds = duplicateAssignments.map((item) => item.id);
        const { error: deleteError } = await supabase.from("product_assignments").delete().in("id", duplicateIds);

        if (deleteError) {
          toast.error("Erro ao consolidar atribuições");
          return;
        }
      }

      setProductAssignments((prev) => {
        const duplicateIdSet = new Set(duplicateAssignments.map((item) => item.id));
        const filteredAssignments = prev.filter(
          (item) => item.id !== primaryAssignment.id && !duplicateIdSet.has(item.id),
        );

        return [...filteredAssignments, mapProductAssignment(updatedAssignment)];
      });

      return;
    }

    const { data, error } = await supabase
      .from("product_assignments")
      .insert({
        seller_id: a.sellerId,
        product_id: a.productId,
        quantity: a.quantity,
        notes: a.notes,
      })
      .select()
      .single();

    if (error) {
      toast.error(assignmentError(error.message));
      return;
    }

    setProductAssignments((prev) => [...prev, mapProductAssignment(data)]);
  }, []);

  const deleteProductAssignment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("product_assignments")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao remover atribuição");
      return;
    }
    setProductAssignments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const transferProductAssignment = useCallback(
    async (assignmentId: string, toSellerId: string, quantity: number) => {
      const source = productAssignments.find((a) => a.id === assignmentId);
      if (!source) {
        toast.error("Atribuição não encontrada");
        return;
      }
      if (quantity <= 0) {
        toast.error("Quantidade inválida");
        return;
      }
      if (quantity > source.quantity) {
        toast.error(`Disponível apenas ${source.quantity}`);
        return;
      }
      if (toSellerId === source.sellerId) {
        toast.error("Selecione outro vendedor");
        return;
      }

      const remaining = source.quantity - quantity;
      if (remaining > 0) {
        const { error: updErr } = await supabase
          .from("product_assignments")
          .update({ quantity: remaining })
          .eq("id", assignmentId);
        if (updErr) {
          toast.error("Erro ao transferir");
          return;
        }
        setProductAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, quantity: remaining } : a)));
      } else {
        const { error: delErr } = await supabase.from("product_assignments").delete().eq("id", assignmentId);
        if (delErr) {
          toast.error("Erro ao transferir");
          return;
        }
        setProductAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      }

      await addProductAssignment({ sellerId: toSellerId, productId: source.productId, quantity, notes: source.notes });
      toast.success("Atribuição transferida");
    },
    [productAssignments, addProductAssignment],
  );

  // ---- Seller Debt Payments ----
  const addSellerDebtPayment = useCallback(async (p: Omit<SellerDebtPayment, "id">) => {
    const { data, error } = await supabase
      .from("seller_debt_payments")
      .insert({
        seller_id: p.sellerId,
        sale_id: p.saleId || null,
        amount: p.amount,
        date: p.date,
        notes: p.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar pagamento");
      return;
    }
    setSellerDebtPayments((prev) => [...prev, mapSellerDebtPayment(data)]);
  }, []);

  const deleteSellerDebtPayment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("seller_debt_payments")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir pagamento");
      return;
    }
    setSellerDebtPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- Seller Manual Debts ----
  const addSellerManualDebt = useCallback(async (d: Omit<SellerManualDebt, "id">) => {
    const { data, error } = await supabase
      .from("seller_manual_debts")
      .insert({
        seller_id: d.sellerId,
        amount: d.amount,
        date: d.date,
        notes: d.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar saldo devedor");
      return;
    }
    setSellerManualDebts((prev) => [...prev, mapSellerManualDebt(data)]);
    toast.success("Saldo devedor registrado");
  }, []);

  const deleteSellerManualDebt = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("seller_manual_debts")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    setSellerManualDebts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // ---- Commission Payments ----
  const addCommissionPayment = useCallback(async (p: Omit<CommissionPayment, "id">) => {
    const { data, error } = await supabase
      .from("commission_payments")
      .insert({
        seller_id: p.sellerId,
        amount: p.amount,
        date: p.date,
        notes: p.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar comissão");
      return;
    }
    setCommissionPayments((prev) => [...prev, mapCommissionPayment(data)]);
    toast.success("Comissão registrada");
  }, []);

  const deleteCommissionPayment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("commission_payments")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    setCommissionPayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- Pro-labore Payments ----
  const addProLaborePayment = useCallback(async (p: Omit<ProLaborePayment, "id">) => {
    const { data, error } = await supabase
      .from("pro_labore_payments")
      .insert({
        partner_id: p.partnerId,
        amount: p.amount,
        date: p.date,
        notes: p.notes,
      })
      .select()
      .single();
    if (error) {
      toast.error("Erro ao registrar pró-labore");
      return;
    }
    setProLaborePayments((prev) => [...prev, mapProLaborePayment(data)]);
    toast.success("Pró-labore registrado");
  }, []);

  const deleteProLaborePayment = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("pro_labore_payments")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    setProLaborePayments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ---- Computed ----
  const getSellerName = useCallback(
    (id: string) => sellers.find((s) => s.id === id)?.name ?? "Vendedor desconhecido",
    [sellers],
  );
  const getTotalRevenue = useCallback(
    () => sales.filter((s) => s.type === "venda").reduce((sum, s) => sum + s.totalPrice, 0),
    [sales],
  );
  const getTotalCosts = useCallback(() => stockEntries.reduce((sum, e) => sum + e.totalCost, 0), [stockEntries]);
  const getTotalExpenses = useCallback(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);
  const getTotalInvested = useCallback(() => investors.reduce((sum, i) => sum + i.investedAmount, 0), [investors]);
  const getNetProfit = useCallback(
    () => getTotalRevenue() - getTotalCosts() - getTotalExpenses() - getTotalLossValue() - getTotalPartnerPayments(),
    [getTotalRevenue, getTotalCosts, getTotalExpenses, getTotalLossValue, getTotalPartnerPayments],
  );
  /**
   * O custo UNITÁRIO de uma venda: o congelado nela (`sale_costs`) ou, na
   * falta dele, o custo de hoje do produto na filial — que é o mesmo número
   * no instante da venda, e a leitura antiga. É o que todo CPV do app usa
   * (ver src/lib/period-result.ts); ler `product.purchasePrice` direto
   * reescrevia o lucro do passado a cada lote novo.
   */
  const productCostById = useMemo(
    () => new Map(products.map((p) => [p.id, p.purchasePrice || 0])),
    [products],
  );
  const saleUnitCost = useCallback(
    (s: Sale) => saleCosts.get(s.id) ?? productCostById.get(s.productId) ?? 0,
    [saleCosts, productCostById],
  );

  const getProductName = useCallback(
    (id: string) => {
      const p = products.find((p) => p.id === id);
      if (!p) return "Produto desconhecido";
      const flavor = p.flavor?.trim();
      const model = (p.model || p.name)?.trim();
      if (flavor && model) return `${flavor} · ${model}`;
      return flavor || model || "Produto desconhecido";
    },
    [products],
  );
  const getInvestorName = useCallback(
    (id: string) => investors.find((i) => i.id === id)?.name ?? "Investidor desconhecido",
    [investors],
  );

  const getPaidToInvestor = useCallback(
    (id: string) => {
      return dividends.filter((d) => d.investorId === id).reduce((sum, d) => sum + d.amount, 0);
    },
    [dividends],
  );

  const getRemainingForInvestor = useCallback(
    (id: string) => {
      const investor = investors.find((i) => i.id === id);
      if (!investor) return 0;
      return Math.max(0, investor.totalReturn - getPaidToInvestor(id));
    },
    [investors, getPaidToInvestor],
  );

  const getSellerDebt = useCallback(
    (id: string) => {
      const fromRetiradas = sales
        .filter((s) => s.sellerId === id && s.type === "retirada_funcionario")
        .reduce((sum, s) => sum + s.totalPrice, 0);
      const fromManual = sellerManualDebts.filter((d) => d.sellerId === id).reduce((sum, d) => sum + d.amount, 0);
      return fromRetiradas + fromManual;
    },
    [sales, sellerManualDebts],
  );

  const getSellerPaid = useCallback(
    (id: string) => {
      return sellerDebtPayments.filter((p) => p.sellerId === id).reduce((sum, p) => sum + p.amount, 0);
    },
    [sellerDebtPayments],
  );

  // Saldo = Retirado - Pago.
  // Positivo = funcionário ainda deve. Negativo = crédito/saldo positivo para o funcionário.
  const getSellerBalance = useCallback(
    (id: string) => {
      return getSellerDebt(id) - getSellerPaid(id);
    },
    [getSellerPaid, getSellerDebt],
  );

  // ---- Novo modelo financeiro ----
  // O nome ficou (é chamado depois de toda escrita de dinheiro), mas o que ele
  // relê hoje é só a posição somada pelo banco.
  const refreshFinancialEvents = useCallback(async () => {
    const position = await fetchLedgerPosition();
    if (position) setLedgerTotals(position);
  }, []);

  /** O razão linha a linha, para o relatório — em páginas, ver `fetchAllRows`. */
  const loadFinancialEvents = useCallback(async (): Promise<FinancialEvent[]> => {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from("financial_events")
        .select("*")
        .order("event_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id"),
    );
    if (error) throw error;
    return (data ?? []).map(mapFinancialEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSales = useCallback(async () => {
    const [salesRes, paRes, prodList] = await Promise.all([
      fetchAllRows(() =>
        scoped(supabase.from("sales").select("*")).order("created_at", { ascending: true }).order("id"),
      ),
      supabase
        .from("product_assignments")
        .select("*")
        .order("created_at", { ascending: true }),
      fetchProductsList(),
    ]);
    if (salesRes.data) setSales(salesRes.data.map(mapSale));
    if (paRes.data) setProductAssignments(paRes.data.map(mapProductAssignment));
    if (prodList) setProducts(prodList);
  }, [fetchProductsList, scoped]);

  const addPartnerContribution = useCallback(
    async (c: Omit<PartnerContribution, "id" | "createdAt">) => {
      const { data, error } = await supabase
        .from("partner_contributions")
        .insert({
          partner_id: c.partnerId,
          amount: c.amount,
          date: c.date,
          notes: c.notes,
        })
        .select()
        .single();
      if (error) {
        toast.error("Erro ao registrar aporte");
        return;
      }
      setPartnerContributions((prev) => [...prev, mapPartnerContribution(data)]);
      await refreshFinancialEvents();
      toast.success("Aporte registrado");
    },
    [refreshFinancialEvents],
  );

  const deletePartnerContribution = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("partner_contributions")
        .delete()
        .eq("id", id);
      if (error) {
        toast.error("Erro ao excluir aporte");
        return;
      }
      setPartnerContributions((prev) => prev.filter((x) => x.id !== id));
      await refreshFinancialEvents();
    },
    [refreshFinancialEvents],
  );

  const addLoan = useCallback(
    async (l: Omit<Loan, "id" | "createdAt">) => {
      const { data, error } = await supabase
        .from("loans")
        .insert({
          lender_name: l.lenderName,
          principal: l.principal,
          interest_amount: l.interestAmount ?? 0,
          received_date: l.receivedDate,
          notes: l.notes,
        })
        .select()
        .single();
      if (error) {
        toast.error("Erro ao registrar empréstimo");
        return;
      }
      setLoans((prev) => [...prev, mapLoan(data)]);
      await refreshFinancialEvents();
      toast.success("Empréstimo registrado");
    },
    [refreshFinancialEvents],
  );

  const updateLoan = useCallback(
    async (id: string, updates: Partial<Loan>) => {
      const dbUpdates: any = {};
      if (updates.lenderName !== undefined) dbUpdates.lender_name = updates.lenderName;
      if (updates.principal !== undefined) dbUpdates.principal = updates.principal;
      if (updates.interestAmount !== undefined) dbUpdates.interest_amount = updates.interestAmount;
      if (updates.receivedDate !== undefined) dbUpdates.received_date = updates.receivedDate;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
      const { error } = await supabase
        .from("loans")
        .update(dbUpdates)
        .eq("id", id);
      if (error) {
        toast.error("Erro ao atualizar empréstimo");
        return;
      }
      setLoans((prev) => prev.map((x) => (x.id === id ? { ...x, ...updates } : x)));
      await refreshFinancialEvents();
    },
    [refreshFinancialEvents],
  );

  const deleteLoan = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("loans")
        .delete()
        .eq("id", id);
      if (error) {
        toast.error("Erro ao excluir empréstimo");
        return;
      }
      setLoans((prev) => prev.filter((x) => x.id !== id));
      setLoanPayments((prev) => prev.filter((p) => p.loanId !== id));
      await refreshFinancialEvents();
    },
    [refreshFinancialEvents],
  );

  const addLoanPayment = useCallback(
    async (p: Omit<LoanPayment, "id" | "createdAt">) => {
      const { data, error } = await supabase
        .from("loan_payments")
        .insert({
          loan_id: p.loanId,
          principal_amount: p.principalAmount ?? 0,
          interest_amount: p.interestAmount ?? 0,
          date: p.date,
          notes: p.notes,
        })
        .select()
        .single();
      if (error) {
        toast.error("Erro ao registrar pagamento");
        return;
      }
      setLoanPayments((prev) => [...prev, mapLoanPayment(data)]);
      await refreshFinancialEvents();
      toast.success("Pagamento registrado");
    },
    [refreshFinancialEvents],
  );

  const deleteLoanPayment = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("loan_payments")
        .delete()
        .eq("id", id);
      if (error) {
        toast.error("Erro ao excluir pagamento");
        return;
      }
      setLoanPayments((prev) => prev.filter((x) => x.id !== id));
      await refreshFinancialEvents();
    },
    [refreshFinancialEvents],
  );

  const getLoanPaid = useCallback(
    (loanId: string) => {
      return loanPayments
        .filter((p) => p.loanId === loanId)
        .reduce((s, p) => s + p.principalAmount + p.interestAmount, 0);
    },
    [loanPayments],
  );

  const getLoanRemaining = useCallback(
    (loanId: string) => {
      const l = loans.find((x) => x.id === loanId);
      if (!l) return 0;
      const total = l.principal + l.interestAmount;
      return Math.max(0, total - getLoanPaid(loanId));
    },
    [loans, getLoanPaid],
  );

  // ---- Selectors do razão (derivados de financial_events) ----
  // `ledgerTotals` vem somado pelo banco (`ledger_position`), não daqui.

  const getCash = useCallback(() => ledgerTotals.cash, [ledgerTotals]);
  const getInventoryCostValue = useCallback(() => ledgerTotals.inventory, [ledgerTotals]);
  const getReceivables = useCallback(() => ledgerTotals.receivable, [ledgerTotals]);
  const getPartnerCapital = useCallback(() => ledgerTotals.partnerCapital, [ledgerTotals]);
  const getLoansOutstanding = useCallback(() => ledgerTotals.loan, [ledgerTotals]);
  const getAccumulatedProfit = useCallback(() => ledgerTotals.accumulatedProfit, [ledgerTotals]);
  const getDistributedProfit = useCallback(() => ledgerTotals.distributedProfit, [ledgerTotals]);
  const getRetainedEarnings = useCallback(
    () => ledgerTotals.accumulatedProfit - ledgerTotals.distributedProfit,
    [ledgerTotals],
  );
  const getDistributableProfit = useCallback(
    (pendingCommissions: number = 0) => {
      return getRetainedEarnings() - pendingCommissions;
    },
    [getRetainedEarnings],
  );

  /**
   * Ordem alfabética sai daqui, não de cada tela.
   *
   * O banco devolve produto e vendedor em ordem de `created_at`, e isso
   * vazava para toda caixa de seleção do ERP — registrar venda, dar entrada,
   * atribuir estoque —, onde a ordem de cadastro não ajuda ninguém a achar o
   * item. Como TODA tela lê a lista daqui, ordenar no valor do contexto
   * conserta as telas de uma vez, e uma tela nova nasce certa sem precisar
   * lembrar de ordenar.
   *
   * Nada dependia da ordem de criação: as buscas são todas por `id`.
   */
  const sortedProducts = useMemo(() => sortCatalog(products), [products]);

  /**
   * Os modelos escondidos na filial de referência, e a lista de produtos sem
   * eles.
   *
   * `products` continua INTEIRO: é ele que dá nome a toda venda, entrada e
   * perda do passado, e um histórico que perde o rótulo do produto arquivado
   * seria pior do que a lista poluída que isto veio resolver. Quem escolhe —
   * seletor da Entrada, diálogos de preço e mínimo, lista de Produtos, as
   * contas de reposição — lê `activeProducts`.
   */
  const hiddenModels = useMemo(
    () => hiddenModelKeys(archivedModels, branchId, branches.map((b) => b.id)),
    [archivedModels, branchId, branches],
  );

  const activeProducts = useMemo(
    () => sortedProducts.filter((p) => !isProductHidden(p, hiddenModels)),
    [sortedProducts, hiddenModels],
  );
  const sortedSellers = useMemo(() => sortByName(sellers), [sellers]);
  const sortedPartners = useMemo(() => sortByName(partners), [partners]);

  /**
   * As tabelas de vendedor não têm `branch_id`: a cidade delas vem do vendedor
   * — é a segunda âncora, e é o que evita quinze colunas que podem divergir.
   * A RLS já corta pelo que a pessoa ALCANÇA; o recorte pela filial ATIVA é
   * feito aqui, em memória, pelo conjunto de `seller_id` da cidade (a lista de
   * `sellers` já chega filtrada da consulta).
   *
   * Em "Todas" não há recorte nenhum: a RLS é o único corte, e ela já é o
   * corte certo.
   */
  const branchSellerIds = useMemo(() => new Set(sellers.map((s) => s.id)), [sellers]);
  const bySeller = useCallback(
    <T extends { sellerId: string }>(rows: T[]): T[] =>
      branchId ? rows.filter((r) => branchSellerIds.has(r.sellerId)) : rows,
    [branchId, branchSellerIds],
  );

  const scopedAssignments = useMemo(() => bySeller(productAssignments), [bySeller, productAssignments]);
  const scopedDebtPayments = useMemo(() => bySeller(sellerDebtPayments), [bySeller, sellerDebtPayments]);
  const scopedManualDebts = useMemo(() => bySeller(sellerManualDebts), [bySeller, sellerManualDebts]);
  const scopedCommissions = useMemo(() => bySeller(commissionPayments), [bySeller, commissionPayments]);

  const ctxValue = useMemo<StoreContextType>(
    () => ({
      products: sortedProducts,
      activeProducts,
      archivedModels,
      hiddenModels,
      archiveModels,
      unarchiveModel,
      stockEntries,
      sales,
      expenses,
      investors,
      dividends,
      partners: sortedPartners,
      sellers: sortedSellers,
      productAssignments: scopedAssignments,
      sellerDebtPayments: scopedDebtPayments,
      partnerPayments,
      sellerManualDebts: scopedManualDebts,
      stockLosses,
      stockTransfers,
      transferBranchStock,
      commissionPayments: scopedCommissions,
      proLaborePayments,
      loading,
      loadProgress,
      addProduct,
      updateProduct,
      deleteProduct,
      addStockEntry,
      deleteStockEntry,
      addStockLoss,
      deleteStockLoss,
      getTotalLossValue,
      addSale,
      updateSale,
      deleteSale,
      addExpense,
      deleteExpense,
      addInvestor,
      updateInvestor,
      deleteInvestor,
      addDividend,
      deleteDividend,
      addPartner,
      updatePartner,
      deletePartner,
      addPartnerPayment,
      deletePartnerPayment,
      getPartnerPaidForMonth,
      getTotalPartnerPayments,
      addSeller,
      updateSeller,
      deleteSeller,
      addProductAssignment,
      deleteProductAssignment,
      transferProductAssignment,
      addSellerDebtPayment,
      deleteSellerDebtPayment,
      addSellerManualDebt,
      deleteSellerManualDebt,
      addCommissionPayment,
      deleteCommissionPayment,
      addProLaborePayment,
      deleteProLaborePayment,
      getSellerName,
      getTotalRevenue,
      getTotalCosts,
      getTotalExpenses,
      getTotalInvested,
      getNetProfit,
      getProductName,
      getInvestorName,
      getPaidToInvestor,
      getRemainingForInvestor,
      getSellerDebt,
      getSellerPaid,
      getSellerBalance,
      saleUnitCost,
      purchaseOrders,
      addPurchaseOrder,
      deletePurchaseOrder,
      receivePurchaseOrder,
      partnerContributions,
      loans,
      loanPayments,
      loadFinancialEvents,
      addPartnerContribution,
      deletePartnerContribution,
      addLoan,
      updateLoan,
      deleteLoan,
      addLoanPayment,
      deleteLoanPayment,
      refreshFinancialEvents,
      refreshSales,

      getCash,
      getInventoryCostValue,
      getReceivables,
      getPartnerCapital,
      getLoansOutstanding,
      getAccumulatedProfit,
      getDistributedProfit,
      getRetainedEarnings,
      getDistributableProfit,
      getLoanPaid,
      getLoanRemaining,
    }),
    [
      sortedProducts,
      activeProducts,
      archivedModels,
      hiddenModels,
      archiveModels,
      unarchiveModel,
      stockEntries,
      sales,
      expenses,
      investors,
      dividends,
      sortedPartners,
      sortedSellers,
      scopedAssignments,
      scopedDebtPayments,
      partnerPayments,
      scopedManualDebts,
      stockLosses,
      stockTransfers,
      transferBranchStock,
      scopedCommissions,
      proLaborePayments,
      loading,
      loadProgress,
      addProduct,
      updateProduct,
      deleteProduct,
      addStockEntry,
      deleteStockEntry,
      addStockLoss,
      deleteStockLoss,
      getTotalLossValue,
      addSale,
      updateSale,
      deleteSale,
      addExpense,
      deleteExpense,
      addInvestor,
      updateInvestor,
      deleteInvestor,
      addDividend,
      deleteDividend,
      addPartner,
      updatePartner,
      deletePartner,
      addPartnerPayment,
      deletePartnerPayment,
      getPartnerPaidForMonth,
      getTotalPartnerPayments,
      addSeller,
      updateSeller,
      deleteSeller,
      addProductAssignment,
      deleteProductAssignment,
      transferProductAssignment,
      addSellerDebtPayment,
      deleteSellerDebtPayment,
      addSellerManualDebt,
      deleteSellerManualDebt,
      addCommissionPayment,
      deleteCommissionPayment,
      addProLaborePayment,
      deleteProLaborePayment,
      getSellerName,
      getTotalRevenue,
      getTotalCosts,
      getTotalExpenses,
      getTotalInvested,
      getNetProfit,
      getProductName,
      getInvestorName,
      getPaidToInvestor,
      getRemainingForInvestor,
      getSellerDebt,
      getSellerPaid,
      getSellerBalance,
      saleUnitCost,
      purchaseOrders,
      addPurchaseOrder,
      deletePurchaseOrder,
      receivePurchaseOrder,
      partnerContributions,
      loans,
      loanPayments,
      loadFinancialEvents,
      addPartnerContribution,
      deletePartnerContribution,
      addLoan,
      updateLoan,
      deleteLoan,
      addLoanPayment,
      deleteLoanPayment,
      refreshFinancialEvents,
      refreshSales,

      getCash,
      getInventoryCostValue,
      getReceivables,
      getPartnerCapital,
      getLoansOutstanding,
      getAccumulatedProfit,
      getDistributedProfit,
      getRetainedEarnings,
      getDistributableProfit,
      getLoanPaid,
      getLoanRemaining,
    ],
  );

  return <StoreContext.Provider value={ctxValue}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
