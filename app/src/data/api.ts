/**
 * v1 service client (app foundation). The ONLY module that talks to the service (CONTRACT §B).
 *
 * Every call resolves to ApiResult<T> = { data, source: 'live' | 'snapshot', snapshotDate }.
 * - Live: VITE_SERVICE_URL (default http://localhost:8787), responses validated with zod.
 * - Snapshot: when /health fails or a live call cannot reach the service, data comes from
 *   app/public/snapshot/ (written by the service's POST /snapshot/export). The UI labels it
 *   "Offline snapshot of <snapshotDate>".
 * - Snapshot assessments/imagery are valid only for an exported portfolio (since v1.1 a snapshot may hold several,
 *   listed in manifest.portfolios; a v1 manifest is one portfolio with the v1 file names, see snapshotPortfolios()). When only its rules changed
 *   (overrides, credit rules), the snapshot answers with a first warning "computed with the exported rules"
 *   (RT-3). Any other change (farms, polygons, loans, zones) throws UnavailableError('Assessment needs the
 *   live service'). Never unlabelled stale numbers for edited rules.
 * - Service ApiError bodies throw ApiRequestError (no fallback). Contract mismatches throw ContractError.
 * - CIREN search, the agent, snapshot export and the insurance request outbox are live-only.
 */
import { z } from 'zod';
import {
  AgentRecommendationSchema,
  CirenOrchardCollectionSchema,
  ClimateEventListSchema,
  CountryListSchema,
  CropTemplateListSchema,
  FarmAssessmentSchema,
  HealthSchema,
  ImageryTimelineSchema,
  InsuranceRequestListSchema,
  InsuranceRequestSchema,
  PortfolioAssessmentSchema,
  PortfolioSchema,
  SamplePortfolioSummaryListSchema,
  SnapshotManifestSchema,
} from '@/domain/schemas';
import { isDeepEmpty } from '@/domain/rules';
import { CROPS } from '@/domain/types';
import type {
  AgentRecommendation,
  AgentRequest,
  CirenOrchardCollection,
  ClimateEvent,
  Country,
  Crop,
  CreateInsuranceRequest,
  CropTemplate,
  FarmAssessment,
  Health,
  ImageryTimeline,
  InsuranceRequest,
  Portfolio,
  PortfolioAssessment,
  SamplePortfolioSummary,
  SnapshotExportRequest,
  SnapshotManifest,
  SnapshotPortfolio,
} from '@/domain/types';
import { ensureMode, loadManifest, markOffline, probe } from './connection';
import { ApiRequestError, NetworkError, SERVICE_URL, SNAPSHOT_BASE, TIMEOUTS, UnavailableError, fetchJson, validate } from './http';

export { ApiRequestError, ContractError, NetworkError, UnavailableError, SERVICE_URL, SNAPSHOT_BASE } from './http';

export type DataSource = 'live' | 'snapshot';

export interface ApiResult<T> {
  data: T;
  source: DataSource;
  /** manifest.asOf when source is 'snapshot', else null. */
  snapshotDate: string | null;
}

export const NEEDS_LIVE = 'Assessment needs the live service';

/* ───────────────────────── internals ───────────────────────── */

async function live<T>(path: string, schema: z.ZodType<T>, opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs: number; signal?: AbortSignal }): Promise<T> {
  return validate(schema, await fetchJson(`${SERVICE_URL}${path}`, opts), path);
}

async function snapshotFile<T>(file: string, schema: z.ZodType<T>, manifest: SnapshotManifest): Promise<T> {
  if (!manifest.files.includes(file)) throw new UnavailableError(`The offline snapshot has no ${file}`);
  let raw: unknown;
  try {
    raw = await fetchJson(`${SNAPSHOT_BASE}${file}`, { timeoutMs: TIMEOUTS.snapshotFile });
  } catch {
    throw new UnavailableError(`The offline snapshot file ${file} could not be read`);
  }
  return validate(schema, raw, `snapshot/${file}`);
}

/**
 * Live first; on a network failure or when offline, the snapshot reader (if any) answers.
 * `fromSnapshot` returns null when the snapshot cannot answer this request (the reason is thrown).
 */
async function withFallback<T>(
  liveCall: () => Promise<T>,
  fromSnapshot: ((m: SnapshotManifest) => Promise<T>) | null,
  liveOnlyReason: string,
): Promise<ApiResult<T>> {
  const mode = await ensureMode();
  if (mode === 'live') {
    try {
      return { data: await liveCall(), source: 'live', snapshotDate: null };
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      if (e.timedOut) {
        // A slow cold request is not an outage: only fall back when /health is also down.
        if ((await probe()) === 'live') throw e;
      } else {
        await markOffline(e.message);
      }
      if (!fromSnapshot) throw new UnavailableError(liveOnlyReason);
    }
  }
  if (!fromSnapshot) throw new UnavailableError(liveOnlyReason);
  const manifest = await loadManifest();
  if (!manifest) throw new UnavailableError('The service is unreachable and no offline snapshot has been exported');
  return { data: await fromSnapshot(manifest), source: 'snapshot', snapshotDate: manifest.asOf };
}

/* ───────────────────────── snapshot validity ───────────────────────── */

/** Deterministic JSON: sorted keys, null/undefined and deep-empty objects dropped. */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(x).sort()) {
        const val = (x as Record<string, unknown>)[k];
        if (isDeepEmpty(val)) continue;
        out[k] = norm(val);
      }
      return out;
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

/**
 * Everything in a portfolio that can change an assessment (CONTRACT §C: snapshot numbers are only valid for
 * the exported portfolio, unchanged). Names, colours, createdAt and the audit are excluded; auto zones
 * without overrides are excluded (both sides synthesise them identically).
 */
export function assessmentFingerprint(p: Portfolio): string {
  return canonicalJson({
    id: p.id,
    country: p.country,
    currency: p.currency,
    creditRules: p.creditRules,
    cropOverrides: p.cropOverrides,
    zones: p.zones
      .filter((z) => !z.auto || !isDeepEmpty(z.overrides))
      .map((z) => ({ id: z.id, center: z.auto ? null : z.center, radiusM: z.radiusM, auto: z.auto, overrides: z.overrides }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    farms: p.farms
      .map(({ name: _n, ciren: _c, areaHa: _a, zoneId: _z, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/**
 * The assessment fingerprint without the rule layer (credit rules, crop/zone/farm overrides, covered,
 * irrigatedDeclared): same farms, polygons, loans and zones. When only rules differ, the snapshot can still
 * answer, labelled "computed with the exported rules" (never presented as reflecting the edits).
 */
export function structureFingerprint(p: Portfolio): string {
  return canonicalJson({
    id: p.id,
    country: p.country,
    currency: p.currency,
    zones: p.zones
      .filter((z) => !z.auto)
      .map((z) => ({ id: z.id, center: z.center, radiusM: z.radiusM }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    farms: p.farms
      .map(({ name: _n, ciren: _c, areaHa: _a, zoneId: _z, overrides: _o, creditRuleOverrides: _r, covered: _cv, irrigatedDeclared: _i, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

type SnapshotMatch = 'exact' | 'rules_differ' | false;

/**
 * Every portfolio in a snapshot, primary first (CONTRACT §C, v1.1). A v1 manifest (no `portfolios`) is one portfolio
 * with the v1 file names, so old snapshots keep working.
 */
export function snapshotPortfolios(m: SnapshotManifest): SnapshotPortfolio[] {
  if (m.portfolios && m.portfolios.length > 0) return m.portfolios;
  return [
    {
      portfolioId: m.portfolioId,
      portfolioName: m.portfolioName,
      farmIds: m.farmIds,
      portfolioFile: 'portfolio.json',
      assessmentFile: 'assessment-portfolio.json',
      eventsFile: 'events.json',
    },
  ];
}

/** The snapshot entry of a portfolio id, or null when the snapshot does not hold it. */
export function snapshotEntry(m: SnapshotManifest, portfolioId: string | null | undefined): SnapshotPortfolio | null {
  if (!portfolioId) return null;
  return snapshotPortfolios(m).find((e) => e.portfolioId === portfolioId) ?? null;
}

const snapshotPortfolioCache = new Map<string, Promise<Portfolio>>();
function loadSnapshotPortfolio(manifest: SnapshotManifest, entry: SnapshotPortfolio): Promise<Portfolio> {
  const key = `${manifest.generatedAt}|${entry.portfolioFile}`;
  let promise = snapshotPortfolioCache.get(key);
  if (!promise) {
    promise = snapshotFile(entry.portfolioFile, PortfolioSchema, manifest);
    snapshotPortfolioCache.set(key, promise);
    promise.catch(() => snapshotPortfolioCache.delete(key));
  }
  return promise;
}

async function snapshotMatches(p: Portfolio, manifest: SnapshotManifest): Promise<{ match: SnapshotMatch; changes: number }> {
  const entry = snapshotEntry(manifest, p.id);
  if (!entry) return { match: false, changes: 0 };
  const exported = await loadSnapshotPortfolio(manifest, entry);
  if (assessmentFingerprint(exported) === assessmentFingerprint(p)) return { match: 'exact', changes: 0 };
  if (structureFingerprint(exported) !== structureFingerprint(p)) return { match: false, changes: 0 };
  const known = new Set(exported.audit.map((c) => c.id));
  const changes = p.audit.filter((c) => !known.has(c.id) && c.status === 'applied').length;
  return { match: 'rules_differ', changes };
}

/** Banner text when the snapshot answers for a portfolio whose rules changed after the export (RT-3). */
export function rulesDifferWarning(changes: number): string {
  const what = changes === 1 ? 'your rule change' : changes > 1 ? `your ${changes} rule changes` : 'your rule changes';
  return `Offline: computed with the exported rules; ${what} since the export need the live service.`;
}

/** Returns the warning to prepend when only rules differ, '' when the snapshot matches exactly. */
async function requireSnapshotPortfolio(p: Portfolio, manifest: SnapshotManifest, farmId?: string): Promise<string> {
  const { match, changes } = await snapshotMatches(p, manifest);
  if (!match) throw new UnavailableError(NEEDS_LIVE);
  if (farmId && !snapshotEntry(manifest, p.id)?.farmIds.includes(farmId)) throw new UnavailableError(NEEDS_LIVE);
  return match === 'rules_differ' ? rulesDifferWarning(changes) : '';
}

function withWarning<T extends { warnings: string[] }>(data: T, warning: string): T {
  return warning ? { ...data, warnings: [warning, ...data.warnings] } : data;
}

/* ───────────────────────── endpoints ───────────────────────── */

/** GET /health (live only; use connection state for the mode). */
export async function getHealth(signal?: AbortSignal): Promise<ApiResult<Health>> {
  return { data: await live('/health', HealthSchema, { timeoutMs: TIMEOUTS.health, signal }), source: 'live', snapshotDate: null };
}

/** GET /countries — 12 South American countries + GLOBAL (coming later). */
export function getCountries(): Promise<ApiResult<Country[]>> {
  return withFallback(
    () => live('/countries', CountryListSchema, { timeoutMs: TIMEOUTS.static }),
    (m) => snapshotFile('countries.json', CountryListSchema, m),
    'Countries need the live service',
  );
}

/** GET /crops — the six crop templates in CROPS order. */
export function getCrops(): Promise<ApiResult<CropTemplate[]>> {
  return withFallback(
    () => live('/crops', CropTemplateListSchema, { timeoutMs: TIMEOUTS.static }),
    (m) => snapshotFile('crops.json', CropTemplateListSchema, m),
    'Crop templates need the live service',
  );
}

/**
 * GET /portfolios/sample[?id=] — a sample portfolio; without id the Chilean sample 'sample-cl'. Offline: that
 * portfolio's file in the snapshot (without id, the snapshot's primary portfolio).
 */
export function getSamplePortfolio(id?: string | null): Promise<ApiResult<Portfolio>> {
  const path = id ? `/portfolios/sample?${new URLSearchParams({ id })}` : '/portfolios/sample';
  return withFallback(
    () => live(path, PortfolioSchema, { timeoutMs: TIMEOUTS.static }),
    (m) => {
      const entry = id ? snapshotEntry(m, id) : snapshotPortfolios(m)[0];
      if (!entry) throw new UnavailableError('This sample portfolio is not in the offline snapshot; it needs the live service');
      return snapshotFile(entry.portfolioFile, PortfolioSchema, m);
    },
    'The sample portfolio needs the live service',
  );
}

function summarySample(p: Portfolio): SamplePortfolioSummary {
  const crops = CROPS.filter((c) => p.farms.some((f) => f.crop === c));
  return { id: p.id, name: p.name, code: p.code ?? null, lender: p.lender, country: p.country, currency: p.currency, farmCount: p.farms.length, crops, description: null };
}

/**
 * GET /portfolios/samples (v1.1, ADR-0026) — every sample portfolio. Offline: the portfolios of the snapshot. A live
 * service older than v1.1 (404 on this route) is answered with the default sample alone.
 */
export function listSamplePortfolios(): Promise<ApiResult<SamplePortfolioSummary[]>> {
  return withFallback(
    async () => {
      try {
        return await live('/portfolios/samples', SamplePortfolioSummaryListSchema, { timeoutMs: TIMEOUTS.static });
      } catch (e) {
        if (!(e instanceof ApiRequestError) || e.status !== 404) throw e;
        return [summarySample(await live('/portfolios/sample', PortfolioSchema, { timeoutMs: TIMEOUTS.static }))];
      }
    },
    async (m) => Promise.all(snapshotPortfolios(m).map(async (e) => summarySample(await loadSnapshotPortfolio(m, e)))),
    'The sample portfolios need the live service',
  );
}

export type BBox = [number, number, number, number];
const bboxParam = (b: BBox) => b.map((n) => n.toFixed(6)).join(',');

/** GET /ciren/orchards — CIREN orchard polygons in a bbox (≤ 0.25° per side). Live only. */
export function getCirenOrchards(bbox: BBox, crop?: Crop | null, signal?: AbortSignal): Promise<ApiResult<CirenOrchardCollection>> {
  const q = new URLSearchParams({ bbox: bboxParam(bbox) });
  if (crop) q.set('crop', crop);
  return withFallback(
    () => live(`/ciren/orchards?${q}`, CirenOrchardCollectionSchema, { timeoutMs: TIMEOUTS.ciren, signal }),
    null,
    'The CIREN orchard layer needs the live service',
  );
}

/** POST /assess/portfolio. */
export function assessPortfolio(portfolio: Portfolio, asOf?: string | null, signal?: AbortSignal): Promise<ApiResult<PortfolioAssessment>> {
  return withFallback(
    () => live('/assess/portfolio', PortfolioAssessmentSchema, { method: 'POST', body: { portfolio, asOf: asOf ?? null }, timeoutMs: TIMEOUTS.assess, signal }),
    async (m) => {
      const warn = await requireSnapshotPortfolio(portfolio, m);
      const entry = snapshotEntry(m, portfolio.id)!;
      return withWarning(await snapshotFile(entry.assessmentFile, PortfolioAssessmentSchema, m), warn);
    },
    NEEDS_LIVE,
  );
}

/** POST /assess/farm. */
export function assessFarm(portfolio: Portfolio, farmId: string, asOf?: string | null, signal?: AbortSignal): Promise<ApiResult<FarmAssessment>> {
  return withFallback(
    () => live('/assess/farm', FarmAssessmentSchema, { method: 'POST', body: { portfolio, farmId, asOf: asOf ?? null }, timeoutMs: TIMEOUTS.assess, signal }),
    async (m) => {
      const warn = await requireSnapshotPortfolio(portfolio, m, farmId);
      return withWarning(await snapshotFile(`assessment-farm-${farmId}.json`, FarmAssessmentSchema, m), warn);
    },
    NEEDS_LIVE,
  );
}

/** POST /imagery/farm (sr default true). May take tens of seconds cold. */
export function getFarmImagery(
  portfolio: Portfolio,
  farmId: string,
  opts?: { sr?: boolean; asOf?: string | null; signal?: AbortSignal },
): Promise<ApiResult<ImageryTimeline>> {
  return withFallback(
    () =>
      live('/imagery/farm', ImageryTimelineSchema, {
        method: 'POST',
        body: { portfolio, farmId, sr: opts?.sr ?? true, asOf: opts?.asOf ?? null },
        timeoutMs: TIMEOUTS.imagery,
        signal: opts?.signal,
      }),
    async (m) => {
      // Imagery depends on the polygon only; any farm of an exported portfolio is fine.
      if (!snapshotEntry(m, portfolio.id)?.farmIds.includes(farmId)) throw new UnavailableError('Imagery for this farm needs the live service');
      return snapshotFile(`imagery-${farmId}.json`, ImageryTimelineSchema, m);
    },
    'Imagery needs the live service',
  );
}

/**
 * GET /events — newest first. Offline: the snapshot's events, only for an exported portfolio (pass its id),
 * because they cover that portfolio's area only.
 */
export function getEvents(bbox: BBox, opts?: { since?: string | null; portfolioId?: string | null; signal?: AbortSignal }): Promise<ApiResult<ClimateEvent[]>> {
  const q = new URLSearchParams({ bbox: bboxParam(bbox) });
  if (opts?.since) q.set('since', opts.since);
  return withFallback(
    () => live(`/events?${q}`, ClimateEventListSchema, { timeoutMs: TIMEOUTS.events, signal: opts?.signal }),
    async (m) => {
      const entry = snapshotEntry(m, opts?.portfolioId);
      if (!entry) throw new UnavailableError('Events for this area need the live service');
      return snapshotFile(entry.eventsFile, ClimateEventListSchema, m);
    },
    'Events need the live service',
  );
}

/** POST /agent/recommend. Live only; 503 no_api_key surfaces as ApiRequestError with code 'no_api_key'. */
export function recommend(req: AgentRequest, signal?: AbortSignal): Promise<ApiResult<AgentRecommendation>> {
  return withFallback(
    () => live('/agent/recommend', AgentRecommendationSchema, { method: 'POST', body: req, timeoutMs: TIMEOUTS.agent, signal }),
    null,
    'The farming agent is unavailable offline',
  );
}

/** POST /snapshot/export — writes app/public/snapshot/ (service side). Live only. */
export function exportSnapshot(req: SnapshotExportRequest = {}): Promise<ApiResult<SnapshotManifest>> {
  return withFallback(
    () => live('/snapshot/export', SnapshotManifestSchema, { method: 'POST', body: req, timeoutMs: TIMEOUTS.snapshotExport }),
    null,
    'Exporting a snapshot needs the live service',
  );
}

export const INSURANCE_NEEDS_LIVE = 'Needs the live service';

/**
 * POST /insurance/requests (v1.1, ADR-0025): queues one request in BrotIA's outbox. Live only. The answer's
 * status 'queued' means stored by BrotIA; nothing is sent to the insurer.
 */
export function createInsuranceRequest(req: CreateInsuranceRequest): Promise<ApiResult<InsuranceRequest>> {
  return withFallback(
    () => live('/insurance/requests', InsuranceRequestSchema, { method: 'POST', body: req, timeoutMs: TIMEOUTS.static }),
    null,
    INSURANCE_NEEDS_LIVE,
  );
}

/** GET /insurance/requests?portfolioId= (v1.1): the portfolio's queued requests, newest first. Live only. */
export function listInsuranceRequests(portfolioId: string, signal?: AbortSignal): Promise<ApiResult<InsuranceRequest[]>> {
  const q = new URLSearchParams({ portfolioId });
  return withFallback(
    () => live(`/insurance/requests?${q}`, InsuranceRequestListSchema, { timeoutMs: TIMEOUTS.static, signal }),
    null,
    INSURANCE_NEEDS_LIVE,
  );
}

/**
 * Resolves an imagery URL ('/files/imagery/...') for display (CONTRACT §B):
 * live → SERVICE_URL + url; snapshot → '/snapshot/' + url without the leading '/files/'.
 */
export function imageUrl(url: string | null | undefined, source: DataSource): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  if (source === 'live') return `${SERVICE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  const rel = url.startsWith('/files/') ? url.slice('/files/'.length) : url.replace(/^\/+/, '');
  return `${SNAPSHOT_BASE}${rel}`;
}

/** Bounding box of all farms, padded by `padKm` (default 25 km, CONTRACT §B events). null without farms. */
export function portfolioBBox(p: Pick<Portfolio, 'farms'>, padKm = 25): BBox | null {
  const pts = p.farms.flatMap((f) => f.polygon.coordinates[0] ?? []);
  if (pts.length === 0) return null;
  let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const dLat = padKm / 111.32;
  const midLat = (minLat + maxLat) / 2;
  const dLng = padKm / (111.32 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
}
