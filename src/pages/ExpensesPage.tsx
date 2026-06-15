import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, X, Receipt, Tag, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const categories = ["Frete", "Embalagem", "Marketing", "Aluguel", "Outros"];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";

export default function ExpensesPage() {
  const { expenses, addExpense, deleteExpense } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", category: "", amount: "", date: todayDateString() });

  const [search, setSearch] = useState("");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPreset, setFPreset] = useState<DateRangePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    addExpense({
      description: form.description.trim(),
      category: form.category || "Outros",
      amount: Number(form.amount),
      date: localDateToISO(form.date),
    });
    setForm({ description: "", category: "", amount: "", date: todayDateString() });
    setOpen(false);
  };

  const applyPreset = (p: DateRangePreset) => {
    setFPreset(p);
    const now = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    if (p === "today") { const t = fmt(now); setDateFrom(t); setDateTo(t); return; }
    if (p === "7d") { const past = new Date(now); past.setDate(past.getDate() - 6); setDateFrom(fmt(past)); setDateTo(fmt(now)); return; }
    if (p === "month") { setDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0))); return; }
    if (p === "lastMonth") { setDateFrom(fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(fmt(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
  };

  const clearFilters = () => { setSearch(""); setFCategory("all"); setFPreset("all"); setDateFrom(""); setDateTo(""); };
  const hasActiveFilters = search !== "" || fCategory !== "all" || dateFrom !== "" || dateTo !== "";

  const filtered = useMemo(() => {
    let items = [...expenses].reverse();
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => e.description.toLowerCase().includes(q));
    }
    if (fCategory !== "all") items = items.filter(e => e.category === fCategory);
    if (dateFrom) items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    return items;
  }, [expenses, search, fCategory, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const sum = filtered.reduce((s, e) => s + e.amount, 0);
    const byCat: Record<string, number> = {};
    filtered.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    return { count: filtered.length, sum, topCat };
  }, [filtered]);

  const presetBtn = (key: DateRangePreset, label: string) => (
    <button
      type="button"
      onClick={() => applyPreset(key)}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
        fPreset === key
          ? "bg-primary/15 text-primary border-primary/40"
          : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-border/80"
      )}
    >{label}</button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Despesas</h1>
          <p className="text-xs text-muted-foreground">Registre custos operacionais</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Nova Despesa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="text-base font-semibold">Adicionar Despesa</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-9 mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9" />
                </div>
              </div>
              <Button type="submit" className="w-full h-10">Adicionar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Receipt size={11} /> Lançamentos</div>
          <p className="mt-0.5 text-lg font-semibold mono">{totals.count}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Calendar size={11} /> Total</div>
          <p className="mt-0.5 text-lg font-semibold mono text-expense">{formatCurrency(totals.sum)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Tag size={11} /> Maior categoria</div>
          <p className="mt-0.5 text-sm font-semibold truncate">
            {totals.topCat ? <>{totals.topCat[0]} <span className="text-muted-foreground mono text-xs ml-1">{formatCurrency(totals.topCat[1])}</span></> : <span className="text-muted-foreground">—</span>}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar descrição..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
        </div>
        <Select value={fCategory} onValueChange={setFCategory}>
          <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          {presetBtn("all", "Tudo")}
          {presetBtn("today", "Hoje")}
          {presetBtn("7d", "7d")}
          {presetBtn("month", "Mês")}
          {presetBtn("lastMonth", "Mês ant.")}
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-muted-foreground ml-auto">
            <X size={13} className="mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">{expenses.length === 0 ? "Nenhuma despesa registrada." : "Nenhuma despesa encontrada."}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-2 px-4 font-medium">Descrição</th>
                <th className="text-left py-2 px-3 font-medium">Categoria</th>
                <th className="text-right py-2 px-3 font-medium">Valor</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors group">
                  <td className="py-2.5 px-4">
                    <div className="font-medium leading-tight">{e.description}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 mono">{formatDateBR(e.date)}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-secondary text-secondary-foreground">{e.category}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right mono text-sm font-semibold text-expense">{formatCurrency(e.amount)}</td>
                  <td className="py-2.5 px-2">
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" onClick={() => deleteExpense(e.id)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
