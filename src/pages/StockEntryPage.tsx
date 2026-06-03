import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Search, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { toast } from "sonner";

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
      if (match) {
        return { flavor: match[1].trim(), quantity: parseInt(match[2], 10) };
      }
      // Try trailing number without x
      const match2 = line.match(/^(.+?)\s+(\d+)\s*$/);
      if (match2) {
        return { flavor: match2[1].trim(), quantity: parseInt(match2[2], 10) };
      }
      return { flavor: line, quantity: 1 };
    });
}

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
    if (created > 0) {
      toast.success(`${created} entrada${created > 1 ? "s" : ""} registrada${created > 1 ? "s" : ""}!`);
    }
    setBrand("");
    setModelSelect("");
    setModel("");
    setUnitCost("");
    setDate(todayDateString());
    setNotes("");
    setFlavorsText("");
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

  const filtered = useMemo(() => {
    let items = [...stockEntries].reverse();
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => getProductName(e.productId).toLowerCase().includes(q));
    }
    if (dateFrom) {
      items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    }
    return items;
  }, [stockEntries, search, dateFrom, dateTo, getProductName]);

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
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Entrada de Estoque</h1>
          <p className="text-muted-foreground text-sm">Registrar compras de pods</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Nova Entrada</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Entrada Rápida de Estoque</DialogTitle></DialogHeader>
            <div className="space-y-4">
              {/* Marca */}
              <div className="space-y-1.5">
                <Label>Marca</Label>
                <Select value={brand} onValueChange={handleBrandChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione a marca" /></SelectTrigger>
                  <SelectContent>
                    {BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Modelo */}
              <div className="space-y-1.5">
                <Label>Modelo / Puffs</Label>
                <Select value={modelSelect} onValueChange={handleModelSelectChange} disabled={!brand}>
                  <SelectTrigger>
                    <SelectValue placeholder={brand ? "Selecione um modelo" : "Selecione a marca primeiro"} />
                  </SelectTrigger>
                  <SelectContent>
                    {existingModels.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Novo modelo</SelectItem>
                  </SelectContent>
                </Select>
                {modelSelect === "__new__" && (
                  <Input
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder="Ex: V155, TE 30K"
                    autoFocus
                  />
                )}
              </div>

              {/* Custo + Data */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Custo Unitário (R$)</Label>
                  <Input type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0,00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Data</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>

              {/* Observações */}
              <div className="space-y-1.5">
                <Label>Observações</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" />
              </div>

              {/* Sabores em lote */}
              <div className="space-y-1.5">
                <Label>Entrada rápida de sabores (sabor + quantidade)</Label>
                <textarea
                  value={flavorsText}
                  onChange={e => setFlavorsText(e.target.value)}
                  placeholder={"Blueberry Ice 2x\nStrawberry Ice 3x\nWatermelon Ice 1x"}
                  rows={5}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>

              {/* Preview */}
              {entries.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Pré-visualização ({validEntries.length} encontrado{validEntries.length !== 1 ? "s" : ""}
                    {missingEntries.length > 0 && `, ${missingEntries.length} não cadastrado${missingEntries.length !== 1 ? "s" : ""}`})
                  </Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-border p-2">
                    {entries.map((e, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between text-sm px-2 py-1 rounded ${!e.product ? "opacity-40 line-through" : ""}`}
                      >
                        <span>{e.fullName}</span>
                        <div className="flex items-center gap-2">
                          <span className="mono text-xs">{e.quantity}x</span>
                          {!e.product && <Badge variant="secondary" className="text-[10px]">não cadastrado</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {unitCost && validEntries.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Total: {formatCurrency(Number(unitCost) * validEntries.reduce((s, e) => s + e.quantity, 0))} ({validEntries.reduce((s, e) => s + e.quantity, 0)} un.)
                    </p>
                  )}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={validEntries.length === 0 || submitting}
                className="w-full"
              >
                {submitting ? "Registrando..." : `Registrar ${validEntries.length} entrada${validEntries.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por produto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" placeholder="De" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" placeholder="Até" />
        </div>
      </div>

      {dateGroups.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">{stockEntries.length === 0 ? "Nenhuma entrada registrada." : "Nenhuma entrada encontrada."}</p></div>
      ) : (
        <div className="space-y-3">
          {dateGroups.map(group => {
            const isCollapsed = collapsedDates.has(group.dateKey);
            return (
              <div key={group.dateKey} className="glass-card overflow-hidden">
                <button
                  onClick={() => toggleDate(group.dateKey)}
                  className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight size={18} className="text-muted-foreground" /> : <ChevronDown size={18} className="text-muted-foreground" />}
                    <div>
                      <h2 className="text-base font-bold">{group.dateLabel}</h2>
                      <p className="text-xs text-muted-foreground">{group.entries.length} entrada{group.entries.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <p className="text-muted-foreground">Quantidade</p>
                      <p className="mono font-medium">{group.totalQty} un.</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Custo Total</p>
                      <p className="mono font-medium text-white">{formatCurrency(group.totalCost)}</p>
                    </div>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="border-t border-border">
                    {group.entries.map(e => (
                      <div key={e.id} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const prod = products.find(p => p.id === e.productId);
                              const flavor = prod?.flavor?.trim();
                              const model = prod?.model?.trim() || prod?.name;
                              return (
                                <>
                                  <h3 className="font-medium text-sm truncate">{flavor || model || getProductName(e.productId)}</h3>
                                  {flavor && model && <span className="text-xs text-muted-foreground shrink-0">· {model}</span>}
                                </>
                              );
                            })()}
                          </div>
                          {e.notes && <p className="text-xs text-muted-foreground truncate">{e.notes}</p>}
                        </div>
                        <div className="flex items-center gap-5 text-sm shrink-0">
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Qtd</p>
                            <p className="mono text-xs font-semibold">{e.quantity}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Custo Un.</p>
                            <p className="mono text-xs text-[#ff4242]">{formatCurrency(e.unitCost)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Total</p>
                            <p className="mono text-xs font-semibold text-[#ff9100]">{formatCurrency(e.totalCost)}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={(ev) => { ev.stopPropagation(); deleteStockEntry(e.id); }} className="text-muted-foreground hover:text-destructive h-7 w-7">
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
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