import { describe, it, expect } from "vitest";
import { buildReport, dayBR, type ReportInput, type ReportSheet } from "@/lib/report-workbook";
import type {
  Product, Sale, Expense, Seller, Partner, Loan, LoanPayment,
  ProLaborePayment, SellerManualDebt, SellerDebtPayment, CommissionPayment,
  ProductAssignment, StockEntry, PurchaseOrder,
} from "@/types";

/**
 * Setembro/2026. A comissão só existe a partir de 01/06/2026 (PROJECT_START),
 * então as datas dos exemplos ficam depois disso — antes disso o histórico é
 * legado e `computeSellerBalance` o ignora de propósito.
 */
const START = new Date(2026, 8, 1);
const END = new Date(2026, 8, 30, 23, 59, 59, 999);
const day = (d: number) => new Date(2026, 8, d, 12).toISOString();
const inSeptember = (iso: string) => {
  const t = new Date(iso);
  return t >= START && t <= END;
};

const product = (id: string, flavor: string, stock: number, cost: number, price: number, min = 0): Product => ({
  id, name: `${flavor} 10K`, brand: "Elfbar", model: "10K", flavor,
  purchasePrice: cost, salePrice: price, stock, minStock: min,
  createdAt: "2026-06-01T00:00:00Z",
});

const sale = (id: string, productId: string, qty: number, unit: number, d: number, extra: Partial<Sale> = {}): Sale => ({
  id, productId, quantity: qty, unitPrice: unit, totalPrice: unit * qty,
  date: day(d), installments: 1, paidAmount: unit * qty, type: "venda",
  paymentMethod: "pix", ...extra,
});

const SELLER: Seller = { id: "s1", name: "Ana", debtPercentage: 0, createdAt: "2026-06-01T00:00:00Z", branchId: "b1" };
const PARTNER: Partner = { id: "p1", name: "Sócia", percentage: 60, monthlyProLabore: 2000, createdAt: "2026-06-01T00:00:00Z" };

function input(over: Partial<ReportInput> = {}): ReportInput {
  const products = [product("pr1", "Menta", 10, 40, 100, 6), product("pr2", "Uva", 0, 50, 120, 4)];
  return {
    generatedAt: new Date(2026, 8, 23, 14, 30),
    periodLabel: "Setembro/2026",
    branchLabel: "Curitiba",
    start: START,
    end: END,
    inPeriod: inSeptember,
    products,
    hiddenModels: new Set<string>(),
    sales: [
      sale("v1", "pr1", 2, 100, 5),
      sale("v2", "pr1", 1, 100, 10, { paidAmount: 0, paymentMethod: "pendente", sellerId: "s1" }),
      // Fora do período: não pode aparecer em aba nenhuma que siga o filtro.
      sale("v3", "pr1", 5, 100, 5 - 40),
    ],
    expenses: [{ id: "e1", description: "Aluguel", category: "Fixo", amount: 800, date: day(2) }] as Expense[],
    stockEntries: [] as StockEntry[],
    stockLosses: [],
    stockTransfers: [],
    purchaseOrders: [] as PurchaseOrder[],
    productAssignments: [
      { id: "a1", sellerId: "s1", productId: "pr1", quantity: 4, createdAt: day(1) },
    ] as ProductAssignment[],
    sellers: [SELLER],
    commissionPayments: [] as CommissionPayment[],
    sellerDebtPayments: [] as SellerDebtPayment[],
    sellerManualDebts: [{ id: "d1", sellerId: "s1", amount: 50, date: day(8) }] as SellerManualDebt[],
    partners: [PARTNER],
    proLaborePayments: [{ id: "w1", partnerId: "p1", amount: 300, date: day(20) }] as ProLaborePayment[],
    partnerContributions: [],
    loans: [{ id: "l1", lenderName: "Tio", principal: 1000, interestAmount: 100, receivedDate: day(1), createdAt: day(1) }] as Loan[],
    loanPayments: [{ id: "lp1", loanId: "l1", principalAmount: 400, interestAmount: 40, date: day(15), createdAt: day(15) }] as LoanPayment[],
    investors: [],
    dividends: [],
    financialEvents: [],
    modelStats: [],
    monthly: [{ monthLong: "Setembro/2026", receita: 300, cogs: 120, despesas: 800, perdas: 0, vendedores: 0, lucro: -620, margem: -206.7, vendas: 2, unidades: 3 }],
    position: {
      cash: 1234.5, inventory: 400, receivables: 100, partnerCapital: 0,
      loansOutstanding: 600, accumulatedProfit: 180, distributedProfit: 300, retainedEarnings: -120,
    },
    branchName: (id) => (id ? "Curitiba" : "Todas as filiais"),
    costOf: (s) => products.find(p => p.id === s.productId)?.purchasePrice ?? 0,
    ...over,
  };
}

const find = (sheets: ReportSheet[], name: string) => {
  const s = sheets.find(x => x.name === name);
  if (!s) throw new Error(`aba ausente: ${name}`);
  return s;
};
/** Índice da coluna pelo rótulo do cabeçalho — evita contar vírgulas à mão. */
const col = (sheet: ReportSheet, header: string) => {
  const i = sheet.rows[0].indexOf(header);
  if (i < 0) throw new Error(`coluna ausente em ${sheet.name}: ${header}`);
  return i;
};

describe("buildReport — forma do arquivo", () => {
  const sheets = buildReport(input());

  it("abre pelo Índice e lista todas as outras abas", () => {
    expect(sheets[0].name).toBe("Índice");
    const listed = sheets[0].rows.slice(4).map(r => r[0]);
    expect(listed).toEqual(sheets.slice(1).map(s => s.name));
  });

  it("respeita o limite de nome de aba do Excel", () => {
    // 31 caracteres e nada de `: \ / ? * [ ]`. Estourar qualquer um dos dois
    // faz o arquivo abrir corrompido, não dá erro na geração.
    sheets.forEach(s => {
      expect(s.name.length).toBeLessThanOrEqual(31);
      expect(s.name).not.toMatch(/[:\\/?*[\]]/);
    });
    expect(new Set(sheets.map(s => s.name)).size).toBe(sheets.length);
  });

  it("dá a cada linha o mesmo número de colunas do cabeçalho", () => {
    // Linha mais comprida que o cabeçalho é dado sem nome; mais curta some no
    // fim sem avisar. As duas passam batido na geração e aparecem só no Excel.
    sheets.filter(s => s.autofilter).forEach(s => {
      const width = s.rows[0].length;
      expect(s.widths.length, `larguras de ${s.name}`).toBe(width);
      s.rows.slice(1).forEach((row, i) => {
        expect(row.length, `${s.name}, linha ${i + 2}`).toBe(width);
      });
    });
  });
});

describe("buildReport — recortes", () => {
  const sheets = buildReport(input());

  it("a aba de Vendas traz só o período, com custo e lucro por linha", () => {
    const vendas = find(sheets, "Vendas");
    expect(vendas.rows.length - 1).toBe(2); // v3 é de agosto
    const lucro = col(vendas, "Lucro bruto");
    const total = col(vendas, "Total");
    // 2 un. × (100 − 40)
    expect(vendas.rows.find(r => r[total] === 200)?.[lucro]).toBe(120);
  });

  it("marca a situação do recebimento", () => {
    const vendas = find(sheets, "Vendas");
    const situacao = col(vendas, "Situação");
    expect(vendas.rows.slice(1).map(r => r[situacao]).sort()).toEqual(["Aberto", "Pago"]);
  });

  it("separa na casa e com vendedores sem somar duas vezes", () => {
    const estoque = find(sheets, "Estoque");
    const linha = estoque.rows.find(r => r[2] === "Menta")!;
    const [casa, comVendedor] = [col(estoque, "Na casa"), col(estoque, "Com vendedores")];
    expect(linha[col(estoque, "Estoque")]).toBe(10);
    expect(linha[casa]).toBe(6);
    expect(linha[comVendedor]).toBe(4);
    expect(Number(linha[casa]) + Number(linha[comVendedor])).toBe(10);
  });

  it("separa principal e juro do empréstimo", () => {
    const emp = find(sheets, "Empréstimos");
    const row = emp.rows[1];
    expect(row[col(emp, "Principal a devolver")]).toBe(600);
    expect(row[col(emp, "Juros a devolver")]).toBe(60);
    expect(row[col(emp, "Ainda a devolver")]).toBe(660);
    expect(row[col(emp, "Situação")]).toBe("Em aberto");
  });

  it("põe dívida lançada e pagamento em colunas próprias", () => {
    const dividas = find(sheets, "Dívidas de vendedor");
    const row = dividas.rows[1];
    expect(row[col(dividas, "Tipo")]).toBe("Dívida lançada");
    expect(row[col(dividas, "Lançado")]).toBe(50);
    expect(row[col(dividas, "Pago")]).toBe(0);
  });

  it("não cobra comissão de quem não é vendedor de comissão", () => {
    const dono = { ...SELLER, id: "s2", name: "Leo" };
    const sheets = buildReport(input({ sellers: [SELLER, dono] }));
    const nomes = find(sheets, "Comissões").rows.slice(1).map(r => r[0]);
    expect(nomes).toEqual(["Ana"]);
  });
});

describe("buildReport — Resumo", () => {
  const resumo = find(buildReport(input()), "Resumo");
  const value = (label: string) => resumo.rows.find(r => r[0] === label)?.[1];

  it("soma a receita e o lucro do período", () => {
    expect(value("Receita")).toBe(300);
    expect(value("CPV (custo dos produtos vendidos)")).toBe(120);
    expect(value("Lucro bruto")).toBe(180);
    expect(value("Despesas")).toBe(800);
    expect(value("Lucro líquido")).toBe(-620);
  });

  it("separa o que já entrou do que falta", () => {
    expect(value("Recebido")).toBe(200);
    expect(value("A receber")).toBe(100);
  });

  it("repassa a posição do razão sem recalcular", () => {
    expect(value("Caixa")).toBe(1234.5);
    expect(value("Lucro retido")).toBe(-120);
    // O juro não está no razão; o "ainda a devolver" soma as duas metades.
    expect(value("Empréstimos — juros a pagar")).toBe(60);
    expect(value("Ainda a devolver")).toBe(660);
  });

  it("o ticket médio é receita ÷ vendas, não recebido ÷ vendas", () => {
    expect(value("Ticket médio")).toBe(150);
  });
});

describe("dayBR", () => {
  it("escreve dd/MM/yyyy e engole data inválida", () => {
    expect(dayBR("2026-09-05T12:00:00.000Z")).toMatch(/^0[45]\/09\/2026$/);
    expect(dayBR(undefined)).toBe("");
    expect(dayBR("nem data")).toBe("");
  });
});
