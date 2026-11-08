/**
 * Farm Overview model (v1.3): decision first, evidence second, detail on demand.
 *
 * Pure (no React, no DOM; node-tested). It turns the structured assessment into what a credit officer reads top to
 * bottom on the Overview tab:
 *   1. a verdict: one plain-language sentence built here from structured fields (tier, leading driver, abandonment
 *      and vigour flags, water decree, fire), never from the service's technical headline, plus a confidence word;
 *   2. the plan: fired credit actions, most severe first, each with a verb-first title and a one-line reason;
 *   3. evidence: two or three themed cards for the drivers that matter, ranked by their largest driver impact;
 *   4. an "all clear" summary for normal farms.
 *
 * Trust rule: nothing here computes a risk metric. Numbers are read from the assessment (drivers, water, peers,
 * series) or the imagery timeline (native frames only) and only formatted. A piece that is missing is omitted,
 * never filled in.
 */
import type {
  CreditAction,
  Crop,
  Driver,
  FarmAssessment,
  FiredCreditAction,
  ImageryFrame,
  ImageryTimeline,
  Peril,
  SeriesPoint,
  SeriesVariable,
  Tier,
} from '@/domain/types';
import { addDays, daysBetween } from '@/domain/dates';
import { date, number } from '@/shared/format';
import type { FarmTab } from './tabModel';

/* ───────────────────────── inputs ───────────────────────── */

/** The slice of the assessment the overview reads (kept narrow so tests can build it inline). */
export type OverviewInput = Pick<FarmAssessment, 'asOf' | 'dataAsOf' | 'nextInstallment'> & {
  risk: Pick<FarmAssessment['risk'], 'score' | 'tier' | 'scoreTier' | 'stage' | 'drivers' | 'creditActions'> & {
    components: { [K in 'climate' | 'disaster' | 'geography']: { drivers: Driver[] } };
  };
  water: {
    supply: Pick<FarmAssessment['water']['supply'], 'decreeActive' | 'decreeId' | 'decreeUntil' | 'snowmeltPctOfNormal' | 'basin'>;
    stress: Pick<FarmAssessment['water']['stress'], 'ndmiZ' | 'ndmiPeerDelta' | 'level'>;
    abandonment: Pick<FarmAssessment['water']['abandonment'], 'flag' | 'confidence' | 'evidence'>;
  };
  peers: Pick<FarmAssessment['peers'], 'nPeers' | 'farmNdviZ' | 'peerMedianNdviZ' | 'reading'>;
  series: Partial<Record<SeriesVariable, { points: SeriesPoint[] }>>;
};

export type Tone = 'alert' | 'watch' | 'ok' | 'info';
export type Confidence = 'Confirmed' | 'Likely' | 'Verify on site';

/* ───────────────────────── constants ───────────────────────── */

/** A theme gets an evidence card only when one of its drivers moves the score at least this much (impact 0..1). */
export const MIN_EVIDENCE_IMPACT = 0.2;
export const MAX_EVIDENCE_CARDS = 3;
/** The service's §E.5 water ramp starts below 90 % of normal snowmelt: at or above it supply adds no risk. */
export const SNOWMELT_OK_PCT = 90;
/** Then-vs-now: the "then" frame is the observed frame nearest a year before "now", within this many days. */
const YEAR_AGO_TOLERANCE_DAYS = 45;
/** Before/after a mapped burn: observed frames within this many days of the burn date. */
const BURN_FRAME_DAYS = 20;

/** Plain nouns per crop: the plants and the places ("Vines" / "vineyards"). */
export const CROP_NOUNS: Record<Crop, { plants: string; places: string }> = {
  table_grape: { plants: 'Vines', places: 'vineyards' },
  cherry: { plants: 'Cherry trees', places: 'cherry orchards' },
  walnut: { plants: 'Walnut trees', places: 'walnut orchards' },
  hazelnut: { plants: 'Hazelnut trees', places: 'hazelnut orchards' },
  avocado: { plants: 'Avocado trees', places: 'avocado orchards' },
  blueberry: { plants: 'Blueberry bushes', places: 'blueberry fields' },
};

/* ───────────────────────── small readers ───────────────────────── */

const TIER_TONE: Record<Tier, Tone> = { high: 'alert', watch: 'watch', normal: 'ok' };

function allDrivers(a: OverviewInput): Driver[] {
  const c = a.risk.components;
  return [...c.climate.drivers, ...c.disaster.drivers, ...c.geography.drivers];
}

function findDriver(a: OverviewInput, metric: string): Driver | undefined {
  return allDrivers(a).find((d) => d.metric === metric);
}

/** A driver that was evaluated and moves the score. */
const active = (d: Driver | undefined): d is Driver => !!d && d.severity > 0 && d.impact > 0;
/** A driver that was evaluated (a value exists) and found nothing. */
const assessedQuiet = (d: Driver | undefined): boolean => !!d && d.severity === 0 && d.value !== null && d.value !== undefined;

const num = (v: Driver['value'] | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const fmtSigned = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${number(Math.abs(n), d)}`;
const fmtNum = (n: number, d = 1) => (n < 0 ? `−${number(-n, d)}` : number(n, d));

/** A burn footprint on the orchard that native Sentinel-2 contradicts (service: severity 0.4, note '…contradicted…'). */
export function isContradictedBurn(d: Driver | undefined): boolean {
  if (!d || d.metric !== 'burned_area' || d.severity <= 0) return false;
  return /contradicted/i.test(d.provenance.note ?? '') || /unconfirmed by imagery/i.test(d.text);
}

/** The latest clear (observed, not estimated) point of a series, or null. */
export function latestClear(points: readonly SeriesPoint[] | undefined): SeriesPoint | null {
  if (!points) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.value !== null && p.value !== undefined && !p.estimated) return p;
  }
  return null;
}

export const vigourWithinNormal = (p: SeriesPoint | null): boolean | null =>
  p && p.value !== null && p.p10 !== null ? p.value >= p.p10 : null;

/** "No. 177" from 'DGA decree No. 177 of 9 Jul 2026'; null when the id has no number. */
export function decreeNumber(id: string | null | undefined): string | null {
  const m = id?.match(/No\.?\s*([\w-]+)/i);
  return m ? `No. ${m[1]}` : null;
}

/* ───────────────────────── 1. verdict ───────────────────────── */

export type VerdictKind =
  | 'abandoned'
  | 'vigour_loss'
  | 'vigour_low'
  | 'water_stress'
  | 'decree'
  | 'burn_on_farm'
  | 'burn_contradicted'
  | 'fire_nearby'
  | 'frost'
  | 'heat'
  | 'harvest_rain'
  | 'chill'
  | 'flood'
  | 'site_history'
  | 'all_clear'
  | 'quiet';

export interface Verdict {
  kind: VerdictKind;
  tone: Tone;
  text: string;
  confidence: Confidence | null;
  /** Why this confidence (hover). */
  confidenceHint: string | null;
}

function waterClause(a: OverviewInput): string | null {
  const { stress, supply } = a.water;
  if (stress.level !== 'moderate' && stress.level !== 'severe') return null;
  const supplyOk = !supply.decreeActive && supply.snowmeltPctOfNormal != null && supply.snowmeltPctOfNormal >= SNOWMELT_OK_PCT;
  const short = supply.decreeActive || (supply.snowmeltPctOfNormal != null && supply.snowmeltPctOfNormal < SNOWMELT_OK_PCT);
  const base = 'the canopy is drier than normal now';
  if (supplyOk) return `${base}, though water supply looks fine`;
  if (short) return `${base} and water supply is short`;
  return base;
}

function cropLooksNormal(a: OverviewInput): boolean {
  const vig = findDriver(a, 'ndvi_z');
  return !a.water.abandonment.flag && !active(vig) && (a.water.stress.level === 'none' || a.water.stress.level === 'mild') && assessedQuiet(vig);
}

/** Pick the leading story: abandonment first whenever flagged (it drives the credit rules), else the top driver. */
function leadingDriver(a: OverviewInput): Driver | null {
  if (a.water.abandonment.flag) return findDriver(a, 'abandonment_flag') ?? null;
  // only drivers that matter can lead (the same bar as an evidence card); otherwise the farm reads as clear
  const drivers = [...a.risk.drivers].filter((d) => d.impact >= MIN_EVIDENCE_IMPACT).sort((x, y) => y.impact - x.impact);
  // a contradicted burn leads only when nothing else in climate or disaster matters
  const now = drivers.filter((d) => d.component !== 'geography' && !isContradictedBurn(d));
  if (now.length > 0) return now[0];
  const burn = drivers.find(isContradictedBurn);
  if (burn) return burn;
  return drivers[0] ?? null;
}

export function buildVerdict(a: OverviewInput, crop: Crop): Verdict {
  const nouns = CROP_NOUNS[crop];
  const tierTone = TIER_TONE[a.risk.tier];
  const stage = lower1(a.risk.stage.label);
  const lead = leadingDriver(a);
  const ab = a.water.abandonment;

  if (ab.flag && lead?.metric === 'abandonment_flag') {
    if (ab.confidence === 'low') {
      const w = waterClause(a);
      return {
        kind: 'vigour_loss',
        tone: tierTone,
        text: `${nouns.plants} lost vigour in the dry season${w ? ` and ${w}` : ''}.`,
        confidence: 'Verify on site',
        confidenceHint: 'The canopy stayed green or recovered, so this is not a confirmed stop of irrigation.',
      };
    }
    const peersOk = ab.confidence === 'high';
    return {
      kind: 'abandoned',
      tone: tierTone,
      text: peersOk
        ? `${nouns.plants} look abandoned: bare soil in the dry season while nearby ${nouns.places} stayed green.`
        : `${nouns.plants} look abandoned: bare soil in the dry season.`,
      confidence: peersOk ? 'Confirmed' : 'Likely',
      confidenceHint: peersOk
        ? `Seen against its own history and ${a.peers.nPeers} nearby ${nouns.places}.`
        : `Seen against its own history; too few nearby ${nouns.places} to compare.`,
    };
  }

  if (!lead) return allClearVerdict(a, stage);

  switch (lead.metric) {
    case 'ndvi_z': {
      const r = a.peers.reading;
      const tail =
        r === 'farm_specific' ? ` while nearby ${nouns.places} look normal` : r === 'zone_wide' ? `, like nearby ${nouns.places}: likely the weather` : '';
      return {
        kind: 'vigour_low',
        tone: tierTone,
        text: `${nouns.plants} are less vigorous than normal for ${stage}${tail}.`,
        confidence: r === 'farm_specific' ? 'Likely' : 'Verify on site',
        confidenceHint: r === 'farm_specific' ? 'Only this farm is down against nearby farms.' : null,
      };
    }
    case 'water_supply': {
      const w = waterClause(a);
      if (w) return { kind: 'water_stress', tone: tierTone, text: `${w.charAt(0).toUpperCase()}${w.slice(1)}.`, confidence: null, confidenceHint: null };
      const s = a.water.supply.snowmeltPctOfNormal;
      return {
        kind: 'water_stress',
        tone: tierTone,
        text: s != null ? `Water supply is short: the snowmelt forecast is ${number(s, 0)} % of normal.` : 'Water supply is short.',
        confidence: null,
        confidenceHint: null,
      };
    }
    case 'decree_active': {
      const until = a.water.supply.decreeUntil;
      return {
        kind: 'decree',
        tone: tierTone,
        text: `A water-scarcity decree covers the farm${until ? ` until ${date(until)}` : ''}${a.water.stress.level === 'none' ? '; the canopy still looks well watered' : ''}.`,
        confidence: 'Confirmed',
        confidenceHint: 'Official declaration.',
      };
    }
    case 'burned_area': {
      const on = lead.provenance.observedAt;
      if (isContradictedBurn(lead))
        return {
          kind: 'burn_contradicted',
          tone: 'ok',
          text: `No fire damage seen: a burn mapped over the orchard${on ? ` on ${date(on)}` : ''} does not show in satellite images.`,
          confidence: null,
          confidenceHint: null,
        };
      if (lead.severity >= 1)
        return {
          kind: 'burn_on_farm',
          tone: tierTone,
          text: `A fire was mapped on the orchard${on ? ` on ${date(on)}` : ''}.`,
          confidence: 'Verify on site',
          confidenceHint: 'Burned-area maps are coarse (about 100 ha).',
        };
      return fireNearby(a, lead, tierTone, 'A burn was mapped near the orchard');
    }
    case 'active_fire':
      return fireNearby(a, lead, tierTone, 'Fire hotspots detected near the orchard');
    case 'tmin_7d_min':
    case 'tmax_7d_max':
    case 'max_rain_72h':
    case 'chill_hours_season':
      return weatherVerdict(lead, tierTone, stage);
    case 'flood_footprint':
      return { kind: 'flood', tone: tierTone, text: 'A flood was mapped on or near the farm.', confidence: 'Verify on site', confidenceHint: null };
    default:
      if (lead.component === 'geography') {
        const why = geographyPhrase(lead);
        return {
          kind: 'site_history',
          tone: tierTone,
          text: `No stress now; the score comes from the site${why ? `: ${why}` : ''}.`,
          confidence: null,
          confidenceHint: null,
        };
      }
      return allClearVerdict(a, stage);
  }
}

function fireNearby(a: OverviewInput, d: Driver, tone: Tone, what: string): Verdict {
  const since = d.provenance.observedAt;
  const ndviOn = a.dataAsOf.ndvi;
  const crop = cropLooksNormal(a) ? `; the crop looked normal in the last image${ndviOn ? ` (${date(ndviOn, 'short')})` : ''}` : '';
  const often = d.metric === 'active_fire' ? ', often small farm burns' : '';
  return {
    kind: 'fire_nearby',
    tone,
    text: `${what}${since ? ` since ${date(since, 'short')}` : ''}${often}${crop}.`,
    confidence: null,
    confidenceHint: null,
  };
}

function weatherVerdict(d: Driver, tone: Tone, stage: string): Verdict {
  const v = num(d.value);
  const n = num(d.normal);
  const both = v !== null && n !== null;
  switch (d.metric) {
    case 'tmin_7d_min':
      return { kind: 'frost', tone, text: both ? `Frost at ${stage}: the coldest night reached ${fmtNum(v)} °C; damage starts at ${fmtNum(n)} °C.` : `Frost at ${stage}.`, confidence: null, confidenceHint: null };
    case 'tmax_7d_max':
      return { kind: 'heat', tone, text: both ? `Heat at ${stage}: the hottest hour reached ${fmtNum(v)} °C; stress starts at ${fmtNum(n)} °C.` : `Heat at ${stage}.`, confidence: null, confidenceHint: null };
    case 'max_rain_72h':
      return { kind: 'harvest_rain', tone, text: both ? `Heavy rain at ${stage}: ${number(v, 1)} mm in 72 h; damage starts at ${number(n, 0)} mm.` : `Heavy rain at ${stage}.`, confidence: null, confidenceHint: null };
    default:
      return { kind: 'chill', tone, text: both ? `Winter chill fell short: ${number(v, 0)} h of the ${number(n, 0)} h needed.` : 'Winter chill fell short.', confidence: null, confidenceHint: null };
  }
}

function geographyPhrase(d: Driver): string | null {
  const v = num(d.value);
  switch (d.metric) {
    case 'frost_pocket':
      return v !== null && v < 0 ? `it sits ${number(Math.abs(v), 0)} m below the zone average, where frost can pool` : 'a frost-prone position';
    case 'basin_water_security':
      return v !== null ? `water-scarcity decrees covered the area in ${number(v, 0)} past years` : 'a history of water-scarcity decrees';
    case 'fire_recurrence':
      return v !== null ? `fires burned in the zone in ${number(v, 0)} past years` : 'a history of fires in the zone';
    default:
      return null;
  }
}

/** What the normal-farm summary can actually vouch for. */
export interface ClearChecks {
  vigour: boolean;
  water: boolean;
  weather: boolean;
}

export function clearChecks(a: OverviewInput): ClearChecks {
  const vig = findDriver(a, 'ndvi_z');
  const vigour = !a.water.abandonment.flag && assessedQuiet(vig);
  const water = !a.water.supply.decreeActive && a.water.stress.level === 'none';
  const weatherDrivers = ['tmin_7d_min', 'tmax_7d_max', 'max_rain_72h'].map((m) => findDriver(a, m));
  const weather = weatherDrivers.every(assessedQuiet);
  return { vigour, water, weather };
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function allClearVerdict(a: OverviewInput, stage: string): Verdict {
  const c = clearChecks(a);
  const ok = (['vigour', 'water', 'weather'] as const).filter((k) => c[k]);
  if (a.risk.tier === 'normal' && ok.length > 0)
    return { kind: 'all_clear', tone: 'ok', text: `All clear: ${listJoin(ok)} within normal for ${stage}.`, confidence: null, confidenceHint: null };
  return { kind: 'quiet', tone: TIER_TONE[a.risk.tier], text: `No significant stress found at ${stage}.`, confidence: null, confidenceHint: null };
}

/* ───────────────────────── 2. plan ───────────────────────── */

/** Most severe first. */
export const ACTION_RANK: Record<CreditAction, number> = { restructure_review: 0, high: 1, field_visit: 2, watch: 3 };

const DEFAULT_TITLES: Record<CreditAction, string> = {
  restructure_review: 'Open a restructuring review',
  high: 'Treat the loan as high risk',
  field_visit: 'Schedule a field visit',
  watch: 'Review repayment capacity',
};

export interface PlanItem {
  key: string;
  /** null for the item derived from the score (no credit rule fired). */
  ruleId: string | null;
  action: CreditAction | null;
  title: string;
  reason: string;
  tone: 'alert' | 'watch';
}

export interface Plan {
  items: PlanItem[];
  /** true → "No action needed" (only when the tier is normal and no rule fired). */
  none: boolean;
  /** One calm line under "No action needed", or null. */
  note: string | null;
}

/** "Reason: instruction." → { title: 'Instruction', reason: 'Reason' }. Messages without a colon keep a default title. */
export function splitActionMessage(c: FiredCreditAction): { title: string; reason: string } {
  const msg = c.message.trim().replace(/\.$/, '');
  const i = msg.indexOf(': ');
  if (i > 0) {
    const instr = msg.slice(i + 2).trim();
    return { title: instr.charAt(0).toUpperCase() + instr.slice(1), reason: msg.slice(0, i).trim() };
  }
  return { title: DEFAULT_TITLES[c.action], reason: msg };
}

export function buildPlan(a: OverviewInput): Plan {
  const fired = [...a.risk.creditActions].sort((x, y) => ACTION_RANK[x.action] - ACTION_RANK[y.action] || x.ruleId.localeCompare(y.ruleId));
  if (fired.length > 0) {
    return {
      items: fired.map((c) => {
        const { title, reason } = splitActionMessage(c);
        return { key: c.ruleId, ruleId: c.ruleId, action: c.action, title, reason, tone: c.action === 'restructure_review' || c.action === 'high' ? 'alert' : 'watch' };
      }),
      none: false,
      note: null,
    };
  }
  if (a.risk.tier !== 'normal')
    return {
      items: [
        {
          key: 'score-tier',
          ruleId: null,
          action: null,
          title: 'Keep on watch',
          reason: `The score is in the ${a.risk.tier === 'high' ? 'high' : 'watch'} band; no credit rule fired.`,
          tone: a.risk.tier === 'high' ? 'alert' : 'watch',
        },
      ],
      none: false,
      note: null,
    };
  const burn = allDrivers(a).find(isContradictedBurn);
  return {
    items: [],
    none: true,
    note: burn ? 'Optional: look at the orchard on the next routine visit, since burn maps are coarse.' : null,
  };
}

/* ───────────────────────── 3. evidence ───────────────────────── */

export type ThemeKey = 'vigour' | 'water' | 'fire' | 'frost' | 'heat' | 'rain' | 'chill' | 'flood';

const THEME_OF: Partial<Record<Peril, ThemeKey>> = {
  abandonment: 'vigour',
  vigour: 'vigour',
  water: 'water',
  declared_emergency: 'water',
  fire: 'fire',
  frost: 'frost',
  heat: 'heat',
  harvest_rain: 'rain',
  chill: 'chill',
  flood: 'flood',
};

/** Tie-break order when two themes have the same top impact. */
const THEME_ORDER: ThemeKey[] = ['vigour', 'water', 'fire', 'frost', 'heat', 'rain', 'chill', 'flood'];

const THEME_TITLES: Record<ThemeKey, string> = {
  vigour: 'Crop vigour',
  water: 'Water',
  fire: 'Fire',
  frost: 'Frost',
  heat: 'Heat',
  rain: 'Rain',
  chill: 'Winter chill',
  flood: 'Flood',
};

const THEME_TABS: Record<ThemeKey, { tab: FarmTab; label: string }> = {
  vigour: { tab: 'imagery', label: 'See Imagery' },
  water: { tab: 'water', label: 'See Water' },
  fire: { tab: 'events', label: 'See Events' },
  frost: { tab: 'risk', label: 'See Risk' },
  heat: { tab: 'risk', label: 'See Risk' },
  rain: { tab: 'risk', label: 'See Risk' },
  chill: { tab: 'risk', label: 'See Risk' },
  flood: { tab: 'events', label: 'See Events' },
};

export interface FramePick {
  date: string;
  /** Native service path ('/files/imagery/…'); never an SR image. */
  path: string;
  layer: 'rgb' | 'ndvi';
  ndviMean: number;
}

export interface FramePair {
  then: FramePick;
  now: FramePick;
  thenLabel: string;
  nowLabel: string;
}

export interface Spark {
  variable: SeriesVariable;
  points: SeriesPoint[];
  /** Horizontal reference (a damage threshold), or null. */
  threshold: number | null;
  /** Shown under the sparkline, e.g. 'Grey band: its normal range'. */
  caption: string;
}

export interface EvidenceCard {
  theme: ThemeKey;
  title: string;
  tone: Tone;
  /** Largest impact among the theme's drivers (ranking key). */
  impact: number;
  /** The big plain number or fact. */
  value: string;
  /** The comparison next to it, e.g. 'vs 0.27 usual for the date'. */
  compare: string | null;
  /** One plain line. */
  note: string | null;
  /** Technical detail for hover (z scores, peers, the service's text). */
  detail: string;
  link: { tab: FarmTab; label: string };
  spark: Spark | null;
  frames: FramePair | null;
}

function themeDrivers(a: OverviewInput): Map<ThemeKey, Driver[]> {
  const m = new Map<ThemeKey, Driver[]>();
  for (const d of allDrivers(a)) {
    const t = THEME_OF[d.peril];
    if (!t) continue;
    m.set(t, [...(m.get(t) ?? []), d]);
  }
  for (const [, ds] of m) ds.sort((x, y) => y.impact - x.impact);
  return m;
}

const observedFrames = (t: Pick<ImageryTimeline, 'frames'> | null | undefined): ImageryFrame[] =>
  (t?.frames ?? []).filter((f) => f.kind === 'observed' && !!(f.urls.rgb || f.urls.ndvi));

function pick(f: ImageryFrame, layer: 'rgb' | 'ndvi'): FramePick {
  const path = (layer === 'rgb' ? f.urls.rgb : f.urls.ndvi) ?? f.urls.ndvi;
  return { date: f.date, path, layer: layer === 'rgb' && f.urls.rgb ? 'rgb' : 'ndvi', ndviMean: f.ndviMean };
}

/** Then vs now: the latest observed frame, and the observed frame nearest a year before it (±45 days). */
export function yearAgoPair(t: Pick<ImageryTimeline, 'frames'> | null | undefined): FramePair | null {
  const obs = observedFrames(t);
  if (obs.length < 2) return null;
  const now = obs[obs.length - 1];
  const target = addDays(now.date, -365);
  let best: ImageryFrame | null = null;
  for (const f of obs) {
    const gap = Math.abs(daysBetween(target, f.date));
    if (gap <= YEAR_AGO_TOLERANCE_DAYS && (!best || gap < Math.abs(daysBetween(target, best.date)))) best = f;
  }
  if (!best || best.date === now.date) return null;
  const layer = best.urls.rgb && now.urls.rgb ? 'rgb' : 'ndvi';
  return { then: pick(best, layer), now: pick(now, layer), thenLabel: 'A year ago', nowLabel: 'Latest' };
}

/** Before vs after a dated event: the last observed frame before it and the first after it (within 20 days). */
export function aroundPair(t: Pick<ImageryTimeline, 'frames'> | null | undefined, on: string | null | undefined): FramePair | null {
  if (!on) return null;
  const day = on.slice(0, 10);
  const obs = observedFrames(t);
  const before = [...obs].reverse().find((f) => f.date < day && daysBetween(f.date, day) <= BURN_FRAME_DAYS);
  const after = obs.find((f) => f.date > day && daysBetween(day, f.date) <= BURN_FRAME_DAYS);
  if (!before || !after) return null;
  const layer = before.urls.rgb && after.urls.rgb ? 'rgb' : 'ndvi';
  return { then: pick(before, layer), now: pick(after, layer), thenLabel: 'Before', nowLabel: 'After' };
}

function spark(a: OverviewInput, variable: SeriesVariable, threshold: number | null, caption: string): Spark | null {
  const pts = (a.series[variable]?.points ?? []).filter((p) => p.value !== null && p.value !== undefined);
  return pts.length >= 3 ? { variable, points: pts, threshold, caption } : null;
}

function sevTone(d: Driver | undefined): Tone {
  if (!d || d.severity <= 0) return 'ok';
  if (d.component === 'geography') return 'info';
  return d.severity >= 0.7 ? 'alert' : 'watch';
}

function vigourCard(a: OverviewInput, ds: Driver[], crop: Crop, imagery: Pick<ImageryTimeline, 'frames'> | null | undefined): EvidenceCard {
  const ab = a.water.abandonment;
  const nouns = CROP_NOUNS[crop];
  const p = latestClear(a.series.ndvi?.points);
  const within = vigourWithinNormal(p);
  const peers = a.peers;
  let tone: Tone = sevTone(ds[0]);
  if (ab.flag) tone = ab.confidence === 'low' ? 'watch' : 'alert';
  let note: string | null;
  if (ab.flag && ab.confidence !== 'low')
    note = within === false ? 'Still below its usual range in the latest image.' : within ? 'Back within its usual range in the latest image.' : null;
  else if (ab.flag) note = within ? 'Back within its usual range now; the dry-season drop needs a look on site.' : 'Still below its usual range; the dry-season drop needs a look on site.';
  else
    note =
      peers.reading === 'farm_specific'
        ? `Only this farm is down; nearby ${nouns.places} look normal.`
        : peers.reading === 'zone_wide'
          ? `Nearby ${nouns.places} are down too: likely the weather.`
          : peers.reading === 'normal'
            ? `In line with nearby ${nouns.places}.`
            : null;
  const z = [
    peers.farmNdviZ != null ? `NDVI z ${fmtSigned(peers.farmNdviZ)} vs its own history` : null,
    peers.peerMedianNdviZ != null ? `zone peers' median z ${fmtSigned(peers.peerMedianNdviZ)} (n=${peers.nPeers})` : null,
  ].filter(Boolean);
  return {
    theme: 'vigour',
    title: THEME_TITLES.vigour,
    tone,
    impact: ds[0]?.impact ?? 0,
    value: p && p.value !== null ? `NDVI ${number(p.value, 2)}` : ab.flag ? 'Vigour lost' : 'Below normal',
    compare: p && p.p50 !== null ? `vs ${number(p.p50, 2)} usual for ${date(p.date, 'short')}` : null,
    note,
    detail: [z.join('; '), ab.flag ? ab.evidence : null].filter(Boolean).join('. '),
    link: THEME_TABS.vigour,
    spark: spark(a, 'ndvi', null, 'NDVI · band: its usual range'),
    frames: yearAgoPair(imagery),
  };
}

function waterCard(a: OverviewInput, ds: Driver[]): EvidenceCard {
  const { supply, stress } = a.water;
  const basin = ds.find((d) => d.metric === 'basin_water_security');
  const stressed = stress.level === 'moderate' || stress.level === 'severe';
  const snow = supply.snowmeltPctOfNormal;
  const snowTxt = snow != null ? `Snowmelt ${number(snow, 0)} % of normal` : null;
  let value: string;
  let compare: string | null = null;
  const notes: string[] = [];
  let tone: Tone;
  if (supply.decreeActive) {
    const no = decreeNumber(supply.decreeId);
    value = no ? `Decree ${no} active` : 'Scarcity decree active';
    compare = supply.decreeUntil ? `until ${date(supply.decreeUntil)}` : null;
    if (stressed) notes.push(`Canopy drier than normal (${stress.level} stress)`);
    if (snowTxt) notes.push(snowTxt);
    tone = stress.level === 'severe' ? 'alert' : 'watch';
  } else if (stressed) {
    value = stress.level === 'severe' ? 'Severe stress' : 'Moderate stress';
    compare = 'canopy drier than normal';
    if (snowTxt) notes.push(snow! >= SNOWMELT_OK_PCT ? `${snowTxt}: supply is not the cause` : snowTxt);
    tone = stress.level === 'severe' ? 'alert' : 'watch';
  } else if (snow != null && snow < SNOWMELT_OK_PCT && active(ds.find((d) => d.metric === 'water_supply'))) {
    value = `Snowmelt ${number(snow, 0)} %`;
    compare = `of normal${supply.basin ? ` for the ${supply.basin} basin` : ''}`;
    tone = 'watch';
  } else {
    value = stress.level === 'none' ? 'No stress now' : 'Not assessed now';
    compare = snowTxt ? lower1(snowTxt) : null;
    tone = basin && basin.severity > 0 ? 'info' : 'ok';
  }
  if (notes.length < 2 && basin && basin.severity > 0 && num(basin.value) !== null) notes.push(`Scarcity decrees in ${number(num(basin.value)!, 0)} past years`);
  const detail = [
    stress.ndmiZ != null ? `NDMI z ${fmtSigned(stress.ndmiZ)} vs its own history` : null,
    stress.ndmiPeerDelta != null ? `${fmtSigned(stress.ndmiPeerDelta)} vs zone peers` : null,
    supply.decreeId ?? null,
    snow != null && supply.basin ? `snowmelt forecast for the ${supply.basin} basin` : null,
  ]
    .filter(Boolean)
    .join('; ');
  return {
    theme: 'water',
    title: THEME_TITLES.water,
    tone,
    impact: ds[0]?.impact ?? 0,
    value,
    compare,
    note: notes.length ? `${notes.join('. ')}.` : null,
    detail: detail || ds[0]?.text || '',
    link: THEME_TABS.water,
    spark: spark(a, 'ndmi', null, 'Canopy moisture · band: usual range'),
    frames: null,
  };
}

function fireCard(a: OverviewInput, ds: Driver[], imagery: Pick<ImageryTimeline, 'frames'> | null | undefined): EvidenceCard {
  const lead = ds.find((d) => d.metric !== 'fire_recurrence' && d.severity > 0) ?? ds[0];
  const on = lead.provenance.observedAt;
  const rec = ds.find((d) => d.metric === 'fire_recurrence' && d.severity > 0);
  const recNote = rec && num(rec.value) !== null ? `Fires in the zone in ${number(num(rec.value)!, 0)} past years.` : null;
  const base = { theme: 'fire' as const, title: THEME_TITLES.fire, impact: ds[0]?.impact ?? 0, detail: lead.text, link: THEME_TABS.fire, spark: null };
  if (lead.metric === 'burned_area' && isContradictedBurn(lead)) {
    const pair = aroundPair(imagery, on);
    return {
      ...base,
      tone: 'ok',
      value: 'No damage seen',
      compare: on ? `burn mapped ${date(on)}` : 'burn mapped on the orchard',
      note: 'The burn map is coarse; the canopy stayed green in native satellite images.',
      frames: pair,
    };
  }
  if (lead.metric === 'burned_area' && lead.severity >= 1)
    return { ...base, tone: 'alert', value: 'Burn on the orchard', compare: on ? `mapped ${date(on)}` : null, note: recNote, frames: aroundPair(imagery, on) };
  if (lead.metric === 'active_fire')
    return {
      ...base,
      tone: 'watch',
      value: 'Hotspots nearby',
      compare: on ? `since ${date(on, 'short')}` : null,
      note: 'Satellite heat detections in the zone, often small farm burns; none mapped on the orchard.',
      frames: null,
    };
  if (lead.metric === 'burned_area')
    return { ...base, tone: lead.severity >= 0.6 ? 'watch' : 'info', value: 'Fire in the zone', compare: on ? `since ${date(on, 'short')}` : null, note: recNote, frames: null };
  return { ...base, tone: 'info', value: num(lead.value) !== null ? `${number(num(lead.value)!, 0)} fire years` : 'Fire history', compare: 'in the zone', note: null, frames: null };
}

function weatherCard(a: OverviewInput, theme: 'frost' | 'heat' | 'rain' | 'chill', ds: Driver[]): EvidenceCard {
  const now = ds.find((d) => d.component === 'climate' && d.severity > 0);
  const pocket = ds.find((d) => d.metric === 'frost_pocket' && d.severity > 0);
  const base = { theme, title: THEME_TITLES[theme], impact: ds[0]?.impact ?? 0, link: THEME_TABS[theme], frames: null };
  if (now) {
    const v = num(now.value);
    const n = num(now.normal);
    const unit = now.unit ?? '';
    const fmt = (x: number) => (unit === 'mm' || unit === 'h' ? number(x, unit === 'h' ? 0 : 1) : fmtNum(x));
    const word = theme === 'frost' || theme === 'rain' ? 'damage at' : theme === 'heat' ? 'stress at' : 'needed';
    const variable: SeriesVariable | null = theme === 'frost' ? 'tmin' : theme === 'heat' ? 'tmax' : theme === 'rain' ? 'precip' : null;
    return {
      ...base,
      tone: sevTone(now),
      value: v !== null ? `${fmt(v)} ${unit}`.trim() : THEME_TITLES[theme],
      compare: n !== null ? (theme === 'chill' ? `of ${fmt(n)} ${unit} ${word}` : `${word} ${fmt(n)} ${unit}`.trim()) : null,
      note: pocket ? `${geographyPhrase(pocket)}.`.replace(/^./, (c) => c.toUpperCase()) : null,
      detail: now.text,
      spark: variable ? spark(a, variable, n, theme === 'rain' ? 'Daily rain · dashed: damage level' : theme === 'heat' ? 'Daily high · dashed: stress level' : 'Daily low · dashed: damage level') : null,
    };
  }
  const g = pocket ?? ds[0];
  const v = num(g.value);
  return {
    ...base,
    tone: 'info',
    value: g.metric === 'frost_pocket' && v !== null && v < 0 ? `${number(Math.abs(v), 0)} m below` : THEME_TITLES[theme],
    compare: g.metric === 'frost_pocket' ? 'the zone average' : null,
    note: g.metric === 'frost_pocket' ? 'Cold air can pool here; no frost now.' : null,
    detail: g.text,
    spark: null,
  };
}

export function buildEvidence(a: OverviewInput, crop: Crop, imagery?: Pick<ImageryTimeline, 'frames'> | null): EvidenceCard[] {
  const groups = themeDrivers(a);
  const ranked = [...groups.entries()]
    .map(([theme, ds]) => ({ theme, ds, impact: ds[0]?.impact ?? 0 }))
    .filter((g) => g.impact >= MIN_EVIDENCE_IMPACT)
    .sort((x, y) => y.impact - x.impact || THEME_ORDER.indexOf(x.theme) - THEME_ORDER.indexOf(y.theme))
    .slice(0, MAX_EVIDENCE_CARDS);
  return ranked.map(({ theme, ds }) => {
    switch (theme) {
      case 'vigour':
        return vigourCard(a, ds, crop, imagery);
      case 'water':
        return waterCard(a, ds);
      case 'fire':
        return fireCard(a, ds, imagery);
      case 'flood': {
        const d = ds[0];
        return {
          theme,
          title: THEME_TITLES.flood,
          tone: sevTone(d),
          impact: d.impact,
          value: d.severity >= 1 ? 'Flood on the farm' : 'Flood nearby',
          compare: d.provenance.observedAt ? `mapped ${date(d.provenance.observedAt)}` : null,
          note: null,
          detail: d.text,
          link: THEME_TABS.flood,
          spark: null,
          frames: null,
        };
      }
      default:
        return weatherCard(a, theme, ds);
    }
  });
}

/* ───────────────────────── 4. all clear ───────────────────────── */

export interface ClearItem {
  key: 'vigour' | 'water' | 'weather';
  title: string;
  value: string;
  ok: boolean;
}

/** Small green cards for a normal farm: what was checked and found normal (unknowns are omitted). */
export function buildClearItems(a: OverviewInput): ClearItem[] {
  const c = clearChecks(a);
  const out: ClearItem[] = [];
  if (c.vigour) {
    const p = latestClear(a.series.ndvi?.points);
    out.push({
      key: 'vigour',
      title: 'Crop vigour',
      value: p && p.value !== null ? `NDVI ${number(p.value, 2)}${p.p50 !== null ? `, usual ${number(p.p50, 2)}` : ''}` : 'Normal',
      ok: true,
    });
  }
  if (c.water) {
    const s = a.water.supply.snowmeltPctOfNormal;
    out.push({ key: 'water', title: 'Water', value: s != null ? `No stress; snowmelt ${number(s, 0)} % of normal` : 'No stress', ok: true });
  }
  if (c.weather) {
    const lo = num(findDriver(a, 'tmin_7d_min')?.value);
    const hi = num(findDriver(a, 'tmax_7d_max')?.value);
    out.push({
      key: 'weather',
      title: 'Weather',
      value: lo !== null && hi !== null ? `No frost, heat or rain stress (${fmtNum(lo)} to ${fmtNum(hi)} °C this week)` : 'No frost, heat or rain stress',
      ok: true,
    });
  }
  return out;
}

/* ───────────────────────── all together ───────────────────────── */

export interface OverviewModel {
  verdict: Verdict;
  plan: Plan;
  evidence: EvidenceCard[];
  /** Non-null → the calm, short layout for a normal farm. */
  clear: ClearItem[] | null;
}

export function buildOverview(a: OverviewInput, crop: Crop, imagery?: Pick<ImageryTimeline, 'frames'> | null): OverviewModel {
  const verdict = buildVerdict(a, crop);
  const plan = buildPlan(a);
  const evidence = buildEvidence(a, crop, imagery);
  const clear = verdict.kind === 'all_clear' && plan.none && evidence.length === 0 ? buildClearItems(a) : null;
  return { verdict, plan, evidence, clear };
}
