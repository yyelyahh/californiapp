/**
 * Formats a Date as YYYY-MM-DD in local timezone — the shape every date input
 * and every date filter in the app speaks.
 */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns today's date as YYYY-MM-DD string in local timezone.
 */
export function todayDateString(): string {
  return isoDay(new Date());
}

/**
 * Primeiro e último dia do mês corrente.
 *
 * Mora aqui porque é o recorte PADRÃO de mais de uma tela (Vendas e Entrada
 * abrem nele, por desempenho — ver o roadmap no CLAUDE.md). O estado inicial e
 * o chip "Mês" precisam produzir exatamente o mesmo intervalo; com a conta
 * repetida em cada tela, um dia eles divergem.
 */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/**
 * Converts a YYYY-MM-DD form value to an ISO-like string preserving the local date.
 * Appends T12:00:00 to avoid UTC date shifting.
 */
/**
 * Lê o valor de um `<input type="date">` e devolve uma data VÁLIDA, ou o
 * `fallback`.
 *
 * Quem digita a data à mão (em vez de usar as setas ou o calendário) passa por
 * valores incompletos no meio do caminho — o campo fica vazio enquanto o ano
 * não está inteiro. `parseISO("")` NÃO lança: devolve "Invalid Date", que
 * atravessa o `try/catch` e explode depois, no `format(...)` do rótulo, com
 * "Invalid time value" — derrubando a tela inteira. Era o que acontecia na
 * Distribuição e na Insights. Ano parcial ("0002") vira uma data válida e
 * esquisita por um instante, e isso não quebra nada.
 *
 * Testada em src/test/date-windows.test.ts.
 */
export function parseDay(value: string, fallback: Date): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return fallback;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // "2026-02-31" vira 3 de março no construtor: data que não existe cai no
  // fallback em vez de virar outra.
  if (isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return fallback;
  return d;
}

/**
 * O período ANTERIOR, do tamanho do trecho JÁ CORRIDO do período atual.
 *
 * Duas armadilhas, as duas já pegas na Insights:
 * - período em curso (o mês de hoje) comparado com o anterior INTEIRO: no dia
 *   9, nove dias de venda contra um mês cheio diziam todo começo de mês que
 *   tudo despencou;
 * - fim em meia-noite: `addDays(start, -1)` é 00:00 do último dia, e todo
 *   lançamento é gravado ao meio-dia — o último dia ficava de fora.
 *
 * Testada em src/test/date-windows.test.ts.
 */
export function previousWindow(start: Date, end: Date, now: Date = new Date()): { start: Date; end: Date } {
  const today = endOfLocalDay(now);
  const elapsedEnd = end > today ? today : end;
  const days = Math.max(1, calendarDaysBetween(start, elapsedEnd) + 1);
  const prevEnd = endOfLocalDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1));
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
  return { start: prevStart, end: prevEnd };
}

/**
 * O MESMO TRECHO do mês anterior: do dia 1 até o mesmo dia de hoje (ou o
 * último dia dele, se o mês anterior for mais curto). É a régua do "Ritmo do
 * mês" das Despesas e das setas do Dashboard no mês em curso.
 *
 * `year`/`month0` são do mês ATUAL (month0 de 0 a 11).
 */
export function sameStretchOfPreviousMonth(
  year: number,
  month0: number,
  day: number,
): { start: Date; end: Date; day: number } {
  const lastDayPrev = new Date(year, month0, 0).getDate();
  const d = Math.min(day, lastDayPrev);
  return {
    start: new Date(year, month0 - 1, 1),
    end: endOfLocalDay(new Date(year, month0 - 1, d)),
    day: d,
  };
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Dias de calendário entre duas datas (ignora hora e horário de verão). */
function calendarDaysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function localDateToISO(dateStr: string): string {
  return `${dateStr}T12:00:00`;
}

/**
 * Formats a date string (ISO or similar) to dd/MM/yyyy in local timezone.
 */
export function formatDateBR(dateStr: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
