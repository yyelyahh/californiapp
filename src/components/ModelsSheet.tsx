import { useMemo, useState } from "react";
// Ícone de tela vem do lucide (o phosphor é só do app-shell do AppLayout).
import { Archive, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useStore } from "@/context/StoreContext";
import { useBranch } from "@/context/BranchContext";
import { formatDateBR } from "@/lib/date-utils";
import { NcButton, NcSheetHeader, NcTabsList } from "@/components/nocturne";
import { computeModelStats } from "@/lib/restock";
import { disuseCandidates, modelArchiveKey, DISUSE_DAYS } from "@/lib/archived-models";

/**
 * Modelos fora de linha.
 *
 * O catálogo só cresce: modelo que o fornecedor parou de trazer, sabor que
 * ninguém pede mais, linha inteira que saiu de moda — tudo continua aparecendo
 * em cada seletor da operação, para sempre. Excluir não serve, porque a linha de
 * `products` é o que dá nome a toda venda, entrada e perda do passado. Arquivar
 * é a terceira opção: a identidade fica, a oferta some.
 *
 * O painel é um BOTÃO no cabeçalho de Produtos e não uma ação por linha da
 * lista, porque a faxina é em lote e episódica — acha-se os doze modelos mortos
 * de uma vez, não um a um rolando quarenta linhas. Por isso a primeira aba já
 * chega com os CANDIDATOS calculados (sem estoque e sem venda há mais de
 * {DISUSE_DAYS} dias): a pergunta "o que aqui já morreu?" é respondida pelo
 * sistema, que tem o dado, e não pela memória de quem abre.
 *
 * Arquivar é por FILIAL: Curitiba pode ter parado de pedir o que São Paulo
 * ainda vende. Em "Todas as filiais" o painel é só de leitura — escrever exige
 * uma cidade concreta, como toda escrita do sistema.
 */
export default function ModelsSheet() {
  const { products, sales, archivedModels, hiddenModels, archiveModels, unarchiveModel } = useStore();
  const { branchId, branches } = useBranch();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("desuso");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  /**
   * As contas por modelo saem do mesmo `computeModelStats` do "Repor agora" —
   * `stock` e `daysSinceLastSale` já moram lá, e duas contas de "há quanto
   * tempo esse modelo não sai" dariam duas respostas para a mesma pergunta.
   * Lê `products` INTEIRO de propósito: o arquivado precisa continuar visível
   * aqui dentro, que é onde ele volta atrás.
   */
  const stats = useMemo(
    () => computeModelStats({ products, sales, periodSales: [] }),
    [products, sales],
  );

  const candidates = useMemo(() => disuseCandidates(stats, hiddenModels), [stats, hiddenModels]);

  /** Estoque de hoje por modelo — é o que denuncia o arquivado que voltou a ter unidade. */
  const stockByKey = useMemo(
    () => new Map(stats.map(s => [modelArchiveKey(s.brand, s.model), s.stock])),
    [stats],
  );

  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? "outra filial";

  /** Em "Todas" mostra o que cada cidade arquivou; com filial escolhida, só a dela. */
  const archived = useMemo(() => {
    const rows = branchId ? archivedModels.filter(r => r.branchId === branchId) : archivedModels;
    return [...rows].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }, [archivedModels, branchId]);

  const toggle = (key: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const allPicked = candidates.length > 0 && picked.size === candidates.length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(candidates.map(c => c.key)));

  const handleArchive = async () => {
    const chosen = candidates.filter(c => picked.has(c.key));
    if (chosen.length === 0) return;
    setSaving(true);
    const ok = await archiveModels(chosen.map(c => ({ brand: c.brand, model: c.model })));
    setSaving(false);
    if (ok) setPicked(new Set());
  };

  const openPanel = () => {
    setPicked(new Set());
    // Sem filial não há o que marcar: abre direto no que já foi arquivado.
    setTab(branchId ? "desuso" : "arquivados");
    setOpen(true);
  };

  return (
    <>
      <NcButton size="md" onClick={openPanel}>
        <Archive size={14} />Modelos
      </NcButton>

      {/* `nocturne` repetido: o Radix porta o painel para o <body> e os tokens
          não chegam por herança. */}
      <Sheet open={open} onOpenChange={v => { setOpen(v); if (!v) setPicked(new Set()); }}>
        <SheetContent className="nocturne flex w-full flex-col p-0 sm:max-w-xl">
          <NcSheetHeader
            eyebrow="Catálogo"
            title="Modelos fora de linha"
            description={
              branchId
                ? "Arquivar tira o modelo das listas de escolha desta filial. O histórico não muda, e dá para voltar atrás a qualquer momento."
                : "Em Todas as filiais o painel só mostra o que já foi arquivado — arquivar é decisão de uma cidade."
            }
          />

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none px-5 pt-3">
              <NcTabsList
                value={tab}
                tabs={[
                  { value: "desuso", label: "Em desuso", count: candidates.length || undefined },
                  { value: "arquivados", label: "Arquivados", count: archived.length || undefined },
                ]}
              />
            </div>

            {/* ---------------- Em desuso ---------------- */}
            <TabsContent value="desuso" className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4 overscroll-contain">
              {!branchId ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                  Escolha uma filial para arquivar. Sair de linha é decisão de cada cidade — uma pode
                  ter parado de pedir o que a outra ainda vende toda semana.
                </p>
              ) : candidates.length === 0 ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                  Nenhum modelo parado. Entram aqui os que estão sem estoque e sem venda há mais de{" "}
                  {DISUSE_DAYS} dias.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
                      Sem estoque e sem venda há mais de {DISUSE_DAYS} dias.
                    </p>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[11.5px] transition-colors hover:underline"
                      style={{ color: "var(--nc-accent)" }}
                    >
                      {allPicked ? "Limpar" : "Marcar todos"}
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                    {candidates.map(c => (
                      // A linha inteira é o alvo, e a caixa é só o desenho do
                      // estado: o Checkbox do Radix é um <button>, e <label> não
                      // alcança botão — clicar no nome do modelo não marcaria
                      // nada, que é justamente onde a pessoa clica.
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggle(c.key)}
                        aria-pressed={picked.has(c.key)}
                        className="nc-row flex w-full items-center gap-3 px-3 py-2.5 text-left"
                      >
                        <Checkbox
                          checked={picked.has(c.key)}
                          tabIndex={-1}
                          aria-hidden
                          className="pointer-events-none"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px]">
                            {c.model}
                            <span style={{ color: "var(--nc-text-3)" }}> · {c.brand}</span>
                          </p>
                          <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                            {c.stock} un. ·{" "}
                            {isFinite(c.daysSinceLastSale)
                              ? `sem venda há ${Math.round(c.daysSinceLastSale)} dias`
                              : "nunca vendeu"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            {/* ---------------- Arquivados ---------------- */}
            <TabsContent value="arquivados" className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-4 overscroll-contain">
              {archived.length === 0 ? (
                <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                  Nenhum modelo arquivado.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                  {archived.map(r => {
                    const back = (stockByKey.get(modelArchiveKey(r.brand, r.model)) ?? 0) > 0;
                    return (
                      <div key={`${r.branchId}|${r.brand}|${r.model}`} className="nc-row flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px]">
                            {r.model}
                            <span style={{ color: "var(--nc-text-3)" }}> · {r.brand}</span>
                          </p>
                          <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                            arquivado em {formatDateBR(r.archivedAt)}
                            {!branchId && ` · ${branchName(r.branchId)}`}
                            {/* Compra que chegou depois de arquivar: a unidade
                                existe, então ela voltou para as listas sozinha —
                                esconder estoque seria esconder dinheiro. */}
                            {back && (
                              <span style={{ color: "var(--nc-alert)" }}> · voltou a ter estoque, já aparece nas listas</span>
                            )}
                          </p>
                        </div>
                        {branchId === r.branchId && (
                          <button
                            type="button"
                            onClick={() => void unarchiveModel(r.brand, r.model)}
                            className="inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] transition-colors hover:bg-white/5"
                            style={{ color: "var(--nc-accent)" }}
                          >
                            <RotateCcw size={12} />Desarquivar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {tab === "desuso" && branchId && candidates.length > 0 && (
            <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
              <div className="flex w-full items-center justify-between gap-3">
                <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                  {picked.size > 0
                    ? <>
                        <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{picked.size}</span>
                        {picked.size === 1 ? " modelo sai" : " modelos saem"} das listas desta filial
                      </>
                    : "Marque o que já morreu"}
                </p>
                <NcButton variant="solid" size="md" onClick={handleArchive} disabled={picked.size === 0 || saving}>
                  {saving ? "Arquivando…" : `Arquivar${picked.size > 0 ? ` (${picked.size})` : ""}`}
                </NcButton>
              </div>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
