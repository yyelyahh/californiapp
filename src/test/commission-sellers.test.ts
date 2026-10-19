import { describe, it, expect } from "vitest";
import { isCommissionSeller } from "@/lib/commissions";

describe("isCommissionSeller", () => {
  it("Luis de Porto Alegre recebe comissão", () => {
    expect(isCommissionSeller({ id: "39d75fa2-dd4a-4aaf-874a-059732e94915", name: "Luis" })).toBe(true);
  });
  it("Luis de Ivoti segue sem comissão", () => {
    expect(isCommissionSeller({ id: "5e67736f-7827-4064-889f-9aa3ab46a342", name: "Luis" })).toBe(false);
  });
  it("Gabriel F. recebe comissão", () => {
    expect(isCommissionSeller({ id: "x", name: "Gabriel F." })).toBe(true);
  });
});
