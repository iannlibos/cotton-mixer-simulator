import type { BaleSize, Lot } from "../domain/stock.js";
import {
  BALE_G_LENGTH_M,
  BALE_P_LENGTH_M,
  BALE_WIDTH_M,
  OPENING_AREA_LENGTH_M,
  OPENING_AREA_WIDTH_M,
} from "../domain/stock.js";
import type { Thresholds } from "../domain/types.js";
import { PARAMS } from "../domain/types.js";
import { qualityIndex, iqColor } from "./strategies.js";

export interface SeqBale {
  produtor: string;
  lote: string;
  iq: number;
  uhml: number;
  elg: number;
  str_val: number;
  ui: number;
  sf: number;
  mic: number;
  mst: number;
  custo: number;
  tamanho?: BaleSize | null;
  _id: number;
}

/** Resumo da composição (P/G) de um conjunto de fardos. */
export interface CompositionSummary {
  p: number;
  g: number;
  unknown: number;
  total: number;
  mode: "p_only" | "g_only" | "mixed" | "unknown";
}

export function summarizeComposition(bales: Array<{ tamanho?: BaleSize | null }>): CompositionSummary {
  let p = 0, g = 0, unknown = 0;
  bales.forEach((b) => {
    if (b.tamanho === "P") p++;
    else if (b.tamanho === "G") g++;
    else unknown++;
  });
  const total = bales.length;
  let mode: CompositionSummary["mode"];
  if (p === 0 && g === 0) mode = "unknown";
  else if (g === 0 && p > 0) mode = "p_only";
  else if (p === 0 && g > 0) mode = "g_only";
  else mode = "mixed";
  return { p, g, unknown, total, mode };
}

export interface SeqSide {
  a: SeqBale[];
  b: SeqBale[];
}

export interface SequenceLotUsage {
  produtor: string;
  lote: string;
  tamanho: BaleSize | null;
  bales: number;
  avgIq: number;
}

export function summarizeSequenceUsage(seq: SeqSide): SequenceLotUsage[] {
  const grouped = new Map<string, { produtor: string; lote: string; tamanho: BaleSize | null; bales: number; iqSum: number }>();
  [...seq.a, ...seq.b].forEach((b) => {
    const tamanho = b.tamanho ?? null;
    const key = `${b.produtor}\u0000${b.lote}\u0000${tamanho ?? ""}`;
    const cur = grouped.get(key);
    if (cur) {
      cur.bales += 1;
      cur.iqSum += b.iq;
    } else {
      grouped.set(key, {
        produtor: b.produtor,
        lote: b.lote,
        tamanho,
        bales: 1,
        iqSum: b.iq,
      });
    }
  });
  return [...grouped.values()]
    .map((r) => ({ ...r, avgIq: r.bales > 0 ? r.iqSum / r.bales : 0 }))
    .sort((a, b) => (
      a.produtor.localeCompare(b.produtor, "pt-BR", { sensitivity: "base" }) ||
      a.lote.localeCompare(b.lote, "pt-BR", { sensitivity: "base", numeric: true }) ||
      (a.tamanho ?? "").localeCompare(b.tamanho ?? "", "pt-BR")
    ));
}

export interface SeqData {
  name: string;
  lots: Lot[];
  totalWeight: number;
  totalBales: number;
}

export interface SeqGenResult {
  sequences: SeqSide[];
  baleWtKg: number;
  bps: number;
  nSeq: number;
  used: number;
  dropped: number;
  totalBales: number;
  isOdd: boolean;
}

export { iqColor };

export function generateSequences(
  data: SeqData,
  seqKg: number,
  _minProds: number,
  thresholds: Thresholds,
): SeqGenResult {
  const totalW = data.totalWeight;
  const totalBales = data.totalBales;
  const baleWtKg = totalW * 1000 / totalBales;
  const isOdd = totalBales % 2 !== 0;

  let targetBps = Math.round(seqKg / baleWtKg);
  if (targetBps % 2 !== 0) targetBps++;
  if (targetBps < 2) targetBps = 2;
  let used = totalBales;
  if (used % 2 !== 0) used--;
  const dropped = totalBales - used;

  const nSeqA = Math.max(1, Math.floor(used / targetBps));
  const nSeqB = nSeqA + 1;
  const bpsA = used / nSeqA, bpsB = used / nSeqB;
  const diffA = Math.abs(bpsA * baleWtKg - seqKg), diffB = Math.abs(bpsB * baleWtKg - seqKg);
  const nSeq = (diffA <= diffB) ? nSeqA : nSeqB;

  const pool: SeqBale[] = [];
  data.lots.forEach(l => {
    const iq = qualityIndex(l, thresholds);
    for (let i = 0; i < (l.allocBales ?? 0); i++) {
      pool.push({
        produtor: l.produtor,
        lote: l.lote,
        iq,
        uhml: l.uhml,
        elg: l.elg,
        str_val: l.str_val,
        ui: l.ui || 0,
        sf: l.sf,
        mic: l.mic,
        mst: l.mst || 0,
        custo: l.custo,
        tamanho: l.tamanho ?? null,
        _id: pool.length,
      });
    }
  });
  pool.sort((a, b) => b.iq - a.iq);

  const bales = pool.slice(0, used);

  const raw: SeqBale[][] = Array.from({ length: nSeq }, () => []);
  for (let i = 0; i < bales.length; i++) raw[i % nSeq].push(bales[i]);

  for (let i = 0; i < nSeq; i++) {
    if (raw[i].length % 2 !== 0) {
      for (let j = i + 1; j < nSeq; j++) {
        if (raw[j].length % 2 !== 0) {
          if (raw[i].length > raw[j].length) raw[j].push(raw[i].pop()!);
          else raw[i].push(raw[j].pop()!);
          break;
        }
      }
    }
  }

  const actualBps = raw[0]?.length || 0;

  function heteroPairs(pairs: { a: SeqBale; b: SeqBale }[]): { a: SeqBale; b: SeqBale }[] {
    if (pairs.length <= 2) return pairs;
    const g: Record<string, { a: SeqBale; b: SeqBale }[]> = {};
    pairs.forEach(p => { const k = p.a.produtor; if (!g[k]) g[k] = []; g[k].push(p); });
    const ks = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
    const pt: Record<string, number> = {};
    ks.forEach(k => { pt[k] = 0; });
    const r: { a: SeqBale; b: SeqBale }[] = [];
    let last: string | null = null;
    while (r.length < pairs.length) {
      let pk: string | null = null;
      for (const k of ks) { if (pt[k] < g[k].length && k !== last) { pk = k; break; } }
      if (!pk) { for (const k of ks) { if (pt[k] < g[k].length) { pk = k; break; } } }
      if (!pk) break;
      r.push(g[pk][pt[pk]++]);
      last = pk;
    }
    return r;
  }

  const sequences: SeqSide[] = raw.map(seq => {
    seq.sort((a, b) => b.iq - a.iq);
    const n = seq.length;
    const half = n / 2;

    const pairs: { a: SeqBale; b: SeqBale }[] = [];
    for (let i = 0; i < half; i++) pairs.push({ a: seq[i], b: seq[n - 1 - i] });

    const ordered = heteroPairs(pairs);

    const sA: SeqBale[] = [], sB: SeqBale[] = [];
    ordered.forEach((p, i) => {
      if (i % 2 === 0) { sA.push(p.a); sB.push(p.b); }
      else { sA.push(p.b); sB.push(p.a); }
    });
    return { a: sA, b: sB };
  });

  return {
    sequences,
    baleWtKg,
    bps: actualBps,
    nSeq,
    used,
    dropped,
    totalBales,
    isOdd,
  };
}

export function computeSeqParams(bales: SeqBale[]): Record<string, number> {
  const n = bales.length;
  if (!n) return {};
  const sp: Record<string, number> = {};
  ["uhml", "str_val", "elg", "ui", "mic", "sf", "mst", "custo"].forEach(k => {
    sp[k] = bales.reduce((s, b) => s + ((b as unknown as Record<string, number>)[k] || 0), 0) / n;
  });
  sp.iq = bales.reduce((s, b) => s + b.iq, 0) / n;
  return sp;
}

export function fmtBRL(v: number): string {
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Dimensões físicas da área útil e dos fardos, exportadas para a UI. */
export const LAYOUT_DIMS = {
  areaLength: OPENING_AREA_LENGTH_M,
  areaWidth: OPENING_AREA_WIDTH_M,
  baleWidth: BALE_WIDTH_M,
  pLength: BALE_P_LENGTH_M,
  gLength: BALE_G_LENGTH_M,
} as const;

/** Um fardo desenhado na área útil. */
export interface LayoutPlacement {
  /** Lado (A ou B) do fardo dentro da sequência. */
  side: "a" | "b";
  /** Índice no lado (A ou B) dentro da sequência. */
  bi: number;
  /** P/G do fardo. */
  tamanho: BaleSize;
  /** Canto superior-esquerdo em metros (origem = canto sup. esq. da área útil). */
  x: number;
  y: number;
  /** Dimensões em metros (já com orientação aplicada). */
  w: number;
  h: number;
  /** Rotulagem/associação opcional (ex.: "endcap esq."). */
  note?: string;
  /** Fardo real da sequência. */
  bale: SeqBale;
}

export interface LayoutPlan {
  /** Dimensões da área útil do braço em metros (limites operacionais do Blendomat). */
  areaLength: number;
  areaWidth: number;
  /**
   * Altura total do canvas em metros — pode ser maior que `areaWidth` quando as
   * pilhas de ponta ultrapassam levemente os 2,20 m do braço (prática operacional).
   */
  canvasHeight: number;
  /** Deslocamento Y (em metros) do topo da área útil dentro do canvas. */
  armYOffset: number;
  placements: LayoutPlacement[];
  composition: CompositionSummary;
  /** Texto curto descrevendo o modo sugerido. */
  modeLabel: string;
  /** Observações/recomendações textuais para a operação. */
  notes: string[];
}

/**
 * Gera um plano de disposição física dos fardos na área útil da abertura.
 *
 * Eixo X = comprimento (45,35 m, direção do movimento do Blendomat).
 * Eixo Y = largura útil (2,20 m do braço — cabe exatamente dois fardos P
 * transversais: 2 × 1,10 m).
 *
 * Regras por composição:
 *  - **P-only**: fardos P dispostos *transversalmente* (0,58 m em X, 1,10 m em Y),
 *    duas fileiras empilhadas (lado A em cima, lado B embaixo) preenchendo os
 *    2,20 m do braço integralmente.
 *  - **G-only**: usa o **mesmo** algoritmo do modo misto (pontas G-quad +
 *    duas faixas independentes no miolo), mas priorizando **G transversal**
 *    no topo — o lane inferior é mantido vazio e só recebe G longitudinais
 *    como transbordo quando o topo atinge o comprimento útil do miolo.
 *    Evita dois G grandes longitudinais rolando paralelos (instabilidade
 *    na passagem do Blendomat).
 *  - **Mistura (P + G)**:
 *      (a) **Pontas** (G-quad): 4 fardos G longitudinais empilhados em uma
 *          coluna de 1,40 m X × 2,32 m Y em cada extremidade (≈6 cm a mais
 *          que o braço, prática operacional para ancorar a máquina). A
 *          pilha da direita fica colada ao último fardo do miolo.
 *      (b) **Miolo — duas faixas independentes encaixadas sem gap em X**:
 *           Logo após o reforço esquerdo, a **seção G** preenche **dois
 *           trilhos independentes**:
 *            • **Topo** (Y = 0..1,40 m): G transversais (0,58 × 1,40 cada)
 *              encostados lado a lado.
 *            • **Fundo** (Y = 1,40..1,98 m): longitudinais (P long 1,10 ×
 *              0,58 e/ou G long 1,40 × 0,58) encostados ponta-a-ponta.
 *           Os trilhos não dependem um do outro — não tentamos forçar
 *           N transversais a caber sobre um longitudinal. O comprimento
 *           dos dois trilhos é casado heuristicamente (preenchemos o
 *           fundo até a largura do topo; se sobrar lane, movemos um G do
 *           topo para o fundo como G long enquanto reduzir o gap final).
 *           Em seguida vem a **seção P**:
 *            • **P-par** (0,58 m X × 2,20 m Y): 2 P transversais
 *              empilhadas — encaixa exatamente no braço.
 *            • **P-partial** (0,58 m X × 1,10 m Y): último P ímpar.
 *      (c) Cada faixa é ordenada em zigue-zague (melhor IQ × pior IQ),
 *          aplicando outside-in *separadamente* nos Gs do topo, nos
 *          longitudinais do fundo e nos pares de P-par. É a mesma
 *          expertise do `heteroPairs` da geração de sequências, garantindo
 *          que vizinhos não sejam todos de IQ alto ou todos de IQ baixo.
 */
export function buildLayoutPlan(seq: SeqSide): LayoutPlan {
  const all = [...seq.a.map((b, bi) => ({ b, side: "a" as const, bi })), ...seq.b.map((b, bi) => ({ b, side: "b" as const, bi }))];
  const comp = summarizeComposition(all.map((x) => x.b));

  const areaLength = OPENING_AREA_LENGTH_M;
  const areaWidth = OPENING_AREA_WIDTH_M;

  const placements: LayoutPlacement[] = [];
  const notes: string[] = [];
  let modeLabel = "";

  // Por padrão o canvas tem a mesma altura do braço útil (sem sobras).
  let canvasHeight = areaWidth;
  let armYOffset = 0;

  if (comp.mode === "p_only" || (comp.mode === "unknown" && all.length > 0)) {
    modeLabel = "Apenas fardos P";
    const pX = BALE_WIDTH_M;
    const pY = BALE_P_LENGTH_M;
    let xA = 0, xB = 0;
    seq.a.forEach((b, bi) => {
      if (xA + pX > areaLength + 1e-6) return;
      placements.push({ side: "a", bi, tamanho: "P", x: xA, y: 0, w: pX, h: pY, bale: b, note: "P transversal (lado A)" });
      xA += pX;
    });
    seq.b.forEach((b, bi) => {
      if (xB + pX > areaLength + 1e-6) return;
      placements.push({ side: "b", bi, tamanho: "P", x: xB, y: pY, w: pX, h: pY, bale: b, note: "P transversal (lado B)" });
      xB += pX;
    });
    if (comp.mode === "unknown") {
      notes.push(
        "Nenhum lote informou tamanho — assumindo P como padrão na visualização. Preencha a coluna TAMANHO para obter a recomendação real.",
      );
    }
  } else {
    // ═══ G-only (reforçado) ou Mistura P+G — mesmo algoritmo de duas faixas
    // independentes. No modo "apenas G" priorizamos preencher o miolo de
    // forma transversal (mais estável) e só usamos o lane longitudinal
    // como transbordo quando o topo já ocupou toda a área útil.
    modeLabel = comp.mode === "g_only" ? "Apenas fardos G" : "Mistura P + G";

    type Ref = { side: "a" | "b"; bi: number; b: SeqBale };
    const gsPool: Ref[] = [];
    const psPool: Ref[] = [];
    const others: Ref[] = [];
    seq.a.forEach((b, bi) => {
      const ref = { side: "a" as const, bi, b };
      if (b.tamanho === "G") gsPool.push(ref);
      else if (b.tamanho === "P") psPool.push(ref);
      else others.push(ref);
    });
    seq.b.forEach((b, bi) => {
      const ref = { side: "b" as const, bi, b };
      if (b.tamanho === "G") gsPool.push(ref);
      else if (b.tamanho === "P") psPool.push(ref);
      else others.push(ref);
    });
    // Fardos sem tamanho identificado viram "P" na visualização para não sumir.
    others.forEach((r) => psPool.push(r));

    // Ordena por IQ desc para aplicar pareamento outside-in (melhor × pior).
    gsPool.sort((a, b) => b.b.iq - a.b.iq);
    psPool.sort((a, b) => b.b.iq - a.b.iq);

    const ENDCAP_COUNT = 4;
    const gLen = BALE_G_LENGTH_M; // 1,40 m
    const gH = BALE_WIDTH_M;       // 0,58 m
    const pX = BALE_WIDTH_M;       // 0,58 m
    const pY = BALE_P_LENGTH_M;    // 1,10 m
    const pLongLen = BALE_P_LENGTH_M; // 1,10 m (P longitudinal em X)
    const endcapStackH = gH * ENDCAP_COUNT; // 2,32 m
    const endcapOverflow = Math.max(0, (endcapStackH - areaWidth) / 2);

    // Canvas cresce quando houver pilhas G-quad nas pontas para acomodar os 2,32 m.
    const willHaveGStack = gsPool.length >= ENDCAP_COUNT;
    if (willHaveGStack && endcapStackH > areaWidth) {
      canvasHeight = endcapStackH;
      armYOffset = endcapOverflow;
    }

    /**
     * Retira N refs do pool alternando topo/fundo (outside-in): melhor,
     * pior, 2º melhor, 2º pior… Distribui qualidade dentro de cada módulo,
     * mesma estratégia do `heteroPairs` usada na geração de sequências.
     */
    const pickOutsideInN = (pool: Ref[], n: number): Ref[] => {
      const picked: Ref[] = [];
      for (let i = 0; i < n; i++) {
        if (pool.length === 0) break;
        if (i % 2 === 0) picked.push(pool.shift()!);
        else picked.push(pool.pop()!);
      }
      return picked;
    };

    // ── (a) Reserva 4 + 4 G para as pontas (IQ balanceado) ────────────────
    const leftCap = pickOutsideInN(gsPool, ENDCAP_COUNT);
    const rightCap = pickOutsideInN(gsPool, ENDCAP_COUNT);
    const hasLeftCap = leftCap.length === ENDCAP_COUNT;
    const hasRightCap = rightCap.length === ENDCAP_COUNT;
    if (!hasLeftCap) leftCap.forEach((r) => gsPool.push(r));
    if (!hasRightCap) rightCap.forEach((r) => gsPool.push(r));

    // ── (b) Decide quantos Gs vão p/ o lane (como G long) ──────────────────
    // Estratégia:
    //  1) Começa com TODOS os Gs do miolo no topo (transversais).
    //  2) Se o topo extrapola o comprimento útil do miolo, o excedente vai
    //     para o lane como G longitudinal (transbordo — mais estável do que
    //     ficar de fora da área útil).
    //  3) Ajusta nPlong ao espaço restante no lane (sob o topo).
    //  4) Só quando HÁ Ps (modo misto) aplicamos a heurística extra de
    //     mover Gs do topo p/ o lane para reduzir o gap final — o
    //     complemento é feito com P long (estável) ao lado. No modo
    //     "apenas fardos G" essa heurística fica DESLIGADA: preferimos
    //     manter os Gs no topo e deixar o lane vazio (estabilidade na
    //     passagem da máquina — evita dois Gs grandes rolando paralelos).
    const midLen = areaLength - (hasLeftCap ? gLen : 0) - (hasRightCap ? gLen : 0);
    const maxTopCols = Math.max(0, Math.floor((midLen + 1e-6) / pX));
    let nGtop = Math.min(gsPool.length, maxTopCols);
    // Transbordo: Gs que não couberam no topo vão p/ o lane (como G long),
    // respeitando a largura disponível do lane (≤ largura do topo).
    const maxLaneGCols = Math.max(0, Math.floor((nGtop * pX + 1e-6) / gLen));
    let nGlong = Math.min(Math.max(0, gsPool.length - nGtop), maxLaneGCols);

    const laneBudgetWidth = () => nGtop * pX - nGlong * gLen;
    const nPlongMax = Math.min(
      psPool.length,
      Math.max(0, Math.floor((laneBudgetWidth() + 1e-6) / pLongLen)),
    );
    let nPlong = nPlongMax;

    const computeGap = (gTop: number, pLong: number, gLong: number): number =>
      gTop * pX - (pLong * pLongLen + gLong * gLen);

    // Heurística extra — só quando há Ps no pool (modo mistura): move Gs
    // do topo p/ o fundo enquanto isso reduzir |gap| do lane. Mantém o
    // balanço visual do miolo na mistura.
    if (psPool.length > 0) {
      while (nGtop >= 1) {
        const gapBefore = computeGap(nGtop, nPlong, nGlong);
        const gapAfter = computeGap(nGtop - 1, nPlong, nGlong + 1);
        if (Math.abs(gapAfter) < Math.abs(gapBefore) - 1e-6) {
          nGtop -= 1;
          nGlong += 1;
        } else {
          break;
        }
      }
    }

    // ── (c) Seleciona refs aplicando outside-in *separadamente* em cada
    // trilho — mesma expertise do `heteroPairs` p/ não juntar fardos ruins.
    const topGs = pickOutsideInN(gsPool, nGtop);    // Gs do trilho superior (zigue-zague IQ)
    const longGs = pickOutsideInN(gsPool, nGlong);  // Gs reaproveitados como long no fundo
    const longPs = pickOutsideInN(psPool, nPlong);  // Ps usados como longitudinal

    // Fundo: intercala P long e G long na ordem em que aparecem (alternando
    // p/ misturar produtores e tipos) — ainda em zigue-zague de IQ pq os
    // pools já saíram outside-in.
    const longRefs: Array<{ ref: Ref; w: number; tamanho: "P" | "G"; note: string }> = [];
    let pi = 0, gi = 0;
    while (pi < longPs.length || gi < longGs.length) {
      // Alterna privilegiando P long (mais comum, melhor encaixe c/ topo).
      if (pi < longPs.length && (gi >= longGs.length || pi <= gi)) {
        longRefs.push({ ref: longPs[pi++], w: pLongLen, tamanho: "P", note: "Longitudinal P (lane do fundo)" });
      } else if (gi < longGs.length) {
        longRefs.push({ ref: longGs[gi++], w: gLen, tamanho: "G", note: "Longitudinal G (lane do fundo)" });
      }
    }
    // P-par + P-partial p/ os Ps remanescentes.
    type PairCol = { top: Ref; bot?: Ref };
    const pPairs: PairCol[] = [];
    while (psPool.length >= 2) {
      const pair = pickOutsideInN(psPool, 2);
      pPairs.push({ top: pair[0], bot: pair[1] });
    }
    let pPartial: Ref | null = null;
    if (psPool.length === 1) pPartial = psPool.shift()!;

    // ── (d) Larguras de cada bloco (sem gap entre eles em X) ───────────────
    const topGsWidth = topGs.length * pX;
    const laneWidth = longRefs.reduce((s, r) => s + r.w, 0);
    const gSectionWidth = Math.max(topGsWidth, laneWidth);

    // ── (e) Pilha esquerda (G-quad) ────────────────────────────────────────
    if (hasLeftCap) {
      for (let i = 0; i < leftCap.length; i++) {
        const r = leftCap[i];
        placements.push({
          side: r.side, bi: r.bi, tamanho: "G",
          x: 0, y: i * gH, w: gLen, h: gH,
          bale: r.b, note: "Pilha esquerda (4 G longitudinais)",
        });
      }
    }

    // ── (f) Seção G — duas faixas independentes ────────────────────────────
    const midStartX = hasLeftCap ? gLen : 0;
    const midEndX = areaLength - (hasRightCap ? gLen : 0);
    const gSectionStartX = midStartX;
    let topPlaced = 0;
    let lanePlaced = 0;

    // Trilho superior: G transversais lado a lado a partir do início da seção G.
    for (let i = 0; i < topGs.length; i++) {
      const xTop = gSectionStartX + i * pX;
      if (xTop + pX > midEndX + 1e-6) break;
      const r = topGs[i];
      placements.push({
        side: r.side, bi: r.bi, tamanho: "G",
        x: xTop, y: armYOffset, w: pX, h: BALE_G_LENGTH_M,
        bale: r.b, note: "G transversal (topo)",
      });
      topPlaced++;
    }

    // Trilho inferior: longitudinais ponta-a-ponta a partir do início da seção G.
    let xLane = gSectionStartX;
    for (const item of longRefs) {
      if (xLane + item.w > midEndX + 1e-6) break;
      placements.push({
        side: item.ref.side, bi: item.ref.bi, tamanho: item.tamanho,
        x: xLane, y: armYOffset + BALE_G_LENGTH_M, w: item.w, h: gH,
        bale: item.ref.b, note: item.note,
      });
      xLane += item.w;
      lanePlaced++;
    }

    // ── (g) Seção P — P-pares empilhados, encostados após a seção G ────────
    const pSectionStartX = gSectionStartX + gSectionWidth;
    let pColIdx = 0;
    let pPairsPlaced = 0;
    let pPartialPlaced = 0;
    for (const pair of pPairs) {
      const xCol = pSectionStartX + pColIdx * pX;
      if (xCol + pX > midEndX + 1e-6) break;
      placements.push({
        side: pair.top.side, bi: pair.top.bi, tamanho: "P",
        x: xCol, y: armYOffset, w: pX, h: pY,
        bale: pair.top.b, note: "P transversal (topo)",
      });
      if (pair.bot) {
        placements.push({
          side: pair.bot.side, bi: pair.bot.bi, tamanho: "P",
          x: xCol, y: armYOffset + pY, w: pX, h: pY,
          bale: pair.bot.b, note: "P transversal (base)",
        });
      }
      pColIdx++;
      pPairsPlaced++;
    }
    if (pPartial) {
      const xCol = pSectionStartX + pColIdx * pX;
      if (xCol + pX <= midEndX + 1e-6) {
        placements.push({
          side: pPartial.side, bi: pPartial.bi, tamanho: "P",
          x: xCol, y: armYOffset, w: pX, h: pY,
          bale: pPartial.b, note: "P transversal — par incompleto",
        });
        pPartialPlaced = 1;
      }
    }

    // ── (h) Pilha direita colada ao último fardo do miolo ──────────────────
    const lastMidX = pSectionStartX + (pPairsPlaced + pPartialPlaced) * pX;
    if (hasRightCap) {
      const rightStart = Math.min(Math.max(lastMidX, gSectionStartX + gSectionWidth), areaLength - gLen);
      for (let i = 0; i < rightCap.length; i++) {
        const r = rightCap[i];
        placements.push({
          side: r.side, bi: r.bi, tamanho: "G",
          x: rightStart, y: i * gH, w: gLen, h: gH,
          bale: r.b, note: "Pilha direita (4 G longitudinais)",
        });
      }
    }

    // ── Avisos operacionais ────────────────────────────────────────────────
    const lostTopG = topGs.length - topPlaced;
    const lostLaneRefs = longRefs.slice(lanePlaced);
    const lostLaneP = lostLaneRefs.filter((r) => r.tamanho === "P").length;
    const lostLaneG = lostLaneRefs.length - lostLaneP;
    const lostPpair = (pPairs.length - pPairsPlaced) * 2;
    const lostPpartial = pPartial && pPartialPlaced === 0 ? 1 : 0;
    const lostP = lostLaneP + lostPpair + lostPpartial;
    const lostG = lostTopG + lostLaneG;
    if (lostP + lostG > 0) {
      notes.push(
        `⚠️ ${lostP + lostG} fardo(s) não couberam na área útil (${lostP} P, ${lostG} G). Considere reduzir o peso por sequência ou revisar a composição.`,
      );
    }
    if (!hasLeftCap || !hasRightCap) {
      const missing: string[] = [];
      if (!hasLeftCap) missing.push("esquerda");
      if (!hasRightCap) missing.push("direita");
      notes.push(
        `⚠️ Fardos G insuficientes para completar pilha(s) da(s) ponta(s) ${missing.join(" e ")} — necessário 4 G longitudinais por ponta.`,
      );
    }
  }

  return { areaLength, areaWidth, canvasHeight, armYOffset, placements, composition: comp, modeLabel, notes };
}

export function seqParamOk(key: string, val: number, thresholds: Thresholds): boolean {
  const t = thresholds[key];
  if (!t) return true;
  const p = PARAMS.find(x => x.key === key);
  if (!p) return true;
  return val >= t.min - 0.0005 && val <= t.max + 0.0005;
}
