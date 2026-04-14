import type { Lot } from "../domain/stock.js";
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
  _id: number;
}

export interface SeqSide {
  a: SeqBale[];
  b: SeqBale[];
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

export function seqParamOk(key: string, val: number, thresholds: Thresholds): boolean {
  const t = thresholds[key];
  if (!t) return true;
  const p = PARAMS.find(x => x.key === key);
  if (!p) return true;
  return val >= t.min - 0.0005 && val <= t.max + 0.0005;
}
