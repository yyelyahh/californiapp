import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/context/StoreContext";
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
import { compareCatalog } from "@/lib/catalog-order";
import { NcButton } from "@/components/nocturne";

/**
 * A MESMA chave que get_seller_catalog usa para casar a foto com o sabor: sem
 * espaço nas pontas e sem caixa. Enquanto a tela agrupava por igualdade exata
 * e o banco casava normalizado, "Ignite" e "ignite" eram um modelo só para a
 * loja e dois para quem cadastra — e a foto que a pessoa apagava não era a que
 * a loja estava mostrando.
 */
const modelKey = (brand?: string | null, model?: string | null) =>
  `${(brand ?? "").trim().toLowerCase()}|||${(model ?? "").trim().toLowerCase()}`;

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
      const key = modelKey(brand, model);
      const cur = map.get(key);
      if (cur) cur.flavors += 1;
      else map.set(key, { brand, model, flavors: 1 });
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort(compareCatalog);
  }, [products]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Mais recente primeiro, e a primeira vence: é o desempate que
      // get_seller_catalog faz (ORDER BY created_at DESC). Sem ele, com linha
      // duplicada a tela mostrava uma foto e a loja outra, sem nada explicando.
      const { data, error } = await supabase
        .from("product_model_images")
        .select("*")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error("Erro ao carregar fotos", { description: error.message });
      } else {
        const next: Record<string, string> = {};
        (data ?? []).forEach(r => {
          const key = modelKey(r.brand, r.model);
          if (key in next) return;
          next[key] = r.image_url || "";
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
      // Porta única de escrita (migration 20260910120000): ela resolve
      // marca+modelo pela mesma chave normalizada da leitura, apaga o que casa
      // e deixa UMA linha. O delete/upsert por igualdade exata que estava aqui
      // errava a linha quando a caixa não batia — e ainda avisava "Foto
      // removida" com a foto continuando no ar. URL vazia = remover.
      // O cast sai quando `set_model_image` aparecer no types.ts regerado.
      const { error } = await (supabase.rpc as unknown as
        (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
      )("set_model_image", { p_brand: brand, p_model: model, p_image_url: url });
      if (error) throw error;
      toast.success(url ? "Foto salva" : "Foto removida");
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
        <NcButton>
          <ImageIcon size={13} />
          <span className="hidden sm:inline">Fotos por Modelo</span>
          <span className="sm:hidden">Fotos</span>
        </NcButton>
      </DialogTrigger>
      <DialogContent className="nocturne max-w-2xl">
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
                <div key={c.key} className="rounded-lg p-3 space-y-2" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
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
                        className="h-10 w-10 rounded-md object-cover"
                        style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}
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
                    <NcButton
                      variant={dirty ? "solid" : "quiet"}
                      size="md"
                      disabled={!dirty || savingKey === c.key}
                      onClick={() => save(c.key, c.brand, c.model)}
                    >
                      {savingKey === c.key ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
                    </NcButton>
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
