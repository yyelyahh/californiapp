import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ModelImagesDialog() {
  const { products } = useStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});

  const combos = useMemo(() => {
    const map = new Map<string, { brand: string; model: string; flavors: number }>();
    products.forEach(p => {
      const brand = (p.brand || "").trim();
      const model = (p.model || "").trim();
      const key = `${brand}|||${model}`;
      const cur = map.get(key);
      if (cur) cur.flavors += 1;
      else map.set(key, { brand, model, flavors: 1 });
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  }, [products]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.from("product_model_images").select("*");
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar fotos", { description: error.message });
      } else {
        const next: Record<string, string> = {};
        (data ?? []).forEach(r => {
          next[`${(r.brand || "").trim()}|||${(r.model || "").trim()}`] = r.image_url || "";
        });
        setUrls(next);
        setInitial(next);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const save = async (key: string, brand: string, model: string) => {
    const url = (urls[key] ?? "").trim();
    if (url === (initial[key] ?? "")) return;
    setSavingKey(key);
    try {
      if (!url) {
        const { error } = await supabase
          .from("product_model_images")
          .delete()
          .eq("brand", brand)
          .eq("model", model);
        if (error) throw error;
        toast.success("Foto removida");
      } else {
        const { error } = await supabase
          .from("product_model_images")
          .upsert({ brand, model, image_url: url }, { onConflict: "brand,model" });
        if (error) throw error;
        toast.success("Foto salva");
      }
      setInitial(prev => ({ ...prev, [key]: url }));
    } catch (e) {
      toast.error("Erro ao salvar foto", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <ImageIcon size={14} />
          <span className="hidden sm:inline">Fotos por Modelo</span>
          <span className="sm:hidden">Fotos</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fotos por modelo</DialogTitle>
          <DialogDescription>
            A foto é compartilhada por todos os sabores da mesma marca + modelo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {combos.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum modelo cadastrado.</p>
            )}
            {combos.map(c => {
              const value = urls[c.key] ?? "";
              const dirty = value.trim() !== (initial[c.key] ?? "");
              return (
                <div key={c.key} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {c.brand || "Sem marca"} · {c.model || "Sem modelo"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.flavors} {c.flavors === 1 ? "sabor" : "sabores"}
                      </p>
                    </div>
                    {value.trim() && (
                      <img
                        src={value}
                        alt={`Foto do modelo ${c.brand} ${c.model}`}
                        loading="lazy"
                        className="h-10 w-10 rounded-md object-cover border border-border"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                      />
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label className="text-xs">URL da foto</Label>
                      <Input
                        type="url"
                        placeholder="https://..."
                        value={value}
                        onChange={e => setUrls(prev => ({ ...prev, [c.key]: e.target.value }))}
                        onBlur={() => save(c.key, c.brand, c.model)}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant={dirty ? "default" : "outline"}
                      disabled={!dirty || savingKey === c.key}
                      onClick={() => save(c.key, c.brand, c.model)}
                    >
                      {savingKey === c.key ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
