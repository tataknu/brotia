/**
 * Sample portfolios on app start (ADR-0026 D6). The demo opens populated, with no "load sample" UI:
 * - First start with an empty store: every sample (GET /portfolios/samples, then GET /portfolios/sample?id=) is
 *   loaded from the live service, or from the offline snapshot when offline. Runs once; deleting the samples later
 *   sticks (the Portfolios page keeps a small "Restore sample portfolios" link).
 * - Stored copies of a sample whose name differs from the sample's current one get the current name, code and lender.
 *   Farms, loans, rules, rule edits and the audit trail are never touched.
 */
import { getSamplePortfolio, listSamplePortfolios } from '@/data/api';
import { useStore } from './store';

let started: Promise<void> | null = null;

/** Loads every sample that is not stored yet (keeps the stored ones as they are). Returns how many were added. */
export async function loadMissingSamples(): Promise<number> {
  const list = (await listSamplePortfolios()).data;
  const { portfolios, addPortfolio } = useStore.getState();
  let n = 0;
  for (const s of list) {
    if (portfolios.some((p) => p.id === s.id)) continue;
    addPortfolio((await getSamplePortfolio(s.id)).data);
    n += 1;
  }
  return n;
}

async function run(): Promise<void> {
  const st = useStore.getState();
  if (st.portfolios.length === 0 && !st.samplesSeeded) {
    await loadMissingSamples();
    useStore.getState().setSamplesSeeded(true);
    return;
  }
  if (!st.samplesSeeded) st.setSamplesSeeded(true);
  const sampleIds = new Set(st.portfolios.map((p) => p.id).filter((id) => id.startsWith('sample-')));
  if (sampleIds.size === 0) return;
  const list = (await listSamplePortfolios()).data;
  for (const s of list) {
    const p = useStore.getState().portfolios.find((x) => x.id === s.id);
    if (p && (p.name !== s.name || (p.code ?? null) !== (s.code ?? null) || p.lender !== s.lender))
      useStore.getState().refreshSampleMeta(s.id, { name: s.name, code: s.code ?? null, lender: s.lender });
  }
}

/** Once per page load (StrictMode-safe). Failures are silent: the app works without samples. */
export function bootstrapSamples(): Promise<void> {
  if (!started) started = run().catch(() => undefined);
  return started;
}

/** Tests only. */
export function resetSampleBootstrap(): void {
  started = null;
}
