/**
 * Climate Loan Monitor — v1 contract types. NORMATIVE.
 *
 * This file is reproduced verbatim in contracts/v1/CONTRACT.md section A. The app copies it into
 * app/src/domain (app foundation owns that copy). The service mirrors it with pydantic models in
 * service/app/models.py (alias_generator=to_camel, populate_by_name=True, serialise by_alias).
 *
 * Conventions (see CONTRACT.md §0):
 * - JSON keys are camelCase. Enum VALUES are snake_case strings exactly as written here.
 * - `x?: T | null` = optional. Producers SHOULD emit null rather than omit; consumers MUST treat
 *   missing and null identically.
 * - Dates 'YYYY-MM-DD'. Timestamps ISO 8601 UTC with 'Z' ('2026-11-07T16:07:00Z'). Month-days 'MM-DD'.
 * - Coordinates are [lng, lat] (GeoJSON order), WGS84.
 * - Money is in the portfolio currency, plain numbers, 2 decimals max.
 */
import type { Geometry, Polygon } from 'geojson';

export type { Geometry, Polygon };

export const CONTRACT_VERSION = 1 as const;

/* ───────────────────────────── Enumerations ───────────────────────────── */

export type Crop = 'cherry' | 'blueberry' | 'avocado' | 'walnut' | 'hazelnut' | 'table_grape';
export const CROPS: Crop[] = ['cherry', 'blueberry', 'avocado', 'walnut', 'hazelnut', 'table_grape'];

export type Peril =
  | 'frost'
  | 'heat'
  | 'harvest_rain'
  | 'water'
  | 'chill'
  | 'fire'
  | 'flood'
  | 'declared_emergency'
  | 'abandonment'
  | 'vigour';
export const PERILS: Peril[] = [
  'frost',
  'heat',
  'harvest_rain',
  'water',
  'chill',
  'fire',
  'flood',
  'declared_emergency',
  'abandonment',
  'vigour',
];
/** Perils aggregated into component C (climate/water). */
export const CLIMATE_PERILS: Peril[] = ['frost', 'heat', 'harvest_rain', 'water', 'chill', 'vigour', 'abandonment'];
/** Perils aggregated into component D (disaster). */
export const DISASTER_PERILS: Peril[] = ['fire', 'flood', 'declared_emergency'];

export type Tier = 'normal' | 'watch' | 'high';
export const TIERS: Tier[] = ['normal', 'watch', 'high'];

export type DataTier = 'enhanced' | 'standard';
export type LicenceTier = 'commercial_ok' | 'demo_only' | 'unresolved';

/** v1 currencies. BOB was dropped with Bolivia (archived). Non-Chilean portfolios use USD. */
export type Currency = 'USD' | 'CLP';

/* ───────────────────────────── Provenance ───────────────────────────── */

/** Attached to every value the service returns (ADR-0011 D1, ADR-0012 D2). camelCase in JSON. */
export interface Provenance {
  /** Wrapper id that answered, e.g. 'cr2met_nrt', 'ran_station', 's2_l2a_pc', 'dga_decrees', 'gwis_ba', 'ciren_catastro', 'derived'. */
  source: string;
  /** Human label, e.g. 'CR2MET NRT (CR2, Univ. de Chile)'. */
  sourceLabel: string;
  /** Date (or timestamp) of the underlying observation; for a range, its END. null when unavailable. */
  observedAt: string | null;
  /** ISO UTC timestamp when the service fetched it (cache write time). */
  fetchedAt: string;
  /** e.g. '10 m', '0.05° (~5 km)', 'station', 'commune', 'province', 'n/a'. */
  resolution: string;
  licenceTier: LicenceTier;
  dataTier: DataTier;
  /** true when served from cache after a failed refresh (ADR-0012 D1). */
  stale: boolean;
  /** true when a fallback, gap-fill, interpolation or proxy produced the value. */
  estimated: boolean;
  /** Free text: why estimated/unavailable, caveats, 'fixture: illustrative'. */
  note?: string | null;
}

/* ───────────────────────────── Countries ───────────────────────────── */

export interface Country {
  /** ISO 3166-1 alpha-2, or the pseudo code 'GLOBAL'. */
  code: string;
  name: string;
  nameEs: string;
  dataTier: DataTier;
  /** true only for 'GLOBAL' in v1 (shown, not selectable). */
  comingLater: boolean;
  /** Map centre [lng, lat] and default zoom for the wizard. */
  center: [number, number];
  zoom: number;
  defaultCurrency: Currency;
}

/* ───────────────────────────── Crop templates ───────────────────────────── */

export interface Labels {
  es: string;
  en: string;
}

export interface Stage {
  /** Unique within the crop, snake_case, e.g. 'bloom'. */
  key: string;
  /** English label, sentence case. */
  label: string;
  labelEs: string;
  /** Inclusive 'MM-DD' window; may wrap the year end (start > end, e.g. '11-10'..'01-15'). */
  start: string;
  end: string;
  /** Sensitivity 0..1 to every peril at this stage. All 10 keys present. */
  sensitivity: Record<Peril, number>;
}

/** Per-stage agronomic thresholds. All present for every stage; sensitivity 0 disables a peril. */
export interface StageThresholds {
  /** T10: temperature (°C) killing ~10 % of the organ; frost severity starts at frostCriticalC + 1. */
  frostCriticalC: number;
  /** T90: severity 1 at or below this (°C). */
  frostSevereC: number;
  /** Heat/sunburn trigger on daily Tmax (°C). */
  heatC: number;
  /** Damaging rain over any 72 h (mm). Severity 0.5 at this value. */
  harvestRainMm72h: number;
  /** FAO-56 crop coefficient for ETc = Kc × ETo. */
  kc: number;
}

export interface AgronomicRules {
  /** Keyed by Stage.key; one entry per stage. */
  stages: Record<string, StageThresholds>;
  /** Crop-level winter chill requirement, hours < 7.2 °C, 1 May–31 Aug. */
  chillHoursMin: number;
  /** NDVI baseline length in years (applies to NDVI/NDMI only; weather uses 1991–2020). */
  baselineYears: number;
}

export interface RiskWeights {
  a: number;
  b: number;
  c: number;
}

export type CreditAction = 'watch' | 'high' | 'field_visit' | 'restructure_review';

export type CreditMetric =
  | 'risk.tier' //            value: Tier            ops: eq neq gt gte lt lte (normal < watch < high); reads Risk.scoreTier
  | 'risk.score' //           value: number          reads Risk.score
  | 'water.decreeActive' //   value: boolean         ops: eq neq
  | 'water.snowmeltPct' //    value: number          (% of 1991–2020 normal); null metric → condition false
  | 'water.stressLevel' //    value: StressLevel     ordered none < mild < moderate < severe; 'unknown' → false
  | 'imagery.abandonment' //  value: boolean         WaterStatus.abandonment.flag
  | 'events.burnedAreaIntersects'; // value: boolean  any fire event with observed_footprint intersecting the farm polygon in the 13-month window, unless native S2 NDVI contradicts it (CONTRACT §E.5 v1.1)

export type CreditOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface CreditCondition {
  metric: CreditMetric;
  op: CreditOp;
  value: number | string | boolean;
  /** If set, the condition also requires the next installment (dueDate > asOf) to be due within N days of asOf. */
  withinDaysBeforeInstallment?: number | null;
}

export interface CreditRule {
  /** Stable id, kebab-case, e.g. 'cr-abandonment'. Unique across template + portfolio rules. */
  id: string;
  name: string;
  enabled: boolean;
  /** Fires when `when` AND every condition in `when.and` hold. */
  when: CreditCondition & { and?: CreditCondition[] | null };
  then: CreditAction;
  /** Shown to the lender when the rule fires. Plain language. */
  message: string;
}

export interface CropTemplate {
  crop: Crop;
  labels: Labels;
  /** CIREN Catastro Frutícola `especie_01` values that map to this crop (hazelnut has two candidates). */
  cirenEspecie: string[];
  evergreen: boolean;
  /** Default for Farm.covered when the farm leaves it null. false for all six in v1. */
  coveredDefault: boolean;
  /** How often orchards of this crop are under covers/nets (drives a soft hint when Farm.covered is null). */
  coverLikelihood: 'rarely' | 'sometimes' | 'often';
  /** UI colour (hex). */
  color: string;
  /** In calendar order; windows tile the year without gaps or overlaps (see §E.3). */
  stages: Stage[];
  rules: AgronomicRules;
  weights: RiskWeights;
  creditRules: CreditRule[];
  /** Citation strings. */
  sources: string[];
  /** true for all v1 templates (ADR-0013 D5): windows/thresholds are approximate expert defaults. */
  approximate: boolean;
}

/* ───────────────────────────── Overrides (layering) ───────────────────────────── */

/**
 * One patch shape for every override layer (portfolio crop overrides, zone, farm).
 * Effective value = farm.overrides ?? zone.overrides[crop] ?? portfolio.cropOverrides[crop] ?? template.
 * Merging is per leaf (deep), never whole-object replacement. See CONTRACT.md §E.2.
 */
export interface RulesPatch {
  stages?: Record<string, { start?: string; end?: string; sensitivity?: Partial<Record<Peril, number>> }> | null;
  rules?: {
    stages?: Record<string, Partial<StageThresholds>> | null;
    chillHoursMin?: number | null;
    baselineYears?: number | null;
  } | null;
  weights?: Partial<RiskWeights> | null;
}

/** Zone overrides are keyed by crop because stage keys differ per crop. */
export type ZoneOverrides = Partial<Record<Crop, RulesPatch>>;

/** Farm-level edits of inherited credit rules, keyed by CreditRule.id. */
export type CreditRuleOverrides = Record<
  string,
  { enabled?: boolean; when?: Partial<CreditRule['when']>; then?: CreditAction; message?: string }
>;

/* ───────────────────────────── Portfolio ───────────────────────────── */

export interface Zone {
  /** Auto zones: 'auto-<farmId>'. Shared zones: any other unique id. */
  id: string;
  name: string;
  /** [lng, lat] */
  center: [number, number];
  /** Default 3338 (= 35 km² circle). */
  radiusM: number;
  /** true = the farm's own zone, centred on its centroid. false = a user-placed shared zone. */
  auto: boolean;
  overrides: ZoneOverrides;
  /** Optional UI colour. */
  color?: string | null;
}

/** Unchanged from v0 (app/src/domain/types.ts). */
export type ScheduleType = 'bullet' | 'monthly' | 'quarterly' | 'semiannual' | 'at_harvest' | 'custom';

/** Unchanged from v0. */
export interface Installment {
  /** 'YYYY-MM-DD' */
  dueDate: string;
  amount: number;
}

/** Unchanged from v0 (Currency widened to the v1 enum). */
export interface Loan {
  originationDate: string;
  maturityDate: string;
  amount: number;
  currency: Currency;
  scheduleType: ScheduleType;
  installments: Installment[];
}

export interface CirenRef {
  /** CIREN especie_01 as read (e.g. 'CEREZO'). */
  especie: string;
  variedad?: string | null;
  /** e.g. 'CATASTRO_FRUTICOLA/61'. */
  sourceLayer: string;
  objectId: number;
}

export interface Farm {
  /** Stable slug, unique in the portfolio, [a-z0-9-]. */
  id: string;
  name: string;
  crop: Crop;
  /** GeoJSON Polygon, [lng, lat], WGS84, exterior ring closed. */
  polygon: Polygon;
  areaHa: number;
  /** [lng, lat] */
  centroid: [number, number];
  /** Assigned by the zone rule (§E.4); the service recomputes it and reports the effective id. */
  zoneId: string;
  /** Under covers/nets. null → template coveredDefault. */
  covered?: boolean | null;
  /** Lender-declared irrigation. null = not declared. */
  irrigatedDeclared?: boolean | null;
  plantingYear?: number | null;
  ciren?: CirenRef | null;
  overrides: RulesPatch;
  creditRuleOverrides: CreditRuleOverrides;
  loan?: Loan | null;
}

export interface RuleChange {
  id: string;
  /** ISO UTC timestamp. */
  at: string;
  actor: { kind: 'user' | 'agent'; name: string };
  /**
   * crop → id is a Crop, root = portfolio.cropOverrides[crop] (a RulesPatch)
   * zone → id is a Zone.id, root = the Zone object (e.g. 'overrides.cherry.rules.stages.bloom.frostCriticalC')
   * farm → id is a Farm.id, root = the Farm object
   * portfolio → id is the Portfolio.id, root = the Portfolio object
   */
  scope: { level: 'crop' | 'zone' | 'farm' | 'portfolio'; id: string };
  /** Dot path from the scope root (§E.2), e.g. 'overrides.cherry.rules.stages.bloom.frostCriticalC' (zone). */
  path: string;
  /** Effective value before the change (may be the inherited value). */
  oldValue: unknown;
  /** null = remove the override (reset to inherited). */
  newValue: unknown;
  reason: string;
  status: 'applied' | 'proposed' | 'dismissed';
  /** Set when an agent proposal was applied/dismissed: the AgentRecommendation.id it came from. */
  recommendationId?: string | null;
}

export interface Portfolio {
  schemaVersion: 1;
  id: string;
  name: string;
  /** v1.1 (ADR-0026 D6): short fund/book code shown in mono beside the name, e.g. 'CLSF1'. Optional, additive. */
  code?: string | null;
  lender: string;
  /** Country.code, e.g. 'CL'. */
  country: string;
  currency: Currency;
  /** ISO UTC timestamp. */
  createdAt: string;
  zones: Zone[];
  farms: Farm[];
  /** Portfolio-level credit rules; same id as a template rule replaces it for every crop. */
  creditRules: CreditRule[];
  /** The lender's own crop-level edits on top of the service templates. */
  cropOverrides: Partial<Record<Crop, RulesPatch>>;
  /** Append-only, oldest first. */
  audit: RuleChange[];
}

/* ───────────────────────────── Series ───────────────────────────── */

export type SeriesVariable = 'ndvi' | 'ndmi' | 'precip' | 'tmin' | 'tmax' | 'eto';
export const SERIES_VARIABLES: SeriesVariable[] = ['ndvi', 'ndmi', 'precip', 'tmin', 'tmax', 'eto'];

export interface SeriesPoint {
  date: string;
  /** null = no valid observation (cloud, outage). Never invented. */
  value: number | null;
  /** Baseline band for the same day of year (§E.6). null when no baseline is available. */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** true when the value is gap-filled/smoothed or from a fallback source. */
  estimated?: boolean | null;
}

export interface Series {
  variable: SeriesVariable;
  /** 'index' for ndvi/ndmi, 'mm' for precip/eto (daily), '°C' for tmin/tmax. */
  unit: string;
  /** Ascending dates. ndvi/ndmi on a 5-day grid; the rest daily. 13-month window ending asOf. Empty when unavailable. */
  points: SeriesPoint[];
  provenance: Provenance;
}

/* ───────────────────────────── Risk ───────────────────────────── */

export interface Driver {
  component: 'climate' | 'disaster' | 'geography';
  peril: Peril;
  /** Machine key, e.g. 'tmin_7d_min', 'max_rain_72h', 'ndvi_z', 'decree_active', 'frost_pocket'. */
  metric: string;
  /** 0..1 from the §E.5 ramps. */
  severity: number;
  /** Stage sensitivity used (C, D); null for geography. */
  sensitivity: number | null;
  /** Sort key: sensitivity × severity for C/D; c × severity for G. */
  impact: number;
  /** Plain language with numbers vs normal/threshold, e.g. 'Coldest night −3.1 °C on 4 Nov; bloom damage starts at −2.4 °C.' */
  text: string;
  value: number | string | boolean | null;
  /** Normal or threshold the value is compared with. */
  normal: number | string | boolean | null;
  unit: string | null;
  provenance: Provenance;
}

export interface RiskComponent {
  key: 'climate' | 'disaster' | 'geography';
  /** 0..1 */
  value: number;
  /** All drivers of this component, impact desc (including impact 0 entries that were evaluated). */
  drivers: Driver[];
}

export interface FiredCreditAction {
  ruleId: string;
  action: CreditAction;
  message: string;
}

export interface Risk {
  /** 0..100, 1 decimal. */
  score: number;
  /** Tier from score alone (§E.1). Credit rules on 'risk.*' read this. */
  scoreTier: Tier;
  /** max(scoreTier, tier floor implied by fired credit actions) (§E.7). */
  tier: Tier;
  stage: { key: string; label: string };
  components: { climate: RiskComponent; disaster: RiskComponent; geography: RiskComponent };
  /** Effective weights used. */
  weights: RiskWeights;
  /** The formula with numbers substituted (§E.1). */
  formula: string;
  /** One sentence. */
  headline: string;
  /** Top 5 across components by impact desc, impact > 0. */
  drivers: Driver[];
  creditActions: FiredCreditAction[];
}

/* ───────────────────────────── Water status (ladder) ───────────────────────────── */

export type StressLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'unknown';

export interface WaterStatus {
  /** Rung 1 */
  irrigated: { value: 'yes' | 'no' | 'unknown'; evidence: string; provenance: Provenance };
  /** Rung 2: ETc = Kc(stage) × ETo. */
  demand: {
    kc: number;
    eto7dMm: number | null;
    need7dMm: number | null;
    need30dMm: number | null;
    provenance: Provenance;
  };
  /** Rung 3 */
  supply: {
    decreeActive: boolean;
    decreeId?: string | null;
    /** 'YYYY-MM-DD' expiry. */
    decreeUntil?: string | null;
    /** Sep–Mar snowmelt volume forecast, % of 1991–2020. null when no forecast covers the basin. */
    snowmeltPctOfNormal?: number | null;
    basin?: string | null;
    provenance: Provenance;
  };
  /** Rung 4 */
  stress: {
    /** Latest persistent NDMI z vs own history. */
    ndmiZ?: number | null;
    /** farm NDMI z − zone peer median NDMI z. */
    ndmiPeerDelta?: number | null;
    /** Landsat LST − air temperature (°C) on the last clear pass. */
    canopyMinusAirC?: number | null;
    level: StressLevel;
    provenance: Provenance;
  };
  /** Rung 5 */
  abandonment: {
    flag: boolean;
    confidence: 'low' | 'medium' | 'high';
    evidence: string;
    provenance: Provenance;
  };
}

/* ───────────────────────────── Peers ───────────────────────────── */

export interface PeerComparison {
  zoneId: string;
  /** Same-crop CIREN orchards with centroid in the zone circle, excluding this farm (max 20 nearest). */
  nPeers: number;
  farmNdviZ: number | null;
  peerMedianNdviZ: number | null;
  farmNdmiZ?: number | null;
  peerMedianNdmiZ?: number | null;
  reading: 'zone_wide' | 'farm_specific' | 'normal' | 'insufficient_peers';
  provenance: Provenance;
}

/* ───────────────────────────── Imagery ───────────────────────────── */

export interface ImageryFrame {
  date: string;
  /** observed = a Sentinel-2 acquisition that day with clearFraction ≥ 0.8; interpolated = Whittaker gap-fill. */
  kind: 'observed' | 'interpolated';
  /** Days to the nearest observed frame; 0 for observed. */
  daysToClear: number;
  /** Share of polygon pixels clear (SCL) — observed frames only. */
  clearFraction?: number | null;
  /** Polygon statistics from NATIVE 10 m pixels (never SR pixels). */
  ndviMean: number;
  ndviP10: number;
  ndviP90: number;
  /**
   * Paths starting '/files/imagery/'. Live: prefix with the service base URL.
   * Offline: replace the leading '/files/' with '/snapshot/'.
   * rgb and rgbSr exist only for observed frames (true colour is never interpolated).
   * ndviSr/rgbSr exist only when srKind is not null.
   */
  urls: { ndvi: string; rgb?: string | null; ndviSr?: string | null; rgbSr?: string | null };
  /** 'ai' = model super-resolution; 'resampled' = plain resampling fallback, labelled 'resampled, not AI'. */
  srKind: 'ai' | 'resampled' | null;
  /** Model id/name when srKind = 'ai'. */
  srModel?: string | null;
}

export interface ImageryTimeline {
  farmId: string;
  /** [minLng, minLat, maxLng, maxLat] in EPSG:4326; every PNG covers exactly this box, north-up. */
  bbox: [number, number, number, number];
  crs: 'EPSG:4326';
  nativeResolutionM: number;
  /** Ground pixel size of SR images (e.g. 2.5); null when no SR frames. */
  srResolutionM: number | null;
  /** Ascending dates. */
  frames: ImageryFrame[];
  legend: { min: number; max: number; colormap: string; stops: [number, string][] };
  /** Set when the farm is (or may be) covered: NDVI reads the cover. */
  coveredWarning?: string | null;
  /** Always present: the trust-rule label shown next to the viewer. */
  trustNote: string;
  provenance: Provenance;
}

/* ───────────────────────────── Events ───────────────────────────── */

export interface ClimateEvent {
  /** '<source>:<native id>', e.g. 'gwis:11749494', 'dga_decree:177-2026'. */
  id: string;
  kind: Peril;
  title: string;
  region: string;
  start: string;
  /** null = ongoing / open-ended. */
  end: string | null;
  severity: 'moderate' | 'severe' | 'extreme';
  /** Provider label, e.g. 'GWIS (Copernicus)'. */
  source: string;
  evidenceKind: 'observed_footprint' | 'official_declaration' | 'own_signal' | 'narrative';
  geometry?: Geometry | null;
  /** Filled only in PortfolioAssessment.events; [] from GET /events. */
  affectedFarmIds: string[];
  /** Sum of exposure of affectedFarmIds; 0 from GET /events. */
  affectedExposure: number;
  provenance: Provenance;
}

/* ───────────────────────────── Assessments ───────────────────────────── */

export interface StageBand {
  stage: string;
  label: string;
  /** Concrete dates clipped to the 13-month window. */
  start: string;
  end: string;
}

export interface FarmAssessment {
  farmId: string;
  asOf: string;
  /** Effective zone after the §E.4 rule (may differ from Farm.zoneId). */
  zoneId: string;
  dataTier: DataTier;
  risk: Risk;
  water: WaterStatus;
  peers: PeerComparison;
  series: Record<SeriesVariable, Series>;
  nextInstallment: Installment | null;
  /** outstandingAt(loan, asOf) — §E.8. 0 without a loan. */
  exposure: number;
  stageBands: StageBand[];
  /** Latest date with data per variable (null = none). Keys: SeriesVariable plus 'imagery', 'events', 'water_supply'. */
  dataAsOf: Record<string, string | null>;
  /** Non-fatal problems (source down, value estimated) in plain language. */
  warnings: string[];
}

export interface RankedFarm {
  farmId: string;
  name: string;
  crop: Crop;
  zoneId: string;
  score: number;
  tier: Tier;
  exposure: number;
  headline: string;
  stage: { key: string; label: string };
  nextInstallment: Installment | null;
}

export interface ExposureSlice {
  farms: number;
  exposure: number;
  /** Exposure of farms with tier watch or high. */
  stressedExposure: number;
}

export interface PortfolioAssessment {
  portfolioId: string;
  asOf: string;
  currency: Currency;
  totalExposure: number;
  exposureByTier: Record<Tier, number>;
  farmsByTier: Record<Tier, number>;
  /** Score desc, ties exposure desc. One entry per farm. */
  ranked: RankedFarm[];
  byCrop: (ExposureSlice & { crop: Crop })[];
  byZone: (ExposureSlice & { zoneId: string })[];
  /** Events touching the portfolio (bbox of all farms + 25 km), newest start first, affected* filled. */
  events: ClimateEvent[];
  creditActions: (FiredCreditAction & { farmId: string })[];
  warnings: string[];
}

/* ───────────────────────────── Agent ───────────────────────────── */

export interface AgentRecommendation {
  id: string;
  zoneId?: string | null;
  farmId?: string | null;
  question: string;
  /** Markdown. Every number in it comes from a tool output. */
  answer: string;
  /** status 'proposed', actor {kind:'agent'}; the app applies them through the audit trail. */
  proposals: RuleChange[];
  evidence: { kind: 'backtest' | 'history' | 'event'; summary: string; data: unknown }[];
  toolCalls: { name: string; input: unknown; outputSummary: string }[];
  /** Model id the service used (from env ANTHROPIC_MODEL or the service default). */
  model: string;
  createdAt: string;
}

/* ───────────────────────────── API envelopes ───────────────────────────── */

export interface ApiError {
  /** Machine code: 'invalid_request' | 'bbox_too_large' | 'not_found' | 'no_api_key' | 'internal_error'. */
  error: string;
  detail: string;
}

export interface Health {
  status: 'ok';
  contractVersion: 1;
  serviceVersion: string;
  /** ISO UTC now. */
  time: string;
  agentAvailable: boolean;
  /** 'ai' when an SR model loaded, 'resampled' when the fallback is active. */
  srMode: 'ai' | 'resampled';
  srModel: string | null;
  sources: { source: string; ok: boolean; lastFetchedAt: string | null; stale: boolean }[];
}

export interface CirenOrchardProperties {
  objectId: number;
  especie: string;
  /** Mapped v1 crop, or null for species outside the six. */
  crop: Crop | null;
  areaHa: number | null;
  comuna: string | null;
  sourceLayer: string;
}

export interface CirenOrchardCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: number;
    geometry: Polygon;
    properties: CirenOrchardProperties;
  }[];
  /** true when the result hit the 300-feature cap. */
  truncated: boolean;
  provenance: Provenance;
}

export interface AssessPortfolioRequest {
  portfolio: Portfolio;
  /** Default: today (UTC) or the latest date the data covers. */
  asOf?: string | null;
}
export interface AssessFarmRequest {
  portfolio: Portfolio;
  farmId: string;
  asOf?: string | null;
}
export interface ImageryRequest {
  portfolio: Portfolio;
  farmId: string;
  /** Default true. */
  sr?: boolean | null;
  asOf?: string | null;
}
export interface AgentRequest {
  portfolio: Portfolio;
  zoneId?: string | null;
  farmId?: string | null;
  question: string;
}
export interface SnapshotExportRequest {
  /** Default: every sample portfolio (v1.1; before v1.1 the default was the sample portfolio alone). */
  portfolio?: Portfolio | null;
  /** v1.1 (ADR-0026): several portfolios in one snapshot; the first is the primary. Wins over `portfolio`. */
  portfolios?: Portfolio[] | null;
  asOf?: string | null;
  /** Default true. */
  sr?: boolean | null;
}

export interface SnapshotManifest {
  contractVersion: 1;
  /** ISO UTC timestamp of the export. */
  generatedAt: string;
  /** The UI label reads 'offline snapshot of <asOf>'. */
  asOf: string;
  portfolioId: string;
  portfolioName: string;
  farmIds: string[];
  /** Paths relative to /snapshot/, e.g. 'assessment-farm-cl-requinoa-cherry.json'. */
  files: string[];
  imageryFrames: number;
  warnings: string[];
  /**
   * v1.1 (ADR-0026): every portfolio in the snapshot, primary first. The top-level portfolioId, portfolioName and
   * farmIds describe the primary, so single-portfolio readers keep working. null/missing in v1 snapshots: readers
   * then treat the snapshot as one portfolio with the v1 file names.
   */
  portfolios?: SnapshotPortfolio[] | null;
}

/** v1.1 (ADR-0026): one portfolio of a snapshot and its files (relative to /snapshot/). */
export interface SnapshotPortfolio {
  portfolioId: string;
  portfolioName: string;
  /** Farm files are assessment-farm-<farmId>.json and imagery-<farmId>.json; farm ids are unique across the snapshot. */
  farmIds: string[];
  /** 'portfolio.json' for the primary, 'portfolio-<id>.json' for the others. */
  portfolioFile: string;
  /** 'assessment-portfolio.json' for the primary, 'assessment-portfolio-<id>.json' for the others. */
  assessmentFile: string;
  /** 'events.json' for the primary, 'events-<id>.json' for the others. */
  eventsFile: string;
}

/** v1.1 (ADR-0026): one entry of GET /portfolios/samples. Load the portfolio with GET /portfolios/sample?id=<id>. */
export interface SamplePortfolioSummary {
  id: string;
  name: string;
  /** v1.1: the portfolio's short code (Portfolio.code). */
  code?: string | null;
  lender: string;
  /** Country.code. */
  country: string;
  currency: Currency;
  farmCount: number;
  /** Crops present, in CROPS order. */
  crops: Crop[];
  /** One sentence for the Portfolios page. */
  description?: string | null;
}

/* ───────────────────────────── Insurance requests (v1.1, ADR-0025) ───────────────────────────── */

/**
 * Perils a parametric insurance request can ask cover for. Values reuse the Peril names:
 * 'water' = drought / water supply, 'harvest_rain' = excess rain.
 */
export type InsurancePeril = 'frost' | 'water' | 'harvest_rain' | 'fire';
export const INSURANCE_PERILS: InsurancePeril[] = ['frost', 'water', 'harvest_rain', 'fire'];

/**
 * Outbox status. 'queued' = stored in BrotIA's outbox, not yet forwarded to the insurer (there is no insurer
 * integration in v1.1; the lender's team forwards it). The only value in v1.1; later values will be added, not renamed.
 */
export type InsuranceRequestStatus = 'queued';

/**
 * What BrotIA would send to the insurer for one farm. The app assembles it from the portfolio and the service's
 * assessment; the service validates and stores it as given (it does not recompute it).
 */
export interface InsuranceRequestPayload {
  /** The insurer this request is addressed to. */
  partner: 'suyana';
  lender: string;
  portfolioName: string;
  farm: {
    name: string;
    crop: Crop;
    areaHa: number;
    /** [lng, lat] */
    centroid: [number, number];
    /** Country.code, e.g. 'CL'. */
    country: string;
    zoneId: string;
    zoneName: string;
  };
  /** null when the farm has no loan. */
  loan: {
    currency: Currency;
    amount: number;
    /** Outstanding principal on risk.asOf (RankedFarm.exposure). */
    outstanding: number;
    /** 'YYYY-MM-DD' */
    maturityDate: string;
  } | null;
  risk: {
    /** The assessment's as-of date, 'YYYY-MM-DD'. */
    asOf: string;
    /** 0..100 */
    score: number;
    tier: Tier;
    /** Up to 3 top drivers, impact desc, in plain words (Driver.text). Empty when the farm assessment could not be read. */
    drivers: { peril: Peril; text: string }[];
  };
  /** Perils the request asks cover for: at least one, no duplicates. */
  perils: InsurancePeril[];
  /** Perils of the farm's top drivers that no parametric product in INSURANCE_PERILS covers (e.g. 'abandonment'). */
  uncoveredPerils: Peril[];
  /** Free text from the lender, ≤ 1000 characters. */
  note?: string | null;
}

export interface CreateInsuranceRequest {
  portfolioId: string;
  farmId: string;
  payload: InsuranceRequestPayload;
}

export interface InsuranceRequest {
  /** 'ins-' + 12 hex characters. */
  id: string;
  /** ISO UTC timestamp when BrotIA queued it. */
  createdAt: string;
  portfolioId: string;
  farmId: string;
  status: InsuranceRequestStatus;
  payload: InsuranceRequestPayload;
}
