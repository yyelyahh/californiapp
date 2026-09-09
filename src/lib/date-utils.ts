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
