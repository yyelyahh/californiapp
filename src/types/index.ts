export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  imageUrl?: string;
  createdAt: string;
  /**
   * Só em "Todas as filiais": o `salePrice` acima é o MAIOR entre as cidades,
   * e as cidades não cobram o mesmo. A tela avisa em vez de mostrar um preço
   * que não é cobrado em lugar nenhum. Com uma filial escolhida vem `false`.
   */
  priceVaries?: boolean;
}

export interface StockEntry {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  date: string;
  notes?: string;
  /**
   * A cidade onde estas unidades entraram. Carimbada na ESCRITA, e é dela que
   * a exclusão tira o estoque de volta — não da filial ativa. As duas quase
   * sempre coincidem (a lista é filtrada), mas "quase sempre" não serve para
   * quem devolve estoque.
   */
  branchId?: string;
}

/**
 * Unidades que mudaram de cidade.
 *
 * Não é consignação (`ProductAssignment`, que é o que está na mão de um
 * vendedor e não sai da loja) nem entrada (`StockEntry`, que é compra e mexe
 * no caixa). É a mesma mercadoria trocando de prateleira — por isso fica fora
 * do razão.
 */
export interface StockTransfer {
  id: string;
  productId: string;
  fromBranchId: string;
  toBranchId: string;
  quantity: number;
  /** O custo com que a unidade saiu da origem, copiado no momento da saída. */
  unitCost: number;
  date: string;
  notes?: string;
  createdAt: string;
}

export type SaleType = "venda" | "retirada_funcionario";
export type PaymentMethod =
  | "pix"
  | "dinheiro"
  | "pix_pendente"
  | "dinheiro_pendente"
  | "dinheiro_com_vendedor"
  | "pendente";

export interface StockLoss {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reason?: string;
  sellerId?: string;
  date: string;
  /** A cidade de onde a unidade saiu — mesma regra do `branchId` de StockEntry. */
  branchId?: string;
}

export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  date: string;
  notes?: string;
  installments: number;
  paidAmount: number;
  /** Data em que a venda foi efetivamente recebida (quitada). */
  paidAt?: string;
  sellerId?: string;
  type: SaleType;
  paymentMethod?: PaymentMethod;
}

export interface SellerDebtPayment {
  id: string;
  sellerId: string;
  saleId?: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface SellerManualDebt {
  id: string;
  sellerId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: string;
}

export interface Investor {
  id: string;
  name: string;
  investedAmount: number;
  returnPercentage: number;
  totalReturn: number; // investedAmount * (1 + returnPercentage/100)
  createdAt: string;
}

export interface Dividend {
  id: string;
  investorId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Partner {
  id: string;
  name: string;
  percentage: number;
  monthlyProLabore: number;
  createdAt: string;
}

export interface CommissionPayment {
  id: string;
  sellerId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface ProLaborePayment {
  id: string;
  partnerId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface PartnerPayment {
  id: string;
  partnerId: string;
  month: string; // YYYY-MM
  amount: number;
  date: string;
  notes?: string;
}

export interface Seller {
  id: string;
  name: string;
  debtPercentage: number;
  createdAt: string;
  /**
   * A cidade do vendedor — a segunda âncora da filial. Tudo o que é dele
   * (atribuições, pedidos, comissões, dívidas) herda a filial daqui, e por isso
   * ela NÃO se troca: quem muda de cidade ganha cadastro novo, senão o passado
   * seria reescrito junto.
   */
  branchId?: string;
}

export interface ProductAssignment {
  id: string;
  sellerId: string;
  productId: string;
  quantity: number;
  notes?: string;
  createdAt: string;
}

// ---- Novo modelo financeiro (contabilidade simplificada) ----

export interface PartnerContribution {
  id: string;
  partnerId: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt: string;
}

export interface Loan {
  id: string;
  lenderName: string;
  principal: number;
  interestAmount: number;
  receivedDate: string;
  notes?: string;
  createdAt: string;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  principalAmount: number;
  interestAmount: number;
  date: string;
  notes?: string;
  createdAt: string;
}

export type FinancialEventKind =
  | "partner_contribution"
  | "loan_received"
  | "loan_payment"
  | "stock_purchase"
  | "sale"
  | "sale_cogs"
  | "expense"
  | "withdrawal"
  | "commission_paid"
  | "stock_loss";

export interface FinancialEvent {
  id: string;
  kind: FinancialEventKind;
  date: string;
  createdAt: string;
  description: string;
  amount: number;
  cashDelta: number;
  inventoryDelta: number;
  receivableDelta: number;
  loanDelta: number;
  partnerCapitalDelta: number;
  accumulatedProfitDelta: number;
  distributedProfitDelta: number;
  refTable: string;
  refId: string;
  notes?: string;
}

// ---- Compras aguardando recebimento (registro logístico, sem impacto em estoque) ----
export type PurchaseOrderStatus = "pending" | "received";

export interface ReceivedFlavor {
  flavor: string;
  quantity: number;
  /**
   * Em qual cidade esta parte da caixa foi guardada. A compra é CENTRAL (o
   * fornecedor entrega uma vez, o frete é da compra inteira) e a divisão
   * acontece no recebimento — por isso o mesmo sabor pode aparecer em duas
   * linhas, uma por filial, exatamente como `order_items` já aceita duas
   * linhas do mesmo produto.
   *
   * Opcional porque `received_flavors` é jsonb: linha gravada antes das
   * filiais não tem o campo, e é lida como matriz.
   */
  branchId?: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  brand: string;
  model: string;
  expectedQuantity: number;
  unitPrice: number;
  receivedFlavors: ReceivedFlavor[];
}

export interface PurchaseOrder {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  date: string;
  notes?: string;
  paidAmount: number;
  freightCost: number;
  receivedAt?: string;
  createdAt: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseReceiptItemInput {
  itemId: string;
  unitCost: number;
  salePrice?: number;
  flavors: ReceivedFlavor[];
}
