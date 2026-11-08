/**
 * Sample portfolio: 12 farm loans on cropland around the Santa Cruz soy belt
 * (San Julián, Cuatro Cañadas, Pailón, Okinawa, Montero, Mineros, Warnes). Fully deterministic.
 */
import type { CropType, Farm, Loan, Polygon, Portfolio, ScheduleType, Zone } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { DEFAULT_THRESHOLDS, ZONE_COLORS } from '@/domain/defaults';
import { addDays } from '@/domain/dates';
import { generateInstallments } from '@/domain/schedule';
import { polygonAreaHa, polygonCentroid } from '@/domain/geo';
import { makeRng } from './rng';
import { AS_OF } from './model';

export const SAMPLE_PORTFOLIO_ID = 'sample-santa-cruz';

const ZONES: Zone[] = [
  {
    id: 'zone-sample-north',
    name: 'Norte integrado',
    color: ZONE_COLORS[0],
    baselineYears: 5,
    stressWindow: { start: '12-15', end: '03-15' },
    irrigated: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
  },
  {
    id: 'zone-sample-east',
    name: 'Este - expansión',
    color: ZONE_COLORS[2],
    baselineYears: 5,
    // Sowing and establishment through pod fill: the frontier is rain-fed and drought-prone.
    stressWindow: { start: '10-15', end: '03-15' },
    irrigated: false,
    thresholds: { ...DEFAULT_THRESHOLDS, dryDays: 18 },
  },
  {
    id: 'zone-sample-irrigated',
    name: 'Norte bajo riego',
    color: ZONE_COLORS[1],
    baselineYears: 7,
    stressWindow: { start: '12-01', end: '03-31' },
    irrigated: true,
    thresholds: { ...DEFAULT_THRESHOLDS, flood72hMm: 110 },
  },
];

interface FieldSpec {
  id: string;
  name: string;
  crop: CropType;
  sowingDate?: string;
  zoneId: string;
  center: [number, number];
  /** East-west and north-south size in km. */
  size: [number, number];
  rotDeg: number;
  pentagon?: boolean;
  loan: { orig: string; mat: string; amount: number; type: ScheduleType };
}

const FIELDS: FieldSpec[] = [
  {
    id: 'farm-tajibos',
    name: 'Estancia Los Tajibos',
    crop: 'soy',
    sowingDate: '2026-11-10',
    zoneId: 'zone-sample-east',
    center: [-62.52, -16.86],
    size: [3.4, 3.2],
    rotDeg: 2,
    loan: { orig: '2026-09-15', mat: '2027-06-30', amount: 380_000, type: 'at_harvest' },
  },
  {
    id: 'farm-brecha8',
    name: 'Agropecuaria Brecha 8',
    crop: 'maize',
    sowingDate: '2026-09-15',
    zoneId: 'zone-sample-east',
    center: [-62.7, -16.97],
    size: [2.2, 2.0],
    rotDeg: -4,
    pentagon: true,
    loan: { orig: '2025-10-01', mat: '2027-10-01', amount: 240_000, type: 'semiannual' },
  },
  {
    id: 'farm-lote7',
    name: 'Colonia Cuatro Cañadas – Lote 7',
    crop: 'soy',
    sowingDate: '2026-10-28',
    zoneId: 'zone-sample-east',
    center: [-62.47, -17.3],
    size: [3.0, 2.6],
    rotDeg: 0,
    loan: { orig: '2026-08-01', mat: '2027-07-31', amount: 310_000, type: 'quarterly' },
  },
  {
    id: 'farm-elcusi',
    name: 'Hacienda El Cusi',
    crop: 'sorghum',
    sowingDate: '2026-02-20',
    zoneId: 'zone-sample-east',
    center: [-62.55, -17.38],
    size: [2.0, 1.6],
    rotDeg: 3,
    pentagon: true,
    loan: { orig: '2026-03-01', mat: '2027-02-28', amount: 150_000, type: 'monthly' },
  },
  {
    id: 'farm-pailon-norte',
    name: 'Agrícola Pailón Norte',
    crop: 'wheat',
    sowingDate: '2026-05-05',
    zoneId: 'zone-sample-east',
    center: [-62.68, -17.56],
    size: [1.8, 1.5],
    rotDeg: -2,
    loan: { orig: '2026-04-15', mat: '2027-04-15', amount: 120_000, type: 'bullet' },
  },
  {
    id: 'farm-las-londras',
    name: 'Granja Las Londras',
    crop: 'sunflower',
    sowingDate: '2026-03-05',
    zoneId: 'zone-sample-east',
    center: [-62.76, -17.74],
    size: [1.2, 1.0],
    rotDeg: 6,
    pentagon: true,
    loan: { orig: '2026-02-01', mat: '2027-01-31', amount: 60_000, type: 'quarterly' },
  },
  {
    id: 'farm-okinawa-dos',
    name: 'Finca Okinawa Dos',
    crop: 'maize',
    sowingDate: '2026-09-05',
    zoneId: 'zone-sample-north',
    center: [-62.85, -17.18],
    size: [1.5, 1.4],
    rotDeg: -8,
    loan: { orig: '2026-08-15', mat: '2027-08-15', amount: 180_000, type: 'quarterly' },
  },
  {
    id: 'farm-parcela-okinawa',
    name: 'Parcela Okinawa Uno',
    crop: 'soy',
    sowingDate: '2026-11-12',
    zoneId: 'zone-sample-north',
    center: [-62.93, -17.27],
    size: [0.95, 0.9],
    rotDeg: 12,
    pentagon: true,
    loan: { orig: '2026-10-01', mat: '2027-05-31', amount: 25_000, type: 'bullet' },
  },
  {
    id: 'farm-arrocera-mineros',
    name: 'Arrocera Mineros',
    crop: 'rice',
    sowingDate: '2026-11-01',
    zoneId: 'zone-sample-irrigated',
    center: [-63.29, -17.2],
    size: [1.6, 1.2],
    rotDeg: 15,
    loan: { orig: '2025-11-01', mat: '2027-11-01', amount: 90_000, type: 'semiannual' },
  },
  {
    id: 'farm-canaveral',
    name: 'Cañaveral San Antonio',
    crop: 'sugarcane',
    zoneId: 'zone-sample-irrigated',
    center: [-63.21, -17.29],
    size: [2.8, 2.2],
    rotDeg: -10,
    pentagon: true,
    loan: { orig: '2025-06-01', mat: '2027-05-31', amount: 220_000, type: 'monthly' },
  },
  {
    id: 'farm-warnes-sur',
    name: 'Agrícola Warnes Sur',
    crop: 'soy',
    sowingDate: '2026-11-08',
    zoneId: 'zone-sample-north',
    center: [-63.08, -17.56],
    size: [2.4, 2.0],
    rotDeg: 4,
    loan: { orig: '2026-09-01', mat: '2027-08-31', amount: 160_000, type: 'quarterly' },
  },
  {
    id: 'farm-mineros-norte',
    name: 'Estancia Mineros Norte',
    crop: 'soy',
    sowingDate: '2026-11-05',
    zoneId: 'zone-sample-north',
    center: [-63.18, -17.03],
    size: [2.6, 2.3],
    rotDeg: -3,
    loan: { orig: '2026-05-01', mat: '2028-05-01', amount: 200_000, type: 'semiannual' },
  },
];

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Irregular, roughly rectangular field polygon around `center` (GeoJSON [lng, lat], closed ring). */
export function fieldPolygon(id: string, center: [number, number], sizeKm: [number, number], rotDeg: number, pentagon = false): Polygon {
  const rng = makeRng(`poly|${id}`);
  const [w, h] = sizeKm;
  const rot = (rotDeg * Math.PI) / 180;
  const kmLng = 111.32 * Math.cos((center[1] * Math.PI) / 180);
  const kmLat = 110.57;
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  let pts: [number, number][] = corners.map(([x, y]) => [x + (rng.uniform() - 0.5) * 0.08 * w, y + (rng.uniform() - 0.5) * 0.08 * h]);
  if (pentagon) {
    // Cut the north-east corner (a road, creek or neighbour's boundary).
    const [x2, y2] = pts[2];
    const cut = 0.22 + 0.1 * rng.uniform();
    pts = [pts[0], pts[1], [x2, y2 - cut * h], [x2 - cut * w, y2], pts[3]];
  }
  const ring = pts.map(([x, y]) => {
    const xr = x * Math.cos(rot) - y * Math.sin(rot);
    const yr = x * Math.sin(rot) + y * Math.cos(rot);
    return [round6(center[0] + xr / kmLng), round6(center[1] + yr / kmLat)];
  });
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

function harvestDate(crop: CropType, sowingDate: string | undefined): string | undefined {
  if (!sowingDate) return undefined;
  return addDays(sowingDate, CROPS[crop].seasonDays);
}

export function makeSample(): Portfolio {
  const farms: Farm[] = FIELDS.map((f) => {
    const polygon = fieldPolygon(f.id, f.center, f.size, f.rotDeg, f.pentagon);
    const loan: Loan = {
      originationDate: f.loan.orig,
      maturityDate: f.loan.mat,
      amount: f.loan.amount,
      currency: 'USD',
      scheduleType: f.loan.type,
      installments: generateInstallments(f.loan.type, f.loan.orig, f.loan.mat, f.loan.amount, { harvestDate: harvestDate(f.crop, f.sowingDate) }),
    };
    const farm: Farm = {
      id: f.id,
      name: f.name,
      crop: f.crop,
      polygon,
      areaHa: polygonAreaHa(polygon),
      centroid: polygonCentroid(polygon),
      zoneId: f.zoneId,
      loan,
    };
    if (f.sowingDate) farm.sowingDate = f.sowingDate;
    return farm;
  });
  return {
    id: SAMPLE_PORTFOLIO_ID,
    name: 'Banco Demo — Santa Cruz agro portfolio',
    lender: 'Banco Demo (sample)',
    currency: 'USD',
    createdAt: AS_OF,
    zones: ZONES.map((z) => ({ ...z, stressWindow: { ...z.stressWindow }, thresholds: { ...z.thresholds } })),
    farms,
  };
}
