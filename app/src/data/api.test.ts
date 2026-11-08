import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { PortfolioSchema } from '@/domain/schemas';
import { syncZones } from '@/domain/rules';
import type { Portfolio } from '@/domain/types';
import { TIMEOUTS } from './http';
import {
  ApiRequestError,
  ContractError,
  NEEDS_LIVE,
  SERVICE_URL,
  UnavailableError,
  assessFarm,
  assessPortfolio,
  assessmentFingerprint,
  getCrops,
  getEvents,
  NetworkError,
  getFarmImagery,
  getSamplePortfolio,
  imageUrl,
  listSamplePortfolios,
  snapshotPortfolios,
  portfolioBBox,
  recommend,
} from './api';
import { __resetConnection, connection } from './connection';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

interface FakeOpts {
  serviceUp: boolean;
  snapshot: boolean;
  liveOverride?: (path: string) => Response | undefined;
}

/** Serves fixtures as the live service and as app/public/snapshot/. */
function fakeFetch(opts: FakeOpts) {
  const liveFiles: Record<string, string> = {
    '/health': 'health.json',
    '/crops': 'crops.json',
    '/countries': 'countries.json',
    '/portfolios/sample': 'portfolio-sample.json',
    '/assess/portfolio': 'assessment-portfolio.json',
    '/imagery/farm': 'imagery-cl-ovalle-table-grape.json',
    '/agent/recommend': 'agent-recommendation.json',
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(SERVICE_URL)) {
      if (!opts.serviceUp) throw new TypeError('fetch failed');
      const path = url.slice(SERVICE_URL.length).split('?')[0];
      const o = opts.liveOverride?.(path);
      if (o) return o;
      const f = liveFiles[path];
      return f ? json(loadFixture(f)) : json({ error: 'not_found', detail: path }, 404);
    }
    if (url.startsWith('/snapshot/')) {
      if (!opts.snapshot) return html(); // Vite SPA fallback
      const name = url.slice('/snapshot/'.length);
      const map: Record<string, string> = { 'portfolio.json': 'portfolio-sample.json' };
      try {
        return json(loadFixture(map[name] ?? name));
      } catch {
        return html();
      }
    }
    throw new TypeError(`unexpected ${url}`);
  });
}

const sample = (): Portfolio => syncZones(PortfolioSchema.parse(loadFixture('portfolio-sample.json')));

beforeEach(() => __resetConnection());
afterEach(() => vi.unstubAllGlobals());

describe('live mode', () => {
  it('validates and tags results as live', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: true, snapshot: true }));
    const res = await getCrops();
    expect(res.source).toBe('live');
    expect(res.snapshotDate).toBeNull();
    expect(res.data).toHaveLength(6);
    expect(connection.get().mode).toBe('live');
    expect(connection.get().health?.contractVersion).toBe(1);
  });

  it('service ApiError bodies throw ApiRequestError and never fall back', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: true, snapshot: true }));
    await expect(assessFarm(sample(), 'cl-nope')).rejects.toMatchObject({ name: 'ApiRequestError', status: 404, code: 'not_found' });
  });

  it('agent 503 no_api_key surfaces its code', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({ serviceUp: true, snapshot: false, liveOverride: (p) => (p === '/agent/recommend' ? json({ error: 'no_api_key', detail: 'ANTHROPIC_API_KEY is not set' }, 503) : undefined) }),
    );
    const err = await recommend({ portfolio: sample(), question: 'q' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe('no_api_key');
  });

  it('a response that breaks the contract throws ContractError', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: true, snapshot: false, liveOverride: (p) => (p === '/crops' ? json([{ crop: 'soy' }]) : undefined) }));
    await expect(getCrops()).rejects.toBeInstanceOf(ContractError);
  });

  it('a network failure mid-session falls back to the snapshot', async () => {
    let up = true;
    const live = fakeFetch({ serviceUp: true, snapshot: true });
    const down = fakeFetch({ serviceUp: false, snapshot: true });
    vi.stubGlobal('fetch', vi.fn((i: RequestInfo | URL) => (up ? live(i) : down(i))));
    expect((await getCrops()).source).toBe('live');
    up = false;
    const res = await getSamplePortfolio();
    expect(res.source).toBe('snapshot');
    expect(res.snapshotDate).toBe('2026-11-07');
    expect(connection.get().mode).toBe('snapshot');
  });
});

describe('timeouts', () => {
  it('a timeout while /health is fine surfaces the timeout and stays live', async () => {
    const base = fakeFetch({ serviceUp: true, snapshot: true });
    vi.stubGlobal(
      'fetch',
      vi.fn((i: RequestInfo | URL, init?: RequestInit) => {
        if (String(i).includes('/assess/portfolio')) {
          return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
        }
        return base(i);
      }),
    );
    vi.useFakeTimers();
    try {
      await getCrops(); // live
      const pending = assessPortfolio(sample()).catch((e) => e);
      await vi.advanceTimersByTimeAsync(TIMEOUTS.assess + 1_000);
      const err = await pending;
      expect(err).toBeInstanceOf(NetworkError);
      expect(err.timedOut).toBe(true);
      expect(connection.get().mode).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('snapshot mode', () => {
  it('serves static data from the snapshot with its date', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: true }));
    const res = await getCrops();
    expect(res).toMatchObject({ source: 'snapshot', snapshotDate: '2026-11-07' });
    expect(connection.get().manifest?.portfolioId).toBe('sample-cl');
  });

  it('serves assessments only for the exported portfolio, unchanged', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: true }));
    const p = sample();
    const res = await assessPortfolio(p);
    expect(res.source).toBe('snapshot');
    expect(res.data.portfolioId).toBe('sample-cl');
    expect((await assessFarm(p, 'cl-ovalle-table-grape')).data.farmId).toBe('cl-ovalle-table-grape');

    // Renaming does not invalidate; a rule edit does.
    const renamed = { ...p, name: 'Renamed', farms: p.farms.map((f) => ({ ...f, name: `${f.name}!` })) };
    expect((await assessPortfolio(renamed)).source).toBe('snapshot');
    // A rule edit is served from the snapshot, labelled as computed with the exported rules (RT-3).
    const edited: Portfolio = { ...p, cropOverrides: { cherry: { weights: { a: 0.9 } } } };
    const ed = await assessPortfolio(edited);
    expect(ed.source).toBe('snapshot');
    expect(ed.data.warnings[0]).toMatch(/computed with the exported rules/);
    const edFarm = await assessFarm(edited, 'cl-ovalle-table-grape');
    expect(edFarm.data.warnings[0]).toMatch(/computed with the exported rules/);
    expect(res.data.warnings[0] ?? '').not.toMatch(/exported rules/);
    // A structural edit (a farm moved, a loan changed) still needs the live service.
    const moved: Portfolio = { ...p, farms: p.farms.map((f, i) => (i === 0 ? { ...f, polygon: { ...f.polygon, coordinates: [f.polygon.coordinates[0].map(([x, y]) => [x + 0.01, y])] } } : f)) };
    await expect(assessPortfolio(moved)).rejects.toMatchObject({ name: 'UnavailableError', reason: NEEDS_LIVE });
    await expect(assessPortfolio({ ...p, id: 'other' })).rejects.toMatchObject({ reason: NEEDS_LIVE });
  });

  it('imagery is served for exported farms', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: true }));
    const res = await getFarmImagery(sample(), 'cl-ovalle-table-grape');
    expect(res.source).toBe('snapshot');
    expect(imageUrl(res.data.frames[0].urls.ndvi, res.source)).toMatch(/^\/snapshot\/imagery\/cl-ovalle-table-grape\//);
  });

  it('events are served offline only for the exported portfolio', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: true }));
    const bbox: [number, number, number, number] = [-72, -35, -70, -30];
    expect((await getEvents(bbox, { portfolioId: 'sample-cl' })).source).toBe('snapshot');
    await expect(getEvents(bbox, { portfolioId: 'pf-other' })).rejects.toBeInstanceOf(UnavailableError);
    await expect(getEvents(bbox)).rejects.toBeInstanceOf(UnavailableError);
  });

  it('live-only endpoints say so', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: true }));
    await expect(recommend({ portfolio: sample(), question: 'q' })).rejects.toBeInstanceOf(UnavailableError);
  });

  it('without an exported snapshot the error says so', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: false, snapshot: false }));
    const err = await getCrops().catch((e) => e);
    expect(err).toBeInstanceOf(UnavailableError);
    expect(err.reason).toMatch(/no offline snapshot/);
    expect(connection.get().manifest).toBeNull();
  });
});

describe('helpers', () => {
  it('resolves image URLs for live and snapshot', () => {
    expect(imageUrl('/files/imagery/f/2026-10-24_ndvi.png', 'live')).toBe(`${SERVICE_URL}/files/imagery/f/2026-10-24_ndvi.png`);
    expect(imageUrl('/files/imagery/f/2026-10-24_ndvi.png', 'snapshot')).toBe('/snapshot/imagery/f/2026-10-24_ndvi.png');
    expect(imageUrl(null, 'live')).toBeNull();
  });
  it('fingerprint ignores names, audit and null-vs-missing', () => {
    const p = sample();
    const q = { ...p, name: 'x', audit: [], farms: p.farms.map((f) => ({ ...f, name: 'y', covered: undefined })) };
    expect(assessmentFingerprint(q)).toBe(assessmentFingerprint(p));
  });
  it('portfolio bbox pads by 25 km', () => {
    const b = portfolioBBox(sample())!;
    expect(b[0]).toBeLessThan(-71.24 - 0.25);
    expect(b[3]).toBeGreaterThan(-30.58 + 0.2);
    expect(portfolioBBox({ farms: [] })).toBeNull();
  });
});

describe('multi-portfolio snapshot (v1.1, ADR-0026)', () => {
  const TWO = 'sample-two';
  const two = (): Portfolio => {
    const p = sample();
    return { ...p, id: TWO, name: 'Second book', farms: p.farms.map((f) => ({ ...f, id: `two-${f.id}`, zoneId: f.zoneId.replace(f.id, `two-${f.id}`) })), zones: p.zones.map((z) => (z.auto ? { ...z, id: z.id.replace('auto-', 'auto-two-') } : z)) };
  };
  const manifestV11 = () => {
    const m = loadFixture<Record<string, unknown>>('manifest.json');
    const primary = { portfolioId: m.portfolioId, portfolioName: m.portfolioName, farmIds: m.farmIds, portfolioFile: 'portfolio.json', assessmentFile: 'assessment-portfolio.json', eventsFile: 'events.json' };
    const second = { portfolioId: TWO, portfolioName: 'Second book', farmIds: two().farms.map((f) => f.id), portfolioFile: `portfolio-${TWO}.json`, assessmentFile: `assessment-portfolio-${TWO}.json`, eventsFile: `events-${TWO}.json` };
    return { ...m, files: [...(m.files as string[]), second.portfolioFile, second.assessmentFile, second.eventsFile], portfolios: [primary, second] };
  };
  const fetchV11 = () => {
    const base = fakeFetch({ serviceUp: false, snapshot: true });
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/snapshot/manifest.json') return json(manifestV11());
      if (url === `/snapshot/portfolio-${TWO}.json`) return json(two());
      if (url === `/snapshot/assessment-portfolio-${TWO}.json`) return json({ ...loadFixture<Record<string, unknown>>('assessment-portfolio.json'), portfolioId: TWO });
      if (url === `/snapshot/events-${TWO}.json`) return json([]);
      return base(input);
    });
  };

  it('treats a v1 manifest as one portfolio with the v1 file names', () => {
    const m = loadFixture<Parameters<typeof snapshotPortfolios>[0]>('manifest.json');
    expect(snapshotPortfolios(m)).toEqual([
      { portfolioId: 'sample-cl', portfolioName: m.portfolioName, farmIds: m.farmIds, portfolioFile: 'portfolio.json', assessmentFile: 'assessment-portfolio.json', eventsFile: 'events.json' },
    ]);
  });

  it('serves every exported portfolio offline, each from its own files', async () => {
    vi.stubGlobal('fetch', fetchV11());
    const list = await listSamplePortfolios();
    expect(list.source).toBe('snapshot');
    expect(list.data.map((s) => s.id)).toEqual(['sample-cl', TWO]);
    expect((await getSamplePortfolio()).data.id).toBe('sample-cl');
    const p2 = (await getSamplePortfolio(TWO)).data;
    expect(p2.id).toBe(TWO);
    expect((await assessPortfolio(p2)).data.portfolioId).toBe(TWO);
    expect((await assessPortfolio(sample())).data.portfolioId).toBe('sample-cl');
    expect((await getEvents([-72, -35, -70, -30], { portfolioId: TWO })).data).toEqual([]);
    await expect(getFarmImagery(p2, 'cl-ovalle-table-grape')).rejects.toBeInstanceOf(UnavailableError);
    await expect(getSamplePortfolio('nope')).rejects.toBeInstanceOf(UnavailableError);
  });

  it('lists the default sample alone when the live service predates GET /portfolios/samples', async () => {
    vi.stubGlobal('fetch', fakeFetch({ serviceUp: true, snapshot: true }));
    const res = await listSamplePortfolios();
    expect(res.source).toBe('live');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: 'sample-cl', currency: 'USD' });
  });
});
