export function onlyDigits(value: string) {
  return (value || "").replace(/\D/g, "");
}

/** Formata para (11) 99999-8888 conforme o usuário digita. */
export function formatPhoneDisplay(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function isValidPhone(value: string) {
  const len = onlyDigits(value).length;
  return len >= 10 && len <= 11;
}
