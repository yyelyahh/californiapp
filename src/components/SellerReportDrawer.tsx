import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/context/StoreContext";
import { computeSellerCommission, getTierForUnits, COMMISSION_TIERS } from "@/lib/commissions";
import { formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths,
  isWithinInterval, parseISO, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, FileSpreadsheet, MessageCircle, ArrowUpCircle, ArrowDownCircle, Package } from "lucide-react";
import type { Sale } from "@/types";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type PeriodKey = "today" | "7d" | "month" | "lastMonth" | "custom";

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

function computeAccrualAdjustments(sales: Sale[]) {
  const sorted = [...sales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const out: { id: string; when: string; label: string; amount: number }[] = [];
  let cumUnits = 0; let cumRevenue = 0; let currentRate = COMMISSION_TIERS[0].rate;
  for (const s of sorted) {
    const priorRevenue = cumRevenue;
    cumUnits += s.quantity; cumRevenue += s.totalPrice;
    const tierAfter = getTierForUnits(cumUnits);
    if (tierAfter.rate > currentRate) {
      const adj = priorRevenue * (tierAfter.rate - currentRate);
      if (adj > 0.001) out.push({ id: `adj-${s.id}`, when: s.date, label: `Ajuste de faixa → ${tierAfter.label}`, amount: adj });
      currentRate = tierAfter.rate;
    }
  }
  return out;
}

export default function SellerReportDrawer({
  sellerId, open, onClose,
}: { sellerId: string | null; open: boolean; onClose: () => void }) {
  const { sellers, sales, commissionPayments, getProductName } = useStore();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));

  const seller = sellers.find(s => s.id === sellerId);

  const { start, end, label } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date, l: string;
    switch (periodKey) {
      case "today":
        s = startOfDay(now); e = endOfDay(now); l = `Hoje · ${format(now, "dd/MM/yyyy")}`; break;
      case "7d":
        s = startOfDay(subDays(now, 6)); e = endOfDay(now); l = `Últimos 7 dias`; break;
      case "lastMonth": {
        const lm = subMonths(now, 1);
        s = startOfMonth(lm); e = endOfMonth(lm); l = format(lm, "MMMM/yyyy", { locale: ptBR });
        break;
      }
      case "custom":
        s = startOfDay(parseISO(customStart)); e = endOfDay(parseISO(customEnd));
        l = `${format(s, "dd/MM/yy")} – ${format(e, "dd/MM/yy")}`; break;
      case "month":
      default:
        s = startOfMonth(now); e = endOfMonth(now); l = format(now, "MMMM/yyyy", { locale: ptBR }); break;
    }
    return { start: s, end: e, label: l };
  }, [periodKey, customStart, customEnd]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };

  const report = useMemo(() => {
    if (!seller) return null;
    const sellerSalesPeriod = sales.filter(s => s.sellerId === seller.id && inPeriod(s.date));
    const vendas = sellerSalesPeriod.filter(s => s.type === "venda");
    const retiradas = sellerSalesPeriod.filter(s => s.type === "retirada_funcionario");
    const units = vendas.reduce((a, s) => a + s.quantity, 0);
    const revenue = vendas.reduce((a, s) => a + s.totalPrice, 0);
    const received = vendas.reduce((a, s) => a + (s.paidAmount || 0), 0);
    const open = Math.max(0, revenue - received);
    const consumo = retiradas.reduce((a, s) => a + s.totalPrice, 0);

    const c = computeSellerCommission(vendas);
    const adjustments = computeAccrualAdjustments(vendas);
    const commPaidPeriod = commissionPayments
      .filter(p => p.sellerId === seller.id && inPeriod(p.date))
      .reduce((a, p) => a + p.amount, 0);
    const commBalance = c.accrued - commPaidPeriod;

    type Mov =
      | { kind: "venda"; when: string; label: string; amount: number; sub: string }
      | { kind: "retirada"; when: string; label: string; amount: number; sub: string }
      | { kind: "pagamento"; when: string; label: string; amount: number; sub?: string }
      | { kind: "ajuste"; when: string; label: string; amount: number; sub?: string };

    const movs: Mov[] = [];
    vendas.forEach(s => {
      const open = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      movs.push({
        kind: "venda",
        when: s.date,
        label: `${s.quantity}x ${getProductName(s.productId)}`,
        amount: s.totalPrice,
        sub: `Recebido ${fmt(s.paidAmount || 0)} · Em aberto ${fmt(open)}`,
      });
    });
    retiradas.forEach(s => {
      movs.push({
        kind: "retirada", when: s.date,
        label: `Retirada: ${s.quantity}x ${getProductName(s.productId)}`,
        amount: s.totalPrice, sub: s.notes || "",
      });
    });
    commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de comissão", amount: p.amount, sub: p.notes });
    });
    adjustments.forEach(a => movs.push({ kind: "ajuste", when: a.when, label: a.label, amount: a.amount }));
    movs.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return {
      units, revenue, received, open, consumo,
      tier: c.tier, accrued: c.accrued, commPaidPeriod, commBalance, movs,
    };
  }, [seller, sales, commissionPayments, start, end, getProductName]);

  if (!seller || !report) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }

  /* ---------- Export: WhatsApp ---------- */
  const buildWhats = () => {
    return [
      `📊 Relatório · ${label}`,
      ``,
      `👤 ${seller.name}`,
      ``,
      `📦 Unidades Vendidas: ${report.units}`,
      `💰 Faturamento: ${fmt(report.revenue)}`,
      `✅ Recebido: ${fmt(report.received)}`,
      `⏳ Em Aberto: ${fmt(report.open)}`,
      `📉 Consumo: ${fmt(report.consumo)}`,
      ``,
      `🏆 Faixa Atual: ${report.tier.label}`,
      `💵 Comissão Acumulada: ${fmt(report.accrued)}`,
      `💸 Comissão Paga: ${fmt(report.commPaidPeriod)}`,
      `🟢 Saldo Disponível: ${fmt(report.commBalance)}`,
    ].join("\n");
  };

  const shareWhats = () => {
    const text = encodeURIComponent(buildWhats());
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  /* ---------- Export: Excel ---------- */
  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    const summary = [
      ["Funcionário", seller.name],
      ["Período", label],
      [],
      ["Unidades vendidas", report.units],
      ["Faturamento", report.revenue],
      ["Recebido", report.received],
      ["Em aberto", report.open],
      ["Consumo / Retiradas", report.consumo],
      [],
      ["Faixa atual", report.tier.label],
      ["Comissão acumulada", report.accrued],
      ["Comissão paga (período)", report.commPaidPeriod],
      ["Saldo de comissão", report.commBalance],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Resumo");

    const rows = [
      ["Data", "Tipo", "Descrição", "Valor", "Observação"],
      ...report.movs.map(m => [
        formatDateBR(m.when),
        m.kind === "venda" ? "Venda"
          : m.kind === "retirada" ? "Retirada"
          : m.kind === "pagamento" ? "Pagamento comissão"
          : "Ajuste comissão",
        m.label, m.amount, ("sub" in m ? m.sub : "") || "",
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Movimentações");
    XLSX.writeFile(wb, `relatorio_${seller.name.replace(/\s+/g, "_")}_${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  /* ---------- Export: PDF (dark, California identity) ---------- */
  const exportPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();

    // Dark background
    doc.setFillColor(15, 15, 18); doc.rect(0, 0, w, h, "F");

    // Header bar
    doc.setFillColor(124, 58, 237); doc.rect(0, 0, w, 6, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text("CALIFORNIA", 40, 50);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(170, 170, 180);
    doc.text("Relatório do Funcionário", 40, 66);

    doc.setFontSize(9); doc.setTextColor(160, 160, 170);
    doc.text(`Emitido em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, w - 40, 50, { align: "right" });

    // Identity card
    doc.setFillColor(24, 24, 30); doc.roundedRect(40, 90, w - 80, 60, 8, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(seller.name, 56, 115);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(180, 180, 190);
    doc.text(`Período: ${label}`, 56, 134);

    // Summary grid
    const startY = 170;
    const items: [string, string, [number, number, number]?][] = [
      ["Unidades vendidas", String(report.units)],
      ["Faturamento", fmt(report.revenue), [82, 196, 132]],
      ["Recebido", fmt(report.received), [82, 196, 132]],
      ["Em aberto", fmt(report.open), [245, 158, 11]],
      ["Consumo / Retiradas", fmt(report.consumo), [245, 158, 11]],
      ["Faixa atual", report.tier.label, [124, 58, 237]],
      ["Comissão acumulada", fmt(report.accrued), [82, 196, 132]],
      ["Comissão paga", fmt(report.commPaidPeriod), [245, 158, 11]],
      ["Saldo disponível", fmt(report.commBalance),
        report.commBalance >= 0 ? [82, 196, 132] : [239, 68, 68]],
    ];
    const cardW = (w - 80 - 16) / 3; const cardH = 56;
    items.forEach((it, i) => {
      const col = i % 3; const row = Math.floor(i / 3);
      const x = 40 + col * (cardW + 8);
      const y = startY + row * (cardH + 8);
      doc.setFillColor(24, 24, 30); doc.roundedRect(x, y, cardW, cardH, 6, 6, "F");
      doc.setTextColor(150, 150, 160); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(it[0].toUpperCase(), x + 12, y + 18);
      const color = it[2] || [255, 255, 255];
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(it[1], x + 12, y + 40);
    });

    const tableY = startY + 3 * (cardH + 8) + 12;
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Movimentações do período", 40, tableY);

    autoTable(doc, {
      startY: tableY + 10,
      head: [["Data", "Tipo", "Descrição", "Valor"]],
      body: report.movs.map(m => [
        formatDateBR(m.when),
        m.kind === "venda" ? "Venda"
          : m.kind === "retirada" ? "Retirada"
          : m.kind === "pagamento" ? "Pagam. comissão"
          : "Ajuste comissão",
        m.label,
        (m.kind === "pagamento" ? "− " : m.kind === "venda" || m.kind === "ajuste" ? "+ " : "− ") + fmt(m.amount),
      ]),
      theme: "plain",
      styles: { fontSize: 9, textColor: [220, 220, 230], cellPadding: 6 },
      headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [24, 24, 30] },
      bodyStyles: { fillColor: [18, 18, 22] },
      columnStyles: { 3: { halign: "right", font: "courier" } },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        const ph = doc.internal.pageSize.getHeight();
        const pw = doc.internal.pageSize.getWidth();
        doc.setFillColor(15, 15, 18);
        doc.rect(0, 0, pw, ph, "F");
        // re-add bar
        doc.setFillColor(124, 58, 237); doc.rect(0, 0, pw, 6, "F");
        // footer
        doc.setTextColor(120, 120, 130); doc.setFontSize(8);
        doc.text("California · Relatório gerado pelo sistema", 40, ph - 20);
      },
    });

    doc.save(`relatorio_${seller.name.replace(/\s+/g, "_")}_${format(new Date(), "yyyyMMdd")}.pdf`);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Relatório do Funcionário</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Period filter */}
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Período</Label>
            <Select value={periodKey} onValueChange={(v: PeriodKey) => setPeriodKey(v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="month">Este mês</SelectItem>
                <SelectItem value="lastMonth">Mês passado</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {periodKey === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px]">Início</Label><Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-9" /></div>
                <div><Label className="text-[10px]">Fim</Label><Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-9" /></div>
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="rounded-lg bg-secondary/50 p-3">
            <p className="text-sm font-semibold">{seller.name}</p>
            <p className="text-[11px] text-muted-foreground">{label} · faixa {report.tier.label}</p>
          </div>

          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Unidades" value={String(report.units)} />
            <Stat label="Faturamento" value={fmt(report.revenue)} tone="income" />
            <Stat label="Recebido" value={fmt(report.received)} tone="income" />
            <Stat label="Em aberto" value={fmt(report.open)} tone="warning" />
            <Stat label="Consumo" value={fmt(report.consumo)} tone="warning" />
            <Stat label="Comissão" value={fmt(report.accrued)} tone="income" />
            <Stat label="Comissão paga" value={fmt(report.commPaidPeriod)} tone="warning" />
            <Stat label="Saldo comissão" value={fmt(report.commBalance)} strong
              tone={report.commBalance >= 0 ? "income" : "expense"} />
          </div>

          {/* Export buttons */}
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={exportPdf}>
              <FileText size={14} className="mr-1.5" /> PDF
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={exportXlsx}>
              <FileSpreadsheet size={14} className="mr-1.5" /> Excel
            </Button>
            <Button size="sm" className="h-9 bg-green-600 hover:bg-green-700 text-white" onClick={shareWhats}>
              <MessageCircle size={14} className="mr-1.5" /> WhatsApp
            </Button>
          </div>

          {/* Movements */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Movimentações</p>
            {report.movs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sem movimentações no período.</p>
            ) : (
              <div className="space-y-1">
                {report.movs.map((m, i) => {
                  const credit = m.kind === "venda" || m.kind === "ajuste";
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                        m.kind === "venda" && "bg-income/15 text-income",
                        m.kind === "retirada" && "bg-warning/15 text-warning",
                        m.kind === "pagamento" && "bg-fixed/15 text-fixed",
                        m.kind === "ajuste" && "bg-primary/15 text-primary",
                      )}>
                        {m.kind === "retirada" ? <Package size={13} /> :
                          credit ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.label}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          <span className="mono">{formatDateBR(m.when)}</span>
                          {"sub" in m && m.sub ? ` · ${m.sub}` : ""}
                        </p>
                      </div>
                      <span className={cn("mono text-sm font-semibold shrink-0",
                        credit ? "text-income" : "text-warning")}>
                        {credit ? "+" : "−"}{fmt(m.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: "income" | "warning" | "expense"; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-0.5 text-sm mono truncate",
        strong && "font-bold text-base",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning",
        tone === "expense" && "text-expense",
      )}>{value}</p>
    </div>
  );
}
