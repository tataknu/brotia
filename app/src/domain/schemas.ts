/**
 * zod 4 schemas for every API response in the v1 contract (CONTRACT.md §A, §B).
 *
 * Rules (CONTRACT §0):
 * - Unknown extra keys are ignored (z.object strips them; never .strict()).
 * - Missing and null are treated identically: `x?: T | null` and `x: T | null` → nul() (output T | null);
 *   `x?: T` → opt() (output T | undefined).
 * - Every schema is annotated with its contract type, so a drift between types.ts and this file is a
 *   compile error.
 */
import { z } from 'zod';
import type { Geometry, Polygon } from 'geojson';
import {
  CROPS,
  INSURANCE_PERILS,
  PERILS,
  SERIES_VARIABLES,
  TIERS,
  type AgentRecommendation,
  type ApiError,
  type CirenOrchardCollection,
  type ClimateEvent,
  type Country,
  type CreditCondition,
  type CreditRule,
  type CropTemplate,
  type FarmAssessment,
  type Health,
  type ImageryTimeline,
  type CreateInsuranceRequest,
  type InsuranceRequest,
  type InsuranceRequestPayload,
  type Portfolio,
  type PortfolioAssessment,
  type Provenance,
  type RuleChange,
  type RulesPatch,
  type SamplePortfolioSummary,
  type SnapshotManifest,
  type SnapshotPortfolio,
} from './types';

/* ── helpers ── */

/** `x?: T | null` / `x: T | null`: missing → null. */
const nul = <S extends z.ZodType>(s: S) => s.nullish().transform((v) => (v ?? null) as z.output<S> | null);
/** `x?: T`: null → undefined. */
const opt = <S extends z.ZodType>(s: S) => s.nullish().transform((v) => (v ?? undefined) as z.output<S> | undefined);
/** A required `unknown` value (z.unknown() alone makes the key optional in the inferred type). */
const anyValue = z.custom<unknown>(() => true);

const num = z.number();
const str = z.string();
const bool = z.boolean();
const lngLat = z.tuple([num, num]);

const crop = z.enum(CROPS);
const peril = z.enum(PERILS);
const tier = z.enum(TIERS);
const seriesVariable = z.enum(SERIES_VARIABLES);
const dataTier = z.enum(['enhanced', 'standard']);
const licenceTier = z.enum(['commercial_ok', 'demo_only', 'unresolved']);
const currency = z.enum(['USD', 'CLP']);

export const GeometrySchema = z.custom<Geometry>(
  (v) => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string',
  { message: 'expected a GeoJSON geometry' },
);

export const PolygonSchema: z.ZodType<Polygon> = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(num))),
});

/* ── provenance ── */

export const ProvenanceSchema: z.ZodType<Provenance> = z.object({
  source: str,
  sourceLabel: str,
  observedAt: nul(str),
  fetchedAt: str,
  resolution: str,
  licenceTier,
  dataTier,
  stale: bool,
  estimated: bool,
  note: nul(str),
});

/* ── countries ── */

export const CountrySchema: z.ZodType<Country> = z.object({
  code: str,
  name: str,
  nameEs: str,
  dataTier,
  comingLater: bool,
  center: lngLat,
  zoom: num,
  defaultCurrency: currency,
});
export const CountryListSchema = z.array(CountrySchema);

/* ── crop templates ── */

const StageSchema = z.object({
  key: str,
  label: str,
  labelEs: str,
  start: str,
  end: str,
  sensitivity: z.record(peril, num),
});

const StageThresholdsSchema = z.object({
  frostCriticalC: num,
  frostSevereC: num,
  heatC: num,
  harvestRainMm72h: num,
  kc: num,
});

const RiskWeightsSchema = z.object({ a: num, b: num, c: num });

const creditMetric = z.enum([
  'risk.tier',
  'risk.score',
  'water.decreeActive',
  'water.snowmeltPct',
  'water.stressLevel',
  'imagery.abandonment',
  'events.burnedAreaIntersects',
]);
const creditOp = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const creditAction = z.enum(['watch', 'high', 'field_visit', 'restructure_review']);

const CreditConditionSchema: z.ZodType<CreditCondition> = z.object({
  metric: creditMetric,
  op: creditOp,
  value: z.union([num, str, bool]),
  withinDaysBeforeInstallment: nul(num),
});

export const CreditRuleSchema: z.ZodType<CreditRule> = z.object({
  id: str,
  name: str,
  enabled: bool,
  when: z.object({
    metric: creditMetric,
    op: creditOp,
    value: z.union([num, str, bool]),
    withinDaysBeforeInstallment: nul(num),
    and: nul(z.array(CreditConditionSchema)),
  }),
  then: creditAction,
  message: str,
});

export const CropTemplateSchema: z.ZodType<CropTemplate> = z.object({
  crop,
  labels: z.object({ es: str, en: str }),
  cirenEspecie: z.array(str),
  evergreen: bool,
  coveredDefault: bool,
  coverLikelihood: z.enum(['rarely', 'sometimes', 'often']),
  color: str,
  stages: z.array(StageSchema),
  rules: z.object({
    stages: z.record(str, StageThresholdsSchema),
    chillHoursMin: num,
    baselineYears: num,
  }),
  weights: RiskWeightsSchema,
  creditRules: z.array(CreditRuleSchema),
  sources: z.array(str),
  approximate: bool,
});
export const CropTemplateListSchema = z.array(CropTemplateSchema);

/* ── portfolio ── */

/** Patches keep missing leaves absent (opt), so parsed patches have no null noise. */
export const RulesPatchSchema: z.ZodType<RulesPatch> = z.object({
  stages: opt(
    z.record(
      str,
      z.object({
        start: opt(str),
        end: opt(str),
        sensitivity: opt(z.partialRecord(peril, num)),
      }),
    ),
  ),
  rules: opt(
    z.object({
      stages: opt(z.record(str, z.partialRecord(z.enum(['frostCriticalC', 'frostSevereC', 'heatC', 'harvestRainMm72h', 'kc']), num))),
      chillHoursMin: opt(num),
      baselineYears: opt(num),
    }),
  ),
  weights: opt(z.partialRecord(z.enum(['a', 'b', 'c']), num)),
});

const ZoneSchema = z.object({
  id: str,
  name: str,
  center: lngLat,
  radiusM: num,
  auto: bool,
  overrides: z.partialRecord(crop, RulesPatchSchema),
  color: nul(str),
});

const InstallmentSchema = z.object({ dueDate: str, amount: num });

const LoanSchema = z.object({
  originationDate: str,
  maturityDate: str,
  amount: num,
  currency,
  scheduleType: z.enum(['bullet', 'monthly', 'quarterly', 'semiannual', 'at_harvest', 'custom']),
  installments: z.array(InstallmentSchema),
});

const CreditRuleOverrideSchema = z.object({
  enabled: opt(bool),
  when: opt(
    z.object({
      metric: opt(creditMetric),
      op: opt(creditOp),
      value: opt(z.union([num, str, bool])),
      withinDaysBeforeInstallment: nul(num),
      and: nul(z.array(CreditConditionSchema)),
    }),
  ),
  then: opt(creditAction),
  message: opt(str),
});

const FarmSchema = z.object({
  id: str,
  name: str,
  crop,
  polygon: PolygonSchema,
  areaHa: num,
  centroid: lngLat,
  zoneId: str,
  covered: nul(bool),
  irrigatedDeclared: nul(bool),
  plantingYear: nul(num),
  ciren: nul(
    z.object({
      especie: str,
      variedad: nul(str),
      sourceLayer: str,
      objectId: num,
    }),
  ),
  overrides: RulesPatchSchema,
  creditRuleOverrides: z.record(str, CreditRuleOverrideSchema),
  loan: nul(LoanSchema),
});

export const RuleChangeSchema: z.ZodType<RuleChange> = z.object({
  id: str,
  at: str,
  actor: z.object({ kind: z.enum(['user', 'agent']), name: str }),
  scope: z.object({ level: z.enum(['crop', 'zone', 'farm', 'portfolio']), id: str }),
  path: str,
  oldValue: anyValue,
  newValue: anyValue,
  reason: str,
  status: z.enum(['applied', 'proposed', 'dismissed']),
  recommendationId: nul(str),
});

export const PortfolioSchema: z.ZodType<Portfolio> = z.object({
  schemaVersion: z.literal(1),
  id: str,
  name: str,
  code: nul(str),
  lender: str,
  country: str,
  currency,
  createdAt: str,
  zones: z.array(ZoneSchema),
  farms: z.array(FarmSchema),
  creditRules: z.array(CreditRuleSchema),
  cropOverrides: z.partialRecord(crop, RulesPatchSchema),
  audit: z.array(RuleChangeSchema),
});

/* ── series, risk, water, peers ── */

const SeriesPointSchema = z.object({
  date: str,
  value: nul(num),
  p10: nul(num),
  p50: nul(num),
  p90: nul(num),
  estimated: nul(bool),
});

const SeriesSchema = z.object({
  variable: seriesVariable,
  unit: str,
  points: z.array(SeriesPointSchema),
  provenance: ProvenanceSchema,
});

const componentKey = z.enum(['climate', 'disaster', 'geography']);
const scalar = z.union([num, str, bool]);

const DriverSchema = z.object({
  component: componentKey,
  peril,
  metric: str,
  severity: num,
  sensitivity: nul(num),
  impact: num,
  text: str,
  value: nul(scalar),
  normal: nul(scalar),
  unit: nul(str),
  provenance: ProvenanceSchema,
});

const RiskComponentSchema = z.object({ key: componentKey, value: num, drivers: z.array(DriverSchema) });

const FiredCreditActionSchema = z.object({ ruleId: str, action: creditAction, message: str });

const stageRef = z.object({ key: str, label: str });

const RiskSchema = z.object({
  score: num,
  scoreTier: tier,
  tier,
  stage: stageRef,
  components: z.object({ climate: RiskComponentSchema, disaster: RiskComponentSchema, geography: RiskComponentSchema }),
  weights: RiskWeightsSchema,
  formula: str,
  headline: str,
  drivers: z.array(DriverSchema),
  creditActions: z.array(FiredCreditActionSchema),
});

const stressLevel = z.enum(['none', 'mild', 'moderate', 'severe', 'unknown']);

const WaterStatusSchema = z.object({
  irrigated: z.object({ value: z.enum(['yes', 'no', 'unknown']), evidence: str, provenance: ProvenanceSchema }),
  demand: z.object({
    kc: num,
    eto7dMm: nul(num),
    need7dMm: nul(num),
    need30dMm: nul(num),
    provenance: ProvenanceSchema,
  }),
  supply: z.object({
    decreeActive: bool,
    decreeId: nul(str),
    decreeUntil: nul(str),
    snowmeltPctOfNormal: nul(num),
    basin: nul(str),
    provenance: ProvenanceSchema,
  }),
  stress: z.object({
    ndmiZ: nul(num),
    ndmiPeerDelta: nul(num),
    canopyMinusAirC: nul(num),
    level: stressLevel,
    provenance: ProvenanceSchema,
  }),
  abandonment: z.object({
    flag: bool,
    confidence: z.enum(['low', 'medium', 'high']),
    evidence: str,
    provenance: ProvenanceSchema,
  }),
});

const PeerComparisonSchema = z.object({
  zoneId: str,
  nPeers: num,
  farmNdviZ: nul(num),
  peerMedianNdviZ: nul(num),
  farmNdmiZ: nul(num),
  peerMedianNdmiZ: nul(num),
  reading: z.enum(['zone_wide', 'farm_specific', 'normal', 'insufficient_peers']),
  provenance: ProvenanceSchema,
});

/* ── assessments ── */

export const FarmAssessmentSchema: z.ZodType<FarmAssessment> = z.object({
  farmId: str,
  asOf: str,
  zoneId: str,
  dataTier,
  risk: RiskSchema,
  water: WaterStatusSchema,
  peers: PeerComparisonSchema,
  series: z.record(seriesVariable, SeriesSchema),
  nextInstallment: nul(InstallmentSchema),
  exposure: num,
  stageBands: z.array(z.object({ stage: str, label: str, start: str, end: str })),
  dataAsOf: z.record(str, nul(str)),
  warnings: z.array(str),
});

export const ClimateEventSchema: z.ZodType<ClimateEvent> = z.object({
  id: str,
  kind: peril,
  title: str,
  region: str,
  start: str,
  end: nul(str),
  severity: z.enum(['moderate', 'severe', 'extreme']),
  source: str,
  evidenceKind: z.enum(['observed_footprint', 'official_declaration', 'own_signal', 'narrative']),
  geometry: nul(GeometrySchema),
  affectedFarmIds: z.array(str),
  affectedExposure: num,
  provenance: ProvenanceSchema,
});
export const ClimateEventListSchema = z.array(ClimateEventSchema);

const ExposureSliceShape = { farms: num, exposure: num, stressedExposure: num };
const tierRecord = z.record(tier, num);

export const PortfolioAssessmentSchema: z.ZodType<PortfolioAssessment> = z.object({
  portfolioId: str,
  asOf: str,
  currency,
  totalExposure: num,
  exposureByTier: tierRecord,
  farmsByTier: tierRecord,
  ranked: z.array(
    z.object({
      farmId: str,
      name: str,
      crop,
      zoneId: str,
      score: num,
      tier,
      exposure: num,
      headline: str,
      stage: stageRef,
      nextInstallment: nul(InstallmentSchema),
    }),
  ),
  byCrop: z.array(z.object({ ...ExposureSliceShape, crop })),
  byZone: z.array(z.object({ ...ExposureSliceShape, zoneId: str })),
  events: z.array(ClimateEventSchema),
  creditActions: z.array(z.object({ ruleId: str, action: creditAction, message: str, farmId: str })),
  warnings: z.array(str),
});

/* ── imagery ── */

export const ImageryTimelineSchema: z.ZodType<ImageryTimeline> = z.object({
  farmId: str,
  bbox: z.tuple([num, num, num, num]),
  crs: z.literal('EPSG:4326'),
  nativeResolutionM: num,
  srResolutionM: nul(num),
  frames: z.array(
    z.object({
      date: str,
      kind: z.enum(['observed', 'interpolated']),
      daysToClear: num,
      clearFraction: nul(num),
      ndviMean: num,
      ndviP10: num,
      ndviP90: num,
      urls: z.object({ ndvi: str, rgb: nul(str), ndviSr: nul(str), rgbSr: nul(str) }),
      srKind: nul(z.enum(['ai', 'resampled'])),
      srModel: nul(str),
    }),
  ),
  legend: z.object({ min: num, max: num, colormap: str, stops: z.array(z.tuple([num, str])) }),
  coveredWarning: nul(str),
  trustNote: str,
  provenance: ProvenanceSchema,
});

/* ── CIREN ── */

export const CirenOrchardCollectionSchema: z.ZodType<CirenOrchardCollection> = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: num,
      geometry: PolygonSchema,
      properties: z.object({
        objectId: num,
        especie: str,
        crop: nul(crop),
        areaHa: nul(num),
        comuna: nul(str),
        sourceLayer: str,
      }),
    }),
  ),
  truncated: bool,
  provenance: ProvenanceSchema,
});

/* ── agent ── */

export const AgentRecommendationSchema: z.ZodType<AgentRecommendation> = z.object({
  id: str,
  zoneId: nul(str),
  farmId: nul(str),
  question: str,
  answer: str,
  proposals: z.array(RuleChangeSchema),
  evidence: z.array(z.object({ kind: z.enum(['backtest', 'history', 'event']), summary: str, data: anyValue })),
  toolCalls: z.array(z.object({ name: str, input: anyValue, outputSummary: str })),
  model: str,
  createdAt: str,
});

/* ── envelopes ── */

export const ApiErrorSchema: z.ZodType<ApiError> = z.object({ error: str, detail: str });

export const HealthSchema: z.ZodType<Health> = z.object({
  status: z.literal('ok'),
  contractVersion: z.literal(1),
  serviceVersion: str,
  time: str,
  agentAvailable: bool,
  srMode: z.enum(['ai', 'resampled']),
  srModel: nul(str),
  sources: z.array(z.object({ source: str, ok: bool, lastFetchedAt: nul(str), stale: bool })),
});

/** v1.1 (ADR-0026): one portfolio of a multi-portfolio snapshot. */
export const SnapshotPortfolioSchema: z.ZodType<SnapshotPortfolio> = z.object({
  portfolioId: str,
  portfolioName: str,
  farmIds: z.array(str),
  portfolioFile: str,
  assessmentFile: str,
  eventsFile: str,
});

export const SnapshotManifestSchema: z.ZodType<SnapshotManifest> = z.object({
  contractVersion: z.literal(1),
  generatedAt: str,
  asOf: str,
  portfolioId: str,
  portfolioName: str,
  farmIds: z.array(str),
  files: z.array(str),
  imageryFrames: num,
  warnings: z.array(str),
  portfolios: nul(z.array(SnapshotPortfolioSchema)),
});

/** v1.1 (ADR-0026): GET /portfolios/samples. */
export const SamplePortfolioSummarySchema: z.ZodType<SamplePortfolioSummary> = z.object({
  id: str,
  name: str,
  code: nul(str),
  lender: str,
  country: str,
  currency,
  farmCount: num,
  crops: z.array(crop),
  description: nul(str),
});
export const SamplePortfolioSummaryListSchema = z.array(SamplePortfolioSummarySchema);

/* ── insurance request outbox (v1.1, ADR-0025) ── */

const insurancePeril = z.enum(INSURANCE_PERILS);

export const InsuranceRequestPayloadSchema: z.ZodType<InsuranceRequestPayload> = z.object({
  partner: z.literal('suyana'),
  lender: str,
  portfolioName: str,
  farm: z.object({
    name: str,
    crop,
    areaHa: num,
    centroid: lngLat,
    country: str,
    zoneId: str,
    zoneName: str,
  }),
  loan: nul(z.object({ currency, amount: num, outstanding: num, maturityDate: str })),
  risk: z.object({
    asOf: str,
    score: num,
    tier,
    drivers: z.array(z.object({ peril, text: str })),
  }),
  perils: z.array(insurancePeril),
  uncoveredPerils: z.array(peril),
  note: nul(str),
});

export const CreateInsuranceRequestSchema: z.ZodType<CreateInsuranceRequest> = z.object({
  portfolioId: str,
  farmId: str,
  payload: InsuranceRequestPayloadSchema,
});

export const InsuranceRequestSchema: z.ZodType<InsuranceRequest> = z.object({
  id: str,
  createdAt: str,
  portfolioId: str,
  farmId: str,
  status: z.literal('queued'),
  payload: InsuranceRequestPayloadSchema,
});
export const InsuranceRequestListSchema = z.array(InsuranceRequestSchema);
