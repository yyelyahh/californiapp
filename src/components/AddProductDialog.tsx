import { useState, useMemo } from "react";
import { Plus, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/context/StoreContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BRAND_PRESETS: Record<string, { purchasePrice: number; salePrice: number }> = {
  Ignite: { purchasePrice: 68.5, salePrice: 149 },
  Elfbar: { purchasePrice: 68, salePrice: 159 },
  Nikbar: { purchasePrice: 0, salePrice: 0 },
};

const DEFAULT_BRANDS = Object.keys(BRAND_PRESETS);

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function AddProductDialog() {
  const { products, addProduct } = useStore();
  const [open, setOpen] = useState(false);
  const [brandSelect, setBrandSelect] = useState("");
  const [brand, setBrand] = useState("");
  const [modelSelect, setModelSelect] = useState("");
  const [model, setModel] = useState("");
  const [flavorsText, setFlavorsText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const flavors = useMemo(() => flavorsText.split("\n").map(f => f.trim()).filter(Boolean), [flavorsText]);

  const existingKeys = useMemo(() => new Set(
    products.map(p => `${p.brand}|${p.model}|${p.flavor}`.toLowerCase())
  ), [products]);

  const allBrands = useMemo(() => {
    const set = new Set<string>(DEFAULT_BRANDS);
    products.forEach(p => p.brand && set.add(p.brand));
    return Array.from(set).sort();
  }, [products]);

  const existingModels = useMemo(() => {
    if (!brand) return [];
    const set = new Set<string>();
    products.filter(p => p.brand === brand).forEach(p => p.model && set.add(p.model));
    return Array.from(set).sort();
  }, [products, brand]);

  const previewProducts = useMemo(() => {
    if (!brand || !model.trim()) return [];
    return flavors.map(flavor => {
      const key = `${brand}|${model.trim()}|${flavor}`.toLowerCase();
      return { flavor, isDuplicate: existingKeys.has(key) };
    });
  }, [brand, model, flavors, existingKeys]);

  const newProducts = previewProducts.filter(p => !p.isDuplicate);
  const duplicates = previewProducts.filter(p => p.isDuplicate);

  const pPrice = Number(purchasePrice) || 0;
  const sPrice = Number(salePrice) || 0;
  const unitMargin = sPrice - pPrice;
  const investment = pPrice * newProducts.length;
  const potential = sPrice * newProducts.length;
  const potentialProfit = unitMargin * newProducts.length;

  const handleBrandChange = (value: string) => {
    setBrandSelect(value);
    setModelSelect("");
    setModel("");
    if (value === "__new__") {
      setBrand("");
      setPurchasePrice("");
      setSalePrice("");
      return;
    }
    setBrand(value);
    const preset = BRAND_PRESETS[value];
    if (preset) {
      setPurchasePrice(preset.purchasePrice ? String(preset.purchasePrice) : "");
      setSalePrice(preset.salePrice ? String(preset.salePrice) : "");
    }
  };

  const handleModelSelectChange = (value: string) => {
    setModelSelect(value);
    if (value !== "__new__") setModel(value); else setModel("");
  };

  const handleReset = () => {
    setBrandSelect(""); setBrand(""); setModelSelect(""); setModel(""); setFlavorsText("");
    setImageUrl(""); setPurchasePrice(""); setSalePrice("");
  };

  const handleSubmit = async () => {
    if (!brand || !model.trim() || newProducts.length === 0) {
      toast.error("Preencha marca, modelo e ao menos um sabor novo."); return;
    }
    setSubmitting(true);
    let created = 0;
    for (const p of newProducts) {
      try {
        await addProduct({
          name: model.trim(), brand, model: model.trim(), flavor: p.flavor,
          purchasePrice: pPrice, salePrice: sPrice, minStock: 0,
          imageUrl: imageUrl.trim() || undefined,
        });
        created++;
      } catch { toast.error(`Erro ao criar: ${p.flavor}`); }
    }
    if (created > 0) toast.success(`${created} produto${created > 1 ? "s" : ""} criado${created > 1 ? "s" : ""}!`);
    handleReset();
    setOpen(false);
    setSubmitting(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
      <SheetTrigger asChild>
        <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Novo Produto</Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-border space-y-1">
          <SheetTitle className="text-lg tracking-tight">Cadastro Rápido</SheetTitle>
          <SheetDescription className="text-xs">Crie vários sabores de um mesmo modelo de uma só vez.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Identificação */}
          <section className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Identificação</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Marca</Label>
                <Select value={brandSelect} onValueChange={handleBrandChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {allBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                    <SelectItem value="__new__">+ Nova marca</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Modelo / Puffs</Label>
                <Select value={modelSelect} onValueChange={handleModelSelectChange} disabled={!brand}>
                  <SelectTrigger><SelectValue placeholder={brand ? "Selecione" : "Marca primeiro"} /></SelectTrigger>
                  <SelectContent>
                    {existingModels.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                    <SelectItem value="__new__">+ Novo modelo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {brandSelect === "__new__" && (
              <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Nome da nova marca" autoFocus />
            )}
            {modelSelect === "__new__" && (
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Ex: V155, 30K, TE 30K" autoFocus />
            )}
          </section>

          {/* Preços */}
          <section className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preços por unidade</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Compra (R$)</Label>
                <Input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Venda (R$)</Label>
                <Input type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0,00" />
              </div>
            </div>
            {pPrice > 0 && sPrice > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Margem por unidade</span>
                <span className={cn("text-sm font-semibold mono", unitMargin >= 0 ? "text-income" : "text-destructive")}>
                  {formatCurrency(unitMargin)}
                </span>
              </div>
            )}
          </section>

          {/* Sabores */}
          <section className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sabores (um por linha)</p>
            <textarea
              value={flavorsText}
              onChange={e => setFlavorsText(e.target.value)}
              placeholder={"Grape Ice\nStrawberry Ice\nWatermelon Ice\nGreen Apple"}
              rows={6}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {previewProducts.length > 0 && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-3 py-2 bg-secondary/30 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    <span className="text-income font-medium">{newProducts.length} novo{newProducts.length !== 1 ? "s" : ""}</span>
                    {duplicates.length > 0 && (
                      <> · <span className="text-warning">{duplicates.length} duplicado{duplicates.length !== 1 ? "s" : ""}</span></>
                    )}
                  </span>
                </div>
                <ul className="max-h-44 overflow-auto divide-y divide-border/40">
                  {previewProducts.map((p, i) => (
                    <li key={i} className={cn("flex items-center justify-between px-3 py-1.5 text-xs", p.isDuplicate && "opacity-50")}>
                      <span className={p.isDuplicate ? "line-through text-muted-foreground" : "text-foreground"}>{p.flavor}</span>
                      {p.isDuplicate && (
                        <span className="text-[10px] text-warning flex items-center gap-1"><AlertCircle size={10} /> já existe</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Resumo financeiro */}
          {newProducts.length > 0 && pPrice > 0 && sPrice > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Sparkles size={11} className="text-primary" /> Impacto estimado
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Investimento</p>
                  <p className="mt-0.5 text-sm font-semibold mono text-foreground">{formatCurrency(investment)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita pot.</p>
                  <p className="mt-0.5 text-sm font-semibold mono text-foreground">{formatCurrency(potential)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lucro pot.</p>
                  <p className={cn("mt-0.5 text-sm font-semibold mono", potentialProfit >= 0 ? "text-income" : "text-destructive")}>{formatCurrency(potentialProfit)}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <SheetFooter className="px-5 py-3 border-t border-border bg-card/40">
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {newProducts.length > 0
                ? <>Serão criados <span className="text-foreground font-medium mono">{newProducts.length}</span> produto{newProducts.length !== 1 ? "s" : ""}</>
                : "Preencha os campos para visualizar"}
            </p>
            <Button onClick={handleSubmit} disabled={newProducts.length === 0 || submitting} size="sm" className="h-9">
              {submitting ? "Criando..." : `Criar ${newProducts.length || ""}`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
