/**
 * O endereço da tela de Vendas já filtrada.
 *
 * É o contrato entre quem MANDA (o Dashboard, quando se clica na receita, no
 * "a receber" ou num modelo) e quem ABRE (a SalesPage). Mora num lugar só
 * porque os dois lados precisam escrever e ler exatamente os mesmos nomes — um
 * `?de=` de um lado e um `?inicio=` do outro abriria Vendas sem filtro nenhum,
 * sem erro, mostrando um total que não é o que se clicou.
 *
 * O filtro vai no endereço, e não num estado do router, para o VOLTAR do
 * navegador funcionar sem pensar: Dashboard → Vendas filtrada → voltar cai no
 * Dashboard do mesmo mês (ele também guarda o mês no endereço, `?mes=`).
 *
 * Cada filtro que viaja por aqui é um que devolve, em Vendas, o MESMO número
 * que foi clicado. Por isso não existe "recebido": a soma do recebido inclui a
 * parte paga das vendas parciais, e nenhum recorte de lista reproduz isso — o
 * link abriria uma tela discordando do número que levou até ela.
 */

/** Situação que viaja: só "a receber" (tudo com saldo, aberto ou parcial). */
export type SalesLinkStatus = "due";

export interface SalesLinkFilter {
  /** Intervalo em dias locais (yyyy-MM-dd), os dois ou nenhum. */
  from?: string;
  to?: string;
  /** Todo o período — o "Geral" do Dashboard. Ganha de `from`/`to`. */
  all?: boolean;
  status?: SalesLinkStatus;
  /**
   * Modelo por MARCA + modelo, nunca só o nome: o "10K" da Elfbar e o "10K" da
   * Ignite são produtos diferentes, e a busca de texto da tela de Vendas não
   * olha a marca.
   */
  model?: { brand: string; model: string };
}

export const SALES_PATH = "/sales";

export function buildSalesLink(f: SalesLinkFilter): string {
  const p = new URLSearchParams();
  if (f.all) {
    p.set("periodo", "tudo");
  } else if (f.from && f.to) {
    p.set("de", f.from);
    p.set("ate", f.to);
  }
  if (f.status === "due") p.set("situacao", "a-receber");
  if (f.model) {
    p.set("marca", f.model.brand);
    p.set("modelo", f.model.model);
  }
  const q = p.toString();
  return q ? `${SALES_PATH}?${q}` : SALES_PATH;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia que existe de verdade: "2026-02-31" passa na forma e não é data. */
function isRealDay(s: string | null): s is string {
  if (!s || !DAY.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Lê o endereço. Devolve `null` quando nada ali é filtro — a tela abre no
 * padrão dela. Parâmetro inválido é ignorado sozinho, sem derrubar os outros:
 * um link colado pela metade ainda filtra o que sobrou dele.
 */
export function parseSalesLink(search: string): SalesLinkFilter | null {
  const p = new URLSearchParams(search);
  const f: SalesLinkFilter = {};
  let any = false;

  if (p.get("periodo") === "tudo") {
    f.all = true;
    any = true;
  } else {
    const de = p.get("de");
    const ate = p.get("ate");
    if (isRealDay(de) && isRealDay(ate) && de <= ate) {
      f.from = de;
      f.to = ate;
      any = true;
    }
  }

  if (p.get("situacao") === "a-receber") {
    f.status = "due";
    any = true;
  }

  const brand = p.get("marca")?.trim();
  const model = p.get("modelo")?.trim();
  if (brand && model) {
    f.model = { brand, model };
    any = true;
  }

  return any ? f : null;
}
