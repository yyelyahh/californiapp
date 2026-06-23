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
import { FileText, FileSpreadsheet, MessageCircle, ArrowUpCircle, ArrowDownCircle, Package, Boxes } from "lucide-react";
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
  const { sellers, sales, commissionPayments, productAssignments, products, getProductName } = useStore();
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
    const consumoUnits = retiradas.reduce((a, s) => a + s.quantity, 0);

    // Group consumption by product
    const consumoMap = new Map<string, { name: string; qty: number; total: number }>();
    retiradas.forEach(s => {
      const cur = consumoMap.get(s.productId) || { name: getProductName(s.productId), qty: 0, total: 0 };
      cur.qty += s.quantity; cur.total += s.totalPrice;
      consumoMap.set(s.productId, cur);
    });
    const consumoBreakdown = Array.from(consumoMap.values()).sort((a, b) => b.total - a.total);

    // Sales detail
    const salesDetail = [...vendas].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(s => {
      const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      return {
        id: s.id, when: s.date, qty: s.quantity, total: s.totalPrice,
        name: getProductName(s.productId), open: op, paid: op < 0.01,
      };
    });

    // Current stock assigned to seller
    const stockItems = productAssignments
      .filter(a => a.sellerId === seller.id && a.quantity > 0)
      .map(a => {
        const p = products.find(pp => pp.id === a.productId);
        return { id: a.id, name: getProductName(a.productId), qty: a.quantity, brand: p?.brand || "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const stockTotalUnits = stockItems.reduce((acc, i) => acc + i.qty, 0);

    const c = computeSellerCommission(vendas);
    const adjustments = computeAccrualAdjustments(vendas);
    const commPaidPeriod = commissionPayments
      .filter(p => p.sellerId === seller.id && inPeriod(p.date))
      .reduce((a, p) => a + p.amount, 0);
    // Saldo = acumulada - consumo - pago
    const commBalance = c.accrued - consumo - commPaidPeriod;

    type Mov =
      | { kind: "venda"; when: string; label: string; amount: number; sub: string }
      | { kind: "retirada"; when: string; label: string; amount: number; sub: string }
      | { kind: "pagamento"; when: string; label: string; amount: number; sub?: string }
      | { kind: "ajuste"; when: string; label: string; amount: number; sub?: string };

    const movs: Mov[] = [];
    vendas.forEach(s => {
      const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      movs.push({
        kind: "venda", when: s.date,
        label: `${s.quantity}x ${getProductName(s.productId)}`,
        amount: s.totalPrice,
        sub: `Recebido ${fmt(s.paidAmount || 0)} · Em aberto ${fmt(op)}`,
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
      units, revenue, received, open, consumo, consumoUnits, consumoBreakdown,
      salesDetail, stockItems, stockTotalUnits,
      tier: c.tier, accrued: c.accrued, commPaidPeriod, commBalance, movs,
    };
  }, [seller, sales, commissionPayments, productAssignments, products, start, end, getProductName]);

  if (!seller || !report) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }

  /* ---------- Export: WhatsApp ---------- */
  const buildWhats = () => {
    const lines: string[] = [];
    lines.push(`📊 Relatório de ${label}`);
    lines.push(``);
    lines.push(`👤 Funcionário: ${seller.name}`);
    lines.push(``);
    lines.push(`📦 Vendas`);
    lines.push(`• Unidades vendidas: ${report.units}`);
    lines.push(`• Valor em aberto: ${fmt(report.open)}`);
    if (report.salesDetail.length) {
      lines.push(``);
      lines.push(`Vendas realizadas:`);
      report.salesDetail.forEach(s => {
        const dt = format(parseISO(s.when), "dd/MM");
        const status = s.paid ? "Recebido" : `Em aberto • ${fmt(s.open)}`;
        lines.push(`• ${dt} • ${s.qty}x ${s.name} • ${status}`);
      });
    }
    lines.push(``);
    lines.push(`🍃 Consumo`);
    lines.push(`• Total consumido: ${fmt(report.consumo)}`);
    if (report.consumoBreakdown.length) {
      lines.push(``);
      lines.push(`Produtos consumidos:`);
      report.consumoBreakdown.forEach(c => {
        lines.push(`• ${c.name} (${c.qty}x) • ${fmt(c.total)}`);
      });
    }
    lines.push(``);
    lines.push(`💰 Comissão`);
    lines.push(`• Faixa atual: ${report.tier.label}`);
    lines.push(`• Comissão no período: ${fmt(report.accrued)}`);
    lines.push(`• Consumo descontado: ${fmt(report.consumo)}`);
    lines.push(`• Comissão paga: ${fmt(report.commPaidPeriod)}`);
    lines.push(`• Saldo disponível: ${fmt(report.commBalance)}`);
    lines.push(``);
    lines.push(`Cálculo: ${fmt(report.accrued)} − ${fmt(report.consumo)} (consumo) − ${fmt(report.commPaidPeriod)} (pagamentos) = ${fmt(report.commBalance)}`);
    lines.push(``);
    lines.push(`📦 Estoque atual`);
    if (report.stockItems.length === 0) {
      lines.push(`• Sem produtos em posse`);
    } else {
      report.stockItems.forEach(s => {
        lines.push(`• ${s.name} (${s.qty}x)`);
      });
      lines.push(``);
      lines.push(`Total em estoque: ${report.stockTotalUnits} unidades`);
    }
    return lines.join("\n");
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
      ["Consumo / Retiradas (valor)", report.consumo],
      ["Consumo / Retiradas (unidades)", report.consumoUnits],
      [],
      ["Faixa atual", report.tier.label],
      ["Comissão acumulada", report.accrued],
      ["Consumo descontado", report.consumo],
      ["Comissão paga (período)", report.commPaidPeriod],
      ["Saldo de comissão", report.commBalance],
      [],
      ["Estoque atual (unidades)", report.stockTotalUnits],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Resumo");

    const salesRows = [
      ["Data", "Qtd", "Produto", "Valor total", "Recebido?", "Em aberto"],
      ...report.salesDetail.map(s => [
        formatDateBR(s.when), s.qty, s.name, s.total, s.paid ? "Sim" : "Não", s.open,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesRows), "Vendas");

    const consumoRows = [
      ["Produto", "Qtd", "Valor"],
      ...report.consumoBreakdown.map(c => [c.name, c.qty, c.total]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(consumoRows), "Consumo");

    const stockRows = [
      ["Produto", "Qtd"],
      ...report.stockItems.map(s => [s.name, s.qty]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stockRows), "Estoque atual");

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

  /* ---------- Export: PDF ---------- */
  const exportPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const w = doc.internal.pageSize.getWidth();

    const PURPLE: [number, number, number] = [124, 58, 237];
    const INK: [number, number, number] = [24, 24, 27];
    const MUTED: [number, number, number] = [113, 113, 122];
    const BORDER: [number, number, number] = [228, 228, 231];
    const SOFT: [number, number, number] = [248, 248, 250];
    const GREEN: [number, number, number] = [22, 163, 74];
    const AMBER: [number, number, number] = [202, 138, 4];
    const RED: [number, number, number] = [220, 38, 38];

    doc.setFillColor(...PURPLE); doc.rect(0, 0, w, 6, "F");

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text("CALIFORNIA", 40, 50);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text("Relatório do Funcionário", 40, 66);
    doc.setFontSize(9);
    doc.text(`Emitido em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, w - 40, 50, { align: "right" });

    doc.setFillColor(...SOFT);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(40, 90, w - 80, 60, 8, 8, "FD");
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(seller.name, 56, 115);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text(`Período: ${label}`, 56, 134);

    const startY = 170;
    const items: [string, string, [number, number, number]?][] = [
      ["Unidades vendidas", String(report.units), INK],
      ["Faturamento", fmt(report.revenue), GREEN],
      ["Em aberto", fmt(report.open), AMBER],
      ["Consumo (valor)", fmt(report.consumo), AMBER],
      ["Consumo (unid.)", String(report.consumoUnits), AMBER],
      ["Estoque atual", `${report.stockTotalUnits} un.`, PURPLE],
      ["Faixa atual", report.tier.label, PURPLE],
      ["Comissão acumulada", fmt(report.accrued), GREEN],
      ["Saldo disponível", fmt(report.commBalance), report.commBalance >= 0 ? GREEN : RED],
    ];
    const cardW = (w - 80 - 16) / 3; const cardH = 56;
    items.forEach((it, i) => {
      const col = i % 3; const row = Math.floor(i / 3);
      const x = 40 + col * (cardW + 8);
      const y = startY + row * (cardH + 8);
      doc.setFillColor(...SOFT); doc.setDrawColor(...BORDER);
      doc.roundedRect(x, y, cardW, cardH, 6, 6, "FD");
      doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(it[0].toUpperCase(), x + 12, y + 18);
      const color = it[2] || INK;
      doc.setTextColor(...color);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(it[1], x + 12, y + 40);
    });

    let cursorY = startY + 3 * (cardH + 8) + 12;

    // Commission breakdown line
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(
      `Cálculo do saldo: ${fmt(report.accrued)} − ${fmt(report.consumo)} (consumo) − ${fmt(report.commPaidPeriod)} (pagamentos) = ${fmt(report.commBalance)}`,
      40, cursorY,
    );
    cursorY += 18;

    const sectionHeader = (title: string) => {
      doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text(title, 40, cursorY);
      cursorY += 6;
    };

    const drawTable = (head: string[][], body: any[][], rightCols: number[] = []) => {
      autoTable(doc, {
        startY: cursorY + 6,
        head, body,
        theme: "grid",
        styles: { fontSize: 9, textColor: INK, cellPadding: 6, lineColor: BORDER, lineWidth: 0.5 },
        headStyles: { fillColor: PURPLE, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: SOFT },
        bodyStyles: { fillColor: [255, 255, 255] },
        columnStyles: rightCols.reduce((acc, c) => ({ ...acc, [c]: { halign: "right", font: "courier", fontStyle: "bold" } }), {}),
        margin: { left: 40, right: 40, top: 40 },
        didDrawPage: () => {
          const pw = doc.internal.pageSize.getWidth();
          const ph = doc.internal.pageSize.getHeight();
          doc.setFillColor(...PURPLE); doc.rect(0, 0, pw, 6, "F");
          doc.setTextColor(...MUTED); doc.setFontSize(8); doc.setFont("helvetica", "normal");
          doc.text("California · Relatório gerado pelo sistema", 40, ph - 20);
        },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 16;
    };

    sectionHeader("Vendas do período");
    if (report.salesDetail.length === 0) {
      doc.setTextColor(...MUTED); doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text("Sem vendas no período.", 40, cursorY + 12); cursorY += 24;
    } else {
      drawTable(
        [["Data", "Qtd", "Produto", "Valor", "Status"]],
        report.salesDetail.map(s => [
          formatDateBR(s.when), s.qty, s.name, fmt(s.total),
          s.paid ? "Recebido" : `Em aberto ${fmt(s.open)}`,
        ]),
        [3],
      );
    }

    sectionHeader("Consumo / Retiradas");
    if (report.consumoBreakdown.length === 0) {
      doc.setTextColor(...MUTED); doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text("Sem consumo no período.", 40, cursorY + 12); cursorY += 24;
    } else {
      drawTable(
        [["Produto", "Qtd", "Valor"]],
        [
          ...report.consumoBreakdown.map(c => [c.name, c.qty, fmt(c.total)]),
          [{ content: "Total", styles: { fontStyle: "bold" } }, { content: report.consumoUnits, styles: { fontStyle: "bold" } }, { content: fmt(report.consumo), styles: { fontStyle: "bold" } }],
        ],
        [2],
      );
    }

    sectionHeader("Estoque atual em posse do vendedor");
    if (report.stockItems.length === 0) {
      doc.setTextColor(...MUTED); doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text("Sem produtos atribuídos.", 40, cursorY + 12); cursorY += 24;
    } else {
      drawTable(
        [["Produto", "Qtd"]],
        [
          ...report.stockItems.map(s => [s.name, s.qty]),
          [{ content: "Total em estoque", styles: { fontStyle: "bold" } }, { content: `${report.stockTotalUnits} un.`, styles: { fontStyle: "bold" } }],
        ],
        [1],
      );
    }

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
            <Stat label="Em aberto" value={fmt(report.open)} tone="warning" />
            <Stat label="Consumo" value={fmt(report.consumo)} tone="warning" />
            <Stat label="Comissão" value={fmt(report.accrued)} tone="income" />
            <Stat label="Paga" value={fmt(report.commPaidPeriod)} tone="warning" />
            <Stat label="Saldo" value={fmt(report.commBalance)} strong
              tone={report.commBalance >= 0 ? "income" : "expense"} />
            <Stat label="Estoque" value={`${report.stockTotalUnits} un.`} />
          </div>

          {/* Commission calc note */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Saldo:</span>{" "}
            {fmt(report.accrued)} − {fmt(report.consumo)} (consumo) − {fmt(report.commPaidPeriod)} (pagamentos) ={" "}
            <span className={cn(report.commBalance >= 0 ? "text-income" : "text-expense", "font-semibold")}>{fmt(report.commBalance)}</span>
          </p>

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

          {/* Consumption breakdown */}
          {report.consumoBreakdown.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Consumo no período</p>
              <div className="space-y-1">
                {report.consumoBreakdown.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">Qtd: {c.qty}</p>
                    </div>
                    <span className="mono text-sm font-semibold text-warning">{fmt(c.total)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  <span>Total consumido</span>
                  <span className="mono text-warning">{fmt(report.consumo)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Current stock */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
              <Boxes size={12} /> Estoque atual do vendedor
            </p>
            {report.stockItems.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sem produtos atribuídos.</p>
            ) : (
              <div className="space-y-1">
                {report.stockItems.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <span className="mono text-sm font-semibold text-primary">{s.qty}x</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  <span>Total em posse</span>
                  <span className="mono text-primary">{report.stockTotalUnits} unidades</span>
                </div>
              </div>
            )}
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
