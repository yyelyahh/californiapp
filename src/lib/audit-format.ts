/**
 * Tradução do `audit_log` para português.
 *
 * O banco grava o movimento em vocabulário de banco: `insert` em `sales`,
 * `changed_fields: {sale_price}`, `product_id: 8f3c…`. Isso responde a pergunta
 * de quem escreveu a migration, não a de quem abre a tela às onze da noite para
 * saber por que o estoque não bate. Este arquivo é a camada que transforma uma
 * coisa na outra — e ela mora aqui, fora do `.tsx`, porque é lógica com regra
 * própria (agrupamento por transação, escolha da linha principal), do tipo que
 * se testa sem montar tela: `src/test/audit-format.test.ts`.
 *
 * A formatação de dinheiro e de data NÃO nasce aqui: sai de `@/lib/currency` e
 * `@/lib/date-utils`, como em todas as outras telas. Auditoria que escreve real
 * de um jeito diferente do resto do painel faz duvidar do número, que é o
 * oposto do serviço dela.
 */
import { formatCurrency } from "@/lib/currency";
import { formatDateBR } from "@/lib/date-utils";

export type AuditAction = "insert" | "update" | "delete";

export type AuditRow = {
  id: string;
  at: string;
  tx: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_source: string;
  action: AuditAction;
  entity: string;
  entity_id: string | null;
  changed_fields: string[] | null;
  row_data: Record<string, unknown>;
  /**
   * Só as colunas que mudaram, como estavam antes. Nula em insert e em delete —
   * e também em toda linha gravada antes da migration 20260914190000, por isso
   * a tela trata ausência como "não dá para dizer o antes", nunca como zero.
   */
  old_data: Record<string, unknown> | null;
};

/**
 * Nome da tabela → como se fala dela.
 *
 * `area` é a TELA do painel onde aquilo vive, não uma categoria inventada: quem
 * lê o log já tem esse mapa na cabeça, porque é o menu da esquerda. `thing` já
 * vem com artigo porque o verbo muda de gênero em português e concordar na
 * montagem da frase custaria mais do que escrever as vinte linhas.
 */
type EntityInfo = { thing: string; area: string };

const ENTITY: Record<string, EntityInfo> = {
  sales: { thing: "uma venda", area: "Vendas" },
  orders: { thing: "um pedido", area: "Vendas" },
  products: { thing: "um produto", area: "Produtos" },
  stock_entries: { thing: "uma entrada de estoque", area: "Entrada" },
  purchase_orders: { thing: "uma compra", area: "Entrada" },
  stock_losses: { thing: "uma perda", area: "Perdas" },
  stock_transfers: { thing: "uma transferência entre filiais", area: "Entrada" },
  product_assignments: { thing: "uma atribuição de estoque", area: "Distribuição" },
  commission_payments: { thing: "um pagamento de comissão", area: "Distribuição" },
  seller_manual_debts: { thing: "uma dívida de vendedor", area: "Distribuição" },
  seller_debt_payments: { thing: "um pagamento de dívida", area: "Distribuição" },
  sellers: { thing: "um vendedor", area: "Distribuição" },
  pro_labore_payments: { thing: "um pró-labore", area: "Distribuição" },
  partner_payments: { thing: "uma retirada de sócio", area: "Distribuição" },
  expenses: { thing: "uma despesa", area: "Despesas" },
  partners: { thing: "um sócio", area: "Financeiro" },
  partner_contributions: { thing: "um aporte", area: "Financeiro" },
  dividends: { thing: "um dividendo", area: "Financeiro" },
  investors: { thing: "um investidor", area: "Financeiro" },
  loans: { thing: "um empréstimo", area: "Financeiro" },
  loan_payments: { thing: "um pagamento de empréstimo", area: "Financeiro" },
  product_branch: { thing: "o preço ou o estoque de um produto numa filial", area: "Produtos" },
  branches: { thing: "uma filial", area: "Acessos" },
  user_branches: { thing: "um acesso a filial", area: "Acessos" },
  user_roles: { thing: "um acesso", area: "Acessos" },
  user_display_names: { thing: "um nome de exibição", area: "Acessos" },
};

export function entityInfo(entity: string): EntityInfo {
  return ENTITY[entity] ?? { thing: `um registro em ${entity}`, area: "Outros" };
}

/** As áreas na ordem do menu — é assim que o filtro da tela as lista. */
export const AREAS = [
  "Vendas",
  "Produtos",
  "Entrada",
  "Perdas",
  "Distribuição",
  "Despesas",
  "Financeiro",
  "Acessos",
] as const;

/**
 * Qual linha do grupo é o ASSUNTO e quais são consequência.
 *
 * Uma venda registrada mexe em duas tabelas na mesma transação: nasce a linha
 * em `sales` e o `create_sale` debita `products.stock`. As duas viram registro
 * de auditoria, e mostrar as duas lado a lado diria que houve dois movimentos —
 * quando houve um, com um efeito. `products` fica no fim da fila por isso: ele
 * quase nunca é o motivo, é o rastro. Quando alguém edita o produto na tela de
 * Produtos, aquele grupo tem uma linha só e a prioridade não decide nada.
 *
 * `orders` vem na frente de `sales` porque confirmar um pedido cria N vendas: o
 * movimento é "confirmou o pedido", e as vendas são o que isso produziu.
 */
const PRIORITY = [
  "orders",
  "purchase_orders",
  "sales",
  "stock_entries",
  "stock_transfers",
  "stock_losses",
  "expenses",
  "commission_payments",
  "pro_labore_payments",
  "partner_payments",
  "partner_contributions",
  "dividends",
  "loans",
  "loan_payments",
  "seller_manual_debts",
  "seller_debt_payments",
  "investors",
  "partners",
  "sellers",
  "user_roles",
  "user_display_names",
  "branches",
  "user_branches",
  "product_assignments",
  // `product_branch` acompanha `products` no fim da fila, e pelo mesmo motivo:
  // toda venda mexe nele, e quase nunca é ELE o motivo do movimento.
  "product_branch",
  "products",
];

function priorityOf(entity: string): number {
  const i = PRIORITY.indexOf(entity);
  // Tabela que entrou na auditoria e ninguém listou aqui fica no meio, e não no
  // fim: o fim é o lugar reservado para quem se sabe ser consequência.
  return i === -1 ? PRIORITY.indexOf("expenses") : i;
}

export type Movement = {
  /** A transação. Duas escritas com o mesmo tx são o mesmo movimento. */
  tx: number;
  at: string;
  main: AuditRow;
  entries: AuditRow[];
};

/**
 * Agrupa as linhas em movimentos.
 *
 * Chave é só o `tx`: `at` recebe `now()`, que em Postgres é o instante de
 * INÍCIO da transação, então todas as linhas de um movimento carregam o mesmo
 * horário — e o `txid_current()` não se repete (é estendido com a época).
 *
 * O agrupamento roda sobre a lista INTEIRA já carregada, não página a página,
 * senão um movimento partido na virada da página viraria dois na tela.
 */
export function groupMovements(rows: AuditRow[]): Movement[] {
  const byTx = new Map<number, AuditRow[]>();
  for (const row of rows) {
    const group = byTx.get(row.tx);
    if (group) group.push(row);
    else byTx.set(row.tx, [row]);
  }

  return Array.from(byTx.values()).map(entries => {
    const main = entries.reduce((best, e) =>
      priorityOf(e.entity) < priorityOf(best.entity) ? e : best,
    );
    return { tx: main.tx, at: entries[0].at, main, entries };
  });
}

/* ------------------------------------------------------------------ */
/* Quem                                                                */
/* ------------------------------------------------------------------ */

/** user_id → nome de exibição, vindo de `public.user_display_names`. */
export type ActorNames = Record<string, string>;

/**
 * Nome curto de quem fez, em três degraus.
 *
 * 1. O nome de exibição cadastrado, quando existe. Ele é resolvido AQUI, na
 *    leitura, e não copiado para dentro do log: assim trocar o nome conserta
 *    também o que já está gravado, sem reescrever registro de auditoria.
 * 2. O `actor_name` que o gatilho copiou — o nome do vendedor.
 * 3. A parte antes do @ do e-mail. Na linha da lista o domínio ocupa espaço
 *    sem distinguir ninguém; o e-mail inteiro aparece no detalhe, e é ele, não
 *    o rótulo, que identifica a pessoa de verdade.
 */
export function actorLabel(row: AuditRow, names?: ActorNames): string {
  const display = row.actor_id ? names?.[row.actor_id] : undefined;
  if (display) return display;
  if (row.actor_name) return row.actor_name;
  if (row.actor_email) return row.actor_email.split("@")[0];
  if (row.actor_source === "anon") return "A loja";
  if (row.actor_source === "service_role") return "Um serviço";
  return "Alguém fora do painel";
}

/** Como a escrita chegou ao banco, em uma expressão. */
export function sourceLabel(source: string): string {
  if (source === "authenticated") return "pelo painel";
  if (source === "anon") return "pela loja pública";
  if (source === "service_role") return "por um serviço";
  return "direto no banco";
}

/** Escrita que não veio de alguém logado no painel merece selo na linha. */
export function isOutsideApp(source: string): boolean {
  return source !== "authenticated" && source !== "anon";
}

/* ------------------------------------------------------------------ */
/* O quê                                                               */
/* ------------------------------------------------------------------ */

const VERB: Record<AuditAction, string> = {
  insert: "registrou",
  update: "alterou",
  delete: "excluiu",
};

export type Phrase = {
  /** O predicado: entra depois do nome de quem fez. */
  text: string;
  /**
   * Movimento que não foi decisão de ninguém — a varredura de prazo dos
   * pedidos. Quem aparece como autor só teve o azar de ter aberto a tela que
   * disparou a varredura, e a linha precisa dizer isso.
   */
  automatic?: boolean;
};

/**
 * A frase do movimento, a partir da linha principal.
 *
 * Os casos especiais existem onde o verbo genérico mentiria por omissão:
 * "alterou um pedido" é verdade e não serve, quando o que aconteceu foi
 * confirmar ou recusar — que é a decisão que essa tela existe para rastrear.
 */
export function describe(main: AuditRow): Phrase {
  const info = entityInfo(main.entity);
  const changed = main.changed_fields ?? [];

  if (main.entity === "orders" && main.action === "update" && changed.includes("status")) {
    const status = String(main.row_data.status ?? "");
    if (status === "confirmada") return { text: "confirmou um pedido" };
    if (status === "recusada") return { text: "recusou um pedido" };
    if (status === "expirada") return { text: "marcou um pedido como expirado", automatic: true };
  }

  if (main.entity === "user_roles") {
    if (main.action === "insert") return { text: "concedeu um acesso" };
    if (main.action === "delete") return { text: "removeu um acesso" };
    return { text: "mudou um acesso" };
  }

  // Ajuste de estoque na mão, na tela de Produtos: o grupo tem uma linha só e
  // a única coluna mexida é o estoque. É o movimento que mais interessa
  // rastrear, e "alterou um produto" o esconderia no meio.
  //
  // A tabela mudou de `products` para `product_branch` quando o estoque passou
  // a ser da cidade; o caso antigo fica porque o log guarda o que aconteceu
  // ANTES da migração, e reescrever histórico é o que a auditoria não faz.
  if (
    (main.entity === "product_branch" || main.entity === "products") &&
    main.action === "update" &&
    changed.length === 1 &&
    changed[0] === "stock"
  ) {
    return { text: "ajustou o estoque de um produto" };
  }

  return { text: `${VERB[main.action]} ${info.thing}` };
}

/* ------------------------------------------------------------------ */
/* Valores                                                             */
/* ------------------------------------------------------------------ */

const FIELD_LABEL: Record<string, string> = {
  amount: "valor",
  brand: "marca",
  branch_id: "filial",
  from_branch_id: "filial de origem",
  to_branch_id: "filial de destino",
  category: "categoria",
  confirmed_at: "confirmado em",
  customer_id: "cliente",
  date: "data",
  debt_percentage: "% de dívida",
  description: "descrição",
  expected_quantity: "quantidade esperada",
  flavor: "sabor",
  freight_cost: "frete",
  freight_notes: "observação de entrega",
  image_url: "foto",
  installments: "parcelas",
  interest_amount: "juro",
  invested_amount: "valor investido",
  investor_id: "investidor",
  lender_name: "credor",
  loan_id: "empréstimo",
  min_stock: "estoque mínimo",
  model: "modelo",
  month: "mês",
  monthly_pro_labore: "pró-labore mensal",
  name: "nome",
  notes: "observação",
  number: "número",
  order_id: "pedido",
  paid_amount: "valor pago",
  paid_at: "pago em",
  partner_id: "sócio",
  payment_method: "forma de pagamento",
  percentage: "participação",
  principal: "principal",
  principal_amount: "principal",
  product_id: "produto",
  purchase_order_id: "compra",
  purchase_price: "preço de compra",
  quantity: "quantidade",
  reason: "motivo",
  received_at: "recebido em",
  received_date: "data de recebimento",
  received_flavors: "sabores recebidos",
  return_percentage: "% de retorno",
  role: "papel",
  sale_id: "venda",
  sale_price: "preço de venda",
  seller_id: "vendedor",
  status: "situação",
  stock: "estoque",
  total_amount: "total",
  total_cost: "custo total",
  total_price: "total",
  total_return: "retorno total",
  type: "tipo",
  unit_cost: "custo unitário",
  unit_price: "preço unitário",
  user_id: "usuário",
  whatsapp: "WhatsApp",
};

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_/g, " ");
}

const MONEY = new Set([
  "amount", "freight_cost", "interest_amount", "invested_amount", "monthly_pro_labore",
  "paid_amount", "principal", "principal_amount", "purchase_price", "sale_price",
  "total_amount", "total_cost", "total_price", "total_return", "unit_cost", "unit_price",
]);

const PERCENT = new Set(["debt_percentage", "percentage", "return_percentage"]);

const DATE = new Set([
  "confirmed_at", "date", "paid_at", "received_at", "received_date",
]);

/** Campos cujo valor é o id de outra linha — a tela resolve para nome. */
const REFERENCE = new Set([
  "branch_id", "from_branch_id", "to_branch_id",
  "customer_id", "investor_id", "loan_id", "order_id", "partner_id",
  "product_id", "purchase_order_id", "sale_id", "seller_id", "user_id",
]);

/**
 * Não entram no detalhe. `id` e os carimbos de tempo do banco não são decisão
 * de ninguém, e `client_token` é peça interna do pedido idempotente: mostrar
 * qualquer um dos três empurra para baixo o campo que importa.
 */
const HIDDEN = new Set(["id", "created_at", "updated_at", "client_token", "original_id"]);

/**
 * Ordem de leitura do detalhe. O jsonb do Postgres devolve as chaves ordenadas
 * por tamanho e depois por byte — ordem estável, mas sem relação nenhuma com o
 * que a pessoa quer ler primeiro.
 */
const FIELD_ORDER = [
  "date", "status", "branch_id", "from_branch_id", "to_branch_id", "name", "description", "brand", "model", "flavor", "category",
  "product_id", "seller_id", "partner_id", "investor_id", "customer_id", "user_id", "role",
  "quantity", "stock", "min_stock",
  "unit_price", "sale_price", "purchase_price", "unit_cost",
  "total_price", "total_amount", "total_cost", "amount", "principal", "principal_amount",
  "interest_amount", "paid_amount", "payment_method", "installments",
  "reason", "notes", "freight_notes",
];

/** Resolve o id de uma referência para um nome legível; null quando não acha. */
export type RefResolver = (field: string, id: string) => string | null;

/** Últimos 8 caracteres do uuid: identifica sem ocupar a linha inteira. */
export function shortId(id: string): string {
  return `#${id.slice(0, 8)}`;
}

const PAYMENT_LABEL: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  pix_pendente: "Pix pendente",
  dinheiro_pendente: "Dinheiro pendente",
  dinheiro_com_vendedor: "Dinheiro com o vendedor",
  pendente: "Pendente",
};

export function formatValue(field: string, value: unknown, resolve?: RefResolver): string {
  if (value === null || value === undefined || value === "") return "—";

  if (MONEY.has(field)) return formatCurrency(Number(value));
  if (PERCENT.has(field)) return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (DATE.has(field)) return formatDateBR(String(value));
  if (field === "payment_method") return PAYMENT_LABEL[String(value)] ?? String(value);

  if (REFERENCE.has(field)) {
    const id = String(value);
    return resolve?.(field, id) ?? shortId(id);
  }

  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") return JSON.stringify(value);

  const text = String(value);
  // A foto é uma URL colada à mão e costuma ter 200 caracteres. O que importa
  // no log é que ela mudou, e para qual domínio.
  if (field === "image_url") return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return text;
}

/** Os campos de um registro, na ordem de leitura e sem os escondidos. */
export function visibleFields(data: Record<string, unknown>): string[] {
  return Object.keys(data)
    .filter(k => !HIDDEN.has(k))
    .filter(k => data[k] !== null && data[k] !== undefined && data[k] !== "")
    .sort((a, b) => {
      const ia = FIELD_ORDER.indexOf(a);
      const ib = FIELD_ORDER.indexOf(b);
      if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return fieldLabel(a).localeCompare(fieldLabel(b), "pt-BR");
    });
}

/**
 * A segunda linha do movimento: o suficiente para não precisar abrir.
 *
 * Em alteração são os CAMPOS mexidos, porque é isso que distingue "mudou o
 * preço" de "corrigiu a observação". Em inclusão e exclusão é o conteúdo — o
 * que foi criado ou o que deixou de existir.
 */
export function summarize(movement: Movement, resolve?: RefResolver): string {
  const { main } = movement;
  const d = main.row_data;
  const val = (f: string) => formatValue(f, d[f], resolve);

  if (main.action === "update") {
    const changed = (main.changed_fields ?? []).filter(f => !HIDDEN.has(f));
    if (changed.length === 0) return "";
    const shown = changed.slice(0, 3).map(fieldLabel).join(", ");
    return changed.length > 3 ? `${shown} e mais ${changed.length - 3}` : shown;
  }

  switch (main.entity) {
    case "sales":
      return [`${d.quantity} un.`, val("total_price"), val("product_id")].join(" · ");
    case "stock_entries":
    case "stock_losses":
      return [`${d.quantity} un.`, val("product_id"), val("total_cost")].join(" · ");
    case "product_assignments":
      return [`${d.quantity} un.`, val("product_id"), val("seller_id")].join(" · ");
    case "orders":
      return [val("total_amount"), val("seller_id")].join(" · ");
    case "expenses":
      return [String(d.description ?? ""), val("amount")].filter(Boolean).join(" · ");
    case "products":
      return [d.brand, d.model, d.flavor].filter(Boolean).join(" · ");
    case "user_roles":
      return [val("role"), val("user_id")].join(" · ");
    default: {
      // O resto tem sempre a mesma forma: um nome (ou a quem se refere) e um
      // valor. Montar caso a caso para vinte tabelas seria vinte lugares para
      // esquecer de mexer quando uma coluna mudasse de nome.
      const who = ["name", "description", "lender_name", "seller_id", "partner_id", "investor_id"]
        .find(f => d[f] !== null && d[f] !== undefined && d[f] !== "");
      const money = ["amount", "total_price", "total_amount", "principal", "invested_amount"]
        .find(f => typeof d[f] === "number");
      return [who ? val(who) : null, money ? val(money) : null].filter(Boolean).join(" · ");
    }
  }
}

/**
 * Texto em que a busca da tela procura. Junta quem, a frase e o resumo, porque
 * é isso que está escrito na linha — procurar por "Uva" tem que achar a venda
 * do sabor Uva, e procurar por "gabi" tem que achar o que a Gabi fez.
 */
export function searchableText(movement: Movement, resolve?: RefResolver, names?: ActorNames): string {
  return [
    actorLabel(movement.main, names),
    movement.main.actor_email ?? "",
    describe(movement.main).text,
    summarize(movement, resolve),
    entityInfo(movement.main.entity).area,
  ]
    .join(" ")
    .toLowerCase();
}
