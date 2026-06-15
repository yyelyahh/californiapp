import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Search, Trash2, ChevronDown, ChevronRight, X, Package, TrendingDown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BRAND_PRESETS: Record<string, number> = {
  Ignite: 68.5,
  Elfbar: 68,
  Nikbar: 0,
};
const BRANDS = Object.keys(BRAND_PRESETS);

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function parseFlavorLines(text: string) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)\s+(\d+)x?\s*$/i);
      if (match) return { flavor: match[1].trim(), quantity: parseInt(match[2], 10) };
      const match2 = line.match(/^(.+?)\s+(\d+)\s*$/);
      if (match2) return { flavor: match2[1].trim(), quantity: parseInt(match2[2], 10) };
      return { flavor: line, quantity: 1 };
    });
}

type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";

export default function StockEntryPage() {
  const { products, stockEntries, addStockEntry, deleteStockEntry, getProductName } = useStore();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [modelSelect, setModelSelect] = useState("");
  const [model, setModel] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [flavorsText, setFlavorsText] = useState("");
  const [search, setSearch] = useState("");
  const [fPreset, setFPreset] = useState<DateRangePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const parsedLines = useMemo(() => parseFlavorLines(flavorsText), [flavorsText]);

  const entries = useMemo(() => {
    if (!brand || !model.trim()) return [];
    return parsedLines.map(({ flavor, quantity }) => {
      const fullName = `${model.trim()} · ${flavor}`;
      const product = products.find(p => p.brand.toLowerCase() === brand.toLowerCase() && p.model.toLowerCase() === model.trim().toLowerCase() && p.flavor.toLowerCase() === flavor.toLowerCase());
      return { flavor, quantity, fullName, product };
    });
  }, [brand, model, parsedLines, products]);

  const validEntries = entries.filter(e => e.product);
  const missingEntries = entries.filter(e => !e.product);
  const totalUnits = validEntries.reduce((s, e) => s + e.quantity, 0);
  const totalInvestment = (Number(unitCost) || 0) * totalUnits;

  const existingModels = useMemo(() => {
    if (!brand) return [];
    const set = new Set<string>();
    products.filter(p => p.brand === brand).forEach(p => p.model && set.add(p.model));
    return Array.from(set).sort();
  }, [products, brand]);

  const handleBrandChange = (value: string) => {
    setBrand(value);
    setModelSelect("");
    setModel("");
    const preset = BRAND_PRESETS[value];
    if (preset) setUnitCost(String(preset));
    else setUnitCost("");
  };

  const handleModelSelectChange = (value: string) => {
    setModelSelect(value);
    if (value !== "__new__") setModel(value);
    else setModel("");
  };

  const handleSubmit = async () => {
    if (validEntries.length === 0) {
      toast.error("Nenhum produto encontrado para registrar.");
      return;
    }
    setSubmitting(true);
    const cost = Number(unitCost) || 0;
    let created = 0;
    for (const entry of validEntries) {
      try {
        await addStockEntry({
          productId: entry.product!.id,
          quantity: entry.quantity,
          unitCost: cost,
          date: localDateToISO(date),
          notes: notes || undefined,
        });
        created++;
      } catch {
        toast.error(`Erro ao registrar: ${entry.fullName}`);
      }
    }
    if (created > 0) toast.success(`${created} entrada${created > 1 ? "s" : ""} registrada${created > 1 ? "s" : ""}!`);
    handleReset();
    setOpen(false);
    setSubmitting(false);
  };

  const handleReset = () => {
    setBrand("");
    setModelSelect("");
    setModel("");
    setUnitCost("");
    setDate(todayDateString());
    setNotes("");
    setFlavorsText("");
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

  const clearFilters = () => { setSearch(""); setFPreset("all"); setDateFrom(""); setDateTo(""); };
  const hasActiveFilters = search !== "" || dateFrom !== "" || dateTo !== "";

  const filtered = useMemo(() => {
    let items = [...stockEntries].reverse();
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => getProductName(e.productId).toLowerCase().includes(q));
    }
    if (dateFrom) items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    return items;
  }, [stockEntries, search, dateFrom, dateTo, getProductName]);

  const totals = useMemo(() => ({
    entries: filtered.length,
    units: filtered.reduce((s, e) => s + e.quantity, 0),
    cost: filtered.reduce((s, e) => s + e.totalCost, 0),
  }), [filtered]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    filtered.forEach(e => {
      const dateKey = e.date.slice(0, 10);
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(e);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, items]) => ({
        dateKey,
        dateLabel: formatDateBR(items[0].date),
        entries: items,
        totalQty: items.reduce((s, e) => s + e.quantity, 0),
        totalCost: items.reduce((s, e) => s + e.totalCost, 0),
      }));
  }, [filtered]);

  const toggleDate = (dateKey: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

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
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Entrada de Estoque</h1>
          <p className="text-xs text-muted-foreground">Registrar compras e reposição de pods</p>
        </div>
        <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
          <SheetTrigger asChild>
            <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Nova Entrada</Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 flex flex-col">
            <SheetHeader className="px-6 py-4 border-b border-border">
              <SheetTitle className="text-base font-semibold">Nova Entrada de Estoque</SheetTitle>
              <p className="text-xs text-muted-foreground">Registre múltiplos sabores de uma vez</p>
            </SheetHeader>

            <div className="flex-1 px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Marca</Label>
                  <Select value={brand} onValueChange={handleBrandChange}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Marca" /></SelectTrigger>
                    <SelectContent>
                      {BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Modelo / Puffs</Label>
                  <Select value={modelSelect} onValueChange={handleModelSelectChange} disabled={!brand}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={brand ? "Modelo" : "Selecione marca"} />
                    </SelectTrigger>
                    <SelectContent>
                      {existingModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      <SelectItem value="__new__">+ Novo modelo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {modelSelect === "__new__" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome do novo modelo</Label>
                  <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Ex: V155, TE 30K" autoFocus className="h-9" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Custo Unitário (R$)</Label>
                  <Input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0,00" className="h-9 mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className="h-9" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Sabores · quantidade</Label>
                  <span className="text-[10px] text-muted-foreground">um por linha</span>
                </div>
                <textarea
                  value={flavorsText}
                  onChange={e => setFlavorsText(e.target.value)}
                  placeholder={"Blueberry Ice 2x\nStrawberry Ice 3x\nWatermelon Ice 1x"}
                  rows={6}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>

              {/* Preview / impacto */}
              {entries.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Pré-visualização</Label>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-income">{validEntries.length} ok</span>
                      {missingEntries.length > 0 && <span className="text-warning">{missingEntries.length} sem cadastro</span>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border divide-y divide-border/60 max-h-44 overflow-y-auto">
                    {entries.map((e, i) => (
                      <div key={i} className={cn("flex items-center justify-between text-xs px-3 py-1.5", !e.product && "opacity-50")}>
                        <span className={cn("truncate", !e.product && "line-through")}>{e.fullName}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="mono">{e.quantity}x</span>
                          {!e.product && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">novo</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalUnits > 0 && (
                    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Impacto financeiro</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Unidades</span>
                        <span className="mono font-medium">{totalUnits}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Investimento</span>
                        <span className="mono font-semibold text-expense">{formatCurrency(totalInvestment)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <SheetFooter className="px-6 py-4 border-t border-border bg-card sticky bottom-0">
              <Button
                onClick={handleSubmit}
                disabled={validEntries.length === 0 || submitting}
                className="w-full h-10"
              >
                {submitting ? "Registrando..." : `Registrar ${validEntries.length || ""} entrada${validEntries.length !== 1 ? "s" : ""}`.trim()}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <Package size={11} /> Entradas
          </div>
          <p className="mt-0.5 text-lg font-semibold mono">{totals.entries}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <TrendingDown size={11} /> Unidades
          </div>
          <p className="mt-0.5 text-lg font-semibold mono">{totals.units}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <Calendar size={11} /> Investido
          </div>
          <p className="mt-0.5 text-lg font-semibold mono text-expense">{formatCurrency(totals.cost)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-1.5">
          {presetBtn("all", "Tudo")}
          {presetBtn("today", "Hoje")}
          {presetBtn("7d", "7d")}
          {presetBtn("month", "Mês")}
          {presetBtn("lastMonth", "Mês ant.")}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setFPreset("custom"); }} className="h-9 w-[140px] text-xs" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setFPreset("custom"); }} className="h-9 w-[140px] text-xs" />
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-muted-foreground">
              <X size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Groups */}
      {dateGroups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">{stockEntries.length === 0 ? "Nenhuma entrada registrada." : "Nenhuma entrada encontrada."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dateGroups.map(group => {
            const isCollapsed = collapsedDates.has(group.dateKey);
            return (
              <div key={group.dateKey} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => toggleDate(group.dateKey)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-secondary/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-sm font-semibold">{group.dateLabel}</h2>
                      <span className="text-[11px] text-muted-foreground">{group.entries.length} entrada{group.entries.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Qtd</p>
                      <p className="mono font-medium">{group.totalQty}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
                      <p className="mono font-semibold text-expense">{formatCurrency(group.totalCost)}</p>
                    </div>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="border-t border-border/60">
                    <table className="w-full text-sm">
                      <tbody>
                        {group.entries.map(e => {
                          const prod = products.find(p => p.id === e.productId);
                          const flavor = prod?.flavor?.trim();
                          const model = prod?.model?.trim() || prod?.name;
                          return (
                            <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors group">
                              <td className="py-2 px-4">
                                <div className="font-medium leading-tight">{flavor || model || getProductName(e.productId)}</div>
                                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                                  {flavor && model && <span>{model}</span>}
                                  {e.notes && (<><span className="opacity-40">·</span><span className="truncate max-w-[200px]" title={e.notes}>{e.notes}</span></>)}
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right mono text-sm text-muted-foreground w-16">{e.quantity}x</td>
                              <td className="py-2 px-3 text-right mono text-sm text-muted-foreground w-28">{formatCurrency(e.unitCost)}</td>
                              <td className="py-2 px-3 text-right mono text-sm font-semibold text-expense w-32">{formatCurrency(e.totalCost)}</td>
                              <td className="py-2 px-2 w-10">
                                <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" onClick={(ev) => { ev.stopPropagation(); deleteStockEntry(e.id); }} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                    <Trash2 size={13} />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
