/**
 * Overview model: verdict, plan and evidence for the five farm shapes the demo relies on. Fixtures are small inline
 * objects mirroring the real assessments of 7 Nov 2026 (service on :8787), not the older contract fixture.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Driver, ImageryFrame, Provenance, SeriesPoint } from '@/domain/types';
import { FarmAssessmentSchema } from '@/domain/schemas';
import {
  aroundPair,
  buildOverview,
  decreeNumber,
  isContradictedBurn,
  latestClear,
  splitActionMessage,
  yearAgoPair,
  type OverviewInput,
} from './overviewModel';

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  source: 'derived',
  sourceLabel: 'Computed',
  observedAt: null,
  fetchedAt: '2026-11-07T22:00:00Z',
  resolution: 'n/a',
  licenceTier: 'commercial_ok',
  dataTier: 'enhanced',
  stale: false,
  estimated: false,
  ...over,
});

function drv(component: Driver['component'], peril: Driver['peril'], metric: string, severity: number, impact: number, over: Partial<Driver> = {}): Driver {
  return { component, peril, metric, severity, sensitivity: component === 'geography' ? null : 1, impact, text: `${metric} text`, value: null, normal: null, unit: null, provenance: prov(), ...over };
}

/** Quiet weather and vigour drivers the service always evaluates. */
const quietClimate = (): Driver[] => [
  drv('climate', 'frost', 'tmin_7d_min', 0, 0, { value: 5.2, normal: -2.2, unit: '°C' }),
  drv('climate', 'heat', 'tmax_7d_max', 0, 0, { value: 28.2, normal: 32, unit: '°C' }),
  drv('climate', 'harvest_rain', 'max_rain_72h', 0, 0, { value: 2.8, normal: 20, unit: 'mm' }),
  drv('climate', 'vigour', 'ndvi_z', 0, 0, { value: 1.11, normal: 0, unit: 'z' }),
];

const pt = (d: string, value: number | null, p10: number, p50: number, p90: number, estimated = false): SeriesPoint => ({ date: d, value, p10, p50, p90, estimated });

function input(over: {
  score: number;
  tier: OverviewInput['risk']['tier'];
  stage?: string;
  climate?: Driver[];
  disaster?: Driver[];
  geography?: Driver[];
  actions?: OverviewInput['risk']['creditActions'];
  water?: Partial<{ supply: Partial<OverviewInput['water']['supply']>; stress: Partial<OverviewInput['water']['stress']>; abandonment: Partial<OverviewInput['water']['abandonment']> }>;
  peers?: Partial<OverviewInput['peers']>;
  ndvi?: SeriesPoint[];
}): OverviewInput {
  const climate = over.climate ?? quietClimate();
  const disaster = over.disaster ?? [];
  const geography = over.geography ?? [];
  const all = [...climate, ...disaster, ...geography].filter((d) => d.impact > 0).sort((x, y) => y.impact - x.impact).slice(0, 5);
  return {
    asOf: '2026-11-07',
    dataAsOf: { ndvi: '2026-11-03' },
    nextInstallment: { dueDate: '2026-11-30', amount: 30000 },
    risk: {
      score: over.score,
      tier: over.tier,
      scoreTier: over.tier,
      stage: { key: 's', label: over.stage ?? 'Bloom' },
      drivers: all,
      creditActions: over.actions ?? [],
      components: { climate: { drivers: climate }, disaster: { drivers: disaster }, geography: { drivers: geography } },
    },
    water: {
      supply: { decreeActive: false, decreeId: null, decreeUntil: null, snowmeltPctOfNormal: 100, basin: 'Maipo', ...over.water?.supply },
      stress: { ndmiZ: 0.5, ndmiPeerDelta: 0.1, level: 'none', ...over.water?.stress },
      abandonment: { flag: false, confidence: 'high', evidence: 'No run.', ...over.water?.abandonment },
    },
    peers: { nPeers: 8, farmNdviZ: 0.5, peerMedianNdviZ: 0.4, reading: 'normal', ...over.peers },
    series: { ndvi: { points: over.ndvi ?? [pt('2026-10-23', 0.7, 0.6, 0.7, 0.8), pt('2026-10-28', 0.71, 0.6, 0.7, 0.8), pt('2026-11-02', 0.79, 0.67, 0.7, 0.79)] } },
  };
}

const ACT = {
  watch: { ruleId: 'cr-risk-high-before-installment', action: 'watch' as const, message: 'High climate risk within 60 days of an installment: review repayment capacity.' },
  visit: { ruleId: 'cr-abandonment', action: 'field_visit' as const, message: 'Vigour lost in the dry season against its own history and its peers: schedule a field visit.' },
  restructure: { ruleId: 'pf-score-80', action: 'restructure_review' as const, message: 'Risk score 80 or more: open a restructuring review.' },
};

const JARGON = /\bz\b|n=|NDVI z|sd |composites|§/;

const frame = (d: string, ndviMean: number, observed = true): ImageryFrame => ({
  date: d,
  kind: observed ? 'observed' : 'interpolated',
  daysToClear: observed ? 0 : 4,
  clearFraction: observed ? 1 : null,
  ndviMean,
  ndviP10: ndviMean - 0.05,
  ndviP90: ndviMean + 0.05,
  urls: { ndvi: `/files/imagery/f/${d}_ndvi.png`, rgb: observed ? `/files/imagery/f/${d}_rgb.png` : null, ndviSr: `/files/imagery/f/${d}_ndvi_sr.png`, rgbSr: observed ? `/files/imagery/f/${d}_rgb_sr.png` : null },
  srKind: observed ? 'ai' : 'resampled',
});

/* ───────── the five farms ───────── */

const ovalle = input({
  score: 100,
  tier: 'high',
  climate: [
    drv('climate', 'abandonment', 'abandonment_flag', 1, 1, { value: true, normal: false }),
    drv('climate', 'water', 'water_supply', 0.66, 0.462, { value: -1.45, normal: 0, unit: 'z' }),
    ...quietClimate().map((d) => (d.metric === 'ndvi_z' ? { ...d, value: -1.6 } : d)),
  ],
  disaster: [
    drv('disaster', 'fire', 'active_fire', 0.6, 0.6, { value: true, normal: false, provenance: prov({ source: 'firms', observedAt: '2026-11-04' }) }),
    drv('disaster', 'declared_emergency', 'decree_active', 0.6, 0.6, { value: true, normal: false }),
  ],
  geography: [drv('geography', 'water', 'basin_water_security', 1, 0.3, { value: 13, normal: 10, unit: 'years' })],
  actions: [ACT.watch, ACT.visit, ACT.restructure],
  water: {
    supply: { decreeActive: true, decreeId: 'DGA decree No. 177 of 9 Jul 2026', decreeUntil: '2027-07-10', snowmeltPctOfNormal: 169.1, basin: 'Limarí' },
    stress: { ndmiZ: -1.45, ndmiPeerDelta: -2.86, level: 'moderate' },
    abandonment: { flag: true, confidence: 'high', evidence: 'Dry season: NDVI z ≤ −2.0 for 30 composites, near bare soil; peers median z -0.2 (n=7).' },
  },
  peers: { nPeers: 7, farmNdviZ: -1.6, peerMedianNdviZ: 3.19, reading: 'farm_specific' },
  ndvi: [pt('2026-10-23', 0.25, 0.25, 0.28, 0.4), pt('2026-10-28', 0.201, 0.245, 0.273, 0.399), pt('2026-11-02', 0.183, 0.238, 0.256, 0.42, true)],
});

const copiapo = input({
  score: 69.6,
  tier: 'high',
  climate: [
    drv('climate', 'water', 'water_supply', 0.66, 0.462, { value: -1.13, normal: 0, unit: 'z' }),
    drv('climate', 'abandonment', 'abandonment_flag', 0.4, 0.4, { value: true, normal: false }),
    drv('climate', 'heat', 'tmax_7d_max', 0.16, 0.08, { value: 33.8, normal: 35, unit: '°C' }),
    drv('climate', 'frost', 'tmin_7d_min', 0, 0, { value: 8, normal: -1, unit: '°C' }),
    drv('climate', 'vigour', 'ndvi_z', 0, 0, { value: -0.74, normal: 0, unit: 'z' }),
  ],
  geography: [
    drv('geography', 'frost', 'frost_pocket', 1, 0.3, { value: -147.7, normal: 0, unit: 'm' }),
    drv('geography', 'water', 'basin_water_security', 0.8, 0.24, { value: 8, normal: 10, unit: 'years' }),
  ],
  actions: [ACT.watch, ACT.visit],
  water: {
    supply: { snowmeltPctOfNormal: 198, basin: 'Copiapó' },
    stress: { ndmiZ: -1.13, ndmiPeerDelta: -0.72, level: 'moderate' },
    abandonment: { flag: true, confidence: 'low', evidence: 'Vigour loss, not a confirmed stop of irrigation. Verify with a field visit.' },
  },
  peers: { nPeers: 8, farmNdviZ: -0.74, peerMedianNdviZ: 0.4, reading: 'normal' },
  ndvi: [pt('2026-10-28', 0.63, 0.6, 0.74, 0.8), pt('2026-11-02', 0.66, 0.62, 0.75, 0.82)],
});

const paine = input({
  score: 30.5,
  tier: 'normal',
  stage: 'Nut growth',
  climate: [drv('climate', 'water', 'water_supply', 0.02, 0.02, { value: 89, normal: 100, unit: '% of normal' }), ...quietClimate()],
  disaster: [
    drv('disaster', 'fire', 'burned_area', 0.4, 0.4, {
      value: true,
      normal: false,
      text: 'Burned area mapped on the orchard, unconfirmed by imagery: Burned area near Paine (163 ha) (29 Nov 2025).',
      provenance: prov({ source: 'gwis_ba', observedAt: '2025-11-29', estimated: true, note: 'Burned area mapped from MODIS/VIIRS; footprint contradicted by native S2 NDVI (drop 0.01 < 0.1): severity 0.4' }),
    }),
  ],
  geography: [
    drv('geography', 'water', 'basin_water_security', 0.5, 0.15, { value: 5, normal: 10, unit: 'years' }),
    drv('geography', 'fire', 'fire_recurrence', 0.4, 0.12, { value: 2, normal: 5, unit: 'years' }),
  ],
  water: { supply: { snowmeltPctOfNormal: 89, basin: 'Maipo' }, stress: { ndmiZ: 0.79, level: 'none' } },
});

const curico = input({
  score: 47.8,
  tier: 'watch',
  stage: 'Fruit set and growth',
  disaster: [drv('disaster', 'fire', 'active_fire', 0.6, 0.6, { value: true, normal: false, provenance: prov({ source: 'firms', observedAt: '2026-11-06' }) })],
  geography: [
    drv('geography', 'water', 'basin_water_security', 1, 0.3, { value: 11, normal: 10, unit: 'years' }),
    drv('geography', 'frost', 'frost_pocket', 0.41, 0.123, { value: -12.3, normal: 0, unit: 'm' }),
    drv('geography', 'fire', 'fire_recurrence', 0.4, 0.12, { value: 2, normal: 5, unit: 'years' }),
  ],
  water: { supply: { snowmeltPctOfNormal: 92, basin: 'Mataquito (Teno)' }, stress: { ndmiZ: 1.88, level: 'none' } },
  peers: { farmNdviZ: 1.71, peerMedianNdviZ: 0.92 },
});

const requinoa = input({
  score: 2.8,
  tier: 'normal',
  stage: 'Fruit set and growth',
  climate: [drv('climate', 'water', 'water_supply', 0.04, 0.032, { value: 88, normal: 100, unit: '% of normal' }), ...quietClimate()],
  geography: [drv('geography', 'water', 'basin_water_security', 0.5, 0.15, { value: 5, normal: 10, unit: 'years' })],
  water: { supply: { snowmeltPctOfNormal: 88, basin: 'Rapel (Cachapoal)' }, stress: { ndmiZ: 0.69, level: 'none' } },
});

describe('Ovalle-like: confirmed abandonment, decree', () => {
  const m = buildOverview(ovalle, 'table_grape');
  it('says it plainly, with a confidence word and the high-tier accent', () => {
    expect(m.verdict.text).toBe('Vines look abandoned: bare soil in the dry season while nearby vineyards stayed green.');
    expect(m.verdict.confidence).toBe('Confirmed');
    expect(m.verdict.tone).toBe('alert');
    expect(m.verdict.text).not.toMatch(JARGON);
  });
  it('lists the fired actions most severe first, verb-first', () => {
    expect(m.plan.items.map((i) => i.action)).toEqual(['restructure_review', 'field_visit', 'watch']);
    expect(m.plan.items.map((i) => i.title)).toEqual(['Open a restructuring review', 'Schedule a field visit', 'Review repayment capacity']);
    expect(m.plan.items[0].reason).toBe('Risk score 80 or more');
    expect(m.plan.none).toBe(false);
  });
  it('shows vigour, water (decree) and fire cards, vigour first despite water drivers summing higher', () => {
    expect(m.evidence.map((e) => e.theme)).toEqual(['vigour', 'water', 'fire']);
    const [vig, water] = m.evidence;
    expect(vig.value).toBe('NDVI 0.20'); // latest clear point, not the estimated one after it
    expect(vig.compare).toBe('vs 0.27 usual for Oct 28');
    expect(vig.note).toBe('Still below its usual range in the latest image.');
    expect(vig.detail).toContain('n=7'); // technical detail lives in the hover
    expect(vig.link.tab).toBe('imagery');
    expect(vig.spark?.points.length).toBe(3);
    expect(water.value).toBe('Decree No. 177 active');
    expect(water.compare).toBe('until Jul 10, 2027');
    expect(water.link.tab).toBe('water');
    expect(m.clear).toBeNull();
  });
});

describe('Copiapó-like: vigour loss, verify, NDMI stress', () => {
  const m = buildOverview(copiapo, 'table_grape');
  it('leads with the vigour loss although water has the larger impact, and asks to verify', () => {
    expect(m.verdict.kind).toBe('vigour_loss');
    expect(m.verdict.text).toBe('Vines lost vigour in the dry season and the canopy is drier than normal now, though water supply looks fine.');
    expect(m.verdict.confidence).toBe('Verify on site');
  });
  it('field visit before watch; water, vigour and frost-pocket cards', () => {
    expect(m.plan.items.map((i) => i.action)).toEqual(['field_visit', 'watch']);
    expect(m.evidence.map((e) => e.theme)).toEqual(['water', 'vigour', 'frost']);
    expect(m.evidence[0].value).toBe('Moderate stress');
    expect(m.evidence[0].note).toContain('supply is not the cause');
    expect(m.evidence[1].note).toMatch(/^Back within its usual range now/);
    expect(m.evidence[2].value).toBe('148 m below');
    expect(m.evidence[2].tone).toBe('info');
  });
});

describe('Paine-like: mapped burn contradicted by native pixels', () => {
  const m = buildOverview(paine, 'walnut');
  it('is calm: no damage seen, no action, a quiet note', () => {
    expect(m.verdict.kind).toBe('burn_contradicted');
    expect(m.verdict.tone).toBe('ok');
    expect(m.verdict.text).toBe('No fire damage seen: a burn mapped over the orchard on Nov 29, 2025 does not show in satellite images.');
    expect(m.plan.none).toBe(true);
    expect(m.plan.items).toEqual([]);
    expect(m.plan.note).toMatch(/^Optional/);
  });
  it('one calm fire card; small drivers (snowmelt 89 %) neither lead nor get cards', () => {
    expect(m.evidence.map((e) => e.theme)).toEqual(['fire']);
    expect(m.evidence[0].tone).toBe('ok');
    expect(m.evidence[0].value).toBe('No damage seen');
    expect(m.clear).toBeNull();
  });
  it('detects the contradiction from the provenance note, not only the text', () => {
    const d = paine.risk.components.disaster.drivers[0];
    expect(isContradictedBurn({ ...d, text: 'Burned area mapped on the orchard.' })).toBe(true);
    expect(isContradictedBurn({ ...d, provenance: prov({ note: 'GWIS' }), text: 'Burned area mapped inside the zone circle.' })).toBe(false);
  });
});

describe('Curicó-like: active fire detections nearby, watch', () => {
  const m = buildOverview(curico, 'cherry');
  it('names the fire and the date, says the crop looked normal', () => {
    expect(m.verdict.kind).toBe('fire_nearby');
    expect(m.verdict.tone).toBe('watch');
    expect(m.verdict.text).toBe('Fire hotspots detected near the orchard since Nov 6, often small farm burns; the crop looked normal in the last image (Nov 3).');
  });
  it('no rule fired: a watch item from the score, never the green "no action"', () => {
    expect(m.plan.none).toBe(false);
    expect(m.plan.items).toHaveLength(1);
    expect(m.plan.items[0]).toMatchObject({ ruleId: null, action: null, title: 'Keep on watch', tone: 'watch' });
    expect(m.plan.items[0].reason).toContain('no credit rule fired');
  });
  it('fire and water cards; the small frost pocket stays out', () => {
    expect(m.evidence.map((e) => e.theme)).toEqual(['fire', 'water']);
    expect(m.evidence[0].value).toBe('Hotspots nearby');
    expect(m.evidence[1].value).toBe('No stress now');
    expect(m.evidence[1].note).toBe('Scarcity decrees in 11 past years.');
  });
});

describe('normal farm', () => {
  const m = buildOverview(requinoa, 'cherry');
  it('all clear, short and green', () => {
    expect(m.verdict.text).toBe('All clear: vigour, water and weather within normal for fruit set and growth.');
    expect(m.verdict.tone).toBe('ok');
    expect(m.plan.none).toBe(true);
    expect(m.plan.note).toBeNull();
    expect(m.evidence).toEqual([]);
    expect(m.clear?.map((c) => c.key)).toEqual(['vigour', 'water', 'weather']);
    expect(m.clear?.[0].value).toBe('NDVI 0.79, usual 0.70');
  });
  it('only vouches for what was assessed', () => {
    const noWeather = input({ score: 0, tier: 'normal', climate: quietClimate().map((d) => (d.metric === 'tmax_7d_max' ? { ...d, value: null } : d)) });
    const v = buildOverview(noWeather, 'cherry').verdict;
    expect(v.text).toBe('All clear: vigour and water within normal for bloom.');
  });
});

describe('helpers', () => {
  it('splits "Reason: instruction." and keeps a default title otherwise', () => {
    expect(splitActionMessage(ACT.visit)).toEqual({ title: 'Schedule a field visit', reason: 'Vigour lost in the dry season against its own history and its peers' });
    expect(splitActionMessage({ ruleId: 'x', action: 'restructure_review', message: 'Custom note' })).toEqual({ title: 'Open a restructuring review', reason: 'Custom note' });
  });
  it('decree number and latest clear point', () => {
    expect(decreeNumber('DGA decree No. 177 of 9 Jul 2026')).toBe('No. 177');
    expect(decreeNumber('Decreto MOP')).toBeNull();
    expect(latestClear([pt('2026-01-01', 0.5, 0, 0, 0), pt('2026-01-06', null, 0, 0, 0), pt('2026-01-11', 0.4, 0, 0, 0, true)])?.date).toBe('2026-01-01');
  });
  it('then-vs-now pairs use observed native frames only', () => {
    const frames = [frame('2025-10-29', 0.25), frame('2025-11-03', 0.24, false), frame('2026-10-24', 0.25), frame('2026-10-29', 0.2), frame('2026-11-02', 0.18, false)];
    const p = yearAgoPair({ frames })!;
    expect([p.then.date, p.now.date]).toEqual(['2025-10-29', '2026-10-29']);
    expect(p.then.path).toBe('/files/imagery/f/2025-10-29_rgb.png');
    expect(p.now.path).not.toContain('_sr');
    const b = aroundPair({ frames: [frame('2025-11-23', 0.87), frame('2025-11-28', 0.86), frame('2025-12-03', 0.86), frame('2025-12-20', 0.85)] }, '2025-11-29')!;
    expect([b.then.date, b.now.date]).toEqual(['2025-11-28', '2025-12-03']);
    expect(aroundPair({ frames: [frame('2025-11-28', 0.86)] }, '2025-11-29')).toBeNull();
    expect(yearAgoPair({ frames: [frame('2026-10-29', 0.2)] })).toBeNull();
  });
});

describe('every offline snapshot farm gets a plain verdict', () => {
  const dir = fileURLToPath(new URL('../../../public/snapshot/', import.meta.url));
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as { farmIds: string[] };
  const portfolio = JSON.parse(readFileSync(`${dir}portfolio.json`, 'utf8')) as { farms: { id: string; crop: Parameters<typeof buildOverview>[1] }[] };
  for (const id of manifest.farmIds) {
    it(id, () => {
      const a = FarmAssessmentSchema.parse(JSON.parse(readFileSync(`${dir}assessment-farm-${id}.json`, 'utf8')));
      const crop = portfolio.farms.find((f) => f.id === id)!.crop;
      const m = buildOverview(a as OverviewInput, crop);
      expect(m.verdict.text.length).toBeGreaterThan(10);
      expect(m.verdict.text).not.toMatch(JARGON);
      expect(m.evidence.length).toBeLessThanOrEqual(3);
      if (a.risk.tier !== 'normal') expect(m.plan.none).toBe(false);
    });
  }
});
