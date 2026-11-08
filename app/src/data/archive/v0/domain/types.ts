/**
 * Domain types. FINAL CONTRACT (foundation-owned). Builders must not edit;
 * request changes through the orchestrator.
 */
import type { Polygon } from 'geojson';

export type { Polygon };

export type CropType =
  | 'soy'
  | 'maize'
  | 'wheat'
  | 'sorghum'
  | 'sunflower'
  | 'rice'
  | 'sugarcane'
  | 'quinoa'
  | 'potato'
  | 'chia';

export interface CropInfo {
  label: string;
  color: string;
  /** Typical sowing date in the Santa Cruz region, 'MM-DD'. */
  typicalSowMonthDay: string;
  /** Typical days from sowing to harvest. */
  seasonDays: number;
}

export const CROPS: Record<CropType, CropInfo> = {
  soy: { label: 'Soy', color: '#2E7A55', typicalSowMonthDay: '11-15', seasonDays: 125 },
  maize: { label: 'Maize', color: '#C07A2C', typicalSowMonthDay: '10-20', seasonDays: 140 },
  wheat: { label: 'Wheat', color: '#B89B3E', typicalSowMonthDay: '05-01', seasonDays: 120 },
  sorghum: { label: 'Sorghum', color: '#A5463F', typicalSowMonthDay: '02-15', seasonDays: 115 },
  sunflower: { label: 'Sunflower', color: '#D2A419', typicalSowMonthDay: '03-01', seasonDays: 110 },
  rice: { label: 'Rice', color: '#3A6EA5', typicalSowMonthDay: '11-01', seasonDays: 130 },
  sugarcane: { label: 'Sugarcane', color: '#5F8F3E', typicalSowMonthDay: '04-15', seasonDays: 365 },
  quinoa: { label: 'Quinoa', color: '#7A5AA6', typicalSowMonthDay: '09-15', seasonDays: 150 },
  potato: { label: 'Potato', color: '#8A6B4E', typicalSowMonthDay: '08-01', seasonDays: 120 },
  chia: { label: 'Chia', color: '#4E7C83', typicalSowMonthDay: '01-15', seasonDays: 110 },
};

export const CROP_TYPES = Object.keys(CROPS) as CropType[];

export type Currency = 'USD' | 'BOB';

export interface Thresholds {
  /** NDVI anomaly z-score vs this field's own same-time-of-year baseline, e.g. -1.5. */
  ndviAnomalyZ: number;
  /** Rain deficit in %, e.g. 40 = rain 40% below baseline. */
  rainDeficitPct: number;
  /** Consecutive dry days (< 1 mm), e.g. 21. */
  dryDays: number;
  /** Frost when Tmin <= this, degrees C, e.g. 0. */
  frostC: number;
  /** Heat stress when Tmax >= this, degrees C, e.g. 35. */
  heatC: number;
  /** Soil moisture percentile (vs own history) below which is stress, e.g. 20. */
  soilMoisturePctile: number;
  /** Flood risk when 72 h rainfall >= this, mm, e.g. 120. */
  flood72hMm: number;
}

export interface Zone {
  id: string;
  name: string;
  color: string;
  /** Number of past years used to build each field's baseline, 3..10 (default 5). */
  baselineYears: number;
  /** Critical crop window, 'MM-DD' bounds (may wrap the year end, e.g. 12-01 .. 03-15). */
  stressWindow: { start: string; end: string };
  irrigated: boolean;
  thresholds: Thresholds;
}

export type ScheduleType = 'bullet' | 'monthly' | 'quarterly' | 'semiannual' | 'at_harvest' | 'custom';

export interface Installment {
  /** ISO date 'YYYY-MM-DD'. */
  dueDate: string;
  amount: number;
}

export interface Loan {
  originationDate: string;
  maturityDate: string;
  amount: number;
  currency: Currency;
  scheduleType: ScheduleType;
  installments: Installment[];
}

export interface Farm {
  id: string;
  name: string;
  crop: CropType;
  sowingDate?: string;
  /** GeoJSON Polygon, coordinates in [lng, lat]. */
  polygon: Polygon;
  areaHa: number;
  /** [lng, lat] */
  centroid: [number, number];
  zoneId: string;
  overrides?: Partial<Thresholds>;
  loan?: Loan;
}

export interface Portfolio {
  id: string;
  name: string;
  lender: string;
  currency: Currency;
  createdAt: string;
  zones: Zone[];
  farms: Farm[];
}

export type Tier = 'normal' | 'watch' | 'high';
export type Peril = 'drought' | 'flood' | 'frost' | 'hail' | 'heat';
export const PERILS: Peril[] = ['drought', 'flood', 'frost', 'hail', 'heat'];
export const TIERS: Tier[] = ['normal', 'watch', 'high'];

/** mean/p10/p90 = this field's own same-day-of-year baseline over zone.baselineYears. */
export interface SeriesPoint {
  date: string;
  value: number | null;
  mean: number;
  p10: number;
  p90: number;
}

/** All series cover AS_OF minus 24 months .. AS_OF. */
export interface FarmSeries {
  /** Every 5 days, value null on cloudy dates. */
  ndvi: SeriesPoint[];
  /** Every 5 days, same dates as ndvi. */
  ndmi: SeriesPoint[];
  /** Daily mm. */
  eto: SeriesPoint[];
  /** Daily mm. */
  precip: SeriesPoint[];
  /** Daily m3/m3. */
  soilMoisture: SeriesPoint[];
  /** Daily degrees C. */
  tmax: SeriesPoint[];
  /** Daily degrees C. */
  tmin: SeriesPoint[];
}

export interface Driver {
  peril: Peril | 'vegetation';
  /** 0..1 */
  severity: number;
  /** Plain language, with numbers vs this field's normal. */
  text: string;
  metric: string;
  value: number;
  normal: number;
}

export interface FarmAssessment {
  farmId: string;
  /** 0..100 */
  score: number;
  tier: Tier;
  /** One sentence. */
  headline: string;
  /** Sorted by severity desc. */
  drivers: Driver[];
  perils: Record<Peril, number>;
  /** Weekly, last 26 weeks. */
  trend: { date: string; score: number }[];
  /** Outstanding principal at AS_OF. */
  exposure: number;
  nextInstallment: Installment | null;
  installmentsInStress: number;
  inStressWindow: boolean;
}

export interface PortfolioAssessment {
  asOf: string;
  totalExposure: number;
  exposureByTier: Record<Tier, number>;
  farmsByTier: Record<Tier, number>;
  /** By score desc, ties by exposure desc. */
  ranked: FarmAssessment[];
  byCrop: { crop: CropType; exposure: number; stressedExposure: number }[];
  byZone: { zoneId: string; exposure: number; stressedExposure: number }[];
}

export interface ClimateEvent {
  id: string;
  kind: Peril;
  title: string;
  region: string;
  start: string;
  end: string;
  severity: 'moderate' | 'severe' | 'extreme';
  description: string;
  affectedFarmIds: string[];
  affectedExposure: number;
}

export interface Alert {
  id: string;
  farmId: string;
  date: string;
  fromTier: Tier;
  toTier: Tier;
  reason: string;
}
