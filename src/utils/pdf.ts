import { jsPDF } from "jspdf";
import "jspdf-autotable";
import type { Lot, MixParams } from "@/domain/stock";
import {
  BALE_G_LENGTH_M,
  BALE_P_LENGTH_M,
  BALE_WIDTH_M,
  OPENING_AREA_LENGTH_M,
  OPENING_AREA_WIDTH_M,
} from "@/domain/stock";
import { PARAMS, buildDefaultThresholds, type Thresholds } from "@/domain/types";
import {
  computeSeqParams,
  fmtBRL,
  seqParamOk,
  buildLayoutPlan,
  summarizeComposition,
  summarizeSequenceUsage,
  type SeqSide,
  type LayoutPlan,
} from "@/engine/sequencer";
import { fmtParam } from "@/utils/paramFormat";
import { fmtKgFromTons } from "@/utils/weight";

declare module "jspdf" {
  interface jsPDF {
    lastAutoTable: { finalY: number };
    autoTable: (options: unknown) => jsPDF;
  }
}

/* -------------------------------------------------------------------------- */
/*  Paleta de impressão P&B: fundo branco, texto escuro, cinzas nos fardos.   */
/* -------------------------------------------------------------------------- */

type RGB = [number, number, number];

const PAPER: RGB = [255, 255, 255];
const TINT: RGB = [244, 244, 244]; // fundo muito claro (linhas alternadas, headers leves)
const TINT2: RGB = [222, 222, 222]; // realces finos
const RULE: RGB = [170, 170, 170]; // linhas de grade claras
const RULE_DK: RGB = [60, 60, 60]; // linhas de grade fortes
const INK: RGB = [20, 20, 20]; // texto primário
const INK_SOFT: RGB = [70, 70, 70]; // texto secundário
const INK_MUTE: RGB = [120, 120, 120]; // labels discretos

function setFill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setDraw(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function setText(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

/**
 * Classificação do IQ em faixas com tonalidade monotônica (claro → escuro)
 * e letra-classe (E/B/R/F). Mantém distinção imediata sob preto e branco
 * mesmo quando tons vizinhos ficam parecidos na impressão.
 */
interface IQBand {
  letter: "E" | "B" | "R" | "F";
  label: string;
  /** Cor de preenchimento do fardo. */
  fill: RGB;
  /** Cor do texto sobre o fardo. */
  text: RGB;
  /** Cor da borda. */
  border: RGB;
  /** Espessura da borda em mm. */
  borderW: number;
}

function iqBand(iq: number): IQBand {
  if (iq >= 75)
    return {
      letter: "E",
      label: "Excelente (≥75)",
      fill: [255, 255, 255],
      text: [0, 0, 0],
      border: [0, 0, 0],
      borderW: 0.7,
    };
  if (iq >= 55)
    return {
      letter: "B",
      label: "Bom (55–74)",
      fill: [228, 228, 228],
      text: [0, 0, 0],
      border: [40, 40, 40],
      borderW: 0.3,
    };
  if (iq >= 35)
    return {
      letter: "R",
      label: "Regular (35–54)",
      fill: [162, 162, 162],
      text: [0, 0, 0],
      border: [40, 40, 40],
      borderW: 0.3,
    };
  return {
    letter: "F",
    label: "Fraco (<35)",
    fill: [68, 68, 68],
    text: [255, 255, 255],
    border: [0, 0, 0],
    borderW: 0.3,
  };
}

/**
 * Trunca `text` com reticências até caber em `maxWmm` na fonte atual. Usa o
 * `getTextWidth` do jsPDF, portanto depende da fonte/tamanho setados antes.
 */
function shrinkToWidth(doc: jsPDF, text: string, maxWmm: number): string {
  if (!text) return text;
  if (doc.getTextWidth(text) <= maxWmm) return text;
  let lo = 1;
  let hi = text.length;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = text.slice(0, mid) + "…";
    if (doc.getTextWidth(cand) <= maxWmm) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, Math.max(1, best)) + "…";
}

const fmt1 = (n: number) => n.toFixed(1).replace(".", ",");

/* -------------------------------------------------------------------------- */
/*  PDF "Gerador de misturas" (tela inicial)                                  */
/* -------------------------------------------------------------------------- */

export function buildPDF(
  name: string,
  date: string,
  params: MixParams,
  lots: Lot[],
  thresholds: Thresholds,
): jsPDF {
  const doc = new jsPDF("landscape", "mm", "a4");
  const w = doc.internal.pageSize.getWidth();

  drawDocHeader(doc, w, 14, "SANTANA TEXTILES · GERADOR DE MISTURAS", name, `${date}  ·  ${lots.length} lotes  ·  ${params.bales} fardos  ·  ${fmtKgFromTons(params.weight)} kg`);

  let y = 38;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text("PARÂMETROS", 14, y);
  y += 5;

  doc.autoTable({
    startY: y,
    head: [["Parâmetro", "Valor", "Mín", "Máx", "Status"]],
    body: PARAMS.filter((p) => p.key !== "mat").map((p) => {
      const v = params[p.key as keyof MixParams];
      const t = thresholds[p.key] || { min: 0, max: 1 };
      return [
        p.label,
        v.toFixed(p.prec),
        String(t.min),
        String(t.max),
        v >= t.min && v <= t.max ? "OK" : "FORA",
      ];
    }),
    ...lightTableStyles(),
    didParseCell: (data: unknown) => {
      const d = data as { section: string; column: { index: number }; cell: { styles: Record<string, unknown>; raw: string } };
      if (d.section === "body" && d.column.index === 4) {
        const fora = d.cell.raw === "FORA";
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.halign = "center";
        if (fora) {
          d.cell.styles.fillColor = INK;
          d.cell.styles.textColor = PAPER;
        }
      }
    },
  });

  y = doc.lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text("COMPOSIÇÃO", 14, y);
  y += 5;

  const tw = params.weight;
  const sortedLots = [...lots].sort((a, b) => (b.allocWeight || 0) - (a.allocWeight || 0));
  doc.autoTable({
    startY: y,
    head: [
      [
        "Produtor",
        "Lote",
        "Fardos",
        "Peso (kg)",
        "%",
        "UHML (mm)",
        "STR",
        "ELG",
        "UI",
        "MIC",
        "SF",
        "MST",
        "SCI",
      ],
    ],
    body: sortedLots.map((l) => [
      l.produtor,
      l.lote,
      l.allocBales,
      fmtKgFromTons(l.allocWeight || 0),
      (((l.allocWeight || 0) / tw) * 100).toFixed(1) + "%",
      fmtParam("uhml", l.uhml),
      fmtParam("str_val", l.str_val),
      fmtParam("elg", l.elg),
      fmtParam("ui", l.ui),
      fmtParam("mic", l.mic),
      fmtParam("sf", l.sf),
      fmtParam("mst", l.mst),
      fmtParam("sci", l.sci),
    ]),
    ...lightTableStyles(),
  });

  return doc;
}

/** Estilos compartilhados dos autoTables (tema claro, impressão P&B). */
function lightTableStyles() {
  return {
    theme: "grid" as const,
    headStyles: {
      fillColor: INK,
      textColor: PAPER,
      fontStyle: "bold" as const,
      fontSize: 8,
      cellPadding: 2,
      lineColor: INK,
      lineWidth: 0.2,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: INK,
      cellPadding: 1.8,
      fillColor: PAPER,
      lineColor: RULE,
      lineWidth: 0.1,
    },
    alternateRowStyles: { fillColor: TINT },
    styles: { valign: "middle" as const, font: "helvetica" as const },
    tableLineColor: RULE,
    tableLineWidth: 0.1,
  };
}

/**
 * Cabeçalho genérico de documento: faixa branca com título forte e regra
 * horizontal — sem blocos escuros que gastariam toner e ainda ofuscariam o
 * texto na impressão P&B.
 */
function drawDocHeader(doc: jsPDF, pageW: number, m: number, eyebrow: string, title: string, sub: string) {
  setFill(doc, PAPER);
  doc.rect(0, 0, pageW, 30, "F");
  setText(doc, INK_SOFT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(eyebrow, m, 9);
  setText(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, m, 18);
  setText(doc, INK_SOFT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(sub, m, 25);
  setDraw(doc, INK);
  doc.setLineWidth(0.5);
  doc.line(m, 30, pageW - m, 30);
}

/* -------------------------------------------------------------------------- */
/*  PDF "Sequências"                                                          */
/* -------------------------------------------------------------------------- */

export interface BuildSeqPdfInput {
  mixName: string;
  params: MixParams;
  lots: Lot[];
  seqWeightKg: number;
  baleWtKg: number;
  sequences: SeqSide[];
  layoutPlans?: LayoutPlan[];
  /** Para marcação OK/FORA nos parâmetros (igual à tela). */
  thresholds?: Thresholds;
  bps?: number;
  used?: number;
  dropped?: number;
  totalBales?: number;
}

/**
 * Decide pontos de corte (em metros no eixo X) para quebrar a pista em
 * `rows` linhas, snapando o corte para a borda mais próxima entre fardos —
 * de modo que nenhum fardo seja partido visualmente entre linhas.
 */
function computeRowCuts(plan: LayoutPlan, rows: number): number[] {
  if (rows <= 1) return [];
  const cuts: number[] = [];
  for (let r = 1; r < rows; r++) {
    const target = (r * plan.areaLength) / rows;
    const candidates: number[] = [target];
    plan.placements.forEach((p) => {
      candidates.push(p.x);
      candidates.push(p.x + p.w);
    });
    candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    let pick = target;
    for (const c of candidates) {
      if (c < 1e-6 || c > plan.areaLength - 1e-6) continue;
      const crosses = plan.placements.some(
        (p) => c > p.x + 1e-6 && c < p.x + p.w - 1e-6,
      );
      if (!crosses) {
        pick = c;
        break;
      }
    }
    cuts.push(pick);
  }
  return cuts;
}

/**
 * Desenha um fardo: preenchimento em escala de cinza da faixa de IQ, letra-
 * classe no canto, produtor/lote/tamanho·IQ centralizados com tamanho de
 * fonte dimensionado pela área do fardo. Todo texto passa por
 * `shrinkToWidth` para ser truncado com reticências apenas quando necessário.
 *
 * As fórmulas de fonte usam a conversão correta (1 pt ≈ 0,353 mm, leading
 * ~1,2): para N linhas em `ph` mm de altura disponível, a fonte máxima por
 * linha é aproximadamente `ph / N × 2`. Os coeficientes abaixo refletem isso
 * e aproveitam a área disponível — o código antigo tratava `ph` em mm como
 * cap em pt e travava tudo em 4–5 pt.
 */
function drawBale(
  doc: jsPDF,
  px: number,
  py: number,
  pw: number,
  ph: number,
  produtor: string,
  lote: string,
  iq: number,
  tamanho: string,
) {
  const band = iqBand(iq);
  setFill(doc, band.fill);
  setDraw(doc, band.border);
  doc.setLineWidth(Math.max(band.borderW, pw * 0.015));
  doc.rect(px, py, pw, ph, "FD");

  if (pw >= 6 && ph >= 5.5) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.min(8, ph * 0.14));
    setText(doc, band.text);
    doc.text(band.letter, px + 1.1, py + 3);
  }

  const pad = 0.85;
  const contentW = Math.max(2, pw - 2 * pad);
  setText(doc, band.text);

  // Fardos **transversais** (altos e estreitos: largura < altura e
  // largura útil típica ~13 mm) não comportam o produtor em linha única.
  // O nome do produtor é quebrado em **uma palavra por linha**, seguindo
  // de lote e tamanho · IQ. Aproveita-se toda a altura disponível e a
  // fonte é dimensionada pelo line-height resultante.
  const isTransversal = pw < ph && pw <= 22 && ph >= 18;

  if (isTransversal) {
    const words = produtor.trim().split(/\s+/).filter(Boolean);
    // Cap em 3 linhas de produtor — cobre virtualmente todos os nomes
    // (ex.: "JOSE ALMIR GORGEN"). Nomes com 4+ palavras concatenam o
    // excedente na última linha.
    const prodLines: string[] =
      words.length === 0
        ? [produtor]
        : words.length <= 3
          ? words
          : [words[0], words[1], words.slice(2).join(" ")];

    const infoLines: { text: string; bold: boolean; scale: number }[] = [
      ...prodLines.map((w) => ({ text: w, bold: true, scale: 0.92 })),
      { text: lote, bold: true, scale: 1.08 },
      { text: `${tamanho} · IQ ${Math.round(iq)}`, bold: false, scale: 0.82 },
    ];

    const topOffset = 4.2; // reserva p/ a letra-classe no canto
    const botOffset = 1.1;
    const availH = ph - topOffset - botOffset;
    const lineH = availH / infoLines.length;
    const basePt = Math.max(6.2, Math.min(10.2, lineH / 0.4));

    for (let i = 0; i < infoLines.length; i++) {
      const l = infoLines[i];
      const baseline = py + topOffset + (i + 0.72) * lineH;
      doc.setFont("helvetica", l.bold ? "bold" : "normal");
      doc.setFontSize(basePt * l.scale);
      doc.text(
        shrinkToWidth(doc, l.text, contentW),
        px + pw / 2,
        baseline,
        { align: "center" },
      );
    }
    return;
  }

  // Fardos longitudinais / quadrados: layout centralizado tradicional.
  const canFitThree = ph >= 17 && pw >= 8;
  const canFitTwo = ph >= 10 && pw >= 7;

  if (canFitThree) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(7.5, Math.min(14, ph * 0.38)));
    doc.text(
      shrinkToWidth(doc, produtor, contentW),
      px + pw / 2,
      py + ph * 0.3,
      { align: "center" },
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(9, Math.min(17, ph * 0.44)));
    doc.text(
      shrinkToWidth(doc, lote, contentW),
      px + pw / 2,
      py + ph * 0.56,
      { align: "center" },
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(6.8, Math.min(11, ph * 0.24)));
    doc.text(
      shrinkToWidth(doc, `${tamanho} · IQ ${Math.round(iq)}`, contentW),
      px + pw / 2,
      py + ph * 0.82,
      { align: "center" },
    );
  } else if (canFitTwo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(7.5, Math.min(13, ph * 0.52)));
    doc.text(
      shrinkToWidth(doc, produtor, contentW),
      px + pw / 2,
      py + ph * 0.38,
      { align: "center" },
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(8.5, Math.min(14, ph * 0.48)));
    doc.text(
      shrinkToWidth(
        doc,
        `${lote} · ${tamanho} · IQ ${Math.round(iq)}`,
        contentW,
      ),
      px + pw / 2,
      py + ph * 0.72,
      { align: "center" },
    );
  } else if (pw >= 5 && ph >= 4) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(7, Math.min(11, ph * 0.5)));
    doc.text(
      shrinkToWidth(doc, lote, contentW),
      px + pw / 2,
      py + ph * 0.42,
      { align: "center" },
    );
    doc.setFontSize(Math.max(6, Math.min(9, ph * 0.32)));
    doc.text(
      shrinkToWidth(doc, `${produtor} · ${tamanho}`, contentW),
      px + pw / 2,
      py + ph * 0.72,
      { align: "center" },
    );
  } else if (pw >= 4 && ph >= 3.5) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(7, Math.min(9, ph * 0.85)));
    doc.text(shrinkToWidth(doc, lote, contentW), px + pw / 2, py + ph / 2 + 0.8, { align: "center" });
  }
}

/**
 * Layout físico com a pista quebrada em `rows` linhas. Cada linha usa a
 * mesma escala (a linha mais longa ocupa toda a largura `w`), preservando
 * proporção real entre os fardos das duas linhas.
 */
function drawLayoutStripWrapped(
  doc: jsPDF,
  plan: LayoutPlan,
  x0: number,
  y0: number,
  w: number,
  rows: number,
  maxHeight?: number,
): number {
  const cuts = computeRowCuts(plan, rows);
  const bounds = [0, ...cuts, plan.areaLength];
  const rowLens = bounds.slice(1).map((e, i) => e - bounds[i]);
  const maxRowLen = Math.max(...rowLens);
  // Espaço entre linhas (inclui 1 mm visual + ~5 mm de ticks/rótulos). Valor
  // apertado o suficiente para caber 3 linhas de pista + cromos + rodapé em
  // A3 paisagem, mesmo nos modos com canvas estendido (endcaps de 2,32 m).
  const rowGap = 6;
  const widthScale = w / maxRowLen;
  const heightScale = maxHeight && maxHeight > 0
    ? Math.max(1, (maxHeight - (rows - 1) * rowGap - 5) / (rows * plan.canvasHeight))
    : widthScale;
  const scale = Math.min(widthScale, heightScale);
  const armH = plan.areaWidth * scale;
  const canvasH = plan.canvasHeight * scale;
  let yCur = y0;

  for (let r = 0; r < rows; r++) {
    const xStart = bounds[r];
    const xEnd = bounds[r + 1];
    const rowLen = xEnd - xStart;
    const rowW = rowLen * scale;
    const armTop = yCur + plan.armYOffset * scale;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, INK_SOFT);
    doc.text(
      `${fmt1(xStart)} m  →  ${fmt1(xEnd)} m`,
      x0,
      yCur - 2,
    );

    setFill(doc, TINT);
    setDraw(doc, RULE_DK);
    doc.setLineWidth(0.4);
    doc.roundedRect(x0, armTop, rowW, armH, 0.8, 0.8, "FD");

    setDraw(doc, RULE);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.4], 0);
    doc.line(x0, armTop + armH / 2, x0 + rowW, armTop + armH / 2);
    doc.setLineDashPattern([], 0);

    // Ticks do eixo X a cada 5 m, ancorados no grid absoluto da pista.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setText(doc, INK_SOFT);
    const firstTick = Math.ceil(xStart / 5) * 5;
    for (let t = firstTick; t <= xEnd + 1e-6; t += 5) {
      const xt = x0 + (t - xStart) * scale;
      setDraw(doc, RULE_DK);
      doc.setLineWidth(0.2);
      doc.line(xt, yCur + canvasH, xt, yCur + canvasH + 1.4);
      doc.text(`${t.toFixed(0)} m`, xt, yCur + canvasH + 5, { align: "center" });
    }

    plan.placements.forEach((p) => {
      const center = p.x + p.w / 2;
      if (center < xStart - 1e-6 || center > xEnd + 1e-6) return;
      const px = x0 + (p.x - xStart) * scale;
      const py = yCur + p.y * scale;
      const pw = p.w * scale;
      const ph = p.h * scale;
      drawBale(doc, px, py, pw, ph, p.bale.produtor, p.bale.lote, p.bale.iq, p.tamanho);
    });

    yCur += canvasH + (r === rows - 1 ? 5 : rowGap);
  }
  return yCur;
}

/**
 * Bloco 2×4 com as métricas de qualidade da sequência. Cada chip tem
 * contraste P&B:
 *  - FORA   → preenchimento escuro + texto branco bold (alto peso visual)
 *  - OK     → papel branco com borda fina e texto escuro
 *  - Neutro → idem OK, sem "status" (ex.: R$/TON)
 */
function drawQualityChips(
  doc: jsPDF,
  ix: number,
  cy: number,
  innerW: number,
  sp: Record<string, number>,
  thresholds: Thresholds,
): number {
  const paramKeys = ["uhml", "str_val", "elg", "ui", "mic", "sf"] as const;
  const chipGap = 3;
  const chipW = (innerW - 3 * chipGap) / 4;
  // Altura apertada (era 13) para liberar espaço vertical ao layout físico
  // em 3 linhas no A3 paisagem sem invadir o rodapé.
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
    const fora = c.ok === false;

    setFill(doc, fora ? INK : PAPER);
    setDraw(doc, INK);
    doc.setLineWidth(fora ? 0.4 : 0.35);
    doc.roundedRect(px, py, chipW, chipH, 1.2, 1.2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setText(doc, fora ? [205, 205, 205] : INK_MUTE);
    doc.text(c.label, px + chipW / 2, py + 4, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(c.ok === null ? 8.5 : 10);
    setText(doc, fora ? PAPER : INK);
    doc.text(c.val, px + chipW / 2, py + 9.4, { align: "center" });

    if (fora) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.6);
      setText(doc, PAPER);
      doc.text("FORA", px + chipW - 2, py + 4, { align: "right" });
    }
  });
  const rowsN = Math.ceil(chips.length / 4);
  return cy + rowsN * chipH + (rowsN - 1) * chipGap + 3;
}

function drawUsageTable(doc: jsPDF, seq: SeqSide, x: number, y: number, w: number): number {
  const rows = summarizeSequenceUsage(seq).map((r) => [
    r.produtor,
    r.lote,
    r.tamanho ?? "—",
    String(r.bales),
    r.avgIq.toFixed(0),
  ]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setText(doc, INK);
  doc.text("FORNECEDORES, LOTES E FARDOS DA SEQUÊNCIA", x, y);

  doc.autoTable({
    startY: y + 3,
    head: [["Fornecedor", "Lote", "Tam.", "Fardos", "IQ méd."]],
    body: rows,
    ...lightTableStyles(),
    margin: { left: x, right: doc.internal.pageSize.getWidth() - x - w, bottom: 18 },
    tableWidth: w,
    styles: {
      valign: "middle" as const,
      font: "helvetica" as const,
      fontSize: 7,
      cellPadding: 1.2,
      overflow: "linebreak" as const,
    },
    headStyles: {
      fillColor: INK,
      textColor: PAPER,
      fontStyle: "bold" as const,
      fontSize: 7,
      cellPadding: 1.4,
      lineColor: INK,
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: w * 0.42 },
      1: { cellWidth: w * 0.3 },
      2: { cellWidth: w * 0.08, halign: "center" as const },
      3: { cellWidth: w * 0.1, halign: "center" as const },
      4: { cellWidth: w * 0.1, halign: "center" as const },
    },
  });

  return doc.lastAutoTable.finalY + 3;
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
  doc.setFontSize(7);
  setText(doc, INK_MUTE);
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
  doc.text(lines, m, pageH - 5 - Math.max(0, lines.length - 1) * 2.5);
}

/** Página 1: resumo A4 retrato. Demais páginas: 1 sequência por A3 paisagem. */
export function buildSeqPDF(input: BuildSeqPdfInput): jsPDF {
  const { mixName, params, lots, seqWeightKg, baleWtKg, sequences, layoutPlans } = input;
  const thresholds = input.thresholds ?? buildDefaultThresholds();
  const bps = input.bps ?? 0;
  const used = input.used ?? 0;
  const dropped = input.dropped ?? 0;
  const totalBales = input.totalBales ?? params.bales ?? 0;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const m = 14;
  let pageW = doc.internal.pageSize.getWidth();
  let pageH = doc.internal.pageSize.getHeight();

  // --- Capa / resumo (A4 retrato, tema claro) ---
  drawDocHeader(
    doc,
    pageW,
    m,
    "SANTANA TEXTILES · PLANEJADOR DE SEQUÊNCIAS",
    mixName || "Mistura",
    `${params.weight != null ? fmtKgFromTons(Number(params.weight)) : "—"} kg · ${params.bales != null ? params.bales : "—"} fardos · ${(baleWtKg || 0).toFixed(1)} kg/fardo · alvo ${seqWeightKg} kg/seq`,
  );

  let y = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text("Resumo", m, y);
  y += 6;

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
    // Accent (alerta) inverte cores para destacar sem depender de matiz.
    setFill(doc, k.accent ? INK : PAPER);
    setDraw(doc, INK);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, y, kpiW, 20, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(doc, k.accent ? [210, 210, 210] : INK_MUTE);
    doc.text(k.label.toUpperCase(), x + kpiW / 2, y + 6, { align: "center" });
    doc.setFontSize(13);
    setText(doc, k.accent ? PAPER : INK);
    doc.text(k.value, x + kpiW / 2, y + 15, { align: "center" });
  });
  y += 26;

  if (dropped > 0) {
    // Aviso em pílula escura (inversa), destaque inequívoco no P&B.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, INK);
    const msg = `${dropped} fardo(s) não usados para manter sequências pares.`;
    setFill(doc, TINT2);
    setDraw(doc, INK);
    doc.setLineWidth(0.3);
    const tw = doc.getTextWidth(msg) + 6;
    doc.roundedRect(m, y - 4, tw, 7, 1.2, 1.2, "FD");
    doc.text(msg, m + 3, y + 0.8);
    y += 7;
  }

  // --- Legenda de IQ em escala de cinza (impressão P&B) ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setText(doc, INK);
  doc.text("Classe do fardo (IQ) · tonalidade clara → escura", m, y);
  y += 5;

  const bands = [iqBand(80), iqBand(65), iqBand(45), iqBand(20)];
  const legendW = (pageW - 2 * m - 3 * 4) / 4;
  bands.forEach((b, i) => {
    const x = m + i * (legendW + 4);
    setFill(doc, b.fill);
    setDraw(doc, b.border);
    doc.setLineWidth(Math.max(0.3, b.borderW));
    doc.rect(x, y, 10, 7, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(doc, b.text);
    doc.text(b.letter, x + 5, y + 4.8, { align: "center" });
    setText(doc, INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(b.label, x + 12, y + 5);
  });
  y += 14;

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
  doc.setFontSize(9);
  setText(doc, INK);
  doc.text("Produtores e lotes nesta mistura", m, y);
  y += 4;

  doc.autoTable({
    startY: y,
    head: [["Produtor", "Lotes"]],
    body: prodRows,
    ...lightTableStyles(),
    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: pageW - m * 2 - 50 } },
    margin: { left: m, right: m },
  });

  // --- Páginas das sequências (A3 paisagem) ---
  sequences.forEach((seq, si) => {
    // A3 paisagem (420 × 297 mm) dobra a escala de impressão e permite
    // também reduzir para A4 com 71% mantendo legibilidade.
    doc.addPage("a3", "l");
    pageW = doc.internal.pageSize.getWidth();
    pageH = doc.internal.pageSize.getHeight();

    setText(doc, INK_SOFT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("SANTANA TEXTILES · PLANEJADOR DE SEQUÊNCIAS", m, 9);
    setText(doc, INK_MUTE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `${mixName || "Mistura"} · seq. ${si + 1} de ${sequences.length}`,
      pageW - m,
      9,
      { align: "right" },
    );
    setText(doc, INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Sequência ${si + 1}`, m, 19);
    setDraw(doc, INK);
    doc.setLineWidth(0.5);
    doc.line(m, 23, pageW - m, 23);

    const innerW = pageW - 2 * m;
    const ix = m;

    const all = [...seq.a, ...seq.b];
    const n = all.length;
    const wt = n * bwk;
    const sp = computeSeqParams(all);
    const iqMed = sp.iq ?? 0;
    const isRestante = bps > 0 && n < bps * 0.8;
    const prds = new Set(all.map((b) => b.produtor)).size;
    const lts = new Set(all.map((b) => b.lote)).size;

    const comp = summarizeComposition(all);
    const plan = layoutPlans?.[si] ?? buildLayoutPlan(seq);

    // Meta (contagem de fardos/peso/composição) à esquerda + selo IQ no canto.
    // Colocado imediatamente após o cabeçalho para deixar os chips, a pista e
    // a lista operacional dentro da área imprimível do A3 paisagem.
    const metaRowTop = 27;
    const badgeW = 52;
    const badgeH = 13;
    const badgeX = pageW - m - badgeW;
    const badgeY = metaRowTop;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setText(doc, INK);
    let sub = `${n} fardos · ${wt.toFixed(0)} kg · ${prds} prod. · ${lts} lotes · ${comp.p} P · ${comp.g} G`;
    if (comp.unknown > 0) sub += ` · ${comp.unknown} sem tam.`;
    if (isRestante) sub += " · RESTANTE";
    const subMaxW = badgeX - ix - 6;
    const subLines = doc.splitTextToSize(sub, subMaxW);
    doc.text(subLines, ix, metaRowTop + 6);

    const band = iqBand(iqMed);
    setFill(doc, band.fill);
    setDraw(doc, band.border);
    doc.setLineWidth(Math.max(0.4, band.borderW));
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.6, 1.6, "FD");
    setText(doc, band.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(
      `IQ ${iqMed.toFixed(0)} · ${band.letter}`,
      badgeX + badgeW / 2,
      badgeY + badgeH / 2 + 1.8,
      { align: "center" },
    );

    let cy = metaRowTop + Math.max(13, subLines.length * 4.8) + 3;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setText(doc, INK_MUTE);
    doc.text("QUALIDADE MÉDIA DA SEQUÊNCIA", ix, cy);
    cy += 2.5;
    cy = drawQualityChips(doc, ix, cy, innerW, sp, thresholds);

    // "LAYOUT FÍSICO" + dimensões na MESMA linha (antes ocupava 2 linhas).
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(doc, INK);
    doc.text("LAYOUT FÍSICO", ix, cy + 4);
    const labelW = doc.getTextWidth("LAYOUT FÍSICO");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, INK_SOFT);
    const dimLine =
      `  ·  Área útil ${fmt1(OPENING_AREA_LENGTH_M)} × ${fmt1(OPENING_AREA_WIDTH_M)} m` +
      `  ·  Fardo P ${fmt1(BALE_P_LENGTH_M)} × ${fmt1(BALE_WIDTH_M)} m` +
      `  ·  Fardo G ${fmt1(BALE_G_LENGTH_M)} × ${fmt1(BALE_WIDTH_M)} m` +
      `  ·  movimento do Blendomat →`;
    doc.text(dimLine, ix + labelW, cy + 4);
    cy += 8;

    const usageRows = summarizeSequenceUsage(seq).length;
    const estimatedUsageH = Math.min(76, 13 + usageRows * 5.4);
    const layoutMaxH = Math.max(80, pageH - m - estimatedUsageH - cy - 12);
    cy = drawLayoutStripWrapped(doc, plan, ix, cy + 3, innerW, 2, layoutMaxH);

    if (plan.notes.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setText(doc, INK_SOFT);
      plan.notes.forEach((t) => {
        const lines = doc.splitTextToSize(`• ${t}`, innerW);
        if (cy + lines.length * 4 + 8 > pageH - m) return;
        doc.text(lines, ix, cy + 3);
        cy += lines.length * 4 + 1;
      });
    }

    cy += 3;
    drawUsageTable(doc, seq, ix, cy, innerW);
  });

  const totalPages = doc.getNumberOfPages();
  for (let pi = 1; pi <= totalPages; pi++) {
    doc.setPage(pi);
    pageW = doc.internal.pageSize.getWidth();
    pageH = doc.internal.pageSize.getHeight();
    const hint = pi === 1 ? "Resumo" : "Layout físico da sequência · movimento do Blendomat →";
    drawSeqFooter(doc, pageW, pageH, m, pi, totalPages, hint);
  }

  return doc;
}
