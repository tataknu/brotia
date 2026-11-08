import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CONTRACT_DIR, fixtureNames, loadFixture } from '@/shared/testing/fixtures';
import {
  AgentRecommendationSchema,
  ApiErrorSchema,
  CirenOrchardCollectionSchema,
  ClimateEventListSchema,
  CountryListSchema,
  CropTemplateListSchema,
  FarmAssessmentSchema,
  HealthSchema,
  ImageryTimelineSchema,
  PortfolioAssessmentSchema,
  PortfolioSchema,
  ProvenanceSchema,
  SnapshotManifestSchema,
} from './schemas';
import { CROPS } from './types';

/** Fixture file → schema of the endpoint that returns it (CONTRACT §F). */
function schemaFor(name: string): z.ZodType {
  if (name === 'agent-recommendation.json') return AgentRecommendationSchema;
  if (name.startsWith('assessment-farm-')) return FarmAssessmentSchema;
  if (name === 'assessment-portfolio.json') return PortfolioAssessmentSchema;
  if (name === 'ciren-orchards.json') return CirenOrchardCollectionSchema;
  if (name === 'countries.json') return CountryListSchema;
  if (name === 'crops.json') return CropTemplateListSchema;
  if (name === 'errors.json') return ApiErrorSchema.array();
  if (name === 'events.json') return ClimateEventListSchema;
  if (name === 'health.json') return HealthSchema;
  if (name.startsWith('imagery-')) return ImageryTimelineSchema;
  if (name === 'manifest.json') return SnapshotManifestSchema;
  if (name === 'portfolio-sample.json') return PortfolioSchema;
  throw new Error(`No schema mapped for fixture ${name}: add it to schemaFor()`);
}

describe('contract fixtures parse with the app schemas', () => {
  const names = fixtureNames();
  it('finds the fixtures', () => {
    expect(names.length).toBeGreaterThanOrEqual(12);
  });
  for (const name of names) {
    it(name, () => {
      const res = schemaFor(name).safeParse(loadFixture(name));
      if (!res.success) throw new Error(`${name}: ${JSON.stringify(res.error.issues.slice(0, 5), null, 2)}`);
      expect(res.success).toBe(true);
    });
  }
});

describe('schema conventions', () => {
  const prov = {
    source: 'derived',
    sourceLabel: 'Derived',
    fetchedAt: '2026-11-07T16:07:00Z',
    resolution: 'n/a',
    licenceTier: 'commercial_ok',
    dataTier: 'enhanced',
    stale: false,
    estimated: false,
  };
  it('treats missing as null', () => {
    const p = ProvenanceSchema.parse(prov);
    expect(p.observedAt).toBeNull();
    expect(p.note).toBeNull();
  });
  it('ignores unknown extra keys', () => {
    const p = ProvenanceSchema.parse({ ...prov, observedAt: '2026-11-06', somethingNew: 42 }) as unknown as Record<string, unknown>;
    expect(p.somethingNew).toBeUndefined();
    expect(p.observedAt).toBe('2026-11-06');
  });
  it('rejects a wrong enum value', () => {
    expect(ProvenanceSchema.safeParse({ ...prov, licenceTier: 'free' }).success).toBe(false);
  });
  it('crops fixture has the six crops in contract order', () => {
    const crops = CropTemplateListSchema.parse(loadFixture('crops.json'));
    expect(crops.map((c) => c.crop)).toEqual(CROPS);
  });
});

describe('domain/types.ts is the verbatim contract copy', () => {
  it('matches contracts/v1/types.ts byte for byte', () => {
    const contract = readFileSync(join(CONTRACT_DIR, 'types.ts'), 'utf8');
    const local = readFileSync(fileURLToPath(new URL('./types.ts', import.meta.url)), 'utf8');
    expect(local).toBe(contract);
  });
});

describe('static fallbacks match the fixtures', () => {
  it('COUNTRIES_FALLBACK equals fixtures/countries.json', async () => {
    const { COUNTRIES_FALLBACK } = await import('./constants');
    expect(COUNTRIES_FALLBACK).toEqual(CountryListSchema.parse(loadFixture('countries.json')));
  });
  it('CROP_META colours equal fixtures/crops.json', async () => {
    const { CROP_META } = await import('./constants');
    for (const t of CropTemplateListSchema.parse(loadFixture('crops.json'))) expect(CROP_META[t.crop].color, t.crop).toBe(t.color);
  });
});
