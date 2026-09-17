import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { todayDateString, localDateToISO } from "@/lib/date-utils";
import { AnimatePresence, motion } from "motion/react";
import SegmentedToggle from "@/components/motion/SegmentedToggle";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { formatCurrency } from "@/lib/currency";
import { NcButton } from "@/components/nocturne";
import { sellersWithAssignedStock } from "@/lib/sellers-with-stock";

type PaymentMethodValue =
  | "pix"
  | "dinheiro"
  | "pix_pendente"
  | "dinheiro_pendente"
  | "dinheiro_com_vendedor"
  | "pendente";

interface Line {
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  paid: boolean;
}

const newLine = (): Line => ({ key: Math.random().toString(36).slice(2), productId: "", quantity: "1", unitPrice: "", paid: true });

export default function BatchSaleForm({ onDone }: { onDone: () => void }) {
  const { products, productAssignments, sellers, addSale, getSellerName } = useStore();
  const { role, sellerId } = useAuth();
  const isSeller = role === "seller";

  const [type, setType] = useState<"venda" | "retirada_funcionario">("venda");
  const [formSellerId, setFormSellerId] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("pix");
  const [pendingMethod, setPendingMethod] = useState<PaymentMethodValue>("pix_pendente");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSellerId = isSeller ? sellerId : (formSellerId || null);
  const sellerName = effectiveSellerId ? getSellerName(effectiveSellerId) : "";

  /**
   * Mesma regra do formulário único, pela mesma função: só entra no seletor
   * quem tem unidade atribuída. Os dois caminhos de registro de venda não podem
   * divergir — este não tem edição, então não há vendedor gravado a preservar,
   * mas o `formSellerId` entra assim mesmo para a lista não puxar o tapete de
   * quem acabou de vender a última unidade com o painel ainda aberto.
   */
  const sellerOptions = useMemo(
    () => sellersWithAssignedStock(sellers, productAssignments, formSellerId),
    [sellers, productAssignments, formSellerId],
  );

  const availableProducts = useMemo(() => {
    if (effectiveSellerId) {
      return products.filter(p => {
        const a = productAssignments.find(x => x.productId === p.id && x.sellerId === effectiveSellerId);
        return a && a.quantity > 0;
      });
    }
    return isSeller ? [] : products.filter(p => p.stock > 0);
  }, [products, productAssignments, effectiveSellerId, isSeller]);

  const availableQty = (productId: string) => {
    if (effectiveSellerId) {
      return productAssignments.find(a => a.productId === productId && a.sellerId === effectiveSellerId)?.quantity ?? 0;
    }
    return products.find(p => p.id === productId)?.stock ?? 0;
  };

  const displayName = (productId: string) => {
    const p = products.find(x => x.id === productId);
    return p ? `${p.flavor} · ${p.model}` : "";
  };

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const validLines = lines.filter(l => l.productId && Number(l.quantity) > 0);
  const total = validLines.reduce((acc, l) => acc + Number(l.quantity) * (Number(l.unitPrice) || 0), 0);
  const received = type === "retirada_funcionario"
    ? 0
    : validLines.reduce((acc, l) => acc + (l.paid ? Number(l.quantity) * (Number(l.unitPrice) || 0) : 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!isSeller && !formSellerId && type === "retirada_funcionario") {
      setError("Selecione o funcionário para a retirada.");
      return;
    }
    if (validLines.length === 0) {
      setError("Adicione pelo menos um produto.");
      return;
    }
    // valida quantidades e duplicidade
    const byProduct = new Map<string, number>();
    for (const l of validLines) {
      byProduct.set(l.productId, (byProduct.get(l.productId) || 0) + Number(l.quantity));
    }
    for (const [pid, qty] of byProduct) {
      if (qty > availableQty(pid)) {
        setError(`Quantidade indisponível para ${displayName(pid)} (disponível: ${availableQty(pid)}).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      for (const l of validLines) {
        const qty = Number(l.quantity);
        const unit = Number(l.unitPrice) || 0;
        await addSale({
          productId: l.productId,
          quantity: qty,
          unitPrice: unit,
          date: localDateToISO(date),
          notes: notes || undefined,
          installments: 1,
          paidAmount: type === "retirada_funcionario" ? 0 : (l.paid ? qty * unit : 0),
          paidAt: type === "venda" && l.paid ? localDateToISO(date) : undefined,
          sellerId: effectiveSellerId || undefined,
          type,
          paymentMethod: type === "venda" ? (l.paid ? paymentMethod : pendingMethod) : undefined,
        });
      }
      setLines([newLine()]);
      setNotes("");
      onDone();
    } catch {
      // erro reportado via toast pelo store
    } finally {
      setSubmitting(false);
    }
  };

  const paidOpts: { id: PaymentMethodValue; label: string }[] = [
    { id: "pix", label: "Pix" },
    { id: "dinheiro", label: "Dinheiro" },
  ];
  const pendingOpts: { id: PaymentMethodValue; label: string; disabled?: boolean }[] = [
    { id: "pix_pendente", label: "Falta receber Pix" },
    { id: "dinheiro_pendente", label: "Falta receber Dinheiro" },
    { id: "dinheiro_com_vendedor", label: sellerName ? `Dinheiro com ${sellerName}` : "Dinheiro com vendedor", disabled: !sellerName },
    { id: "pendente", label: "Falta receber (a definir)" },
  ];

  const hasPending = validLines.some(l => !l.paid);
  const hasPaid = validLines.some(l => l.paid);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!isSeller && (
        <SegmentedToggle
          value={type}
          onChange={(v) => setType(v)}
          options={[
            { id: "venda" as const, label: "Vendas" },
            { id: "retirada_funcionario" as const, label: "Retiradas" },
          ]}
        />
      )}


      {/* `grid-cols-1` EXPLÍCITO na base, e não só o `sm:grid-cols-2`.
          Esta era a causa do arrasto lateral do painel, e a diferença exata
          para o formulário de venda única, que sempre teve `grid-cols-2`:
          sem uma classe de coluna, o Tailwind não emite `minmax(0, 1fr)`, a
          coluna fica `auto` — do tamanho do MAX-CONTENT — e quem a estica é o
          `<input type="date">`, que no Safari tem largura intrínseca grande e
          não encolhe com `w-full`. O `minmax(0, …)` é justamente a permissão
          de encolher abaixo do conteúdo. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!isSeller && (
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">Funcionário</Label>
            <Select value={formSellerId} onValueChange={v => { setFormSellerId(v); setLines([newLine()]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
              <SelectContent>
                {sellerOptions.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhum vendedor com estoque atribuído. Distribua em Distribuição.
                  </div>
                )}
                {sellerOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Data</Label>
          {/* `w-full min-w-0` no próprio campo: o `w-full` do Input do shadcn
              não vence a largura intrínseca do seletor de data do Safari sem o
              `min-w-0` para liberar o encolhimento. */}
          <Input type="date" className="w-full min-w-0" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {!isSeller && !formSellerId && (
        <p className="text-xs text-muted-foreground">
          Selecione um vendedor para carregar os produtos atribuídos a ele. Só aparecem os que têm estoque atribuído.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 text-xs"><Layers size={14} /> Itens ({validLines.length})</Label>
          <NcButton variant="quiet" onClick={() => setLines(ls => [...ls, newLine()])}>
            <Plus size={13} />Adicionar item
          </NcButton>
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
          {lines.map((l, idx) => {
            const disponivel = l.productId ? availableQty(l.productId) : null;
            const excede = l.productId && Number(l.quantity) > (disponivel ?? 0);
            return (
              <motion.div
                key={l.key}
                layout
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
              {/* Card do item no Nocturne: a mesma superfície e a mesma régua
                  do resto do painel, em vez do `bg-card/40` do shadcn que
                  destoava dentro dele. */}
              <div className="space-y-2 rounded-lg p-2.5" style={{ background: "var(--nc-surface)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                <div className="flex items-center gap-2">
                  <span className="nc-num w-4 shrink-0 text-[11px] font-semibold" style={{ color: "var(--nc-text-3)" }}>{idx + 1}</span>
                  <Select
                    value={l.productId}
                    onValueChange={v => {
                      const prod = products.find(p => p.id === v);
                      setLine(l.key, { productId: v, unitPrice: l.unitPrice || (prod?.salePrice?.toString() ?? "") });
                    }}
                    disabled={!isSeller && !formSellerId}
                  >
                    {/* `min-w-0` porque o `w-full` do SelectTrigger, num item
                        de flex, não deixa ele encolher abaixo do conteúdo: o
                        nome do produto empurrava a lixeira para fora. */}
                    <SelectTrigger className="h-9 min-w-0 flex-1 text-xs"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                    <SelectContent>
                      {availableProducts.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">Nenhum produto disponível.</div>
                      )}
                      {availableProducts.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.flavor} · {p.model} ({availableQty(p.id)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* `NcButton--danger`: nasce neutro e só fica crítico no
                      hover, a regra do sistema para ação destrutiva. O tamanho
                      do alvo vem do `pointer: coarse` no index.css. */}
                  <NcButton
                    variant="danger"
                    size="icon"
                    aria-label={`Remover item ${idx + 1}`}
                    className="shrink-0"
                    onClick={() => setLines(ls => (ls.length === 1 ? [newLine()] : ls.filter(x => x.key !== l.key)))}
                  ><Trash2 size={14} /></NcButton>
                </div>
                {/* `flex-wrap`: os cinco controles desta linha somam ~448px com
                    os paddings do card e do painel, e o telefone tem 360 — era
                    isso que deixava o lote arrastar de lado. Com a quebra, a
                    quantidade e o preço ficam na primeira linha (cabem em 242px)
                    e a pílula e o total descem para a segunda. Não é largura
                    fixa demais: os dois campos numéricos precisam de largura
                    própria, senão o `<input>` assume a largura intrínseca dele,
                    que é bem maior. */}
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <div className="w-20">
                    <Input
                      type="number"
                      min="1"
                      className="h-8 text-xs"
                      value={l.quantity}
                      onChange={e => setLine(l.key, { quantity: e.target.value })}
                      placeholder="Qtd"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">×</span>
                  <div className="w-28">
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 text-xs"
                      value={l.unitPrice}
                      onChange={e => setLine(l.key, { unitPrice: e.target.value })}
                      placeholder="Preço un."
                      disabled={type === "retirada_funcionario" ? false : undefined}
                    />
                  </div>
                  {/* O selo entra no VOCABULÁRIO do sistema: `--paid` é dinheiro
                      que entrou (verde) e `--partial` é o que falta (laranja),
                      os mesmos dois tons da lista de vendas e do trilho. Antes
                      era uma pílula própria em `bg-income`/`bg-warning`, cores
                      de outra paleta — e a regra do Nocturne é que dois selos
                      da mesma cor significam a mesma coisa em qualquer tela.
                      Sendo `--action`, ele também herda o alvo de toque. */}
                  {type === "venda" && (
                    <motion.button
                      type="button"
                      key={l.paid ? "paid" : "unpaid"}
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      onClick={() => setLine(l.key, { paid: !l.paid })}
                      aria-pressed={l.paid}
                      className={cn("nc-pill nc-pill--action", l.paid ? "nc-pill--paid" : "nc-pill--partial")}
                    >{l.paid ? "Recebido" : "A receber"}</motion.button>
                  )}
                  <AnimatedNumber
                    className="ml-auto text-xs font-semibold mono"
                    value={Number(l.quantity) * (Number(l.unitPrice) || 0)}
                    format={formatCurrency}
                    duration={0.25}
                  />
                </div>
                {excede && (
                  <p className="pl-6 text-[11px]" style={{ color: "var(--nc-crit)" }}>Disponível: {disponivel}</p>
                )}
              </div>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </div>

      </div>

      {type === "venda" && hasPaid && (
        <div>
          <Label className="mb-2 block text-xs">Forma de pagamento (itens recebidos)</Label>
          <SegmentedToggle value={paymentMethod} onChange={(v) => setPaymentMethod(v as PaymentMethodValue)} options={paidOpts} />
        </div>
      )}

      {type === "venda" && hasPending && (
        <div>
          <Label className="mb-2 block text-xs">Situação dos itens a receber</Label>
          <SegmentedToggle value={pendingMethod} onChange={(v) => setPendingMethod(v as PaymentMethodValue)} align="left" options={pendingOpts} />

        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Observações</Label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Aplicada a todos os itens" />
      </div>

      {/* Resumo no mesmo desenho do rodapé do formulário único: fundo --nc-bg
          dentro do painel, régua que apaga nas pontas antes da linha final, e
          as cores do sistema — verde é dinheiro que entrou, laranja é o que
          falta. Estava em `bg-secondary/50` com `text-income`/`text-warning`,
          que são de outra paleta. */}
      {validLines.length > 0 && (
        <div className="space-y-1 rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
          <div className="flex justify-between">
            <span style={{ color: "var(--nc-text-2)" }}>Itens</span>
            <span className="nc-num">{validLines.length}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--nc-text-2)" }}>Total</span>
            <AnimatedNumber className="nc-num font-semibold" value={total} format={formatCurrency} duration={0.25} />
          </div>
          {type === "venda" && (
            <div className="nc-rule-top space-y-1 pt-1.5">
              <div className="flex justify-between">
                <span style={{ color: "var(--nc-text-2)" }}>Recebido</span>
                <AnimatedNumber className="nc-num" style={{ color: "var(--nc-ok)" }} value={received} format={formatCurrency} duration={0.25} />
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--nc-text-2)" }}>Falta receber</span>
                <AnimatedNumber className="nc-num" style={{ color: "var(--nc-alert)" }} value={Math.max(0, total - received)} format={formatCurrency} duration={0.25} />
              </div>
            </div>
          )}
          {type === "retirada_funcionario" && (
            <div className="nc-rule-top flex justify-between pt-1.5">
              <span style={{ color: "var(--nc-text-2)" }}>Saldo devedor do funcionário</span>
              <AnimatedNumber className="nc-num font-semibold" style={{ color: "var(--nc-alert)" }} value={total} format={formatCurrency} duration={0.25} />
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
          style={{
            color: "var(--nc-crit)",
            background: "color-mix(in srgb, var(--nc-crit) 10%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--nc-crit) 30%, transparent)",
          }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* O lote traz o próprio botão — o rótulo dele conta as linhas válidas, e
          por isso o painel não lhe dá o rodapé fixo do registro único. */}
      <NcButton
        type="submit"
        variant="solid"
        size="md"
        className="w-full"
        disabled={submitting || validLines.length === 0}
      >
        {submitting ? "Registrando…" : `Registrar ${validLines.length || ""} ${type === "retirada_funcionario" ? "retirada(s)" : "venda(s)"}`}
      </NcButton>
    </form>
  );
}
