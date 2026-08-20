import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { todayDateString, localDateToISO } from "@/lib/date-utils";
import { AnimatePresence, motion } from "motion/react";
import SegmentedToggle from "@/components/motion/SegmentedToggle";
import AnimatedNumber from "@/components/motion/AnimatedNumber";

type PaymentMethodValue =
  | "pix"
  | "dinheiro"
  | "pix_pendente"
  | "dinheiro_pendente"
  | "dinheiro_com_vendedor"
  | "pendente";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

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


      <div className="grid sm:grid-cols-2 gap-3">
        {!isSeller && (
          <div>
            <Label>Funcionário</Label>
            <Select value={formSellerId} onValueChange={v => { setFormSellerId(v); setLines([newLine()]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
              <SelectContent>
                {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Data</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {!isSeller && !formSellerId && (
        <p className="text-xs text-muted-foreground">Selecione um vendedor para carregar os produtos atribuídos a ele.</p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5"><Layers size={14} /> Itens ({validLines.length})</Label>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLines(ls => [...ls, newLine()])}>
            <Plus size={13} className="mr-1" />Adicionar item
          </Button>
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
              <div className="rounded-xl border border-border/60 bg-card/40 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground w-4 shrink-0 mono">{idx + 1}</span>
                  <Select
                    value={l.productId}
                    onValueChange={v => {
                      const prod = products.find(p => p.id === v);
                      setLine(l.key, { productId: v, unitPrice: l.unitPrice || (prod?.salePrice?.toString() ?? "") });
                    }}
                    disabled={!isSeller && !formSellerId}
                  >
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                    <SelectContent>
                      {availableProducts.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">Nenhum produto disponível.</div>
                      )}
                      {availableProducts.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.flavor} · {p.model} ({availableQty(p.id)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover item"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setLines(ls => (ls.length === 1 ? [newLine()] : ls.filter(x => x.key !== l.key)))}
                  ><Trash2 size={14} /></Button>
                </div>
                <div className="flex items-center gap-2 pl-6">
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
                  {type === "venda" && (
                    <motion.button
                      type="button"
                      key={l.paid ? "paid" : "unpaid"}
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      onClick={() => setLine(l.key, { paid: !l.paid })}
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-medium border transition",
                        l.paid ? "bg-income/10 text-income border-income/30" : "bg-warning/10 text-warning border-warning/30"
                      )}
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
                  <p className="pl-6 text-[11px] text-destructive">Disponível: {disponivel}</p>
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

      <div>
        <Label>Observações</Label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Aplicada a todos os itens" />
      </div>

      {validLines.length > 0 && (
        <div className={cn("rounded-xl p-3 space-y-1 text-sm border", type === "retirada_funcionario" ? "bg-warning/10 border-warning/20" : "bg-secondary/50 border-border/60")}>
          <div className="flex justify-between"><span className="text-muted-foreground">Itens</span><span className="mono">{validLines.length}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total</span><AnimatedNumber className="font-semibold mono" value={total} format={formatCurrency} duration={0.25} /></div>
          {type === "venda" && (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><AnimatedNumber className="mono text-income" value={received} format={formatCurrency} duration={0.25} /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Falta receber</span><AnimatedNumber className="mono text-warning" value={Math.max(0, total - received)} format={formatCurrency} duration={0.25} /></div>
            </>
          )}
          {type === "retirada_funcionario" && (
            <div className="flex justify-between"><span className="text-warning">Saldo devedor do funcionário</span><AnimatedNumber className="font-semibold mono text-warning" value={total} format={formatCurrency} duration={0.25} /></div>
          )}
        </div>

      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting || validLines.length === 0}>
        {submitting ? "Registrando..." : `Registrar ${validLines.length || ""} ${type === "retirada_funcionario" ? "retirada(s)" : "venda(s)"}`}
      </Button>
    </form>
  );
}
