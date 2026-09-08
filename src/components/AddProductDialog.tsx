import { useState, useMemo } from "react";
import { Plus, Sparkles, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sortNames } from "@/lib/catalog-order";
import { useStore } from "@/context/StoreContext";
import { toast } from "sonner";
import { NcButton, NcSheetHeader } from "@/components/nocturne";

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
    return sortNames(Array.from(set));
  }, [products]);

  const existingModels = useMemo(() => {
    if (!brand) return [];
    const set = new Set<string>();
    products.filter(p => p.brand === brand).forEach(p => p.model && set.add(p.model));
    return sortNames(Array.from(set));
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
        <NcButton variant="solid" size="md"><Plus size={14} />Novo produto</NcButton>
      </SheetTrigger>
      {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja: o
          Radix porta o painel para o <body> e os tokens não chegam por herança. */}
      <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
        <NcSheetHeader
          eyebrow="Produtos"
          title="Cadastro rápido"
          description="Crie vários sabores de um mesmo modelo de uma só vez."
        />

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Identificação */}
          <section className="space-y-3">
            <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Identificação</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Marca</Label>
                <Select value={brandSelect} onValueChange={handleBrandChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent className="nocturne">
                    {allBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                    <SelectItem value="__new__">+ Nova marca</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Modelo / Puffs</Label>
                <Select value={modelSelect} onValueChange={handleModelSelectChange} disabled={!brand}>
                  <SelectTrigger><SelectValue placeholder={brand ? "Selecione" : "Marca primeiro"} /></SelectTrigger>
                  <SelectContent className="nocturne">
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
            <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Preços por unidade</p>
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
              <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                <span className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>Margem por unidade</span>
                <span className="nc-num text-sm font-semibold" style={{ color: unitMargin >= 0 ? "var(--nc-accent)" : "var(--nc-crit)" }}>
                  {formatCurrency(unitMargin)}
                </span>
              </div>
            )}
          </section>

          {/* Sabores */}
          <section className="space-y-3">
            <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Sabores (um por linha)</p>
            <textarea
              value={flavorsText}
              onChange={e => setFlavorsText(e.target.value)}
              placeholder={"Grape Ice\nStrawberry Ice\nWatermelon Ice\nGreen Apple"}
              rows={6}
              className="nc-input flex w-full px-3 py-2 text-sm"
            />
            {previewProducts.length > 0 && (
              <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                <div className="flex items-center justify-between px-3 py-2 text-[11px]" style={{ background: "var(--nc-bg)" }}>
                  <span>
                    <span className="font-medium" style={{ color: "var(--nc-accent)" }}>{newProducts.length} novo{newProducts.length !== 1 ? "s" : ""}</span>
                    {duplicates.length > 0 && (
                      <> · <span style={{ color: "var(--nc-alert)" }}>{duplicates.length} duplicado{duplicates.length !== 1 ? "s" : ""}</span></>
                    )}
                  </span>
                </div>
                <ul className="max-h-44 overflow-auto">
                  {previewProducts.map((p, i) => (
                    <li key={i} className="nc-row flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className={p.isDuplicate ? "line-through" : undefined} style={p.isDuplicate ? { color: "var(--nc-text-3)" } : undefined}>{p.flavor}</span>
                      {p.isDuplicate && (
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--nc-alert)" }}><AlertCircle size={10} /> já existe</span>
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
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>
                <Sparkles size={11} style={{ color: "var(--nc-accent)" }} /> Impacto estimado
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="nc-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Investimento</p>
                  <p className="nc-num mt-0.5 text-sm font-semibold">{formatCurrency(investment)}</p>
                </div>
                <div className="nc-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Receita pot.</p>
                  <p className="nc-num mt-0.5 text-sm font-semibold">{formatCurrency(potential)}</p>
                </div>
                <div className="nc-card px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--nc-text-3)" }}>Lucro pot.</p>
                  <p className="nc-num mt-0.5 text-sm font-semibold" style={{ color: potentialProfit >= 0 ? "var(--nc-accent)" : "var(--nc-crit)" }}>{formatCurrency(potentialProfit)}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
              {newProducts.length > 0
                ? <>Serão criados <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{newProducts.length}</span> produto{newProducts.length !== 1 ? "s" : ""}</>
                : "Preencha os campos para visualizar"}
            </p>
            <NcButton variant="solid" size="md" onClick={handleSubmit} disabled={newProducts.length === 0 || submitting}>
              {submitting ? "Criando…" : `Criar ${newProducts.length || ""}`}
            </NcButton>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
