import { useState } from "react";
import { Reorder, motion, useDragControls } from "motion/react";
// Ícone de tela vem do lucide (o phosphor é só do app-shell do AppLayout).
import { Eye, EyeOff, GripVertical, SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { EYEBROW, NcButton, NcSheetHeader, SegmentedChips } from "@/components/nocturne";
import { cn } from "@/lib/utils";
import {
  WIDGETS,
  groupOf,
  moveWithin,
  reorderGroup,
  updateWidget,
  widgetDef,
  type DashboardLayout,
  type WidgetArea,
  type WidgetConfig,
  type WidgetId,
  type WidgetSize,
} from "@/lib/dashboard-layout";

const MODE_OPTIONS = [
  { value: "vertical", label: "Vertical — coluna e trilho", short: "Vertical" },
  { value: "cards", label: "Cards — grade de blocos", short: "Cards" },
];

const AREA_OPTIONS = [
  { value: "main", label: "Na coluna do meio", short: "Coluna" },
  { value: "rail", label: "No trilho da direita", short: "Trilho" },
];

const SIZE_LABEL: Record<WidgetSize, { label: string; short: string }> = {
  s: { label: "Pequeno — 1/4 da largura", short: "P" },
  m: { label: "Médio — metade da largura", short: "M" },
  l: { label: "Grande — largura inteira", short: "G" },
};

/**
 * O painel "Personalizar" do Dashboard.
 *
 * Mexer aqui muda a tela NA HORA, por trás do painel — é a pré-visualização, e
 * por isso não existe "Salvar": o hook grava sozinho, com debounce. O rodapé
 * tem "Pronto" só para fechar, e "Restaurar padrão" para voltar ao Dashboard de
 * antes da personalização.
 *
 * A lista muda com o modo, porque as perguntas mudam: no vertical cada bloco
 * pertence a uma área (e a ordem é dentro dela), nos cards todos dividem a mesma
 * grade e o que se escolhe é o tamanho. A ORDEM entre os dois é a mesma — ver o
 * cabeçalho de src/lib/dashboard-layout.ts.
 */
export default function DashboardCustomizeSheet({
  layout,
  onChange,
  onReset,
}: {
  layout: DashboardLayout;
  onChange: (next: DashboardLayout) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const visibleCount = layout.widgets.filter(w => w.visible).length;
  const groups: { area: WidgetArea | null; title: string }[] =
    layout.mode === "vertical"
      ? [{ area: "main", title: "Coluna do meio" }, { area: "rail", title: "Trilho da direita" }]
      : [{ area: null, title: "Blocos" }];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Personalizar o Dashboard"
        aria-label="Personalizar o Dashboard"
        className="nc-btn nc-btn--ghost nc-btn--icon"
      >
        <SlidersHorizontal size={15} />
      </button>

      {/* `nocturne` repetido: o Radix porta o painel para o <body> e os tokens
          não chegam por herança. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="nocturne flex w-full flex-col p-0 sm:max-w-lg">
          <NcSheetHeader
            eyebrow="Dashboard"
            title="Personalizar"
            description="O que aparece, em que ordem e de que jeito. Fica salvo na sua conta e vale em qualquer aparelho."
          />

          {/* `layoutScroll`: o arrasto do Reorder mede posição, e sem isto ele
              não desconta a rolagem do painel — o bloco pousaria fora do lugar. */}
          <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <section className="flex flex-col gap-2">
              <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Visualização</span>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedChips
                  options={MODE_OPTIONS}
                  value={layout.mode}
                  onChange={v => onChange({ ...layout, mode: v as DashboardLayout["mode"] })}
                />
                <p className="min-w-0 flex-1 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
                  {layout.mode === "vertical"
                    ? "Blocos em pilha, com o resumo num trilho à direita."
                    : "Todos os blocos numa grade, cada um no tamanho que você escolher."}
                </p>
              </div>
            </section>

            {groups.map(g => (
              <WidgetGroup
                key={g.area ?? "all"}
                title={g.title}
                area={g.area}
                layout={layout}
                onChange={onChange}
              />
            ))}
          </motion.div>

          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{visibleCount}</span>
                {" "}de {WIDGETS.length} blocos na tela
              </p>
              <div className="flex items-center gap-2">
                <NcButton size="md" onClick={onReset}>Restaurar padrão</NcButton>
                <NcButton variant="solid" size="md" onClick={() => setOpen(false)}>Pronto</NcButton>
              </div>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function WidgetGroup({
  title,
  area,
  layout,
  onChange,
}: {
  title: string;
  area: WidgetArea | null;
  layout: DashboardLayout;
  onChange: (next: DashboardLayout) => void;
}) {
  const items = groupOf(layout, area);
  const peers = items.map(w => w.id);

  return (
    <section className="mt-5 flex flex-col gap-2">
      <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>{title}</span>
      {items.length === 0 ? (
        <p
          className="rounded-lg px-3 py-4 text-center text-[12px]"
          style={{ color: "var(--nc-text-3)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}
        >
          {area === "rail"
            ? "Nenhum bloco no trilho — a coluna ocupa a largura inteira."
            : "Nenhum bloco aqui."}
        </p>
      ) : (
        <Reorder.Group
          axis="y"
          values={peers}
          onReorder={(next: WidgetId[]) => onChange(reorderGroup(layout, next))}
          className="overflow-hidden rounded-lg"
          style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}
        >
          {items.map(w => (
            <WidgetRow
              key={w.id}
              widget={w}
              mode={layout.mode}
              onPatch={patch => onChange(updateWidget(layout, w.id, patch))}
              onStep={dir => onChange(moveWithin(layout, w.id, dir, peers))}
            />
          ))}
        </Reorder.Group>
      )}
    </section>
  );
}

function WidgetRow({
  widget,
  mode,
  onPatch,
  onStep,
}: {
  widget: WidgetConfig;
  mode: DashboardLayout["mode"];
  onPatch: (patch: Partial<Omit<WidgetConfig, "id">>) => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const def = widgetDef(widget.id);
  // O arrasto começa SÓ na alça: a linha inteira arrastável roubaria o toque
  // dos chips e do olho, e no celular brigaria com a rolagem do painel.
  const controls = useDragControls();

  const sizeOptions = def.sizes.map(s => ({ value: s, ...SIZE_LABEL[s] }));

  return (
    <Reorder.Item
      value={widget.id}
      dragListener={false}
      dragControls={controls}
      className="nc-row flex items-center gap-2 px-2 py-2"
      style={{ background: "var(--nc-surface)", position: "relative" }}
    >
      {/* A alça também anda pelo teclado (setas), que é o caminho do mesmo
          arrasto para quem não usa mouse. */}
      <button
        type="button"
        onPointerDown={e => controls.start(e)}
        onKeyDown={e => {
          if (e.key === "ArrowUp") { e.preventDefault(); onStep(-1); }
          if (e.key === "ArrowDown") { e.preventDefault(); onStep(1); }
        }}
        aria-label={`Mover ${def.label} (setas para cima e para baixo)`}
        title="Arraste para reordenar"
        className="flex h-8 w-6 flex-none cursor-grab touch-none items-center justify-center rounded active:cursor-grabbing"
        style={{ color: "var(--nc-text-3)" }}
      >
        <GripVertical size={15} />
      </button>

      <div className={cn("min-w-0 flex-1 transition-opacity", !widget.visible && "opacity-45")}>
        <p className="truncate text-[13px]">{def.label}</p>
        <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>{def.description}</p>
      </div>

      {/* Largura fixa na célula das escolhas: os blocos têm opções diferentes
          (o "Repor agora" só cabe na coluna), e sem ela o olho de cada linha
          ficaria numa altura diferente. */}
      <div className="flex w-[124px] flex-none justify-end">
        {mode === "vertical"
          ? def.areas.length > 1 && (
              <SegmentedChips
                options={AREA_OPTIONS}
                value={widget.area}
                onChange={v => onPatch({ area: v as WidgetArea })}
              />
            )
          : sizeOptions.length > 1 && (
              <SegmentedChips
                options={sizeOptions}
                value={widget.size}
                onChange={v => onPatch({ size: v as WidgetSize })}
              />
            )}
      </div>

      <button
        type="button"
        onClick={() => onPatch({ visible: !widget.visible })}
        aria-pressed={widget.visible}
        aria-label={widget.visible ? `Esconder ${def.label}` : `Mostrar ${def.label}`}
        title={widget.visible ? "Esconder" : "Mostrar"}
        className="nc-btn nc-btn--ghost nc-btn--icon flex-none"
        style={{ color: widget.visible ? "var(--nc-accent)" : "var(--nc-text-3)" }}
      >
        {widget.visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
    </Reorder.Item>
  );
}
