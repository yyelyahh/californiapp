import { useStore } from "@/context/StoreContext";
import type { Product } from "@/types";
import { useState, useMemo } from "react";
import { Trash2, Search, Package, ChevronRight, Pencil, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import AddProductDialog from "@/components/AddProductDialog";
import ModelImagesDialog from "@/components/ModelImagesDialog";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { AnimatePresence, motion } from "motion/react";
import { listItem, transitionBase } from "@/lib/motion";
import { NcButton, Rule, EYEBROW } from "@/components/nocturne";
import { sortNames, sortCatalog, compareText } from "@/lib/catalog-order";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
function formatCurrencyShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

/** Abaixo disso a coluna de estoque do sabor sai em --nc-alert na tabela. */
const LOW_STOCK = 3;
/** Quantos modelos cabem na lista do trilho antes de virar "+ N outros". */
const MAX_LOW_ROWS = 6;
/** Linhas mínimas na lista do trilho, para o bloco não ficar vazio. */
const MIN_LOW_ROWS = 3;

/** Lucro é accent quando positivo e crítico quando negativo — regra do painel. */
function profitColor(v: number) {
  return v >= 0 ? "var(--nc-accent)" : "var(--nc-crit)";
}

/**
 * Estoque do modelo: zerado é crítico, no mínimo é alerta, o resto é texto
 * normal. Mesmo vocabulário das bolinhas de urgência do "Repor agora".
 */
function modelStockColor(m: { stock: number; min: number }) {
  if (m.stock === 0) return "var(--nc-crit)";
  if (m.min > 0 && m.stock <= m.min) return "var(--nc-alert)";
  return undefined;
}

export default function ProductsPage() {
  const { products, updateProduct, deleteProduct } = useStore();
  const [search, setSearch] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ name: "", brand: "", model: "", flavor: "", purchasePrice: "", salePrice: "", stock: "", minStock: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ model: "", brand: "all", purchasePrice: "", salePrice: "" });
  const [bulkMinOpen, setBulkMinOpen] = useState(false);
  const [bulkMinForm, setBulkMinForm] = useState({ model: "", brand: "all", minStock: "" });

  const outOfStockCount = useMemo(() => products.filter(p => p.stock <= 0).length, [products]);

  const filtered = useMemo(() => {
    const base = showOutOfStock ? products : products.filter(p => p.stock > 0);
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.flavor.toLowerCase().includes(q)
    );
  }, [products, search, showOutOfStock]);

  const brandGroups = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    filtered.forEach(p => {
      const brand = p.brand || "Sem Marca";
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand)!.push(p);
    });
    return Array.from(groups.entries())
      .map(([brand, prods]) => {
        // Ordem de leitura, não de preço: quem abre esta tela está procurando
        // um sabor pelo nome. O preço ordenava por número e, como todo sabor
        // do mesmo modelo custa igual, o desempate caía na ordem de cadastro.
        const sorted = sortCatalog(prods);
        const modelMap = new Map<string, typeof filtered>();
        sorted.forEach(p => {
          const model = (p.model || "").trim() || "Sem Modelo";
          if (!modelMap.has(model)) modelMap.set(model, []);
          modelMap.get(model)!.push(p);
        });
        const models = Array.from(modelMap.entries())
          .map(([model, mProds]) => ({
            model,
            products: mProds,
            totalInvested: mProds.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
            totalSaleValue: mProds.reduce((s, p) => s + p.salePrice * p.stock, 0),
            totalProfit: mProds.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
            totalStock: mProds.reduce((s, p) => s + p.stock, 0),
          }))
          .sort((a, b) => compareText(a.model, b.model));
        return {
          brand,
          products: sorted,
          models,
          totalInvested: prods.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
          totalSaleValue: prods.reduce((s, p) => s + p.salePrice * p.stock, 0),
          totalProfit: prods.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
          totalStock: prods.reduce((s, p) => s + p.stock, 0),
        };
      })
      .sort((a, b) => compareText(a.brand, b.brand));
  }, [filtered]);

  const totals = useMemo(() => ({
    invested: products.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
    saleValue: products.reduce((s, p) => s + p.salePrice * p.stock, 0),
    profit: products.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
    stock: products.reduce((s, p) => s + p.stock, 0),
    models: new Set(products.map(p => `${p.brand}|${p.model}`)).size,
    brands: new Set(products.map(p => p.brand)).size,
  }), [products]);

  const marginPct = totals.saleValue > 0 ? (totals.profit / totals.saleValue) * 100 : 0;

/**
   * Estoque por MODELO, do mais baixo para o mais alto.
   *
   * O corte é o mínimo do próprio modelo — o mesmo que o botão "Mínimo por
   * modelo" grava. Ele é por modelo e não por sabor de propósito: sabor a sabor
   * não há controle nenhum de reposição, então um número por sabor seria um
   * alerta que ninguém sabe atender. O mínimo mora em `minStock` de cada linha
   * de produto (o bulk aplica o mesmo valor a todos os sabores do modelo), e
   * aqui a leitura é o MAIOR deles: se algum sabor foi ajustado à mão para um
   * mínimo mais alto, é esse que manda.
   */
  const modelStock = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; stock: number; min: number }>();
    products.forEach(p => {
      const model = (p.model || "").trim() || "Sem modelo";
      const brand = (p.brand || "").trim() || "Sem marca";
      const key = `${brand}|${model}`;
      const cur = map.get(key);
      if (cur) {
        cur.stock += p.stock;
        cur.min = Math.max(cur.min, p.minStock ?? 0);
      } else {
        map.set(key, { key, brand, model, stock: p.stock, min: p.minStock ?? 0 });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.stock - b.stock || compareText(a.model, b.model));
  }, [products]);

  /** Abaixo do mínimo configurado. Modelo sem mínimo definido não entra. */
  const belowMin = useMemo(
    () => modelStock.filter(m => m.min > 0 && m.stock <= m.min),
    [modelStock],
  );

  /**
   * Quem aparece no trilho: os abaixo do mínimo primeiro e, se forem poucos,
   * completa com os de estoque mais baixo — mesma regra do "Repor agora" do
   * Dashboard, para o bloco nunca aparecer vazio quando ainda não há mínimo
   * nenhum cadastrado.
   */
  const lowModels = useMemo(() => {
    if (belowMin.length >= MIN_LOW_ROWS) return belowMin;
    const seen = new Set(belowMin.map(m => m.key));
    return [...belowMin, ...modelStock.filter(m => !seen.has(m.key)).slice(0, MIN_LOW_ROWS - belowMin.length)];
  }, [belowMin, modelStock]);

  const toggleBrand = (brand: string) => {
    setCollapsedBrands(prev => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand); else next.add(brand);
      return next;
    });
  };

  const toggleModel = (key: string) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };


  const startEdit = (p: typeof products[0]) => {
    setEditId(p.id);
    setEditForm({
      name: p.name, brand: p.brand, model: p.model || '', flavor: p.flavor,
      purchasePrice: String(p.purchasePrice), salePrice: String(p.salePrice), stock: String(p.stock),
      minStock: String(p.minStock ?? 0),
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId || !editForm.name.trim()) return;
    await updateProduct(editId, {
      name: editForm.name.trim(),
      brand: editForm.brand.trim() || editForm.name.trim().split(" ")[0],
      model: editForm.model.trim(),
      flavor: editForm.flavor.trim(),
      purchasePrice: Number(editForm.purchasePrice) || 0,
      salePrice: Number(editForm.salePrice) || 0,
      stock: Number(editForm.stock) || 0,
      minStock: Number(editForm.minStock) || 0,

    });
    setEditId(null);
  };

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.model && p.model.trim()) set.add(p.model.trim()); });
    return sortNames(Array.from(set));
  }, [products]);

  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.brand && p.brand.trim()) set.add(p.brand.trim()); });
    return sortNames(Array.from(set));
  }, [products]);

  const bulkAffected = useMemo(() => {
    if (!bulkForm.model) return [];
    return products.filter(p =>
      p.model.trim().toLowerCase() === bulkForm.model.trim().toLowerCase() &&
      (bulkForm.brand === "all" || p.brand.trim().toLowerCase() === bulkForm.brand.trim().toLowerCase())
    );
  }, [products, bulkForm.model, bulkForm.brand]);

  const handleBulkUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkForm.model) { toast.error("Selecione um modelo"); return; }
    const newPurchase = bulkForm.purchasePrice.trim() === "" ? null : Number(bulkForm.purchasePrice);
    const newSale = bulkForm.salePrice.trim() === "" ? null : Number(bulkForm.salePrice);
    if (newPurchase === null && newSale === null) { toast.error("Informe ao menos um preço"); return; }
    if (bulkAffected.length === 0) { toast.error("Nenhum produto encontrado para esse modelo"); return; }
    const updates: Partial<Product> = {};
    if (newPurchase !== null && !isNaN(newPurchase)) updates.purchasePrice = newPurchase;
    if (newSale !== null && !isNaN(newSale)) updates.salePrice = newSale;
    await Promise.all(bulkAffected.map(p => updateProduct(p.id, updates)));
    toast.success(`${bulkAffected.length} produto(s) atualizado(s)`);
    setBulkOpen(false);
    setBulkForm({ model: "", brand: "all", purchasePrice: "", salePrice: "" });
  };

  const bulkMinAffected = useMemo(() => {
    if (!bulkMinForm.model) return [];
    return products.filter(p =>
      p.model.trim().toLowerCase() === bulkMinForm.model.trim().toLowerCase() &&
      (bulkMinForm.brand === "all" || p.brand.trim().toLowerCase() === bulkMinForm.brand.trim().toLowerCase())
    );
  }, [products, bulkMinForm.model, bulkMinForm.brand]);

  const handleBulkMinUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkMinForm.model) { toast.error("Selecione um modelo"); return; }
    if (bulkMinForm.minStock.trim() === "") { toast.error("Informe o estoque mínimo"); return; }
    const min = Number(bulkMinForm.minStock);
    if (isNaN(min) || min < 0) { toast.error("Valor inválido"); return; }
    if (bulkMinAffected.length === 0) { toast.error("Nenhum produto encontrado para esse modelo"); return; }
    await Promise.all(bulkMinAffected.map(p => updateProduct(p.id, { minStock: min })));
    toast.success(`Mínimo aplicado a ${bulkMinAffected.length} produto(s)`);
    setBulkMinOpen(false);
    setBulkMinForm({ model: "", brand: "all", minStock: "" });
  };

  return (
    // `/products` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento. Mesmo esqueleto do
    // Dashboard — coluna principal + trilho.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>Catálogo interno</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Produtos</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <NcButton onClick={() => setBulkOpen(true)}>
              <Tag size={13} />
              <span className="hidden sm:inline">Preço por modelo</span><span className="sm:hidden">Preço</span>
            </NcButton>
            <NcButton onClick={() => setBulkMinOpen(true)}>
              <Package size={13} />
              <span className="hidden sm:inline">Mínimo por modelo</span><span className="sm:hidden">Mínimo</span>
            </NcButton>
            <ModelImagesDialog />
            <AddProductDialog />
          </div>
        </header>

        {/* ---------------- Busca e filtro ---------------- */}
        <div className="nc-card flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--nc-text-3)" }} />
            <input
              type="text"
              placeholder="Buscar por nome, marca ou sabor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Buscar produto"
              className="nc-input h-8 w-full pl-8 pr-2.5 text-[12.5px]"
            />
          </div>
          {/* Mesmo realce do chip de período do Dashboard: contorno accent sobre
              preenchimento de 10%. Um botão ligado no painel é sempre isso. */}
          <button
            type="button"
            onClick={() => setShowOutOfStock(v => !v)}
            aria-pressed={showOutOfStock}
            className="nc-btn"
            style={showOutOfStock
              ? { color: "var(--nc-accent)", boxShadow: "inset 0 0 0 1px var(--nc-accent)", background: "color-mix(in srgb, var(--nc-accent) 10%, transparent)" }
              : { color: "var(--nc-text-2)", boxShadow: "inset 0 0 0 1px var(--nc-divider)" }}
          >
            {showOutOfStock ? "Ocultar zerados" : `Mostrar zerados${outOfStockCount > 0 ? ` (${outOfStockCount})` : ""}`}
          </button>
          {search && (
            <NcButton variant="ghost" onClick={() => setSearch("")}>
              <X size={13} />Limpar
            </NcButton>
          )}
        </div>

        {/* ---------------- Marcas ---------------- */}
        {brandGroups.length === 0 ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            {products.length === 0
              ? "Nenhum produto cadastrado ainda."
              : search.trim()
                ? `Nenhum produto encontrado para “${search.trim()}”.`
                : "Nenhum produto encontrado."}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {brandGroups.map(group => {
              const isCollapsed = collapsedBrands.has(group.brand);
              return (
                <section key={group.brand} className="nc-card overflow-hidden">
                  <button
                    onClick={() => toggleBrand(group.brand)}
                    aria-expanded={!isCollapsed}
                    className="nc-hover flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <motion.span
                        animate={{ rotate: isCollapsed ? 0 : 90 }}
                        transition={transitionBase}
                        className="inline-flex flex-none"
                        style={{ color: "var(--nc-text-3)" }}
                      >
                        <ChevronRight size={14} />
                      </motion.span>
                      <div className="min-w-0">
                        <h2 className="truncate text-[15px]">{group.brand}</h2>
                        <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                          {group.products.length} produto{group.products.length !== 1 ? "s" : ""} · {group.totalStock} un.
                        </p>
                      </div>
                    </div>
                    <GroupTotals invested={group.totalInvested} saleValue={group.totalSaleValue} profit={group.totalProfit} />
                  </button>

                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={transitionBase}
                        className="overflow-hidden"
                        style={{ borderTop: "1px solid var(--nc-track)" }}
                      >
                        {group.models.map(m => {
                          const modelKey = `${group.brand}|${m.model}`;
                          const isOpen = expandedModels.has(modelKey);
                          return (
                            <div key={modelKey} className="nc-row">
                              <button
                                onClick={() => toggleModel(modelKey)}
                                aria-expanded={isOpen}
                                className="nc-hover flex w-full items-center justify-between gap-3 py-2 pl-7 pr-4 text-left"
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <motion.span
                                    animate={{ rotate: isOpen ? 90 : 0 }}
                                    transition={transitionBase}
                                    className="inline-flex flex-none"
                                    style={{ color: "var(--nc-text-3)" }}
                                  >
                                    <ChevronRight size={13} />
                                  </motion.span>
                                  <div className="min-w-0">
                                    <h3 className="truncate text-[13px]">{m.model}</h3>
                                    <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                                      {m.products.length} produto{m.products.length !== 1 ? "s" : ""} · {m.totalStock} un.
                                    </p>
                                  </div>
                                </div>
                                <GroupTotals invested={m.totalInvested} saleValue={m.totalSaleValue} profit={m.totalProfit} />
                              </button>

                              <AnimatePresence initial={false}>
                                {isOpen && (
                                  <motion.div
                                    key="model-body"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={transitionBase}
                                    className="overflow-hidden"
                                  >
                                    {/* Mesma tabela do "Repor agora": cabeçalho
                                        em texto terciário e peso normal, sem
                                        faixa de fundo e sem caixa alta. */}
                                    <div className="overflow-x-auto px-3 pb-2 pt-1">
                                      <table className="w-full min-w-[440px] text-[13px]">
                                        <thead>
                                          <tr style={{ color: "var(--nc-text-3)" }}>
                                            <th className="px-2 py-1.5 text-left font-normal">Sabor</th>
                                            <th className="px-2 py-1.5 text-right font-normal">Estoque</th>
                                            <th className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">Compra</th>
                                            <th className="px-2 py-1.5 text-right font-normal">Venda</th>
                                            <th className="px-2 py-1.5 text-right font-normal">Lucro</th>
                                            <th className="w-[72px] px-2 py-1.5" />
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {m.products.map(p => (
                                            <FlavorRow
                                              key={p.id}
                                              product={p}
                                              onEdit={() => startEdit(p)}
                                              onDelete={() => setDeleteTarget(p)}
                                            />
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------- Coluna direita: Capital em estoque ----------------
          No celular ela vem ANTES da lista (`order-first`): o Dashboard pode
          deixar o trilho no fim porque a coluna dele é curta; aqui a lista de
          produtos rola por telas, e um resumo embaixo dela não seria lido. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Capital em estoque</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Potencial de venda</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <AnimatedNumber
              value={totals.saleValue}
              format={formatCurrencyShort}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
          </div>
          {/* Mesma barra do "recebido / a receber" do painel: a divisão de um
              total em duas partes, não uma escala. */}
          <div className="mt-2 flex h-[5px] gap-0.5">
            <div style={{ flex: Math.max(totals.invested, 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
            <div style={{ flex: Math.max(totals.profit, 0.001), background: "var(--nc-profit)", borderRadius: 2 }} />
          </div>
          <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            <span>custo {formatCurrencyShort(totals.invested)}</span>
            <span style={{ color: "var(--nc-profit)" }}>lucro {formatCurrencyShort(totals.profit)}</span>
          </div>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Investido no que está parado</span>
            <span className="nc-num text-sm">{formatCurrencyShort(totals.invested)}</span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Lucro previsto</span>
            <span style={{ color: profitColor(totals.profit) }}>
              <AnimatedNumber
                value={totals.profit}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-xl font-semibold"
              />
            </span>
          </div>
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>margem sobre o potencial</span>
            <span>{marginPct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
          </div>
        </div>

        <Rule />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Estoque</span>
            <div className="nc-num text-base font-semibold">{totals.stock} un.</div>
            <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              {outOfStockCount} sabor{outOfStockCount === 1 ? "" : "es"} zerado{outOfStockCount === 1 ? "" : "s"}
            </span>
          </div>
          <div>
            <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>Catálogo</span>
            <div className="nc-num text-base font-semibold">{totals.models} modelos</div>
            <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              {totals.brands} marca{totals.brands === 1 ? "" : "s"} · {products.length} sabores
            </span>
          </div>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Estoque por modelo</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {belowMin.length} de {modelStock.length} no mínimo
            </span>
          </div>
          {lowModels.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhum modelo cadastrado.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {lowModels.slice(0, MAX_LOW_ROWS).map(m => (
                <motion.div key={m.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {m.model}
                    <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                  </span>
                  <span className="nc-num flex-none" style={{ color: modelStockColor(m) }}>
                    {m.stock} un.
                    {m.min > 0 && <span style={{ color: "var(--nc-text-3)" }}> /{m.min}</span>}
                  </span>
                </motion.div>
              ))}
              {lowModels.length > MAX_LOW_ROWS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {lowModels.length - MAX_LOW_ROWS} outros no mínimo
                </p>
              )}
            </Stagger>
          )}
          {belowMin.length === 0 && modelStock.some(m => m.min > 0) && (
            <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum modelo abaixo do mínimo.
            </p>
          )}
        </div>
      </aside>

      {/* ---------------- Diálogos ----------------
          Todos levam a classe `nocturne`: o Radix porta o conteúdo para o
          <body>, fora da árvore da página, e lá a fonte e o anel de foco do
          painel não chegariam por herança. Mesmo cuidado que a loja documenta
          para o SheetContent dela. */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="nocturne">
          <DialogHeader>
            <DialogTitle>Alterar preço por modelo</DialogTitle>
            <DialogDescription>Atualize o preço de compra e/ou venda de todos os produtos de um modelo de uma só vez.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkUpdate} className="space-y-4">
            <div>
              <Label className="text-xs">Modelo</Label>
              <Select value={bulkForm.model} onValueChange={v => setBulkForm(f => ({ ...f, model: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um modelo (ex: 10K, V155)" /></SelectTrigger>
                <SelectContent className="nocturne">
                  {availableModels.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum modelo cadastrado</div>
                  ) : availableModels.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Marca (opcional)</Label>
              <Select value={bulkForm.brand} onValueChange={v => setBulkForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="nocturne">
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {availableBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Preço compra (R$)</Label>
                <Input type="number" step="0.01" placeholder="Manter" value={bulkForm.purchasePrice} onChange={e => setBulkForm(f => ({ ...f, purchasePrice: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Preço venda (R$)</Label>
                <Input type="number" step="0.01" placeholder="Manter" value={bulkForm.salePrice} onChange={e => setBulkForm(f => ({ ...f, salePrice: e.target.value }))} />
              </div>
            </div>
            {bulkForm.model && (
              <div className="rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                <p className="mb-1" style={{ color: "var(--nc-text-2)" }}>
                  Produtos afetados: <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{bulkAffected.length}</span>
                </p>
                {bulkAffected.length > 0 && (
                  <ul className="max-h-32 space-y-0.5 overflow-auto" style={{ color: "var(--nc-text-2)" }}>
                    {bulkAffected.slice(0, 8).map(p => (
                      <li key={p.id} className="truncate">• {p.brand} {p.name} {p.flavor && `· ${p.flavor}`}</li>
                    ))}
                    {bulkAffected.length > 8 && (<li>+ {bulkAffected.length - 8} outros…</li>)}
                  </ul>
                )}
              </div>
            )}
            <NcButton type="submit" variant="solid" size="md" className="w-full" disabled={bulkAffected.length === 0}>
              Atualizar {bulkAffected.length > 0 && `(${bulkAffected.length})`}
            </NcButton>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMinOpen} onOpenChange={setBulkMinOpen}>
        <DialogContent className="nocturne">
          <DialogHeader>
            <DialogTitle>Estoque mínimo por modelo</DialogTitle>
            <DialogDescription>Defina o estoque mínimo de um modelo. O valor será aplicado a todos os sabores desse modelo.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkMinUpdate} className="space-y-4">
            <div>
              <Label className="text-xs">Modelo</Label>
              <Select value={bulkMinForm.model} onValueChange={v => setBulkMinForm(f => ({ ...f, model: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um modelo" /></SelectTrigger>
                <SelectContent className="nocturne">
                  {availableModels.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum modelo cadastrado</div>
                  ) : availableModels.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Marca (opcional)</Label>
              <Select value={bulkMinForm.brand} onValueChange={v => setBulkMinForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="nocturne">
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {availableBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estoque mínimo (unidades)</Label>
              <Input type="number" min="0" placeholder="Ex: 10" value={bulkMinForm.minStock} onChange={e => setBulkMinForm(f => ({ ...f, minStock: e.target.value }))} />
              <p className="mt-1 text-[11px]" style={{ color: "var(--nc-text-3)" }}>Alerta será exibido quando o estoque total do modelo ficar abaixo desse valor.</p>
            </div>
            {bulkMinForm.model && (
              <div className="rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                <p style={{ color: "var(--nc-text-2)" }}>
                  Produtos afetados: <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{bulkMinAffected.length}</span>
                </p>
              </div>
            )}
            <NcButton type="submit" variant="solid" size="md" className="w-full" disabled={bulkMinAffected.length === 0}>
              Aplicar {bulkMinAffected.length > 0 && `(${bulkMinAffected.length})`}
            </NcButton>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editId} onOpenChange={v => { if (!v) setEditId(null); }}>
        <DialogContent className="nocturne">
          <DialogHeader><DialogTitle>Editar produto</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Marca</Label><Input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} /></div>
              <div><Label className="text-xs">Modelo</Label><Input value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Sabor</Label><Input value={editForm.flavor} onChange={e => setEditForm(f => ({ ...f, flavor: e.target.value }))} /></div>
            <div><Label className="text-xs">Nome interno</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label className="text-xs">Compra (R$)</Label><Input type="number" step="0.01" value={editForm.purchasePrice} onChange={e => setEditForm(f => ({ ...f, purchasePrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Venda (R$)</Label><Input type="number" step="0.01" value={editForm.salePrice} onChange={e => setEditForm(f => ({ ...f, salePrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Estoque</Label><Input type="number" value={editForm.stock} onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))} /></div>
              <div><Label className="text-xs">Mín.</Label><Input type="number" value={editForm.minStock} onChange={e => setEditForm(f => ({ ...f, minStock: e.target.value }))} /></div>
            </div>
            <NcButton type="submit" variant="solid" size="md" className="w-full">Salvar alterações</NcButton>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent className="nocturne">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (<>Tem certeza que deseja excluir <strong>{deleteTarget.flavor || deleteTarget.name}</strong>
                {deleteTarget.flavor && deleteTarget.name && <> · {deleteTarget.name}</>}? Esta ação ficará registrada na auditoria.</>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { if (deleteTarget) await deleteProduct(deleteTarget.id); setDeleteTarget(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Investido / Potencial / Lucro do cabeçalho de marca e de modelo. Rótulo é
 * sobretítulo terciário e valor é `nc-num`; investido e potencial somem em tela
 * estreita porque o lucro é o número que decide se aquele grupo interessa.
 */
function GroupTotals({ invested, saleValue, profit }: { invested: number; saleValue: number; profit: number }) {
  return (
    <div className="flex flex-none items-center gap-4 text-[11px]">
      <div className="hidden text-right sm:block">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Investido</p>
        <p className="nc-num">{formatCurrency(invested)}</p>
      </div>
      <div className="hidden text-right md:block">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Potencial</p>
        <p className="nc-num">{formatCurrency(saleValue)}</p>
      </div>
      <div className="text-right">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Lucro</p>
        <p className="nc-num" style={{ color: profitColor(profit) }}>{formatCurrency(profit)}</p>
      </div>
    </div>
  );
}

/**
 * Linha de sabor. As três cores de estoque são o mesmo vocabulário do
 * "Repor agora": terciário para zerado (existe mas não conta), `--nc-alert`
 * para acabando, texto normal para o que está de pé.
 */
function FlavorRow({ product: p, onEdit, onDelete }: { product: Product; onEdit: () => void; onDelete: () => void }) {
  const profit = p.salePrice - p.purchasePrice;
  const stockColor = p.stock === 0
    ? "var(--nc-text-3)"
    : p.stock <= LOW_STOCK ? "var(--nc-alert)" : undefined;

  return (
    <tr className="nc-row nc-hover group">
      <td className="px-2 py-1.5">
        <span className="truncate">{p.flavor || p.name}</span>
      </td>
      <td className="nc-num px-2 py-1.5 text-right font-medium" style={stockColor ? { color: stockColor } : undefined}>
        {p.stock}
      </td>
      <td className="nc-num hidden px-2 py-1.5 text-right sm:table-cell" style={{ color: "var(--nc-text-2)" }}>
        {formatCurrency(p.purchasePrice)}
      </td>
      <td className="nc-num px-2 py-1.5 text-right">{formatCurrency(p.salePrice)}</td>
      <td className="nc-num px-2 py-1.5 text-right" style={{ color: profitColor(profit) }}>
        {formatCurrency(profit)}
      </td>
      <td className="px-2 py-1">
        {/* No desktop as ações só aparecem no hover da linha; no toque não há
            hover, então ficam sempre visíveis abaixo de sm. */}
        <div className="flex justify-end gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <NcButton variant="ghost" size="icon" onClick={onEdit} aria-label={`Editar ${p.flavor || p.name}`}>
            <Pencil size={13} />
          </NcButton>
          <NcButton variant="danger" size="icon" onClick={onDelete} aria-label={`Excluir ${p.flavor || p.name}`}>
            <Trash2 size={13} />
          </NcButton>
        </div>
      </td>
    </tr>
  );
}
