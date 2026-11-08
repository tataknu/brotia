/**
 * Live vs offline-snapshot mode (CONTRACT §B "App client rules", §C).
 *
 * - GET /health with a 3 s timeout decides the mode. 'live' when it answers, 'snapshot' otherwise.
 * - While in snapshot mode the service is re-probed every RECHECK_MS (on a timer and on the next call), so
 *   the app goes back to live when the service comes up. A network failure on any live call flips the mode to 'snapshot'.
 * - The manifest (app/public/snapshot/manifest.json) is loaded once; null = no snapshot exported yet.
 */
import { HealthSchema, SnapshotManifestSchema } from '@/domain/schemas';
import type { Health, SnapshotManifest } from '@/domain/types';
import { SERVICE_URL, SNAPSHOT_BASE, TIMEOUTS, fetchJson, validate } from './http';

export type Mode = 'unknown' | 'live' | 'snapshot';

export interface ConnectionState {
  mode: Mode;
  /** Last /health answer (live mode). */
  health: Health | null;
  /** undefined = not loaded yet; null = no snapshot available. */
  manifest: SnapshotManifest | null | undefined;
  /** Why we are offline, plain language. */
  offlineReason: string | null;
  checkedAt: number;
}

export const RECHECK_MS = 30_000;

let state: ConnectionState = { mode: 'unknown', health: null, manifest: undefined, offlineReason: null, checkedAt: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<ConnectionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const connection = {
  get: (): ConnectionState => state,
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let probing: Promise<Mode> | null = null;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;

/** RT-11: while offline, re-probe /health every RECHECK_MS on its own, so the app returns to live without a click. */
function scheduleRecheck() {
  if (recheckTimer || typeof window === 'undefined') return;
  recheckTimer = setTimeout(() => {
    recheckTimer = null;
    if (state.mode === 'snapshot') void probe();
  }, RECHECK_MS);
}

/** Probes GET /health now. */
export function probe(): Promise<Mode> {
  if (probing) return probing;
  probing = (async () => {
    try {
      const health = validate(HealthSchema, await fetchJson(`${SERVICE_URL}/health`, { timeoutMs: TIMEOUTS.health }), '/health');
      setState({ mode: 'live', health, offlineReason: null, checkedAt: Date.now() });
    } catch (e) {
      await loadManifest();
      setState({ mode: 'snapshot', health: null, offlineReason: (e as Error).message, checkedAt: Date.now() });
      scheduleRecheck();
    } finally {
      probing = null;
    }
    return state.mode;
  })();
  return probing;
}

/** Current mode, probing when unknown or when an offline verdict is older than RECHECK_MS. */
export async function ensureMode(): Promise<Mode> {
  if (state.mode === 'unknown') return probe();
  if (state.mode === 'snapshot' && Date.now() - state.checkedAt > RECHECK_MS) return probe();
  return state.mode;
}

/** A live call failed at the network level: switch to the snapshot. */
export async function markOffline(reason: string): Promise<void> {
  await loadManifest();
  setState({ mode: 'snapshot', health: null, offlineReason: reason, checkedAt: Date.now() });
  scheduleRecheck();
}

let manifestLoad: Promise<SnapshotManifest | null> | null = null;

/** Loads the snapshot manifest once (null when there is none). */
export function loadManifest(): Promise<SnapshotManifest | null> {
  if (state.manifest !== undefined) return Promise.resolve(state.manifest);
  if (!manifestLoad) {
    manifestLoad = (async () => {
      let manifest: SnapshotManifest | null = null;
      try {
        const raw = await fetchJson(`${SNAPSHOT_BASE}manifest.json`, { timeoutMs: TIMEOUTS.snapshotFile });
        const parsed = SnapshotManifestSchema.safeParse(raw);
        manifest = parsed.success ? parsed.data : null;
      } catch {
        manifest = null; // no snapshot exported (the dev server answers index.html → not JSON)
      }
      setState({ manifest });
      manifestLoad = null;
      return manifest;
    })();
  }
  return manifestLoad;
}

/** Test hook: reset module state. */
export function __resetConnection(next?: Partial<ConnectionState>) {
  state = { mode: 'unknown', health: null, manifest: undefined, offlineReason: null, checkedAt: 0, ...next };
  probing = null;
  manifestLoad = null;
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = null;
  listeners.forEach((l) => l());
}
