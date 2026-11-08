/**
 * App store v2 (app foundation). zustand v5 + persist, localStorage key 'clm-store-v2'.
 * Old 'clm-store-v1' data (v0 Bolivian demo) is ignored.
 *
 * The app owns persistence and the audit trail (CONTRACT §0 Statelessness): zones, rule overrides,
 * credit rules and the audit live INSIDE each Portfolio; agent recommendations are kept per portfolio id.
 *
 * Targets: every portfolio action takes `pid`. Use DRAFT ('draft') to edit the wizard draft.
 *
 * zustand v5 rule: never return a freshly built array/object from a selector without useShallow.
 * Select raw state (`useStore(s => s.draft)`) and derive with useMemo.
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { syncZones } from '@/domain/rules';
import type { AgentRecommendation, CropTemplate, Loan, Portfolio, RuleChange } from '@/domain/types';
import {
  commitChange,
  makeChange,
  makeProposalDecision,
  makeRevert,
  type Actor,
  type ChangeInput,
} from '@/domain/rules';
import {
  emptyPortfolio,
  withFarmAdded,
  withFarmRemoved,
  withFarmUpdated,
  withLoan,
  withMeta,
  withSharedZoneAdded,
  withZoneRemoved,
  withZoneUpdated,
  type FarmPatch,
  type NewFarmInput,
  type PortfolioMeta,
  type ZonePatch,
} from './portfolio';
import { newId } from './ids';

/** Pseudo portfolio id that targets the wizard draft. */
export const DRAFT = 'draft' as const;
export const STORE_KEY = 'clm-store-v2';
export const DEFAULT_USER_NAME = 'Credit analyst';

type Templates = readonly CropTemplate[] | null | undefined;

export type RuleChangeRequest = Omit<ChangeInput, 'actor' | 'status' | 'recommendationId'> & { actor?: Actor };

export interface StoreState {
  portfolios: Portfolio[];
  draft: Portfolio | null;
  wizardStep: number;
  /** Agent recommendations per portfolio id (newest last). Proposal state is read from the audit (proposalState). */
  recommendations: Record<string, AgentRecommendation[]>;
  /** Name recorded as the actor of user changes in the audit trail. */
  userName: string;
  /** True once the sample portfolios were auto-loaded (or the store already held portfolios) on a first app start. */
  samplesSeeded: boolean;
  /** Agent side panel (UI only, not persisted). Context says what the agent is asked about. */
  agentPanel: AgentPanelState;

  /* draft lifecycle */
  /** Starts a fresh draft (replaces any draft); step → 0. Returns the draft's future portfolio id. */
  startDraft: (opts?: { country?: string; currency?: Portfolio['currency'] }) => string;
  /** Moves the draft into `portfolios` (name trimmed, createdAt now). Returns its id ('' if no draft). */
  commitDraft: () => string;
  discardDraft: () => void;
  setWizardStep: (n: number) => void;

  /* portfolios */
  /** Adds or replaces (same id) a portfolio, e.g. the sample from GET /portfolios/sample. */
  addPortfolio: (p: Portfolio) => void;
  deletePortfolio: (id: string) => void;
  /**
   * Refreshes the display fields (name, code, lender) of a stored sample portfolio from the service's current sample.
   * Farms, loans, rules, rule edits and the audit trail are untouched; nothing is audited. No-op when unchanged.
   */
  refreshSampleMeta: (id: string, meta: { name: string; code?: string | null; lender: string }) => void;
  setSamplesSeeded: (v: boolean) => void;
  updateMeta: (pid: string, patch: PortfolioMeta) => void;

  /* farms */
  /** Returns the new farm id ('' when pid is unknown). */
  addFarm: (pid: string, input: NewFarmInput) => string;
  updateFarm: (pid: string, farmId: string, patch: FarmPatch) => void;
  removeFarm: (pid: string, farmId: string) => void;
  setLoan: (pid: string, farmId: string, loan: Loan | null) => void;

  /* zones */
  /** Adds a shared 35 km² zone at [lng, lat]. Returns its id ('' when pid is unknown). */
  addSharedZone: (pid: string, center: [number, number], opts?: { name?: string; color?: string | null }) => string;
  updateZone: (pid: string, zoneId: string, patch: ZonePatch) => void;
  removeZone: (pid: string, zoneId: string) => void;

  /* rules + audit */
  /**
   * Applies an agronomic or credit-rule edit and appends it to the audit (oldValue = effective value now).
   * newValue null = reset to inherited. Pass the templates from useCrops() so oldValue can be resolved.
   */
  applyRuleChange: (pid: string, req: RuleChangeRequest, templates: Templates) => RuleChange | null;
  /** Reverts an applied change (appends a new audited change). */
  revertChange: (pid: string, changeId: string, templates: Templates) => RuleChange | null;

  /* agent */
  addRecommendation: (pid: string, rec: AgentRecommendation) => void;
  /** Applies one proposal of a recommendation: appends an 'applied' copy attributed to the user. */
  applyProposal: (pid: string, recId: string, proposalId: string, templates: Templates) => RuleChange | null;
  /** Records a 'dismissed' copy; nothing changes in the rules. */
  dismissProposal: (pid: string, recId: string, proposalId: string, templates: Templates) => RuleChange | null;
  clearRecommendations: (pid: string) => void;

  setUserName: (name: string) => void;

  /* agent panel (shell slot) */
  /** Opens the agent side panel with a context (portfolio, and optionally one zone or one farm). */
  openAgent: (ctx: Omit<AgentPanelState, 'open'>) => void;
  closeAgent: () => void;
}

export interface AgentPanelState {
  open: boolean;
  portfolioId: string | null;
  zoneId: string | null;
  farmId: string | null;
}

/** In-memory fallback so the store also works where localStorage is missing (node tests, private mode). */
const memory = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : (memory.get(k) ?? null);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
      else memory.set(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
      else memory.delete(k);
    } catch {
      memory.delete(k);
    }
  },
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const getP = (pid: string): Portfolio | undefined => (pid === DRAFT ? (get().draft ?? undefined) : get().portfolios.find((p) => p.id === pid));
      const putP = (pid: string, next: Portfolio) => {
        if (pid === DRAFT) set({ draft: next });
        else set((s) => ({ portfolios: s.portfolios.map((p) => (p.id === pid ? next : p)) }));
      };
      /** Runs a pure reducer on the target portfolio; no-op when it does not exist or nothing changed. */
      const mutate = (pid: string, fn: (p: Portfolio) => Portfolio) => {
        const p = getP(pid);
        if (!p) return;
        const next = fn(p);
        if (next !== p) putP(pid, next);
      };
      const user = (): Actor => ({ kind: 'user', name: get().userName || DEFAULT_USER_NAME });
      const findProposal = (pid: string, recId: string, proposalId: string) => {
        const rec = get().recommendations[pid]?.find((r) => r.id === recId);
        const proposal = rec?.proposals.find((c) => c.id === proposalId);
        return rec && proposal ? { rec, proposal } : null;
      };

      return {
        portfolios: [],
        draft: null,
        wizardStep: 0,
        recommendations: {},
        userName: DEFAULT_USER_NAME,
        samplesSeeded: false,
        agentPanel: { open: false, portfolioId: null, zoneId: null, farmId: null },

        startDraft: (opts) => {
          const d = emptyPortfolio(newId('pf'), opts);
          set({ draft: d, wizardStep: 0 });
          return d.id;
        },
        commitDraft: () => {
          const d = get().draft;
          if (!d) return '';
          const p: Portfolio = syncZones({
            ...d,
            name: d.name.trim() || 'Untitled portfolio',
            lender: d.lender.trim(),
            createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          });
          set((s) => {
            const recs = { ...s.recommendations };
            if (recs[DRAFT]) {
              recs[p.id] = recs[DRAFT];
              delete recs[DRAFT];
            }
            return { portfolios: [...s.portfolios.filter((x) => x.id !== p.id), p], draft: null, wizardStep: 0, recommendations: recs };
          });
          return p.id;
        },
        discardDraft: () =>
          set((s) => {
            const recs = { ...s.recommendations };
            delete recs[DRAFT];
            return { draft: null, wizardStep: 0, recommendations: recs };
          }),
        setWizardStep: (n) => set({ wizardStep: Math.max(0, Math.floor(n)) }),

        addPortfolio: (p) => {
          const clean = syncZones(p);
          set((s) => {
            const exists = s.portfolios.some((x) => x.id === clean.id);
            return { portfolios: exists ? s.portfolios.map((x) => (x.id === clean.id ? clean : x)) : [...s.portfolios, clean] };
          });
        },
        deletePortfolio: (id) =>
          set((s) => {
            const recs = { ...s.recommendations };
            delete recs[id];
            return { portfolios: s.portfolios.filter((p) => p.id !== id), recommendations: recs };
          }),
        updateMeta: (pid, patch) => mutate(pid, (p) => withMeta(p, patch)),
        refreshSampleMeta: (id, meta) =>
          set((s) => ({
            portfolios: s.portfolios.map((p) =>
              p.id === id && (p.name !== meta.name || (p.code ?? null) !== (meta.code ?? null) || p.lender !== meta.lender)
                ? { ...p, name: meta.name, code: meta.code ?? null, lender: meta.lender }
                : p,
            ),
          })),
        setSamplesSeeded: (v) => set({ samplesSeeded: v }),

        addFarm: (pid, input) => {
          const p = getP(pid);
          if (!p) return '';
          const [next, id] = withFarmAdded(p, input);
          putP(pid, next);
          return id;
        },
        updateFarm: (pid, farmId, patch) => mutate(pid, (p) => withFarmUpdated(p, farmId, patch)),
        removeFarm: (pid, farmId) => mutate(pid, (p) => withFarmRemoved(p, farmId)),
        setLoan: (pid, farmId, loan) => mutate(pid, (p) => withLoan(p, farmId, loan)),

        addSharedZone: (pid, center, opts) => {
          const p = getP(pid);
          if (!p) return '';
          const [next, id] = withSharedZoneAdded(p, center, opts);
          putP(pid, next);
          return id;
        },
        updateZone: (pid, zoneId, patch) => mutate(pid, (p) => withZoneUpdated(p, zoneId, patch)),
        removeZone: (pid, zoneId) => mutate(pid, (p) => withZoneRemoved(p, zoneId)),

        applyRuleChange: (pid, req, templates) => {
          const p = getP(pid);
          if (!p) return null;
          const change = makeChange(p, templates, { ...req, actor: req.actor ?? user(), status: 'applied' });
          putP(pid, commitChange(p, change, templates));
          return change;
        },
        revertChange: (pid, changeId, templates) => {
          const p = getP(pid);
          if (!p) return null;
          const change = makeRevert(p, templates, changeId, user());
          if (!change) return null;
          putP(pid, commitChange(p, change, templates));
          return change;
        },

        addRecommendation: (pid, rec) =>
          set((s) => ({ recommendations: { ...s.recommendations, [pid]: [...(s.recommendations[pid] ?? []).filter((r) => r.id !== rec.id), rec] } })),
        applyProposal: (pid, recId, proposalId, templates) => {
          const p = getP(pid);
          const hit = findProposal(pid, recId, proposalId);
          if (!p || !hit) return null;
          const change = makeProposalDecision(p, templates, hit.rec, hit.proposal, 'applied', user());
          putP(pid, commitChange(p, change, templates));
          return change;
        },
        dismissProposal: (pid, recId, proposalId, templates) => {
          const p = getP(pid);
          const hit = findProposal(pid, recId, proposalId);
          if (!p || !hit) return null;
          const change = makeProposalDecision(p, templates, hit.rec, hit.proposal, 'dismissed', user());
          putP(pid, commitChange(p, change, templates));
          return change;
        },
        clearRecommendations: (pid) =>
          set((s) => {
            const recs = { ...s.recommendations };
            delete recs[pid];
            return { recommendations: recs };
          }),

        setUserName: (name) => set({ userName: name.trim() || DEFAULT_USER_NAME }),

        openAgent: (ctx) => set({ agentPanel: { open: true, portfolioId: ctx.portfolioId ?? null, zoneId: ctx.zoneId ?? null, farmId: ctx.farmId ?? null } }),
        closeAgent: () => set((s) => ({ agentPanel: { ...s.agentPanel, open: false } })),
      };
    },
    {
      name: STORE_KEY,
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        portfolios: s.portfolios,
        draft: s.draft,
        wizardStep: s.wizardStep,
        recommendations: s.recommendations,
        userName: s.userName,
        samplesSeeded: s.samplesSeeded,
      }),
    },
  ),
);

/** A single portfolio by id (stored reference, stable). Pass DRAFT for the wizard draft. */
export const usePortfolio = (id: string | undefined): Portfolio | undefined =>
  useStore((s) => (!id ? undefined : id === DRAFT ? (s.draft ?? undefined) : s.portfolios.find((p) => p.id === id)));

const NO_RECS: AgentRecommendation[] = [];
/** Agent recommendations of a portfolio (stable reference). */
export const useRecommendations = (pid: string | undefined): AgentRecommendation[] =>
  useStore((s) => (pid ? (s.recommendations[pid] ?? NO_RECS) : NO_RECS));

export { newId };
