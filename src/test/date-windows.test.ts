import { describe, it, expect } from "vitest";
import { previousWindow, sameStretchOfPreviousMonth, localDateToISO, parseDay } from "@/lib/date-utils";

describe("parseDay", () => {
  const fallback = new Date(2026, 0, 1);
  it("lê a data do campo", () => {
    expect(parseDay("2026-09-24", fallback)).toEqual(new Date(2026, 8, 24));
  });
  it("valor pela metade (quem digita à mão) cai no fallback em vez de virar data inválida", () => {
    for (const v of ["", "2026-09", "2026-9-4", "abc", "2026-02-31"]) {
      expect(parseDay(v, fallback)).toBe(fallback);
    }
  });
});

/** Todo lançamento é gravado ao meio-dia do dia escolhido. */
const noon = (day: string) => new Date(localDateToISO(day));
const within = (d: Date, w: { start: Date; end: Date }) => d >= w.start && d <= w.end;

describe("previousWindow", () => {
  it("mês em curso compara com o mesmo NÚMERO de dias já corridos, não com um mês cheio", () => {
    const now = new Date(2026, 8, 9, 15, 0); // 9 de setembro
    const w = previousWindow(new Date(2026, 8, 1), new Date(2026, 8, 30, 23, 59, 59, 999), now);
    // 9 dias corridos → os 9 dias antes do dia 1: 23 a 31 de agosto.
    expect(w.start).toEqual(new Date(2026, 7, 23));
    expect(within(noon("2026-08-31"), w)).toBe(true);
    expect(within(noon("2026-08-22"), w)).toBe(false);
  });

  it("o último dia do período anterior entra (fim no fim do dia, não à meia-noite)", () => {
    const w = previousWindow(new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59, 999), new Date(2026, 8, 20));
    expect(within(noon("2026-07-31"), w)).toBe(true);
    expect(within(noon("2026-07-01"), w)).toBe(true);
    expect(within(noon("2026-08-01"), w)).toBe(false);
  });

  it("período fechado usa o tamanho inteiro dele", () => {
    // 10 a 19 de agosto (10 dias), olhando de setembro.
    const w = previousWindow(new Date(2026, 7, 10), new Date(2026, 7, 19, 23, 59, 59, 999), new Date(2026, 8, 20));
    expect(w.start).toEqual(new Date(2026, 6, 31));
    expect(within(noon("2026-08-09"), w)).toBe(true);
  });
});

describe("sameStretchOfPreviousMonth", () => {
  it("vai do dia 1 até o mesmo dia, inclusive", () => {
    const s = sameStretchOfPreviousMonth(2026, 8, 24); // setembro, dia 24
    expect(s.start).toEqual(new Date(2026, 7, 1));
    expect(within(noon("2026-08-24"), s)).toBe(true);
    expect(within(noon("2026-08-25"), s)).toBe(false);
  });

  it("mês anterior mais curto: para no último dia dele", () => {
    const s = sameStretchOfPreviousMonth(2026, 2, 31); // 31 de março
    expect(s.day).toBe(28);
    expect(within(noon("2026-02-28"), s)).toBe(true);
  });

  it("janeiro olha para dezembro do ano anterior", () => {
    const s = sameStretchOfPreviousMonth(2027, 0, 10);
    expect(s.start).toEqual(new Date(2026, 11, 1));
    expect(within(noon("2026-12-10"), s)).toBe(true);
  });
});
