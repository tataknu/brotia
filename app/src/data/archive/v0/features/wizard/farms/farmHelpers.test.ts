import { describe, expect, it } from 'vitest';
import { areaLabel, isNameTaken, normalizeDrawnPolygon, totalAreaHa, uniqueFarmName } from './farmHelpers';

describe('uniqueFarmName', () => {
  it('starts at Farm 1', () => {
    expect(uniqueFarmName([])).toBe('Farm 1');
  });
  it('fills the lowest free number after deletions', () => {
    expect(uniqueFarmName([{ id: 'a', name: 'Farm 2' }])).toBe('Farm 1');
    expect(uniqueFarmName([{ id: 'a', name: 'Farm 1' }, { id: 'b', name: 'farm 2 ' }])).toBe('Farm 3');
  });
  it('ignores the excluded farm', () => {
    expect(uniqueFarmName([{ id: 'a', name: 'Farm 1' }], 'a')).toBe('Farm 1');
  });
});

describe('isNameTaken', () => {
  const farms = [{ id: 'a', name: 'El Paraíso' }, { id: 'b', name: 'Farm 2' }];
  it('detects duplicates on other farms only', () => {
    expect(isNameTaken(farms, 'b', ' el paraíso')).toBe(true);
    expect(isNameTaken(farms, 'a', 'El Paraíso')).toBe(false);
    expect(isNameTaken(farms, 'a', '')).toBe(false);
  });
});

describe('areas', () => {
  it('formats with one decimal', () => {
    expect(areaLabel(12)).toBe('12.0 ha');
    expect(areaLabel(1234.56)).toBe('1,234.6 ha');
  });
  it('sums', () => {
    expect(totalAreaHa([{ areaHa: 10.15 }, { areaHa: 2.2 }, { areaHa: Number.NaN }])).toBe(12.4);
  });
});

describe('normalizeDrawnPolygon', () => {
  it('closes an open ring', () => {
    const p = normalizeDrawnPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(p?.coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });
  it('keeps a closed ring closed once', () => {
    const p = normalizeDrawnPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(p?.coordinates[0]).toHaveLength(4);
  });
  it('rejects non-polygons and degenerate rings', () => {
    expect(normalizeDrawnPolygon({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeNull();
    expect(normalizeDrawnPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] })).toBeNull();
    expect(normalizeDrawnPolygon(null)).toBeNull();
  });
});
