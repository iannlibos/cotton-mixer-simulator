import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import {
  generateSequences,
  computeSeqParams,
  fmtBRL,
  iqColor,
  seqParamOk,
  buildLayoutPlan,
  summarizeComposition,
  type SeqSide,
  type SeqBale,
  type LayoutPlan,
  type LayoutPlacement,
} from "../engine/sequencer";
import { BALE_P_LENGTH_M, BALE_G_LENGTH_M } from "../domain/stock";
import { buildSeqPDF } from "../utils/pdf";

/**
 * Regras de troca de fardos (operacionais):
 *   • P ↔ P e G ↔ G: liberadas em qualquer orientação.
 *   • P ↔ G: aceita **apenas** quando ambos os slots estão na orientação
 *     longitudinal (largura > altura). Nessa orientação P (1,10 m) e G
 *     (1,40 m) compartilham a mesma altura (0,58 m), então a operação só
 *     muda a largura do slot — não cria um fardo "deitado" sem cabimento.
 *   • Em qualquer outra combinação P↔G a troca é bloqueada (manter um G
 *     em slot de P transversal ou vice-versa quebraria a área útil).
 */
function isLongitudinal(p: LayoutPlacement): boolean {
  return p.w > p.h + 1e-6;
}

function canSwapPlacements(p1: LayoutPlacement, p2: LayoutPlacement): boolean {
  const t1 = p1.bale.tamanho ?? p1.tamanho;
  const t2 = p2.bale.tamanho ?? p2.tamanho;
  if (t1 === t2) return true;
  return isLongitudinal(p1) && isLongitudinal(p2);
}

/**
 * Dois slots estão no mesmo "trilho" quando compartilham o mesmo topo (Y)
 * e a mesma altura (H) — i.e., uma linha horizontal contígua do layout
 * (ex.: o lane longitudinal, a linha de topo de G transversais, a linha
 * de topo de P-par etc.). Endcaps ficam cada um em seu próprio trilho
 * (têm Y diferente para cada nível da pilha).
 */
function sameRow(a: LayoutPlacement, b: LayoutPlacement): boolean {
  return Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.h - b.h) < 1e-3;
}

/**
 * Re-empacota o trilho que contém o slot `pivotIdx`: ordena todos os
 * slots do mesmo trilho por X, fixa o X do slot mais à esquerda e
 * encosta os demais lado a lado usando suas larguras atuais. Assim,
 * uma troca P long ↔ G long "empurra" (ou "puxa") os vizinhos evitando
 * sobreposição ou buracos.
 */
function repackRowContaining(placements: LayoutPlacement[], pivotIdx: number): void {
  const pivot = placements[pivotIdx];
  if (!pivot) return;
  const rowIdx = placements
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => sameRow(p, pivot));
  if (rowIdx.length <= 1) return;
  rowIdx.sort((a, b) => a.p.x - b.p.x);
  let cursor = rowIdx[0].p.x;
  for (const { idx } of rowIdx) {
    placements[idx] = { ...placements[idx], x: cursor };
    cursor += placements[idx].w;
  }
}

const LAYOUT_DIMS_TEXT = {
  area: "45,35 × 2,20 m",
};

function iqLabel(iq: number): string {
  if (iq >= 75) return "Excelente";
  if (iq >= 55) return "Bom";
  if (iq >= 35) return "Regular";
  return "Fraco";
}

interface LayoutCanvasProps {
  plan: LayoutPlan;
  si: number;
  highlightProducer: string | null;
  selectedKey: string | null;
  onSelect: (side: "a" | "b", bi: number) => void;
  onDragStart: (si: number, side: "a" | "b", bi: number) => void;
  onDrop: (si: number, side: "a" | "b", bi: number) => void;
  onDragEnd: () => void;
  onRotate: (si: number, side: "a" | "b", bi: number) => void;
  /**
   * Decide visualmente se o slot de destino aceita o fardo arrastado.
   * Retorna `true` quando válido (highlight verde), `false` quando
   * bloqueado (highlight vermelho). `null` quando não há arrasto ativo.
   */
  canDropOn: (dstSi: number, dstSide: "a" | "b", dstBi: number) => boolean | null;
}

function compositionBadgeClass(mode: LayoutPlan["composition"]["mode"]): string {
  if (mode === "p_only") return "seq-layout-badge seq-layout-badge--p";
  if (mode === "g_only") return "seq-layout-badge seq-layout-badge--g";
  if (mode === "mixed") return "seq-layout-badge seq-layout-badge--mix";
  return "seq-layout-badge seq-layout-badge--unknown";
}

/**
 * Desenha a área útil do Blendomat (45,35 × 2,20 m) proporcionalmente
 * usando HTML absoluto: cada fardo vira um div com tamanho/posição em %,
 * mantendo a escala real entre fardos e área. Os divs são arrastáveis
 * (mesma API do painel de sequência), permitindo reordenar/trocar fardos
 * diretamente no layout físico.
 */
function LayoutCanvas({
  plan,
  si,
  highlightProducer,
  selectedKey,
  onSelect,
  onDragStart,
  onDrop,
  onDragEnd,
  onRotate,
  canDropOn,
}: LayoutCanvasProps) {
  const { areaLength, areaWidth, canvasHeight, armYOffset } = plan;

  const xTicks: number[] = [];
  for (let x = 0; x <= areaLength + 0.001; x += 5) xTicks.push(+x.toFixed(2));
  if (xTicks[xTicks.length - 1] !== areaLength) xTicks.push(areaLength);

  const armTopPct = (armYOffset / canvasHeight) * 100;
  const armHeightPct = (areaWidth / canvasHeight) * 100;
  const armMidPct = ((armYOffset + areaWidth / 2) / canvasHeight) * 100;

  return (
    <div className="seq-layout-wrap">
      <div className="seq-layout-flow">
        <span>▸ Sentido de movimento do Blendomat</span>
        <div className="seq-layout-flow-line" />
      </div>

      <div
        className="seq-layout-canvas"
        style={{ aspectRatio: `${areaLength} / ${canvasHeight}` }}
        aria-label={`Disposição física dos fardos da sequência ${si + 1}`}
      >
        <div
          className="seq-layout-arm"
          style={{ top: `${armTopPct}%`, height: `${armHeightPct}%` }}
          aria-hidden="true"
        />
        <div
          className="seq-layout-midline"
          style={{ top: `${armMidPct}%` }}
          aria-hidden="true"
        />
        <span className="seq-layout-width-lbl" style={{ top: `${armMidPct}%` }}>
          {areaWidth.toFixed(2)} m
        </span>

        {plan.placements.map((p, i) => {
          const keyStr = `${p.side}:${p.bi}`;
          const leftPct = (p.x / areaLength) * 100;
          const topPct = (p.y / canvasHeight) * 100;
          const wPct = (p.w / areaLength) * 100;
          const hPct = (p.h / canvasHeight) * 100;
          const isHidden = !!highlightProducer && p.bale.produtor !== highlightProducer;
          const isSelected = selectedKey === keyStr;
          const title =
            `${p.bale.lote} — ${p.bale.produtor}\n` +
            `Tamanho: ${p.tamanho}${p.note ? "\n" + p.note : ""}\n` +
            `IQ: ${p.bale.iq.toFixed(0)}`;
          const isLong = p.w > p.h;
          return (
            <div
              key={`pl-${i}-${keyStr}`}
              className={[
                "seq-layout-bale",
                `seq-layout-bale--${p.tamanho}`,
                isLong ? "is-long" : "is-trans",
                isSelected ? "is-selected" : "",
                isHidden ? "is-faded" : "",
              ].filter(Boolean).join(" ")}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${wPct}%`,
                height: `${hPct}%`,
                background: iqColor(p.bale.iq),
              }}
              title={title}
              draggable
              onDragStart={() => onDragStart(si, p.side, p.bi)}
              onDragOver={(e) => {
                e.preventDefault();
                const verdict = canDropOn(si, p.side, p.bi);
                e.currentTarget.classList.remove("is-drag-over", "is-drag-over--blocked");
                if (verdict === false) {
                  e.currentTarget.classList.add("is-drag-over--blocked");
                  e.dataTransfer.dropEffect = "none";
                } else {
                  e.currentTarget.classList.add("is-drag-over");
                }
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove("is-drag-over", "is-drag-over--blocked")}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("is-drag-over", "is-drag-over--blocked");
                onDrop(si, p.side, p.bi);
              }}
              onDragEnd={onDragEnd}
              onClick={() => onSelect(p.side, p.bi)}
            >
              <span className="seq-layout-bale-prod">{p.bale.produtor}</span>
              <span className="seq-layout-bale-lote">{p.bale.lote}</span>
              <span className="seq-layout-bale-meta">{p.tamanho} · IQ {p.bale.iq.toFixed(0)}</span>
              {isSelected && (
                <button
                  type="button"
                  className="seq-layout-rotate"
                  title="Girar 90° (transversal ↔ longitudinal)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRotate(si, p.side, p.bi);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  draggable={false}
                >
                  ⟳
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="seq-layout-axis">
        {xTicks.map((t, i) => {
          const pct = (t / areaLength) * 100;
          const label = t === areaLength ? `${t.toFixed(2)} m` : `${t.toFixed(0)} m`;
          return (
            <div key={`xt-${i}`} className="seq-layout-tick" style={{ left: `${pct}%` }}>
              <div className="seq-layout-tick-mark" />
              <span className="seq-layout-tick-lbl">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PageSeq() {
  const { seqHistRecord, thresholds, setCurStep, viewHistory, history } = useApp();

  const [seqWeight, setSeqWeight] = useState(9000);
  const [minProds, setMinProds] = useState(3);
  const [sequences, setSequences] = useState<SeqSide[]>([]);
  const [baleWtKg, setBaleWtKg] = useState(0);
  const [bps, setBps] = useState(0);
  const [nSeq, setNSeq] = useState(0);
  const [used, setUsed] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [totalBales, setTotalBales] = useState(0);
  const [isOdd, setIsOdd] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ si: number; side: "a" | "b"; bi: number } | null>(null);
  const [swapHint, setSwapHint] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  /**
   * `layoutPlans` é fonte de verdade da posição visual dos fardos. É
   * gerado por `buildLayoutPlan` na primeira carga / no botão "Gerar
   * Sequências" e em seguida passa a ser editado **diretamente** pelas
   * ações do usuário (swap por arrasto, rotação 90°, swap pelo painel).
   * Isto permite que a edição manual persista, já que reconstruir o plano
   * a partir das `sequences` reaplicaria a ordenação por IQ do engine e
   * apagaria as escolhas do operador.
   */
  const [layoutPlans, setLayoutPlans] = useState<LayoutPlan[]>([]);

  const dragSrc = useRef<{ si: number; side: "a" | "b"; bi: number } | null>(null);

  const h = seqHistRecord;

  const regeneratePlans = useCallback((seqs: SeqSide[]) => {
    setLayoutPlans(seqs.map((s) => buildLayoutPlan(s)));
  }, []);

  const doGenerate = useCallback(() => {
    if (!h) return;
    const totalW = h.params.weight;
    const tBales = h.lots.reduce((s, l) => s + (l.allocBales ?? 0), 0);
    const data = { name: h.name, lots: h.lots, totalWeight: totalW, totalBales: tBales };
    const result = generateSequences(data, seqWeight, minProds, thresholds);

    setSequences(result.sequences);
    regeneratePlans(result.sequences);
    setBaleWtKg(result.baleWtKg);
    setBps(result.bps);
    setNSeq(result.nSeq);
    setUsed(result.used);
    setDropped(result.dropped);
    setTotalBales(result.totalBales);
    setIsOdd(result.isOdd);
    setSelected(null);
    setGenerated(true);
  }, [h, seqWeight, minProds, thresholds, regeneratePlans]);

  // Auto-generate on mount
  useEffect(() => {
    if (h && !generated) {
      doGenerate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Troca dois fardos atualizando **ambos** os estados:
   *   • `sequences` — para que parâmetros (IQ, peso, custo) recalculem
   *     corretamente em cada sequência.
   *   • `layoutPlans` — troca os refs `bale` / `side` / `bi` nos slots,
   *     preservando posição/orientação dos slots. Assim o usuário vê o
   *     fardo realmente migrar para o slot de destino.
   */
  const swapBales = (si1: number, side1: "a" | "b", bi1: number, si2: number, side2: "a" | "b", bi2: number) => {
    if (si1 === si2 && side1 === side2 && bi1 === bi2) return;

    // Validação operacional: respeita as regras de tamanho/orientação dos slots
    // (ver `canSwapPlacements`). Sem os planos carregados (caso raro), libera
    // a troca para preservar o comportamento histórico do painel.
    const findPlacement = (sIdx: number, side: "a" | "b", bi: number) =>
      layoutPlans[sIdx]?.placements.find((p) => p.side === side && p.bi === bi) ?? null;
    const pl1 = findPlacement(si1, side1, bi1);
    const pl2 = findPlacement(si2, side2, bi2);
    if (pl1 && pl2 && !canSwapPlacements(pl1, pl2)) {
      setSwapHint(`Troca bloqueada — só é possível trocar P por G se ambos estiverem em orientação longitudinal.`);
      return;
    }

    const newSeqs = sequences.map(s => ({ a: [...s.a], b: [...s.b] }));
    const tmp = newSeqs[si1][side1][bi1];
    newSeqs[si1][side1][bi1] = newSeqs[si2][side2][bi2];
    newSeqs[si2][side2][bi2] = tmp;
    setSequences(newSeqs);

    setLayoutPlans(prev => {
      const next = prev.map(plan => ({ ...plan, placements: plan.placements.map(p => ({ ...p })) }));
      const findIdx = (sIdx: number, side: "a" | "b", bi: number) =>
        next[sIdx]?.placements.findIndex(p => p.side === side && p.bi === bi) ?? -1;
      const i1 = findIdx(si1, side1, bi1);
      const i2 = findIdx(si2, side2, bi2);
      if (i1 < 0 || i2 < 0) return next;
      const p1 = next[si1].placements[i1];
      const p2 = next[si2].placements[i2];
      // Mantém o slot quando o fardo recebido tem o mesmo tamanho do antigo.
      // Quando troca P long ↔ G long, o slot adota as dimensões naturais do
      // novo fardo (P long = 1,10 / G long = 1,40 m) e o trilho (mesma
      // linha Y/H) é re-empacotado lado a lado para evitar sobreposição
      // ou gap — o fardo trocado "empurra" ou "puxa" os vizinhos.
      const t1 = p1.bale.tamanho ?? p1.tamanho;
      const t2 = p2.bale.tamanho ?? p2.tamanho;
      const sameSize = t1 === t2;
      const longWidthFor = (sz: typeof p1.tamanho) => (sz === "G" ? BALE_G_LENGTH_M : BALE_P_LENGTH_M);
      next[si1].placements[i1] = sameSize
        ? { ...p1, bale: p2.bale }
        : { ...p1, bale: p2.bale, tamanho: t2, w: longWidthFor(t2) };
      next[si2].placements[i2] = sameSize
        ? { ...p2, bale: p1.bale }
        : { ...p2, bale: p1.bale, tamanho: t1, w: longWidthFor(t1) };

      // Re-empacota o(s) trilho(s) afetado(s) se a troca mudou larguras.
      if (!sameSize) {
        repackRowContaining(next[si1].placements, i1);
        if (si1 !== si2) repackRowContaining(next[si2].placements, i2);
        else if (!sameRow(next[si1].placements[i1], next[si1].placements[i2])) {
          repackRowContaining(next[si1].placements, i2);
        }
      }
      return next;
    });

    setSelected(null);
    setSwapHint(null);
  };

  /**
   * Rotaciona em 90° o fardo do slot informado: troca w↔h, mantendo o
   * canto superior-esquerdo (x, y). Permite ao operador alternar
   * transversal ↔ longitudinal para acomodar a operação.
   */
  const rotateBale = (si: number, side: "a" | "b", bi: number) => {
    setLayoutPlans(prev => prev.map((plan, idx) => {
      if (idx !== si) return plan;
      return {
        ...plan,
        placements: plan.placements.map(p => {
          if (p.side !== side || p.bi !== bi) return p;
          const newW = p.h;
          const newH = p.w;
          // Não deixa o fardo ultrapassar a área útil em X após rotacionar.
          const newX = Math.min(p.x, plan.areaLength - newW);
          return {
            ...p,
            x: Math.max(0, newX),
            w: newW,
            h: newH,
            note: (p.note ? p.note + " · " : "") + "rotacionado",
          };
        }),
      };
    }));
  };

  const handleDragStart = (si: number, side: "a" | "b", bi: number) => {
    dragSrc.current = { si, side, bi };
  };

  /**
   * Drag-and-drop sempre realiza uma troca direta — origem ⇄ destino —
   * mesmo que ambos estejam no mesmo lado da mesma sequência. Como o
   * layout é editado in-place em `layoutPlans`, o efeito visual é imediato
   * e simétrico ao painel "Trocar com…".
   */
  const handleDrop = (si: number, side: "a" | "b", bi: number) => {
    const src = dragSrc.current;
    if (!src) {
      return;
    }
    swapBales(src.si, src.side, src.bi, si, side, bi);
    dragSrc.current = null;
  };

  /**
   * Restaura o layout a partir das `sequences` correntes, descartando
   * trocas e rotações manuais. Útil quando o operador quer voltar ao
   * arranjo automático recomendado.
   */
  const resetLayout = () => {
    regeneratePlans(sequences);
    setSelected(null);
    setSwapHint(null);
  };

  // Aviso de troca bloqueada some sozinho após alguns segundos para não
  // poluir o painel quando o operador continuar trabalhando.
  useEffect(() => {
    if (!swapHint) return;
    const t = window.setTimeout(() => setSwapHint(null), 3500);
    return () => window.clearTimeout(t);
  }, [swapHint]);

  const overallComposition = useMemo(() => {
    const all = sequences.flatMap((s) => [...s.a, ...s.b]);
    return summarizeComposition(all);
  }, [sequences]);

  const legendEntries = useMemo(() => {
    if (!h) return [] as { prod: string; lots: string[] }[];
    const pl: Record<string, string[]> = {};
    h.lots.forEach(l => {
      if (!pl[l.produtor]) pl[l.produtor] = [];
      if (!pl[l.produtor].includes(l.lote)) pl[l.produtor].push(l.lote);
    });
    return Object.entries(pl)
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
      .map(([prod, ls]) => ({
        prod,
        lots: [...ls].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true })),
      }));
  }, [h]);

  if (!h) {
    return (
      <div className="page page--wide active" style={{ display: "block" }}>
        <div className="pg-title">Planejador de Sequências</div>
        <p style={{ color: "var(--tx3)" }}>Nenhuma mistura selecionada para sequenciar.</p>
        <button className="btn btn-s" onClick={() => setCurStep(1)}>← Voltar</button>
      </div>
    );
  }

  const goBack = () => {
    const idx = history.findIndex(x => x.name === h.name);
    if (idx >= 0) viewHistory(idx);
    else setCurStep(1);
  };

  const handleSeqPDF = () => {
    if (!h || !sequences.length) return;
    const doc = buildSeqPDF({
      mixName: h.name,
      params: h.params,
      lots: h.lots,
      seqWeightKg: seqWeight,
      baleWtKg,
      sequences,
      thresholds,
      bps,
      used,
      dropped,
      totalBales,
    });
    doc.save(`${(h.name || "sequencias").replace(/\s+/g, "_")}_sequencias.pdf`);
  };

  return (
    <div className="page page--wide active" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="pg-title">Sequências — {h.name}</div>
          <div className="pg-sub" style={{ marginBottom: 0 }}>
            {h.params.weight.toFixed(2)} ton · {h.lots.reduce((s, l) => s + (l.allocBales ?? 0), 0)} fardos
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-s" onClick={goBack}>← Voltar</button>
          <button type="button" className="btn btn-s btn-sm" onClick={handleSeqPDF} disabled={!generated || !sequences.length}>
            📄 PDF
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <label className="lbl">Peso por Sequência (kg)</label>
            <input type="number" className="inp inp-num" value={seqWeight} min={500} step={500} style={{ width: 130 }} onChange={(e) => setSeqWeight(parseInt(e.target.value) || 9000)} />
          </div>
          <div>
            <label className="lbl">Mín. Produtores / Seq</label>
            <input type="number" className="inp inp-num" value={minProds} min={1} max={20} step={1} style={{ width: 80 }} onChange={(e) => setMinProds(parseInt(e.target.value) || 3)} />
          </div>
          <button className="btn btn-p" onClick={doGenerate}>🔄 Gerar Sequências</button>
        </div>

        {generated && (
          <>
            {(isOdd || dropped > 0) && (
              <div className="seq-notice">
                ⚠️ Mistura com <strong>{totalBales}</strong> fardos{isOdd ? " (ímpar)" : ""}.
                {dropped > 0 && <> <strong>{dropped}</strong> fardo{dropped > 1 ? "s" : ""} removido{dropped > 1 ? "s" : ""} para manter sequências pares.</>}
                {" "}Utilizados: <strong>{used}</strong> fardos.
              </div>
            )}

            <div className="mx" style={{ marginBottom: 12 }}>
              {[
                { l: "Sequências", v: String(nSeq), c: "var(--cy)" },
                { l: "Fardos/Seq", v: String(bps), c: "var(--tx)" },
                { l: "Peso/Seq", v: `${(bps * baleWtKg).toFixed(0)} kg`, c: "var(--cy)" },
                { l: "Peso Fardo", v: `${baleWtKg.toFixed(0)} kg`, c: "var(--tx2)" },
                { l: "Fardos", v: `${used}/${totalBales}`, c: dropped > 0 ? "var(--am)" : "var(--tx2)" },
              ].map(k => (
                <div key={k.l} style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.l}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: k.c, marginTop: 3 }}>{k.v}</div>
                </div>
              ))}
            </div>

            {(() => {
              const c = overallComposition;
              const modeText =
                c.mode === "p_only"
                  ? "Apenas fardos P"
                  : c.mode === "g_only"
                    ? "Apenas fardos G"
                    : c.mode === "mixed"
                      ? "Mistura P + G"
                      : "Tamanho não informado";
              const cls = compositionBadgeClass(c.mode);
              return (
                <div className="seq-layout-panel">
                  <div className="seq-layout-panel-hdr">
                    <div>
                      <div className="seq-layout-panel-title">Disposição física dos fardos</div>
                      <div className="seq-layout-panel-sub">
                        Área útil: <strong>{LAYOUT_DIMS_TEXT.area}</strong> · Fardo P:{" "}
                        <strong>1,10 × 0,58 m</strong> · Fardo G: <strong>1,40 × 0,58 m</strong>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={cls}>{modeText}</span>
                      <span className="seq-layout-count">{c.p} P · {c.g} G{c.unknown > 0 ? ` · ${c.unknown} sem tam.` : ""}</span>
                    </div>
                  </div>
                  {c.mode === "p_only" && (
                    <div className="seq-layout-note">
                      ✔ Apenas fardos P — dispostos <strong>transversalmente</strong> (1,10 m em Y), duas fileiras empilhadas
                      preenchem exatamente a largura do braço (2,20 m).
                    </div>
                  )}
                  {c.mode === "g_only" && (
                    <div className="seq-layout-note">
                      ✔ Todos os fardos são G — disposição longitudinal convencional em duas fileiras.
                    </div>
                  )}
                  {c.mode === "unknown" && (
                    <div className="seq-layout-note seq-layout-note--warn">
                      ⚠ Nenhum lote informou o tamanho do fardo (P/G). Inclua a coluna <strong>TAMANHO</strong> no CSV de estoque
                      (valores P ou G) para habilitar a recomendação real. A visualização assume P como padrão.
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="seq-legend">
              {legendEntries.map(({ prod: p, lots: ls }) => {
                const act = highlight === p;
                return (
                  <div
                    key={p}
                    className={`seq-leg-btn${act ? " active" : ""}`}
                    onClick={() => setHighlight(highlight === p ? null : p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setHighlight(highlight === p ? null : p);
                      }
                    }}
                  >
                    <div>
                      <div className="seq-leg-name">{p}</div>
                      <div className="seq-leg-lots">{ls.join(", ")}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {sequences.map((seq, si) => {
        const all = [...seq.a, ...seq.b];
        const n = all.length;
        const wt = n * baleWtKg;
        const last = n < bps * 0.8;
        const prds = [...new Set(all.map(b => b.produtor))];
        const lts = [...new Set(all.map(b => b.lote))];
        const sp = computeSeqParams(all);

        const swapOpen = selected && selected.si === si;
        const candidates: { b: SeqBale; si: number; side: "a" | "b"; bi: number }[] = [];
        if (swapOpen && selected) {
          // O slot de origem precisa estar carregado para validar candidatos
          // segundo `canSwapPlacements` (regra P↔G só na longitudinal).
          const srcPlacement = layoutPlans[selected.si]?.placements.find(
            (p) => p.side === selected.side && p.bi === selected.bi,
          ) ?? null;
          sequences.forEach((s2, si2) => {
            if (si2 === si) return;
            const plan2 = layoutPlans[si2];
            const checkAndPush = (b: SeqBale, side: "a" | "b", bi2: number) => {
              const dstPlacement = plan2?.placements.find((p) => p.side === side && p.bi === bi2) ?? null;
              if (srcPlacement && dstPlacement && !canSwapPlacements(srcPlacement, dstPlacement)) return;
              candidates.push({ b, si: si2, side, bi: bi2 });
            };
            s2.a.forEach((b, bi2) => checkAndPush(b, "a", bi2));
            s2.b.forEach((b, bi2) => checkAndPush(b, "b", bi2));
          });
          candidates.sort((a, b) => b.b.iq - a.b.iq);
        }

        return (
          <div key={si} className={`seq-card${last ? " is-last" : ""}`}>
            <div className="seq-header">
              <div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "var(--cy)" }}>Seq {si + 1}</span>
                {last && <span style={{ fontSize: 10, color: "var(--am)", fontWeight: 700, marginLeft: 6 }}>RESTANTE</span>}
                <span style={{ fontSize: 11, color: "var(--tx3)", marginLeft: 8 }}>
                  {n} fardos · {wt.toFixed(0)} kg · {prds.length} prod · {lts.length} lotes
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: iqColor(sp.iq || 0) }}>
                  IQ {(sp.iq || 0).toFixed(0)}
                </div>
                <div style={{ fontSize: 9, color: "var(--tx3)" }}>{iqLabel(sp.iq || 0)}</div>
              </div>
            </div>

            {layoutPlans[si] && (
              <div className="seq-layout-section">
                <div className="seq-layout-section-hdr">
                  <span className="seq-layout-section-title">Layout físico</span>
                  <div className="seq-layout-section-actions">
                    <span className="seq-layout-section-hint">
                      Arrastar = trocar fardos · Clicar = selecionar (⟳ gira 90°)
                    </span>
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={resetLayout}
                      title="Recalcula o layout automático para esta e demais sequências"
                    >
                      ↺ Resetar layout
                    </button>
                  </div>
                </div>
                {swapHint && (
                  <div className="seq-layout-swap-hint" role="status" aria-live="polite">
                    ⚠ {swapHint}
                  </div>
                )}
                <LayoutCanvas
                  plan={layoutPlans[si]}
                  si={si}
                  highlightProducer={highlight}
                  selectedKey={selected && selected.si === si ? `${selected.side}:${selected.bi}` : null}
                  onSelect={(side, bi) => {
                    if (selected && selected.si === si && selected.side === side && selected.bi === bi) {
                      setSelected(null);
                    } else {
                      setSelected({ si, side, bi });
                    }
                  }}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onDragEnd={() => { dragSrc.current = null; }}
                  onRotate={rotateBale}
                  canDropOn={(dstSi, dstSide, dstBi) => {
                    const src = dragSrc.current;
                    if (!src) return null;
                    const sp = layoutPlans[src.si]?.placements.find((p) => p.side === src.side && p.bi === src.bi);
                    const dp = layoutPlans[dstSi]?.placements.find((p) => p.side === dstSide && p.bi === dstBi);
                    if (!sp || !dp) return null;
                    if (src.si === dstSi && src.side === dstSide && src.bi === dstBi) return null;
                    return canSwapPlacements(sp, dp);
                  }}
                />
                {layoutPlans[si].notes.length > 0 && (
                  <ul className="seq-layout-notes">
                    {layoutPlans[si].notes.map((t, ni) => (
                      <li key={ni}>{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {swapOpen && selected && (
              <div className="seq-swap open">
                <div className="seq-swap-title">
                  🔄 Trocar <strong>{seq[selected.side][selected.bi]?.lote}</strong>{" "}
                  <span style={{ fontWeight: 600, color: "var(--tx2)" }}>{seq[selected.side][selected.bi]?.produtor}</span>{" "}
                  (IQ {seq[selected.side][selected.bi]?.iq.toFixed(0)}) — selecione o substituto:{" "}
                  <span style={{ cursor: "pointer", color: "var(--tx3)", marginLeft: 8 }} onClick={() => setSelected(null)}>✕ fechar</span>
                </div>
                <div className="seq-swap-pool">
                  {candidates.map((c, ci) => (
                    <div
                      key={ci}
                      className="seq-swap-bale"
                      style={{ background: iqColor(c.b.iq) }}
                      title={`${c.b.lote} — ${c.b.produtor}\nIQ: ${c.b.iq.toFixed(0)} | Seq ${c.si + 1}`}
                      onClick={() => swapBales(si, selected.side, selected.bi, c.si, c.side, c.bi)}
                    >
                      <span className="seq-swap-bale-lote">{c.b.lote}</span>
                      <span className="seq-swap-bale-prod">{c.b.produtor}</span>
                      <span className="seq-swap-bale-iq">{c.b.iq.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="seq-params">
              {["uhml", "str_val", "elg", "ui", "mic", "sf", "mst"].map(k => {
                const p = PARAMS.find(x => x.key === k);
                if (!p) return null;
                const v = sp[k] || 0;
                const ok = seqParamOk(k, v, thresholds);
                return (
                  <div key={k} className="seq-p">
                    <div className="seq-p-lbl">{p.label}</div>
                    <div className="seq-p-val" style={{ color: ok ? "var(--gn)" : "var(--rd)" }}>
                      {v.toFixed(p.prec)}
                    </div>
                  </div>
                );
              })}
              <div className="seq-p">
                <div className="seq-p-lbl">R$/ton</div>
                <div className="seq-p-val" style={{ color: "var(--cy)" }}>{fmtBRL(sp.custo || 0)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
