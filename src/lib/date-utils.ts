/**
 * Returns today's date as YYYY-MM-DD string in local timezone.
 */
export function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
