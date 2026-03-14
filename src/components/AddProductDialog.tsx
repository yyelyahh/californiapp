import { useState, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/context/StoreContext";
import { toast } from "sonner";

const BRAND_PRESETS: Record<string, { purchasePrice: number; salePrice: number }> = {
  Ignite: { purchasePrice: 68.5, salePrice: 149 },
  Elfbar: { purchasePrice: 68, salePrice: 159 },
  Nikbar: { purchasePrice: 0, salePrice: 0 },
};

const BRANDS = Object.keys(BRAND_PRESETS);

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function AddProductDialog() {
  const { products, addProduct } = useStore();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [flavorsText, setFlavorsText] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const flavors = useMemo(() => {
    return flavorsText
      .split("\n")
      .map(f => f.trim())
      .filter(Boolean);
  }, [flavorsText]);

  const existingNames = useMemo(() => {
    return new Set(products.map(p => p.name.toLowerCase()));
  }, [products]);

  const previewProducts = useMemo(() => {
    if (!brand || !model.trim()) return [];
    return flavors.map(flavor => {
      const name = `${model.trim()}`;
      const isDuplicate = existingNames.has(name.toLowerCase());
      return { name, flavor, isDuplicate };
    });
  }, [brand, model, flavors, existingNames]);

  const newProducts = previewProducts.filter(p => !p.isDuplicate);
  const duplicates = previewProducts.filter(p => p.isDuplicate);

  const handleBrandChange = (value: string) => {
    setBrand(value);
    const preset = BRAND_PRESETS[value];
    if (preset) {
      setPurchasePrice(preset.purchasePrice ? String(preset.purchasePrice) : "");
      setSalePrice(preset.salePrice ? String(preset.salePrice) : "");
    }
  };

  const handleSubmit = async () => {
    if (!brand || !model.trim() || newProducts.length === 0) {
      toast.error("Preencha marca, modelo e pelo menos um sabor novo.");
      return;
    }

    const pPrice = Number(purchasePrice) || 0;
    const sPrice = Number(salePrice) || 0;

    let created = 0;
    for (const p of newProducts) {
      try {
        await addProduct({
          name: p.name,
          brand,
          model: model.trim(),
          flavor: p.flavor,
          purchasePrice: pPrice,
          salePrice: sPrice,
        });
        created++;
      } catch {
        toast.error(`Erro ao criar: ${p.name}`);
      }
    }

    if (created > 0) {
      toast.success(`${created} produto${created > 1 ? "s" : ""} criado${created > 1 ? "s" : ""}!`);
    }

    // Reset
    setBrand("");
    setModel("");
    setFlavorsText("");
    setPurchasePrice("");
    setSalePrice("");
    setOpen(false);
  };

  const handleReset = () => {
    setBrand("");
    setModel("");
    setFlavorsText("");
    setPurchasePrice("");
    setSalePrice("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) handleReset(); }}>
      <DialogTrigger asChild>
        <Button><Plus size={16} className="mr-2" />Novo Produto</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastro Rápido de Produtos</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Marca */}
          <div className="space-y-1.5">
            <Label>Marca</Label>
            <Select value={brand} onValueChange={handleBrandChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a marca" />
              </SelectTrigger>
              <SelectContent>
                {BRANDS.map(b => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Modelo/Puffs */}
          <div className="space-y-1.5">
            <Label>Modelo / Puffs</Label>
            <Input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="Ex: V155, 30K, TE 30K"
            />
          </div>

          {/* Preços */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Preço Compra (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={e => setPurchasePrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preço Venda (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={salePrice}
                onChange={e => setSalePrice(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          {brand && purchasePrice && salePrice && (
            <p className="text-xs text-muted-foreground">
              Margem: {formatCurrency(Number(salePrice) - Number(purchasePrice))} por unidade
            </p>
          )}

          {/* Sabores em lote */}
          <div className="space-y-1.5">
            <Label>Sabores (um por linha)</Label>
            <textarea
              value={flavorsText}
              onChange={e => setFlavorsText(e.target.value)}
              placeholder={"Grape Ice\nStrawberry Ice\nWatermelon Ice\nGreen Apple"}
              rows={5}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Preview */}
          {previewProducts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Pré-visualização ({newProducts.length} novo{newProducts.length !== 1 ? "s" : ""}
                {duplicates.length > 0 && `, ${duplicates.length} duplicado${duplicates.length !== 1 ? "s" : ""}`})
              </Label>
              <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-border p-2">
                {previewProducts.map((p, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                      p.isDuplicate ? "opacity-40 line-through" : ""
                    }`}
                  >
                    <span>{p.name}</span>
                    {p.isDuplicate && (
                      <Badge variant="secondary" className="text-[10px] ml-2">já existe</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ações */}
          <Button
            onClick={handleSubmit}
            disabled={newProducts.length === 0}
            className="w-full"
          >
            Criar {newProducts.length} produto{newProducts.length !== 1 ? "s" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
