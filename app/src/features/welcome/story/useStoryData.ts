/** Loads the real values the story shows, from the static snapshot only (works offline). */
import { useEffect, useState } from 'react';
import { SNAPSHOT_BASE, imageUrl } from '../../../data/api';

export const STORY_FARM = 'sur-los-angeles-cherry';
export const STORY_PORTFOLIO = 'sample-cl-sur';

type Pt = { date: string; value: number | null; p10?: number | null; p90?: number | null };
type Inst = { dueDate: string; amount: number };

export type StoryData = {
  farmName: string;
  crop: string;
  areaHa: number;
  centroid: [number, number];
  ring: [number, number][];
  bbox: [number, number, number, number];
  portfolioCode: string;
  portfolioName: string;
  currency: string;
  installments: Inst[];
  origination: string;
  maturity: string;
  score: number;
  tier: string;
  asOf: string;
  headline: string;
  driverText: string;
  nextInstallment: Inst | null;
  exposure: number | null;
  /** Portfolio assessment: loan exposure by risk tier (normal / watch / high), in `currency`. */
  exposureByTier: Record<string, number> | null;
  frames: { date: string; kind: string; src: string; rgb: string | null }[];
  ndvi: Pt[];
  ndmi: Pt[];
  precip: Pt[];
  tmin: Pt[];
  tmax: Pt[];
  stages: { label: string; start: string; end: string }[];
  fieldVisit: string | null;
};

async function j(file: string) {
  const r = await fetch(`${SNAPSHOT_BASE}${file}`);
  if (!r.ok) throw new Error(file);
  return r.json();
}

export function useStoryData(farmId = STORY_FARM, portfolioId = STORY_PORTFOLIO): StoryData | null {
  const [data, setData] = useState<StoryData | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      j(`portfolio-${portfolioId}.json`),
      j(`assessment-farm-${farmId}.json`),
      j(`imagery-${farmId}.json`),
      j(`assessment-portfolio-${portfolioId}.json`).catch(() => null),
    ])
      .then(([p, a, im, pa]) => {
        const farm = p.farms.find((f: { id: string }) => f.id === farmId);
        if (!farm || !live) return;
        const driver = a.risk.drivers?.[0];
        const fv = (pa?.creditActions ?? []).find((c: { farmId: string; action: string }) => c.farmId === farmId && c.action === 'field_visit');
        setData({
          farmName: farm.name,
          crop: farm.crop,
          areaHa: farm.areaHa,
          centroid: farm.centroid,
          ring: farm.polygon.coordinates[0],
          bbox: im.bbox,
          portfolioCode: p.code,
          portfolioName: p.name,
          currency: farm.loan?.currency ?? p.currency,
          installments: farm.loan?.installments ?? [],
          origination: farm.loan?.originationDate,
          maturity: farm.loan?.maturityDate,
          score: a.risk.score,
          tier: a.risk.tier,
          asOf: a.asOf,
          headline: a.risk.headline,
          driverText: driver?.text ?? '',
          nextInstallment: a.nextInstallment ?? null,
          exposure: a.exposure ?? null,
          exposureByTier: pa?.exposureByTier ?? null,
          frames: im.frames
            .filter((f: { urls: { ndvi: string | null } }) => f.urls.ndvi)
            .map((f: { date: string; kind: string; urls: { ndvi: string; rgb: string | null } }) => ({
              date: f.date,
              kind: f.kind,
              src: imageUrl(f.urls.ndvi, 'snapshot') ?? '',
              rgb: f.kind === 'observed' ? imageUrl(f.urls.rgb, 'snapshot') : null,
            })),
          ndvi: a.series.ndvi.points,
          ndmi: a.series.ndmi.points,
          precip: a.series.precip.points,
          tmin: a.series.tmin.points,
          tmax: a.series.tmax.points,
          stages: a.stageBands ?? [],
          fieldVisit: fv ? fv.message : null,
        });
      })
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [farmId, portfolioId]);
  return data;
}
