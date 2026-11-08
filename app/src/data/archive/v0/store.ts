/**
 * App store. FINAL CONTRACT (foundation-owned).
 * zustand v5 + persist (localStorage key 'clm-store-v1').
 *
 * zustand v5 rule: never return a freshly built array/object from a selector without useShallow.
 * Prefer selecting raw state (e.g. `useStore(s => s.draft)`) and deriving with useMemo.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Polygon } from 'geojson';
import type { Farm, Loan, Portfolio, Zone } from '@/domain/types';
import {
  emptyDraft,
  withFarmAdded,
  withFarmRemoved,
  withFarmUpdated,
  withLoan,
  withZoneAdded,
  withZoneRemoved,
  withZoneUpdated,
} from './draft';
import { newId } from './ids';

export interface StoreState {
  portfolios: Portfolio[];
  draft: Portfolio | null;
  wizardStep: number;

  /** Starts a fresh draft (replaces any existing draft) with one default zone; resets the step to 0. */
  startDraft: () => void;
  updateDraft: (patch: Partial<Pick<Portfolio, 'name' | 'lender' | 'currency'>>) => void;
  /** Adds a farm from a drawn polygon; computes areaHa + centroid; crop 'soy'; zone = first zone. Returns the id. */
  addFarm: (polygon: Polygon) => string;
  /** Patch a farm. If `polygon` is patched, areaHa and centroid are recomputed. */
  updateFarm: (id: string, patch: Partial<Omit<Farm, 'id'>>) => void;
  removeFarm: (id: string) => void;
  addZone: (name: string) => string;
  updateZone: (id: string, patch: Partial<Omit<Zone, 'id'>>) => void;
  /** Removes a zone and reassigns its farms to the first remaining zone. The last zone cannot be removed. */
  removeZone: (id: string) => void;
  /** Sets (or clears, with undefined) a farm's loan. */
  setLoan: (farmId: string, loan: Loan | undefined) => void;
  setWizardStep: (n: number) => void;
  /** Moves the draft into `portfolios`, clears the draft, resets the step. Returns the portfolio id ('' if no draft). */
  commitDraft: () => string;
  discardDraft: () => void;
  deletePortfolio: (id: string) => void;
  /** Adds a portfolio (replaces one with the same id). */
  addPortfolio: (p: Portfolio) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const mutateDraft = (fn: (d: Portfolio) => Portfolio) => {
        const d = get().draft;
        if (d) set({ draft: fn(d) });
      };
      return {
        portfolios: [],
        draft: null,
        wizardStep: 0,

        startDraft: () => set({ draft: emptyDraft(), wizardStep: 0 }),
        updateDraft: (patch) => mutateDraft((d) => ({ ...d, ...patch })),
        addFarm: (polygon) => {
          const id = newId('farm');
          mutateDraft((d) => withFarmAdded(d, polygon, id));
          return id;
        },
        updateFarm: (id, patch) => mutateDraft((d) => withFarmUpdated(d, id, patch)),
        removeFarm: (id) => mutateDraft((d) => withFarmRemoved(d, id)),
        addZone: (name) => {
          const id = newId('zone');
          mutateDraft((d) => withZoneAdded(d, name, id));
          return id;
        },
        updateZone: (id, patch) => mutateDraft((d) => withZoneUpdated(d, id, patch)),
        removeZone: (id) => mutateDraft((d) => withZoneRemoved(d, id)),
        setLoan: (farmId, loan) => mutateDraft((d) => withLoan(d, farmId, loan)),
        setWizardStep: (n) => set({ wizardStep: Math.max(0, Math.floor(n)) }),
        commitDraft: () => {
          const d = get().draft;
          if (!d) return '';
          const p: Portfolio = { ...d, name: d.name.trim() || 'Untitled portfolio', lender: d.lender.trim(), createdAt: new Date().toISOString() };
          set((s) => ({ portfolios: [...s.portfolios.filter((x) => x.id !== p.id), p], draft: null, wizardStep: 0 }));
          return p.id;
        },
        discardDraft: () => set({ draft: null, wizardStep: 0 }),
        deletePortfolio: (id) => set((s) => ({ portfolios: s.portfolios.filter((p) => p.id !== id) })),
        addPortfolio: (p) => set((s) => ({ portfolios: [...s.portfolios.filter((x) => x.id !== p.id), p] })),
      };
    },
    {
      name: 'clm-store-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ portfolios: s.portfolios, draft: s.draft, wizardStep: s.wizardStep }),
    },
  ),
);

/** Stable selector helper: a single portfolio by id (returns the stored object reference, or undefined). */
export const usePortfolio = (id: string | undefined): Portfolio | undefined =>
  useStore((s) => (id ? s.portfolios.find((p) => p.id === id) : undefined));

export { newId };
