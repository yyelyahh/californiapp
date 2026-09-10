import { useMemo, useState, type FormEvent } from "react";
import { useStore } from "@/context/StoreContext";
import { AnimatePresence, motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { Plus, Trash2, Wallet } from "lucide-react";
import { formatDateBR, todayDateString, localDateToISO } from "@/lib/date-utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { useConfirm } from "@/components/ConfirmProvider";
import { NcButton, NcSheetHeader, Rule, EYEBROW } from "@/components/nocturne";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";

/** Quantos sócios cabem na lista do trilho antes de virar "+ N outros". */
const MAX_RAIL_ROWS = 6;

/** Qual painel está aberto. Um de cada vez — os três registram coisas diferentes. */
type OpenPanel = null | "aporte" | "emprestimo" | { loanId: string };

export default function FinancePage() {
  const {
    partners, partnerContributions, loans, loanPayments,
    addPartnerContribution, deletePartnerContribution,
    addLoan, deleteLoan, addLoanPayment,
    getPartnerCapital, getLoansOutstanding,
    getCash, getInventoryCostValue, getReceivables,
  } = useStore();
  const confirm = useConfirm();

  const [panel, setPanel] = useState<OpenPanel>(null);
  const [submitting, setSubmitting] = useState(false);

  const partnerCapital = getPartnerCapital();
  /** Só o PRINCIPAL que ainda não voltou — é o que o razão carrega em `loan_delta`. */
  const principalOutstanding = getLoansOutstanding();
  const cash = getCash();
  const inventory = getInventoryCostValue();
  const receivables = getReceivables();

  /** De onde veio o dinheiro que não é venda: sócio ou credor. Principal, não
   *  o total com juros — juro nenhum entrou como dinheiro. */
  const funding = partnerCapital + principalOutstanding;

  const sortedContributions = useMemo(
    () => [...partnerContributions].sort((a, b) => b.date.localeCompare(a.date)),
    [partnerContributions],
  );

  /** Aporte somado por sócio — o corte que a lista cronológica não dá. */
  const byPartner = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; count: number }>();
    partnerContributions.forEach(c => {
      const name = partners.find(p => p.id === c.partnerId)?.name ?? "Sócio";
      const cur = map.get(c.partnerId);
      if (cur) { cur.total += c.amount; cur.count += 1; }
      else map.set(c.partnerId, { id: c.partnerId, name, total: c.amount, count: 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [partnerContributions, partners]);

  const loanRows = useMemo(() => {
    return loans
      .map(l => {
        const mine = loanPayments.filter(p => p.loanId === l.id);
        const principalPaid = mine.reduce((s, p) => s + p.principalAmount, 0);
        const interestPaidHere = mine.reduce((s, p) => s + p.interestAmount, 0);
        // Principal e juro andam separados porque o razão os trata assim
        // (`loan_delta` x `accumulated_profit_delta`). Subtrair a soma dos dois
        // de um total único deixava um pagamento só de juro abatendo dívida que
        // ainda existe — e era daí que saía a sugestão errada do formulário.
        const principalRemaining = Math.max(0, l.principal - principalPaid);
        const interestRemaining = Math.max(0, l.interestAmount - interestPaidHere);
        const remaining = principalRemaining + interestRemaining;
        return {
          ...l,
          total: l.principal + l.interestAmount,
          paid: principalPaid + interestPaidHere,
          principalRemaining,
          interestRemaining,
          remaining,
          settled: remaining <= 0.01,
          payments: mine.length,
        };
      })
      // Em aberto primeiro: quitado é histórico, não é decisão de hoje.
      .sort((a, b) => Number(a.settled) - Number(b.settled) || b.remaining - a.remaining);
  }, [loans, loanPayments]);

  const interestPaid = useMemo(
    () => loanPayments.reduce((s, p) => s + p.interestAmount, 0),
    [loanPayments],
  );

  /** Juro combinado que ainda não foi pago — a metade que o razão não carrega. */
  const interestRemaining = useMemo(
    () => loanRows.reduce((s, l) => s + l.interestRemaining, 0),
    [loanRows],
  );

  /**
   * "Ainda a devolver" da tela inteira: o principal do razão MAIS o juro que
   * falta. O cabeçalho da seção e o trilho liam só o principal enquanto cada
   * linha mostrava principal + juro, então a mesma frase valia dois números na
   * mesma tela — e dava para um empréstimo aparecer "Quitado" com saldo vivo
   * na coluna do lado.
   */
  const loansRemaining = principalOutstanding + interestRemaining;

  /* ---------------- Formulários ---------------- */
  const [contribForm, setContribForm] = useState({ partnerId: "", amount: "", date: todayDateString(), notes: "" });
  const [loanForm, setLoanForm] = useState({ lenderName: "", principal: "", interestAmount: "", receivedDate: todayDateString(), notes: "" });
  const [payForm, setPayForm] = useState({ principalAmount: "", interestAmount: "", date: todayDateString(), notes: "" });

  const openLoanId = typeof panel === "object" && panel !== null ? panel.loanId : null;
  const payingLoan = openLoanId ? loanRows.find(l => l.id === openLoanId) : null;

  const closePanel = () => setPanel(null);

  const openPay = (loan: { id: string; principalRemaining: number; interestRemaining: number }) => {
    setPanel({ loanId: loan.id });
    // Sugere quitar, com cada metade no seu campo. Antes o principal vinha com
    // o que falta INTEIRO, juro incluído: aceitar a sugestão lançava juro como
    // abatimento de principal, o razão via -1100 contra +1000, "Ainda a
    // devolver" ia a negativo e o juro nunca abatia o lucro acumulado.
    setPayForm({
      principalAmount: loan.principalRemaining > 0.01 ? loan.principalRemaining.toFixed(2) : "",
      interestAmount: loan.interestRemaining > 0.01 ? loan.interestRemaining.toFixed(2) : "",
      date: todayDateString(),
      notes: "",
    });
  };

  const contribAmount = Number(contribForm.amount) || 0;
  const loanPrincipal = Number(loanForm.principal) || 0;
  const loanInterest = Number(loanForm.interestAmount) || 0;
  const payTotal = (Number(payForm.principalAmount) || 0) + (Number(payForm.interestAmount) || 0);

  const submitContrib = async (e: FormEvent) => {
    e.preventDefault();
    if (!contribForm.partnerId || contribAmount <= 0) return;
    setSubmitting(true);
    await addPartnerContribution({
      partnerId: contribForm.partnerId,
      amount: contribAmount,
      date: localDateToISO(contribForm.date),
      notes: contribForm.notes.trim() || undefined,
    });
    setSubmitting(false);
    setContribForm({ partnerId: "", amount: "", date: todayDateString(), notes: "" });
    closePanel();
  };

  const submitLoan = async (e: FormEvent) => {
    e.preventDefault();
    if (!loanForm.lenderName.trim() || loanPrincipal <= 0) return;
    setSubmitting(true);
    await addLoan({
      lenderName: loanForm.lenderName.trim(),
      principal: loanPrincipal,
      interestAmount: loanInterest,
      receivedDate: localDateToISO(loanForm.receivedDate),
      notes: loanForm.notes.trim() || undefined,
    });
    setSubmitting(false);
    setLoanForm({ lenderName: "", principal: "", interestAmount: "", receivedDate: todayDateString(), notes: "" });
    closePanel();
  };

  const submitPay = async (e: FormEvent) => {
    e.preventDefault();
    if (!openLoanId || payTotal <= 0) return;
    setSubmitting(true);
    await addLoanPayment({
      loanId: openLoanId,
      principalAmount: Number(payForm.principalAmount) || 0,
      interestAmount: Number(payForm.interestAmount) || 0,
      date: localDateToISO(payForm.date),
      notes: payForm.notes.trim() || undefined,
    });
    setSubmitting(false);
    closePanel();
  };

  return (
    // `/finance` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>Capital e dívida</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Financeiro</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <NcButton variant="solid" size="md" onClick={() => setPanel("aporte")}>
              <Plus size={14} />Aporte
            </NcButton>
            <NcButton variant="quiet" size="md" onClick={() => setPanel("emprestimo")}>
              <Plus size={14} />Empréstimo
            </NcButton>
          </div>
        </header>

        {/* ---------------- Aportes ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Aportes dos sócios"
            sub={`${sortedContributions.length} lançamento${sortedContributions.length === 1 ? "" : "s"} · ${formatCurrency(partnerCapital)} de capital`}
          />
          {sortedContributions.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum aporte registrado.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              <AnimatePresence initial={false}>
                {sortedContributions.map(c => {
                  const partner = partners.find(p => p.id === c.partnerId);
                  return (
                    <motion.div
                      key={c.id}
                      layout
                      variants={listItem}
                      exit={{ opacity: 0, height: 0 }}
                      transition={transitionBase}
                      className="nc-row nc-hover group flex items-center justify-between gap-3 overflow-hidden px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">{partner?.name ?? "Sócio"}</p>
                        <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                          {formatDateBR(c.date)}{c.notes ? ` · ${c.notes}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-none items-center gap-3">
                        <span className="nc-num text-[13px]">{formatCurrency(c.amount)}</span>
                        {/* No desktop a ação só aparece no hover; no toque não há
                            hover, então fica sempre visível abaixo de sm. */}
                        <div className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <NcButton
                            variant="danger"
                            size="icon"
                            aria-label={`Excluir aporte de ${partner?.name ?? "sócio"}`}
                            onClick={async () => {
                              if (await confirm({ title: "Excluir aporte", description: "O capital dos sócios volta a não contar com este valor.", destructive: true })) {
                                deletePartnerContribution(c.id);
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </NcButton>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </Stagger>
          )}
        </section>

        {/* ---------------- Empréstimos ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Empréstimos"
            sub={loansRemaining > 0.01 ? `${formatCurrency(loansRemaining)} ainda a devolver` : "Nada em aberto"}
          />
          {loanRows.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum empréstimo registrado.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              <AnimatePresence initial={false}>
                {loanRows.map(l => (
                  <motion.div
                    key={l.id}
                    layout
                    variants={listItem}
                    exit={{ opacity: 0, height: 0 }}
                    transition={transitionBase}
                    className="nc-row group overflow-hidden px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px]">{l.lenderName}</span>
                        {l.settled && <span className="nc-pill nc-pill--paid flex-none">Quitado</span>}
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <span
                          className="nc-num text-[13px]"
                          style={{ color: l.settled ? "var(--nc-text-2)" : "var(--nc-alert)" }}
                        >
                          {formatCurrency(l.remaining)}
                        </span>
                        {!l.settled && (
                          <NcButton variant="quiet" onClick={() => openPay(l)}>
                            Pagamento
                          </NcButton>
                        )}
                        {/* Faltava por completo: empréstimo lançado errado (ou de
                            teste) não tinha como sair da tela. O banco apaga os
                            pagamentos junto, por ON DELETE CASCADE em
                            loan_payments.loan_id. */}
                        <div className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <NcButton
                            variant="danger"
                            size="icon"
                            aria-label={`Excluir empréstimo de ${l.lenderName}`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Excluir empréstimo",
                                description: l.payments > 0
                                  ? `${l.lenderName} · ${formatCurrency(l.total)}\n\nOs ${l.payments} pagamento(s) registrados nele também são apagados.`
                                  : `${l.lenderName} · ${formatCurrency(l.total)}`,
                                destructive: true,
                              });
                              if (ok) deleteLoan(l.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </NcButton>
                        </div>
                      </div>
                    </div>

                    <p className="nc-num mt-1 truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      {formatDateBR(l.receivedDate)} · principal {formatCurrency(l.principal)}
                      {l.interestAmount > 0 && ` · juros ${formatCurrency(l.interestAmount)}`}
                      {l.notes ? ` · ${l.notes}` : ""}
                    </p>

                    {/* Divisão real do total do empréstimo: o que já voltou e o
                        que falta. */}
                    <div className="mt-2 flex h-[5px] gap-0.5">
                      <div style={{ flex: Math.max(l.paid, 0.001), background: "var(--nc-ok)", borderRadius: 2 }} />
                      {l.remaining > 0.01 && (
                        <div style={{ flex: l.remaining, background: "var(--nc-alert)", borderRadius: 2 }} />
                      )}
                    </div>
                    <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                      <span style={{ color: "var(--nc-ok)" }}>pago {formatCurrencyShort(l.paid)}</span>
                      <span>de {formatCurrencyShort(l.total)}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </Stagger>
          )}
        </section>
      </div>

      {/* ---------------- Coluna direita: a posição de hoje ----------------
          A tela ignorava o razão (`financial_events`) por completo, embora ele
          já estivesse calculado no StoreContext. É dele que sai tudo aqui. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Posição de hoje</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Caixa</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <span style={{ color: cash < 0 ? "var(--nc-crit)" : undefined }}>
              <AnimatedNumber
                value={cash}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
              />
            </span>
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            estoque a custo {formatCurrencyShort(inventory)} · a receber {formatCurrencyShort(receivables)}
          </p>
        </div>

        <Rule />

        {/* Divisão real: todo dinheiro que entrou sem ser venda veio de um sócio
            ou de um credor. O do credor volta; o do sócio, não. */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Wallet size={12} style={{ color: "var(--nc-text-3)" }} />
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>De onde veio o dinheiro</span>
          </div>
          {funding <= 0 ? (
            <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhum aporte ou empréstimo registrado.
            </p>
          ) : (
            <>
              <div className="flex h-[5px] gap-0.5">
                <div style={{ flex: Math.max(partnerCapital, 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
                {principalOutstanding > 0.01 && (
                  <div style={{ flex: principalOutstanding, background: "var(--nc-alert)", borderRadius: 2 }} />
                )}
              </div>
              <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                <span>sócios {formatCurrencyShort(partnerCapital)}</span>
                <span style={{ color: "var(--nc-alert)" }}>principal {formatCurrencyShort(principalOutstanding)}</span>
              </div>
            </>
          )}
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Empréstimos em aberto</span>
            <span className="nc-num text-sm">{loanRows.filter(l => !l.settled).length}</span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Ainda a devolver</span>
            <span style={{ color: loansRemaining > 0.01 ? "var(--nc-alert)" : undefined }}>
              <AnimatedNumber
                value={loansRemaining}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-xl font-semibold"
              />
            </span>
          </div>
          {/* As duas metades, porque só uma delas aparece na barra acima: lá
              está o principal, que é o dinheiro que de fato entrou. */}
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>principal {formatCurrencyShort(principalOutstanding)}</span>
            <span>juros {formatCurrencyShort(interestRemaining)}</span>
          </div>
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>juros já pagos</span>
            <span>{formatCurrencyShort(interestPaid)}</span>
          </div>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Capital por sócio</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {byPartner.length} no total
            </span>
          </div>
          {byPartner.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhum aporte registrado.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {byPartner.slice(0, MAX_RAIL_ROWS).map(p => (
                <motion.div key={p.id} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="nc-num flex-none">
                    {formatCurrencyShort(p.total)}
                    <span style={{ color: "var(--nc-text-3)" }}> · {p.count}</span>
                  </span>
                </motion.div>
              ))}
              {byPartner.length > MAX_RAIL_ROWS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {byPartner.length - MAX_RAIL_ROWS} outros sócios
                </p>
              )}
            </Stagger>
          )}
        </div>
      </aside>

      {/* ================= Aporte ================= */}
      <Sheet open={panel === "aporte"} onOpenChange={v => { if (!v) closePanel(); }}>
        <SheetContent className="nocturne w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Capital"
            title="Aporte de sócio"
            description="Dinheiro que o sócio põe na operação. Não volta como dívida — vira capital."
          />
          <form id="form-aporte" onSubmit={submitContrib} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Quem e quanto</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Sócio</Label>
                <Select value={contribForm.partnerId} onValueChange={v => setContribForm(f => ({ ...f, partnerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o sócio" /></SelectTrigger>
                  <SelectContent className="nocturne">
                    {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={contribForm.amount} onChange={e => setContribForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" className="nc-num" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={contribForm.date} onChange={e => setContribForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observação</Label>
                <Input value={contribForm.notes} onChange={e => setContribForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
              </div>
            </section>
          </form>
          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {contribAmount > 0
                  ? <>Capital passa a <span className="nc-num font-medium">{formatCurrency(partnerCapital + contribAmount)}</span></>
                  : "Escolha o sócio e o valor"}
              </p>
              <NcButton type="submit" form="form-aporte" variant="solid" size="md" disabled={!contribForm.partnerId || contribAmount <= 0 || submitting}>
                {submitting ? "Registrando…" : "Registrar aporte"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ================= Empréstimo ================= */}
      <Sheet open={panel === "emprestimo"} onOpenChange={v => { if (!v) closePanel(); }}>
        <SheetContent className="nocturne w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Dívida"
            title="Empréstimo recebido"
            description="Dinheiro que entrou e vai ter de voltar. Os juros são o total combinado, não a taxa."
          />
          <form id="form-emprestimo" onSubmit={submitLoan} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>De quem veio</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Credor</Label>
                <Input value={loanForm.lenderName} onChange={e => setLoanForm(f => ({ ...f, lenderName: e.target.value }))} placeholder="Nome de quem emprestou" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data de recebimento</Label>
                <Input type="date" value={loanForm.receivedDate} onChange={e => setLoanForm(f => ({ ...f, receivedDate: e.target.value }))} />
              </div>
            </section>
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Quanto</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Principal (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={loanForm.principal} onChange={e => setLoanForm(f => ({ ...f, principal: e.target.value }))} placeholder="0,00" className="nc-num" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Juros totais (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={loanForm.interestAmount} onChange={e => setLoanForm(f => ({ ...f, interestAmount: e.target.value }))} placeholder="0,00" className="nc-num" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observação</Label>
                <Input value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
              </div>
            </section>
          </form>
          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {loanPrincipal > 0
                  ? <>A devolver <span className="nc-num font-medium" style={{ color: "var(--nc-alert)" }}>{formatCurrency(loanPrincipal + loanInterest)}</span></>
                  : "Preencha o credor e o principal"}
              </p>
              <NcButton type="submit" form="form-emprestimo" variant="solid" size="md" disabled={!loanForm.lenderName.trim() || loanPrincipal <= 0 || submitting}>
                {submitting ? "Registrando…" : "Registrar empréstimo"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ================= Pagamento de empréstimo ================= */}
      <Sheet open={!!openLoanId} onOpenChange={v => { if (!v) closePanel(); }}>
        <SheetContent className="nocturne w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
          {payingLoan && (
            <>
              <NcSheetHeader
                eyebrow="Dívida"
                title={`Pagamento a ${payingLoan.lenderName}`}
                description="Separe quanto do valor abate o principal e quanto é juro — o razão trata os dois de forma diferente."
              />
              <form id="form-pagamento" onSubmit={submitPay} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                <section className="space-y-1.5">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Onde este empréstimo está</p>
                  <LedgerLine label="Total com juros" value={formatCurrency(payingLoan.total)} />
                  <LedgerLine label="Já pago" value={formatCurrency(payingLoan.paid)} tone="var(--nc-ok)" />
                  <div className="nc-rule-top flex items-center justify-between gap-2 pt-2 text-[13px]">
                    <span>Falta</span>
                    <span className="nc-num font-medium" style={{ color: "var(--nc-alert)" }}>
                      {formatCurrency(payingLoan.remaining)}
                    </span>
                  </div>
                </section>
                <Rule />
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Registrar pagamento</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Principal (R$)</Label>
                      <Input type="number" step="0.01" min="0" value={payForm.principalAmount} onChange={e => setPayForm(f => ({ ...f, principalAmount: e.target.value }))} placeholder="0,00" className="nc-num" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Juros (R$)</Label>
                      <Input type="number" step="0.01" min="0" value={payForm.interestAmount} onChange={e => setPayForm(f => ({ ...f, interestAmount: e.target.value }))} placeholder="0,00" className="nc-num" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Data</Label>
                    <Input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Observação</Label>
                    <Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
                  </div>
                </section>
              </form>
              <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                    {payTotal > 0
                      ? <>Falta passa a <span className="nc-num font-medium">{formatCurrency(Math.max(0, payingLoan.remaining - payTotal))}</span></>
                      : "Informe o valor"}
                  </p>
                  <NcButton type="submit" form="form-pagamento" variant="solid" size="md" disabled={payTotal <= 0 || submitting}>
                    {submitting ? "Registrando…" : "Registrar"}
                  </NcButton>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Cabeçalho de seção: sobretítulo terciário e uma linha de contexto. */
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>{title}</span>
        {sub && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>{sub}</p>}
      </div>
    </div>
  );
}

/** Linha de conta: rótulo à esquerda, número tabular à direita. */
function LedgerLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12.5px]">
      <span style={{ color: "var(--nc-text-2)" }}>{label}</span>
      <span className="nc-num" style={{ color: tone }}>{value}</span>
    </div>
  );
}
