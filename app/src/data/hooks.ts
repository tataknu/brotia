/**
 * React hooks over the async client, with a small shared cache keyed by request
 * (endpoint + canonical JSON of the inputs). Every POST carries the full Portfolio, so a rule edit changes
 * the key and refetches automatically; renames and audit-only edits do not.
 *
 *   const { data, source, snapshotDate, error, loading, refetch } = usePortfolioAssessment(portfolio);
 *
 * `error` is an Error: UnavailableError (offline / needs live, `.reason` is UI text), ApiRequestError
 * (`.code`, `.detail` from the service), ContractError, or NetworkError.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  AgentRecommendation,
  AgentRequest,
  CirenOrchardCollection,
  ClimateEvent,
  Country,
  Crop,
  CropTemplate,
  FarmAssessment,
  ImageryTimeline,
  Portfolio,
  SamplePortfolioSummary,
  PortfolioAssessment,
} from '@/domain/types';
import {
  assessFarm,
  assessPortfolio,
  assessmentFingerprint,
  canonicalJson,
  getCirenOrchards,
  getCountries,
  getCrops,
  getEvents,
  getFarmImagery,
  getSamplePortfolio,
  listSamplePortfolios,
  portfolioBBox,
  recommend,
  type ApiResult,
  type BBox,
  type DataSource,
} from './api';
import { connection, ensureMode, probe, type ConnectionState } from './connection';

/* ───────────────────────── cache ───────────────────────── */

interface Entry<T> {
  result?: ApiResult<T>;
  error?: Error;
  promise?: Promise<void>;
  /** Invalidated: refetch on next use, keep showing the previous result meanwhile. */
  stale?: boolean;
  /** Bumped on every change so subscribers re-render. */
  version: number;
}

const cache = new Map<string, Entry<unknown>>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((l) => l());
}

function load<T>(key: string, fetcher: () => Promise<ApiResult<T>>, force = false): Promise<void> {
  const prev = cache.get(key) as Entry<T> | undefined;
  if (prev?.promise) return prev.promise;
  if (prev && !force && !prev.stale && (prev.result || prev.error)) return Promise.resolve();
  const entry: Entry<T> = { result: prev?.result, error: undefined, version: (prev?.version ?? 0) + 1 };
  entry.promise = fetcher().then(
    (result) => {
      cache.set(key, { result, version: entry.version + 1 });
    },
    (error: unknown) => {
      cache.set(key, { result: undefined, error: error instanceof Error ? error : new Error(String(error)), version: entry.version + 1 });
    },
  ).finally(() => notify(key));
  cache.set(key, entry as Entry<unknown>);
  notify(key);
  return entry.promise;
}

/** Drops cached results whose key starts with `prefix` (all when omitted) and refetches mounted ones. */
export function invalidate(prefix = ''): void {
  for (const key of [...cache.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const e = cache.get(key)!;
    if (e.promise) continue;
    cache.set(key, { ...e, stale: true, version: e.version + 1 });
    notify(key);
  }
}

export interface QueryState<T> {
  data: T | undefined;
  source: DataSource | undefined;
  snapshotDate: string | null;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/**
 * Generic cached query. `key` null = disabled. The fetcher is read from a ref, so it may be an inline closure;
 * the KEY decides identity.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<ApiResult<T>>): QueryState<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (l: () => void) => {
      if (!key) return () => {};
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(l);
      return () => {
        set!.delete(l);
      };
    },
    [key],
  );
  const getSnap = useCallback(() => (key ? (cache.get(key)?.version ?? 0) : -1), [key]);
  const version = useSyncExternalStore(subscribe, getSnap, getSnap);

  useEffect(() => {
    if (!key) return;
    const e = cache.get(key);
    if (!e || (!e.promise && (e.stale || (!e.result && !e.error)))) void load(key, () => fetcherRef.current());
  }, [key, version]);

  const entry = key ? (cache.get(key) as Entry<T> | undefined) : undefined;
  const refetch = useCallback(() => {
    if (key) void load(key, () => fetcherRef.current(), true);
  }, [key]);

  return {
    data: entry?.result?.data,
    source: entry?.result?.source,
    snapshotDate: entry?.result?.snapshotDate ?? null,
    error: entry?.error,
    loading: !!key && (!entry || !!entry.promise || (!entry.result && !entry.error)),
    refetch,
  };
}

/* ───────────────────────── connection ───────────────────────── */

/** Live/offline state for banners and badges. Probes /health on first use. */
export function useConnection(): ConnectionState & { recheck: () => void } {
  const state = useSyncExternalStore(connection.subscribe, connection.get, connection.get);
  useEffect(() => {
    void ensureMode();
  }, []);
  const recheck = useCallback(() => {
    void probe().then(() => invalidate());
  }, []);
  return { ...state, recheck };
}

/* ───────────────────────── endpoint hooks ───────────────────────── */

export const useCountries = () => useQuery<Country[]>('countries', getCountries);
export const useCrops = () => useQuery<CropTemplate[]>('crops', getCrops);

/** The sample portfolio (fetch on demand: pass enabled=false to skip). */
export const useSamplePortfolio = (enabled = true) => useQuery<Portfolio>(enabled ? 'portfolio-sample' : null, () => getSamplePortfolio());
/** GET /portfolios/samples (v1.1): every sample portfolio. */
export const useSamplePortfolios = () => useQuery<SamplePortfolioSummary[]>('portfolio-samples', listSamplePortfolios);

export function useCirenOrchards(bbox: BBox | null, crop?: Crop | null): QueryState<CirenOrchardCollection> {
  const key = bbox ? `ciren:${bbox.map((n) => n.toFixed(4)).join(',')}:${crop ?? ''}` : null;
  return useQuery(key, () => getCirenOrchards(bbox!, crop));
}

const pkey = (p: Portfolio) => assessmentFingerprint(p);

export function usePortfolioAssessment(portfolio: Portfolio | null | undefined, asOf?: string | null): QueryState<PortfolioAssessment> {
  const key = portfolio && portfolio.farms.length > 0 ? `assess-portfolio:${asOf ?? ''}:${pkey(portfolio)}` : null;
  return useQuery(key, () => assessPortfolio(portfolio!, asOf));
}

/** Cache key of one farm's assessment. Shared so other views (e.g. the watchlist water icon) reuse results. */
export const farmAssessmentKey = (farmId: string, asOf: string | null | undefined, fingerprint: string): string =>
  `assess-farm:${farmId}:${asOf ?? ''}:${fingerprint}`;

export function useFarmAssessment(portfolio: Portfolio | null | undefined, farmId: string | null | undefined, asOf?: string | null): QueryState<FarmAssessment> {
  const key = portfolio && farmId ? farmAssessmentKey(farmId, asOf, pkey(portfolio)) : null;
  return useQuery(key, () => assessFarm(portfolio!, farmId!, asOf));
}

export function useFarmImagery(portfolio: Portfolio | null | undefined, farmId: string | null | undefined, opts?: { sr?: boolean; asOf?: string | null }): QueryState<ImageryTimeline> {
  const farm = portfolio?.farms.find((f) => f.id === farmId);
  // Imagery depends on the farm polygon (and crop/covered flag for warnings), not on rules.
  const key = portfolio && farm ? `imagery:${portfolio.id}:${farm.id}:${opts?.sr ?? true}:${opts?.asOf ?? ''}:${canonicalJson([farm.polygon, farm.crop, farm.covered])}` : null;
  return useQuery(key, () => getFarmImagery(portfolio!, farmId!, opts));
}

/** Events in a bbox. Pass the portfolio id so the offline snapshot can answer for the exported portfolio. */
export function useEvents(bbox: BBox | null, opts?: { since?: string | null; portfolioId?: string | null }): QueryState<ClimateEvent[]> {
  const key = bbox ? `events:${bbox.map((n) => n.toFixed(3)).join(',')}:${opts?.since ?? ''}:${opts?.portfolioId ?? ''}` : null;
  return useQuery(key, () => getEvents(bbox!, opts));
}

/** Events touching a portfolio (bbox of its farms + 25 km, CONTRACT §B). */
export function usePortfolioEvents(portfolio: Portfolio | null | undefined, since?: string | null): QueryState<ClimateEvent[]> {
  const bbox = useMemo(() => (portfolio ? portfolioBBox(portfolio) : null), [portfolio]);
  return useEvents(bbox, { since, portfolioId: portfolio?.id ?? null });
}

/** Agent call as a mutation (never cached). */
export function useRecommend() {
  const [state, setState] = useState<{ data?: AgentRecommendation; error?: Error; loading: boolean }>({ loading: false });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = useCallback(async (req: AgentRequest): Promise<AgentRecommendation | undefined> => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setState({ loading: true });
    try {
      const res = await recommend(req, ctrl.current.signal);
      setState({ data: res.data, loading: false });
      return res.data;
    } catch (e) {
      if (ctrl.current?.signal.aborted) return undefined;
      setState({ error: e as Error, loading: false });
      return undefined;
    }
  }, []);
  const reset = useCallback(() => setState({ loading: false }), []);
  return { ...state, run, reset };
}

/** Test hook. */
export function __resetCache() {
  cache.clear();
}
