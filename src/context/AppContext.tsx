import React, { createContext, useContext, useCallback, useState, useMemo, useRef, useEffect } from "react";
import type { Lot, MixParams, HistoryRecord } from "@/domain/stock";
import type { Thresholds, EngineRules } from "@/domain/types";
import {
  DEFAULT_RULES,
  PARAMS,
  ensureThresholds,
} from "@/domain/types";
import {
  calcMixParams,
  checkViolations,
  baleWeight,
} from "@/engine/constraints";
import { explainRelaxationSuggestion, optimizeMix, type OptimizerResult } from "@/engine/optimizer";
import { runAllStrategies, type StrategyResult } from "@/engine/strategies";
import { solverRouter } from "@/engine/solvers/router";
import { yieldToUi } from "@/engine/yield-ui";
import type { SolverMode, SolverOptions, SolverResult } from "@/engine/solvers/types";
import { parseCSVFile } from "@/io/csv";
import { buildAuditRecord } from "@/audit/trail";
import { computeQualityBaseline, filterUsableLots } from "@/engine/baseline";

const OPTIMIZER_VERSION = "2.0.0";

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function migrateUhmlToMm(v: unknown): unknown {
  if (typeof v !== "number" || !Number.isFinite(v)) return v;
  return v > 0 && v < 5 ? v * 25.4 : v;
}

function migrateHistoryUhml(history: HistoryRecord[]): HistoryRecord[] {
  let changed = false;
  const next = history.map((h) => {
    const uhmlParams = migrateUhmlToMm(h.params?.uhml);
    const uhmlThMin = migrateUhmlToMm(h.thresholds?.uhml?.min);
    const uhmlThMax = migrateUhmlToMm(h.thresholds?.uhml?.max);

    const lots = (h.lots || []).map((l) => {
      const uhml = migrateUhmlToMm(l.uhml) as number;
      if (uhml !== l.uhml) changed = true;
      return { ...l, uhml };
    });

    const params = { ...h.params, uhml: uhmlParams as number };
    const thresholds = h.thresholds
      ? { ...h.thresholds, uhml: { min: uhmlThMin as number, max: uhmlThMax as number } }
      : h.thresholds;

    if (params.uhml !== h.params.uhml) changed = true;
    if (thresholds && h.thresholds && (thresholds.uhml.min !== h.thresholds.uhml.min || thresholds.uhml.max !== h.thresholds.uhml.max)) changed = true;

    return { ...h, params, thresholds, lots };
  });

  if (changed) saveToStorage("ntx_hist", next);
  return next;
}

interface AppState {
  stock: Lot[];
  currentMix: Lot[];
  history: HistoryRecord[];
  curStep: number;
  curPage: "step1" | "step2" | "step3" | "config" | "hist" | "seq" | "rules";
  thresholds: Thresholds;
  rules: EngineRules;
  optimizationPriority: string;
  targets: Record<string, number | null>;
  targetWeight: number;
  mixName: string;
  lastOptimization: OptimizerResult | null;
  lastCsvWarnings: string[];
  histDetailIndex: number | null;
  suggestions: StrategyResult[];
  seqHistRecord: HistoryRecord | null;
  solverMode: SolverMode;
  solverOptions: SolverOptions;
  lastSolverResult: SolverResult | null;
  isGenerating: boolean;
  generationStatus: string;
  generationProgress: number;
}

const initialState: AppState = {
  stock: [],
  currentMix: [],
  history: migrateHistoryUhml(loadFromStorage<HistoryRecord[]>("ntx_hist", [])),
  curStep: 1,
  curPage: "step1",
  thresholds: ensureThresholds(loadFromStorage<Thresholds | null>("ntx_thresh", null)),
  rules: loadFromStorage<EngineRules | null>("ntx_rules", null) || { ...DEFAULT_RULES },
  optimizationPriority: loadFromStorage<string>("ntx_priority", "rotation_first"),
  targets: {},
  targetWeight: 30,
  mixName: "",
  lastOptimization: null,
  lastCsvWarnings: [],
  histDetailIndex: null,
  suggestions: [],
  seqHistRecord: null,
  solverMode: loadFromStorage<SolverMode>("ntx_solver_mode", "classic"),
  solverOptions: loadFromStorage<SolverOptions>("ntx_solver_opts", {
    mcIterations: 20,
    saIterations: 3000,
    saT0: 500,
    saTmin: 0.1,
    saAlpha: 0.997,
  }),
  lastSolverResult: null,
  isGenerating: false,
  generationStatus: "",
  generationProgress: 0,
};

interface AppContextValue extends AppState {
  setStock: (lots: Lot[]) => void;
  setCurrentMix: (mix: Lot[]) => void;
  setCurStep: (n: number) => void;
  setCurPage: (p: AppState["curPage"]) => void;
  setThresholds: (t: Thresholds) => void;
  setRules: (r: EngineRules) => void;
  setOptimizationPriority: (p: string) => void;
  setTarget: (key: string, val: number | null) => void;
  setTargetWeight: (w: number) => void;
  setMixName: (n: string) => void;
  updateThreshold: (key: string, side: "min" | "max", val: number) => void;
  updateRule: (updates: Partial<EngineRules>) => void;
  loadStockFromFile: (file: File) => Promise<void>;
  resetStock: () => void;
  runEngine: (targetWeight: number) => Promise<void>;
  runStrategies: (targetWeight: number) => Promise<void>;
  selectSuggestion: (idx: number) => void;
  runWithTargets: (targetWeight: number) => Promise<void>;
  applyAlternative: (idx: number) => void;
  addLotToMix: (stockId: number) => void;
  removeLotFromMix: (idx: number) => void;
  editAllocation: (idx: number, field: "bales" | "weight", val: number) => void;
  saveMix: (name: string) => Promise<void>;
  viewHistory: (i: number) => void;
  deleteHistory: (i: number) => void;
  openSeqPlanner: (record: HistoryRecord) => void;
  isWarn: (key: string, v: number) => boolean;
  cellCls: (key: string, v: number) => string;
  weightOk: (targetW: number) => boolean;
  getParams: () => MixParams | null;
  getViolations: (params: MixParams | null) => ReturnType<typeof checkViolations>;
  getExplainRelaxation: () => string | null;
  hasCostData: () => boolean;
  applyQualityBaseline: () => void;
  setSolverMode: (m: SolverMode) => void;
  setSolverOptions: (o: Partial<SolverOptions>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persist = useCallback((updates: Partial<AppState>) => {
    setState((s) => {
      const next = { ...s, ...updates };
      if ("thresholds" in updates && updates.thresholds)
        saveToStorage("ntx_thresh", updates.thresholds);
      if ("rules" in updates && updates.rules) saveToStorage("ntx_rules", updates.rules);
      if ("history" in updates && updates.history) saveToStorage("ntx_hist", updates.history);
      if ("optimizationPriority" in updates && updates.optimizationPriority)
        saveToStorage("ntx_priority", updates.optimizationPriority);
      return next;
    });
  }, []);

  const setStock = useCallback(
    (lots: Lot[]) => persist({ stock: lots }),
    [persist]
  );

  const setCurrentMix = useCallback(
    (mix: Lot[]) => setState((s) => ({ ...s, currentMix: mix })),
    []
  );

  const setCurStep = useCallback(
    (n: number) =>
      setState((s) => {
        if (n === 2 && !s.stock.length) return s;
        if (n === 3 && !s.currentMix.length) return s;
        const page = n === 1 ? "step1" : n === 2 ? "step2" : "step3";
        return { ...s, curStep: n, curPage: page };
      }),
    []
  );

  const setCurPage = useCallback(
    (p: AppState["curPage"]) => setState((s) => ({ ...s, curPage: p })),
    []
  );

  const setThresholds = useCallback(
    (t: Thresholds) => persist({ thresholds: ensureThresholds(t) }),
    [persist]
  );

  const setRules = useCallback((r: EngineRules) => persist({ rules: r }), [persist]);

  const setOptimizationPriority = useCallback(
    (p: string) => persist({ optimizationPriority: p }),
    [persist]
  );

  const setTarget = useCallback(
    (key: string, val: number | null) =>
      setState((s) => {
        const targets = { ...s.targets, [key]: val };
        return { ...s, targets };
      }),
    []
  );

  const updateThreshold = useCallback(
    (key: string, side: "min" | "max", val: number) => {
      setState((s) => {
        const th = { ...s.thresholds };
        if (!th[key]) th[key] = { min: 0, max: 1 };
        th[key] = { ...th[key], [side]: val };
        saveToStorage("ntx_thresh", th);
        return { ...s, thresholds: ensureThresholds(th) };
      });
    },
    []
  );

  const updateRule = useCallback(
    (updates: Partial<EngineRules>) =>
      setState((s) => {
        const rules = { ...s.rules, ...updates };
        saveToStorage("ntx_rules", rules);
        return { ...s, rules };
      }),
    []
  );

  const loadStockFromFile = useCallback(
    async (file: File) => {
      try {
        const { lots, errors, warnings } = await parseCSVFile(file);
        if (errors.length) {
          alert("Erros no CSV:\n- " + errors.join("\n- "));
          return;
        }
        setState((s) => ({
          ...s,
          stock: lots,
          lastCsvWarnings: warnings,
          suggestions: [],
        }));
      } catch (err) {
        alert("Falha ao processar CSV: " + (err instanceof Error ? err.message : String(err)));
      }
    },
    []
  );

  const resetStock = useCallback(() => {
    setState((s) => ({
      ...s,
      stock: [],
      currentMix: [],
      lastOptimization: null,
      targets: {},
      suggestions: [],
      curStep: 1,
      curPage: "step1",
    }));
  }, []);

  const setTargetWeight = useCallback((w: number) => setState((s) => ({ ...s, targetWeight: w })), []);
  const setMixName = useCallback((n: string) => setState((s) => ({ ...s, mixName: n })), []);

  const runStrategies = useCallback(async (targetWeight: number) => {
    const snap = stateRef.current;
    if (!snap.stock.length) return;
    if (!filterUsableLots(snap.stock).length) {
      alert(
        "Nenhum lote tem todas as medidas HVI preenchidas (zeros = ainda não avaliado). Complete as análises ou ajuste o CSV.",
      );
      return;
    }

    setState((s) => ({
      ...s,
      isGenerating: true,
      generationStatus: "Gerando misturas…",
      generationProgress: 0,
    }));
    await yieldToUi();

    const isClassic = snap.solverMode === "classic";

    try {
      const results = await runAllStrategies(
        snap.stock,
        targetWeight,
        snap.rules,
        snap.thresholds,
        snap.optimizationPriority,
        (label, stepIndex, stepTotal) => {
          setState((s) => ({
            ...s,
            generationStatus: label,
            generationProgress: isClassic
              ? Math.round(((stepIndex + 1) / stepTotal) * 35)
              : Math.round(((stepIndex + 1) / stepTotal) * 28),
          }));
        },
      );

      let fourth: StrategyResult | null = null;
      let solverOut: SolverResult | null = null;

      if (isClassic) {
        setState((s) => ({
          ...s,
          generationStatus: "Engine otimizada (5 modos + local search)…",
          generationProgress: 40,
        }));
        await yieldToUi();
        const t0 = performance.now();
        const optRes = optimizeMix({
          stock: snap.stock,
          targetWeight,
          thresholds: snap.thresholds,
          rules: snap.rules,
          priority: snap.optimizationPriority,
          seed: Date.now(),
        });
        const elapsed = Math.round(performance.now() - t0);
        const best = optRes.best;
        if (best?.mix?.length && best.params) {
          fourth = {
            strategy: {
              id: "engine_optimized",
              name: "Engine Otimizada",
              icon: "\u2699\ufe0f",
              color: "#a855f7",
              desc: "Otimizador principal: 5 modos greedy + localImprove (até 1500 passos).",
              score: () => 0,
            },
            lots: best.mix.map((l) => ({ ...l })),
            params: best.params,
            violations: checkViolations(best.params, snap.thresholds),
            elapsed,
          };
        }
        setState((s) => ({ ...s, generationProgress: 85 }));
        await yieldToUi();
      } else {
        setState((s) => ({
          ...s,
          generationStatus:
            snap.solverMode === "montecarlo"
              ? "Monte Carlo: explorando soluções…"
              : "Simulated Annealing…",
          generationProgress: 35,
        }));
        await yieldToUi();

        const opts: SolverOptions = {
          ...snap.solverOptions,
          onMcProgress: (label, cur, tot) => {
            setState((s) => ({
              ...s,
              generationStatus: label,
              generationProgress: 35 + Math.round((cur / tot) * 55),
            }));
          },
        };

        solverOut = await solverRouter(
          snap.solverMode,
          {
            stock: snap.stock,
            targetWeight,
            thresholds: snap.thresholds,
            rules: snap.rules,
            priority: snap.optimizationPriority,
            seed: Date.now(),
          },
          opts,
        );

        const best = solverOut.result.best;
        if (best?.mix?.length && best.params) {
          const solverLabel = snap.solverMode === "montecarlo" ? "Monte Carlo" : "Simulated Annealing";
          fourth = {
            strategy: {
              id: `solver_${snap.solverMode}`,
              name: solverLabel,
              icon: snap.solverMode === "montecarlo" ? "\u{1f3b2}" : "\u{1f525}",
              color: snap.solverMode === "montecarlo" ? "#06b6d4" : "#f97316",
              desc:
                snap.solverMode === "montecarlo"
                  ? `Engine otimizada executada ${snap.solverOptions.mcIterations ?? 20}× com seeds aleatórios.`
                  : `Meta-heurística com ${snap.solverOptions.saIterations ?? 3000} iterações.`,
              score: () => 0,
            },
            lots: best.mix.map((l) => ({ ...l })),
            params: best.params,
            violations: checkViolations(best.params, snap.thresholds),
            elapsed: solverOut.elapsed,
          };
        }
      }

      const allSuggestions = fourth ? [...results, fourth] : results;

      if (!allSuggestions.length) {
        alert("Nenhuma estratégia conseguiu gerar mistura dentro dos limites e regras atuais. Revise os parâmetros.");
        setState((s) => ({
          ...s,
          isGenerating: false,
          generationStatus: "",
          generationProgress: 0,
        }));
        return;
      }

      setState((s) => ({
        ...s,
        suggestions: allSuggestions,
        lastSolverResult: solverOut,
        targetWeight,
        isGenerating: false,
        generationStatus: "",
        generationProgress: 100,
      }));
    } catch (err) {
      console.error(err);
      setState((s) => ({
        ...s,
        isGenerating: false,
        generationStatus: "",
        generationProgress: 0,
      }));
      alert("Falha ao gerar misturas.");
    }
  }, []);

  const selectSuggestion = useCallback(
    (idx: number) => {
      setState((s) => {
        const sug = s.suggestions[idx];
        if (!sug) return s;
        const isSolver = sug.strategy.id.startsWith("solver_");
        return {
          ...s,
          currentMix: sug.lots.map(l => ({ ...l })),
          lastSolverResult: isSolver ? s.lastSolverResult : null,
          curStep: 3,
          curPage: "step3",
        };
      });
    },
    []
  );

  const runEngine = useCallback(async (targetWeight: number) => {
    const s = stateRef.current;
    if (!s.stock.length) return;
    if (!filterUsableLots(s.stock).length) {
      alert(
        "Nenhum lote tem todas as medidas HVI preenchidas (zeros = ainda não avaliado). A engine só usa lotes com dados completos.",
      );
      return;
    }
    try {
      const solverOut = await solverRouter(
        s.solverMode,
        {
          stock: s.stock,
          targetWeight,
          thresholds: s.thresholds,
          rules: s.rules,
          priority: s.optimizationPriority,
          seed: Date.now(),
        },
        s.solverOptions,
      );
      const result = solverOut.result;
      const best = result.best;
      if (!best || !best.mix.length) {
        alert("Não foi possível gerar mistura. Revise regras e estoque.");
        return;
      }
      setState((prev) => ({
        ...prev,
        currentMix: best.mix.map((l) => ({ ...l })),
        lastOptimization: result,
        lastSolverResult: solverOut,
        targetWeight,
        curStep: 3,
        curPage: "step3",
      }));
    } catch (err) {
      console.error(err);
      alert("Falha ao executar engine.");
    }
  }, []);

  const runWithTargets = useCallback(async (targetWeight: number) => {
    const s = stateRef.current;
    const activeTargets: Record<string, number> = {};
    PARAMS.forEach((p) => {
      const v = s.targets[p.key];
      if (v != null && Number.isFinite(v)) activeTargets[p.key] = v;
    });
    if (!Object.keys(activeTargets).length) {
      alert("Preencha ao menos um target nos KPIs.");
      return;
    }
    if (!filterUsableLots(s.stock).length) {
      alert(
        "Nenhum lote tem todas as medidas HVI preenchidas. A otimização com targets exige lotes com dados completos.",
      );
      return;
    }
    try {
      const solverOut = await solverRouter(
        s.solverMode,
        {
          stock: s.stock,
          targetWeight,
          thresholds: s.thresholds,
          rules: s.rules,
          priority: s.optimizationPriority,
          seed: Date.now(),
          targetValues: activeTargets,
        },
        s.solverOptions,
      );
      const result = solverOut.result;
      const best = result.best;
      if (!best || !best.mix.length) {
        alert("Não foi possível atingir targets com as regras atuais.");
        return;
      }
      setState((prev) => ({
        ...prev,
        currentMix: best.mix.map((l) => ({ ...l })),
        lastOptimization: result,
        lastSolverResult: solverOut,
        targetWeight,
        curStep: 3,
        curPage: "step3",
      }));
    } catch (err) {
      console.error(err);
      alert("Falha ao otimizar com targets.");
    }
  }, []);

  const applyAlternative = useCallback((idx: number) => {
    setState((s) => {
      const alts = s.lastOptimization?.alternatives || [];
      const alt = alts[idx];
      if (!alt?.mix?.length) return s;
      return { ...s, currentMix: alt.mix.map((m) => ({ ...m })) };
    });
  }, []);

  const addLotToMix = useCallback((stockId: number) => {
    setState((s) => {
      const lot = s.stock.find((l) => l.id === stockId);
      if (!lot) return s;
      const entry = { ...lot, allocBales: 1, allocWeight: baleWeight(lot) };
      return { ...s, currentMix: [...s.currentMix, entry] };
    });
  }, []);

  const removeLotFromMix = useCallback((idx: number) => {
    setState((s) => {
      const mix = s.currentMix.filter((_, i) => i !== idx);
      return { ...s, currentMix: mix, curStep: mix.length ? s.curStep : 2, curPage: mix.length ? s.curPage : "step2" };
    });
  }, []);

  const editAllocation = useCallback((idx: number, field: "bales" | "weight", val: number) => {
    setState((s) => {
      const mix = [...s.currentMix];
      const l = mix[idx];
      if (!l) return s;
      const bw = baleWeight(l);
      if (field === "bales") {
        l.allocBales = Math.max(1, Math.min(l.fardos, Math.round(val) || 1));
        l.allocWeight = l.allocBales * bw;
      } else {
        l.allocWeight = Math.max(bw, Math.min(l.peso, val || bw));
        l.allocBales = Math.max(1, Math.round(l.allocWeight / bw));
      }
      return { ...s, currentMix: mix };
    });
  }, []);

  const saveMix = useCallback(
    async (name: string) => {
      setState((s) => {
        const params = calcMixParams(s.currentMix);
        if (!params) return s;
        const violations = checkViolations(params, s.thresholds);
        let score = 100;
        violations.forEach((v) => {
          const t = s.thresholds[v.key];
          const range = Math.max(0.0001, t.max - t.min);
          const dist = Math.abs(v.type === "below" ? t.min - v.val : v.val - t.max);
          score -= Math.min(25, (dist / range) * 100);
        });
        const wMatch = Math.abs(params.weight - s.targetWeight) <= Math.max(0.01, s.targetWeight * (s.rules.weightTol / 100));
        if (!wMatch) score -= 10;
        score = Math.max(0, Math.round(score));
        const rec: HistoryRecord = {
          id: Date.now(),
          name,
          date: new Date().toLocaleDateString("pt-BR"),
          params,
          thresholds: structuredClone(s.thresholds),
          score,
          lots: s.currentMix.map((l) => ({ ...l })),
        };
        const history = [rec, ...s.history];
        saveToStorage("ntx_hist", history);
        if (s.lastOptimization) {
          buildAuditRecord({
            stock: s.stock,
            rules: { ...s.rules } as Record<string, unknown>,
            thresholds: s.thresholds as Record<string, unknown>,
            optimizerVersion: OPTIMIZER_VERSION,
            best: s.lastOptimization.best,
            alternatives: s.lastOptimization.alternatives || [],
            diagnostics: s.lastOptimization.diagnostics || [],
            mixName: name,
          }).then((audit) => {
            const trail = loadFromStorage<unknown[]>("ntx_audit", []);
            saveToStorage("ntx_audit", [audit, ...trail]);
          });
        }
        return {
          ...s,
          history,
          stock: [],
          currentMix: [],
          lastOptimization: null,
          targets: {},
          suggestions: [],
          curStep: 1,
          curPage: "seq" as const,
          histDetailIndex: 0,
          seqHistRecord: rec,
        };
      });
    },
    []
  );

  const viewHistory = useCallback((i: number) => {
    setState((s) => ({ ...s, curPage: "hist", histDetailIndex: i }));
  }, []);

  const deleteHistory = useCallback((i: number) => {
    setState((s) => {
      const history = s.history.filter((_, idx) => idx !== i);
      saveToStorage("ntx_hist", history);
      return { ...s, history, curPage: "step1", histDetailIndex: null };
    });
  }, []);

  const openSeqPlanner = useCallback((record: HistoryRecord) => {
    setState((s) => ({
      ...s,
      seqHistRecord: record,
      curPage: "seq",
    }));
  }, []);

  const weightOk = useCallback(
    (targetW: number) => {
      const params = calcMixParams(state.currentMix);
      if (!params) return false;
      const tol = targetW * (state.rules.weightTol / 100);
      return Math.abs(params.weight - targetW) <= Math.max(0.01, tol);
    },
    [state.currentMix, state.rules.weightTol]
  );

  const getParams = useCallback(() => calcMixParams(state.currentMix), [state.currentMix]);

  const getViolations = useCallback(
    (params: MixParams | null) => checkViolations(params, state.thresholds),
    [state.thresholds]
  );

  const getExplainRelaxation = useCallback(
    () => (state.lastOptimization ? explainRelaxationSuggestion(state.lastOptimization) : null),
    [state.lastOptimization]
  );

  const isWarnFn = useCallback(
    (key: string, v: number) => {
      const p = PARAMS.find((x) => x.key === key);
      const t = state.thresholds[key];
      if (!p || !t) return false;
      return (p.good && v < t.min) || (!p.good && v > t.max);
    },
    [state.thresholds]
  );

  const cellClsFn = useCallback(
    (key: string, v: number) => (isWarnFn(key, v) ? "cell-warn" : ""),
    [isWarnFn]
  );

  const hasCostDataFn = useCallback(
    () => state.stock.some(s => s.custo > 0),
    [state.stock]
  );

  const applyQualityBaseline = useCallback(() => {
    setState((s) => {
      const b = computeQualityBaseline(s.stock);
      if (!b) {
        alert(
          "Não há lotes com HVI completo no estoque para calcular o baseline. Importe um CSV com medidas preenchidas ou aguarde as análises.",
        );
        return s;
      }
      const th = ensureThresholds(b.thresholds);
      saveToStorage("ntx_thresh", th);
      return { ...s, thresholds: th };
    });
  }, []);

  const setSolverMode = useCallback((m: SolverMode) => {
    saveToStorage("ntx_solver_mode", m);
    setState((s) => ({ ...s, solverMode: m, lastSolverResult: null }));
  }, []);

  const setSolverOptions = useCallback((o: Partial<SolverOptions>) => {
    setState((s) => {
      const solverOptions = { ...s.solverOptions, ...o };
      saveToStorage("ntx_solver_opts", solverOptions);
      return { ...s, solverOptions };
    });
  }, []);

  const value = useMemo(
    (): AppContextValue => ({
      ...state,
      setStock,
      setCurrentMix,
      setCurStep,
      setCurPage,
      setThresholds,
      setRules,
      setOptimizationPriority,
      setTarget,
      setTargetWeight,
      setMixName,
      updateThreshold,
      updateRule,
      loadStockFromFile,
      resetStock,
      runEngine,
      runStrategies,
      selectSuggestion,
      runWithTargets,
      applyAlternative,
      addLotToMix,
      removeLotFromMix,
      editAllocation,
      saveMix,
      viewHistory,
      deleteHistory,
      openSeqPlanner,
      isWarn: isWarnFn,
      cellCls: cellClsFn,
      weightOk,
      getParams,
      getViolations,
      getExplainRelaxation,
      hasCostData: hasCostDataFn,
      applyQualityBaseline,
      setSolverMode,
      setSolverOptions,
    }),
    [
      state,
      setStock,
      setCurrentMix,
      setCurStep,
      setCurPage,
      setThresholds,
      setRules,
      setOptimizationPriority,
      setTarget,
      setTargetWeight,
      setMixName,
      updateThreshold,
      updateRule,
      loadStockFromFile,
      resetStock,
      runEngine,
      runStrategies,
      selectSuggestion,
      runWithTargets,
      applyAlternative,
      addLotToMix,
      removeLotFromMix,
      editAllocation,
      saveMix,
      viewHistory,
      deleteHistory,
      openSeqPlanner,
      isWarnFn,
      cellClsFn,
      weightOk,
      getParams,
      getViolations,
      getExplainRelaxation,
      hasCostDataFn,
      applyQualityBaseline,
      setSolverMode,
      setSolverOptions,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
