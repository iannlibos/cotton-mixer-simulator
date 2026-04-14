import { jsPDF } from "jspdf";
import "jspdf-autotable";
import type { Lot, MixParams } from "@/domain/stock";
import { PARAMS, buildDefaultThresholds, type Thresholds } from "@/domain/types";
import {
  computeSeqParams,
  fmtBRL,
  iqColor,
  seqParamOk,
  type SeqBale,
  type SeqSide,
} from "@/engine/sequencer";
import { fmtParam } from "@/utils/paramFormat";

declare module "jspdf" {
  interface jsPDF {
    lastAutoTable: { finalY: number };
    autoTable: (options: unknown) => jsPDF;
  }
}

export function buildPDF(
  name: string,
  date: string,
  params: MixParams,
  lots: Lot[],
  thresholds: Thresholds
): jsPDF {
  const doc = new jsPDF("landscape", "mm", "a4");
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(11, 15, 26);
  doc.rect(0, 0, w, 28, "F");
  doc.setTextColor(34, 211, 238);
  doc.setFontSize(9);
  doc.text("SANTANA TEXTILES · GERADOR DE MISTURAS", 14, 12);
  doc.setTextColor(232, 234, 240);
  doc.setFontSize(16);
  doc.setFont(undefined as never, "bold");
  doc.text(name, 14, 22);
  doc.setFontSize(9);
  doc.setFont(undefined as never, "normal");
  doc.setTextColor(154, 161, 185);
  doc.text(
    `${date}  |  ${lots.length} lotes  |  ${params.bales} fardos  |  ${params.weight.toFixed(2)} ton`,
    w - 14,
    22,
    { align: "right" }
  );

  let y = 36;
  doc.setFontSize(10);
  doc.setTextColor(34, 211, 238);
  doc.setFont(undefined as never, "bold");
  doc.text("PARÂMETROS", 14, y);
  y += 7;

  doc.autoTable({
    startY: y,
    head: [["Parâmetro", "Valor", "Mín", "Máx", "Status"]],
    body: PARAMS.filter((p) => p.key !== "mat").map((p) => {
      const v = params[p.key as keyof MixParams];
      const t = thresholds[p.key] || { min: 0, max: 1 };
      return [p.label, v.toFixed(p.prec), t.min, t.max, v >= t.min && v <= t.max ? "OK" : "FORA"];
    }),
    theme: "grid",
  });

  y = doc.lastAutoTable.finalY + 10;
  doc.text("COMPOSIÇÃO", 14, y);
  y += 5;

  const tw = params.weight;
  const sortedLots = [...lots].sort((a, b) => (b.allocWeight || 0) - (a.allocWeight || 0));
  doc.autoTable({
    startY: y,
    head: [["Produtor", "Lote", "Fardos", "Peso (ton)", "%", "UHML (mm)", "STR", "ELG", "UI", "MIC", "SF", "MST", "SCI"]],
    body: sortedLots.map((l) => [
      l.produtor,
      l.lote,
      l.allocBales,
      (l.allocWeight || 0).toFixed(2),
      ((l.allocWeight || 0) / tw * 100).toFixed(1) + "%",
      fmtParam("uhml", l.uhml),
      fmtParam("str_val", l.str_val),
      fmtParam("elg", l.elg),
      fmtParam("ui", l.ui),
      fmtParam("mic", l.mic),
      fmtParam("sf", l.sf),
      fmtParam("mst", l.mst),
      fmtParam("sci", l.sci),
    ]),
    theme: "grid",
  });

  return doc;
}

export interface BuildSeqPdfInput {
  mixName: string;
  params: MixParams;
  lots: Lot[];
  seqWeightKg: number;
  baleWtKg: number;
  sequences: SeqSide[];
  /** Para cores OK/fora nos parâmetros (igual à tela). */
  thresholds?: Thresholds;
  bps?: number;
  used?: number;
  dropped?: number;
  totalBales?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function iqRgb(iq: number): [number, number, number] {
  return hexToRgb(iqColor(iq));
}

function truncateLote(lote: string, maxChars: number): string {
  if (lote.length <= maxChars) return lote;
  return lote.slice(0, Math.max(0, maxChars - 1)) + "…";
}

/** Fardos empilhados verticalmente (ordem: topo = primeiro da sequência). */
function drawBaleColumn(
  doc: jsPDF,
  yStart: number,
  x: number,
  colW: number,
  bales: SeqBale[],
  gapV: number,
  boxH: number,
): number {
  const n = bales.length;
  if (!n) return yStart;
  const fontLote = boxH >= 12 ? 7 : boxH >= 9 ? 6.5 : boxH >= 7 ? 6 : 5;
  const fontProd = Math.max(3.8, fontLote - 1.6);
  const fontIq = Math.max(4.5, fontLote - 1);
  const maxLoteChars = colW >= 28 ? 16 : colW >= 20 ? 12 : 8;
  const maxProdChars = maxLoteChars + 4;
  for (let i = 0; i < n; i++) {
    const y = yStart + i * (boxH + gapV);
    const b = bales[i];
    const [r, g, b_] = iqRgb(b.iq);
    doc.setFillColor(r, g, b_);
    doc.roundedRect(x, y, colW, boxH, 0.8, 0.8, "F");
    doc.setDrawColor(20, 25, 35);
    doc.setLineWidth(0.15);
    doc.roundedRect(x, y, colW, boxH, 0.8, 0.8, "S");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontLote);
    const lote = truncateLote(b.lote, maxLoteChars);
    doc.text(lote, x + colW / 2, y + boxH * 0.30, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontProd);
    doc.text(truncateLote(b.produtor, maxProdChars), x + colW / 2, y + boxH * 0.54, { align: "center" });
    doc.setFontSize(fontIq);
    doc.text(String(Math.round(b.iq)), x + colW / 2, y + boxH * 0.80, { align: "center" });
  }
  return yStart + n * (boxH + gapV) - gapV;
}

function drawQualityChips(
  doc: jsPDF,
  ix: number,
  cy: number,
  innerW: number,
  sp: Record<string, number>,
  thresholds: Thresholds,
): number {
  const paramKeys = ["uhml", "str_val", "elg", "ui", "mic", "sf", "mst"] as const;
  const chipGap = 3;
  const chipW = (innerW - 3 * chipGap) / 4;
  const chipH = 11;
  const chips: { label: string; val: string; ok: boolean | null }[] = [
    ...paramKeys.map((k) => {
      const p = PARAMS.find((x) => x.key === k)!;
      const v = (sp[k] as number) || 0;
      return {
        label: p.label.toUpperCase(),
        val: v.toFixed(p.prec),
        ok: seqParamOk(k, v, thresholds),
      };
    }),
    { label: "R$/TON", val: fmtBRL(sp.custo || 0), ok: null },
  ];
  chips.forEach((c, i) => {
    const col = i % 4;
    const px = ix + col * (chipW + chipGap);
    const py = cy + Math.floor(i / 4) * (chipH + chipGap);
    doc.setFillColor(19, 24, 37);
    doc.setDrawColor(48, 56, 78);
    doc.roundedRect(px, py, chipW, chipH, 1, 1, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(180, 188, 210);
    doc.text(c.label, px + chipW / 2, py + 3.5, { align: "center" });
    doc.setFontSize(c.ok === null ? 6.5 : 8);
    if (c.ok === null) doc.setTextColor(34, 211, 238);
    else doc.setTextColor(c.ok ? 52 : 239, c.ok ? 211 : 68, c.ok ? 153 : 68);
    doc.text(c.val, px + chipW / 2, py + 9, { align: "center" });
  });
  const rows = Math.ceil(chips.length / 4);
  return cy + rows * chipH + (rows - 1) * chipGap + 4;
}

function drawSeqFooter(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  m: number,
  pageNum: number,
  totalPages: number,
  shortHint?: string,
) {
  doc.setFontSize(6);
  doc.setTextColor(72, 78, 95);
  doc.setFont("helvetica", "normal");
  const ts = new Date().toLocaleString("pt-BR");
  const base =
    (shortHint ? shortHint + " · " : "") +
    "Santana Textiles · " +
    ts +
    " · " +
    pageNum +
    "/" +
    totalPages;
  const lines = doc.splitTextToSize(base, pageW - 2 * m);
  doc.text(lines, m, pageH - 4 - Math.max(0, lines.length - 1) * 2.2);
}

function drawSummaryStrip(doc: jsPDF, pageW: number, m: number, subtitle: string) {
  doc.setFillColor(11, 15, 26);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(34, 211, 238);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("SANTANA TEXTILES · PLANEJADOR DE SEQUÊNCIAS", m, 10);
  doc.setTextColor(232, 234, 240);
  doc.setFontSize(14);
  doc.text(subtitle, m, 19);
}

/** Página 1: resumo. Páginas seguintes: uma sequência por página (A4 retrato), fardos grandes como na tela. */
export function buildSeqPDF(input: BuildSeqPdfInput): jsPDF {
  const { mixName, params, lots, seqWeightKg, baleWtKg, sequences } = input;
  const thresholds = input.thresholds ?? buildDefaultThresholds();
  const bps = input.bps ?? 0;
  const used = input.used ?? 0;
  const dropped = input.dropped ?? 0;
  const totalBales = input.totalBales ?? params.bales ?? 0;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const m = 14;
  let pageW = doc.internal.pageSize.getWidth();
  let pageH = doc.internal.pageSize.getHeight();

  drawSummaryStrip(doc, pageW, m, mixName || "Mistura");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(55, 62, 78);
  doc.text(
    `${params.weight != null ? Number(params.weight).toFixed(2) : "—"} t · ${params.bales != null ? params.bales : "—"} fardos · ${(baleWtKg || 0).toFixed(1)} kg/fardo · alvo ${seqWeightKg} kg/seq`,
    m,
    25,
  );

  let y = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(34, 211, 238);
  doc.text("Resumo", m, y);
  y += 7;

  const bwk = baleWtKg || 213;
  const nSeq = sequences.length;
  const kpi: { label: string; value: string; accent?: boolean }[] = [
    { label: "Sequências", value: String(nSeq) },
    { label: "Fardos/seq", value: bps > 0 ? String(bps) : "—" },
    { label: "Peso/seq", value: bps > 0 ? `${(bps * bwk).toFixed(0)} kg` : "—" },
    { label: "Peso fardo", value: `${bwk.toFixed(1)} kg` },
    {
      label: "Fardos (uso)",
      value: totalBales > 0 ? `${used}/${totalBales}` : String(used),
      accent: dropped > 0,
    },
  ];
  const gapK = 4;
  const kpiW = (pageW - 2 * m - gapK * (kpi.length - 1)) / kpi.length;
  kpi.forEach((k, i) => {
    const x = m + i * (kpiW + gapK);
    doc.setFillColor(26, 32, 53);
    doc.setDrawColor(48, 56, 78);
    doc.roundedRect(x, y, kpiW, 18, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(120, 128, 160);
    doc.text(k.label.toUpperCase(), x + kpiW / 2, y + 5, { align: "center" });
    doc.setFontSize(11);
    doc.setTextColor(k.accent ? 251 : 34, k.accent ? 191 : 211, k.accent ? 36 : 238);
    doc.text(k.value, x + kpiW / 2, y + 13, { align: "center" });
  });
  y += 24;

  if (dropped > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(251, 191, 36);
    doc.text(`${dropped} fardo(s) não usados para manter sequências pares.`, m, y);
    y += 5;
  }

  const legendItems: { hex: string; label: string }[] = [
    { hex: "#10b981", label: "≥75 Excelente" },
    { hex: "#22d3ee", label: "55–74 Bom" },
    { hex: "#fbbf24", label: "35–54 Regular" },
    { hex: "#ef4444", label: "<35 Fraco" },
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(28, 32, 42);
  doc.text("Cor do fardo = IQ (igual à tela)", m, y);
  y += 5;
  let lx = m;
  for (const it of legendItems) {
    const [r, g, b] = hexToRgb(it.hex);
    doc.setFillColor(r, g, b);
    doc.rect(lx, y - 2.5, 3.2, 3.2, "F");
    doc.setTextColor(55, 60, 72);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(it.label, lx + 5, y);
    lx += 42;
  }
  y += 10;

  const pLotsRef: Record<string, string[]> = {};
  lots.forEach((l) => {
    if (!pLotsRef[l.produtor]) pLotsRef[l.produtor] = [];
    if (!pLotsRef[l.produtor].includes(l.lote)) pLotsRef[l.produtor].push(l.lote);
  });
  const prodRows = Object.entries(pLotsRef)
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
    .map(([p, ls]) => [
      p,
      [...ls]
        .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }))
        .join(", "),
    ]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(28, 32, 42);
  doc.text("Produtores e lotes nesta mistura", m, y);
  y += 5;

  doc.autoTable({
    startY: y,
    head: [["Produtor", "Lotes"]],
    body: prodRows,
    theme: "grid",
    headStyles: {
      fillColor: [26, 32, 53],
      textColor: [232, 234, 240],
      fontSize: 7,
      cellPadding: 2,
      lineColor: [55, 65, 95],
      lineWidth: 0.15,
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [232, 234, 240],
      cellPadding: 1.8,
      fillColor: [22, 28, 42],
      lineColor: [55, 65, 95],
      lineWidth: 0.1,
    },
    alternateRowStyles: { fillColor: [28, 34, 50], textColor: [232, 234, 240] },
    styles: { valign: "middle" },
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: pageW - m * 2 - 40 } },
    margin: { left: m, right: m },
    tableLineColor: [55, 65, 95],
    tableLineWidth: 0.1,
  });

  sequences.forEach((seq, si) => {
    doc.addPage("a4", "p");
    pageW = doc.internal.pageSize.getWidth();
    pageH = doc.internal.pageSize.getHeight();

    doc.setFillColor(11, 15, 26);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setTextColor(34, 211, 238);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("SANTANA TEXTILES · PLANEJADOR DE SEQUÊNCIAS", m, 8);
    doc.setTextColor(200, 205, 220);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`${mixName || "Mistura"} · seq. ${si + 1} de ${sequences.length}`, m, 14);
    doc.setTextColor(232, 234, 240);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Sequência ${si + 1}`, m, 20);

    const innerW = pageW - 2 * m;
    const ix = m;
    const bottomReserve = 16;
    const gapV = 1.2;

    const all = [...seq.a, ...seq.b];
    const n = all.length;
    const wt = n * bwk;
    const sp = computeSeqParams(all);
    const iqMed = sp.iq ?? 0;
    const isRestante = bps > 0 && n < bps * 0.8;
    const prds = new Set(all.map((b) => b.produtor)).size;
    const lts = new Set(all.map((b) => b.lote)).size;

    let cy = 24;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(28, 32, 42);
    doc.text("Qualidade média da sequência", ix, cy);
    cy += 5;
    cy = drawQualityChips(doc, ix, cy, innerW, sp, thresholds);

    const metaRowTop = cy;
    const metaRowH = 12;
    const badgeW = 40;
    const badgeH = 10;
    const badgeX = pageW - m - badgeW;
    const badgeY = metaRowTop + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(38, 42, 52);
    let sub = `${n} fardos · ${wt.toFixed(0)} kg · ${prds} prod. · ${lts} lotes`;
    if (isRestante) sub += " · RESTANTE";
    const subMaxW = badgeX - ix - 4;
    const subLines = doc.splitTextToSize(sub, subMaxW);
    doc.text(subLines, ix, metaRowTop + 6);

    const [ir, ig, ib] = iqRgb(iqMed);
    doc.setFillColor(ir, ig, ib);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.4, 1.4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`IQ ${iqMed.toFixed(0)}`, badgeX + badgeW / 2, badgeY + badgeH / 2 + 2.2, { align: "center" });

    cy = metaRowTop + Math.max(metaRowH, subLines.length * 4.2) + 4;

    const gutter = 6;
    const colW = (innerW - gutter) / 2;
    const maxN = Math.max(seq.a.length, seq.b.length, 1);

    const labelY = cy;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(32, 36, 48);
    doc.text(`LADO A (${seq.a.length})`, ix + colW / 2, labelY, { align: "center" });
    doc.text(`LADO B (${seq.b.length})`, ix + colW + gutter + colW / 2, labelY, { align: "center" });

    const yStacks = labelY + 5;
    const availH = pageH - m - bottomReserve - yStacks;
    let boxH = (availH - Math.max(0, maxN - 1) * gapV) / maxN;
    boxH = Math.min(14, Math.max(5, boxH));

    const stackH = maxN > 0 ? maxN * (boxH + gapV) - gapV : 0;
    const midX = ix + colW + gutter / 2;
    doc.setDrawColor(90, 98, 120);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2, 3], 0);
    doc.line(midX, yStacks, midX, yStacks + stackH);
    doc.setLineDashPattern([], 0);

    drawBaleColumn(doc, yStacks, ix, colW, seq.a, gapV, boxH);
    drawBaleColumn(doc, yStacks, ix + colW + gutter, colW, seq.b, gapV, boxH);
  });

  const totalPages = doc.getNumberOfPages();
  for (let pi = 1; pi <= totalPages; pi++) {
    doc.setPage(pi);
    pageW = doc.internal.pageSize.getWidth();
    pageH = doc.internal.pageSize.getHeight();
    const hint = pi === 1 ? "Resumo" : "Colunas A|B · ordem vertical cima→baixo";
    drawSeqFooter(doc, pageW, pageH, m, pi, totalPages, hint);
  }

  return doc;
}
