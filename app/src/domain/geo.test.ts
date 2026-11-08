import { describe, expect, it } from 'vitest';
import { polygonAreaHa, polygonCentroid } from './geo';
import { haversineM } from './geo';

describe('geo', () => {
  // ~1 km x ~1 km square at a tropical latitude (area check).
  const sq = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-62.8, -17.2],
        [-62.79062, -17.2],
        [-62.79062, -17.20904],
        [-62.8, -17.20904],
        [-62.8, -17.2],
      ],
    ],
  };
  it('computes area in hectares', () => {
    const ha = polygonAreaHa(sq);
    expect(ha).toBeGreaterThan(90);
    expect(ha).toBeLessThan(110);
  });
  it('computes centroid as [lng, lat]', () => {
    const [lng, lat] = polygonCentroid(sq);
    expect(lng).toBeCloseTo(-62.795, 2);
    expect(lat).toBeCloseTo(-17.2045, 2);
  });
});

describe('haversineM', () => {
  it('is ~111.2 km per degree of latitude', () => {
    expect(haversineM([-71.3, -34.6], [-71.3, -33.6])).toBeGreaterThan(111_000);
    expect(haversineM([-71.3, -34.6], [-71.3, -33.6])).toBeLessThan(111_400);
  });
  it('is 0 for the same point', () => {
    expect(haversineM([-70.8, -34.28], [-70.8, -34.28])).toBe(0);
  });
});
