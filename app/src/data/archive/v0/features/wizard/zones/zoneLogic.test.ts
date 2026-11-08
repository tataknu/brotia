import { describe, expect, it } from 'vitest';
import { THRESHOLD_META } from '@/domain/defaults';
import { clampToMeta, dominantCrop, farmsPerZone, isValidMonthDay, monthDayLabel, overrideCount, suggestStressWindow, toMonthDay, withOverride } from './zoneLogic';

describe('month-day helpers', () => {
  it('validates MM-DD', () => {
    expect(isValidMonthDay('12-15')).toBe(true);
    expect(isValidMonthDay('02-29')).toBe(true);
    expect(isValidMonthDay('02-30')).toBe(false);
    expect(isValidMonthDay('13-01')).toBe(false);
    expect(isValidMonthDay('1-5')).toBe(false);
  });
  it('builds and labels MM-DD', () => {
    expect(toMonthDay(4, 31)).toBe('04-30');
    expect(toMonthDay(1, 5)).toBe('01-05');
    expect(monthDayLabel('12-15')).toBe('Dec 15');
  });
});

describe('suggestStressWindow', () => {
  it('soy flowers and fills grain around January to February', () => {
    expect(suggestStressWindow('soy')).toEqual({ start: '01-04', end: '02-17' });
  });
  it('every crop gets a valid window', () => {
    for (const crop of ['maize', 'wheat', 'sugarcane', 'quinoa'] as const) {
      const w = suggestStressWindow(crop);
      expect(isValidMonthDay(w.start) && isValidMonthDay(w.end)).toBe(true);
    }
  });
});

describe('dominantCrop', () => {
  const farms = [
    { crop: 'soy' as const, areaHa: 100, zoneId: 'a' },
    { crop: 'maize' as const, areaHa: 300, zoneId: 'b' },
    { crop: 'soy' as const, areaHa: 250, zoneId: 'b' },
  ];
  it('weights by area inside the zone', () => {
    expect(dominantCrop(farms, 'a')).toBe('soy');
    expect(dominantCrop(farms, 'b')).toBe('maize');
  });
  it('falls back to all farms, then null', () => {
    expect(dominantCrop(farms, 'empty')).toBe('soy');
    expect(dominantCrop([], 'a')).toBeNull();
  });
});

describe('overrides', () => {
  it('sets and clears keys, collapsing to undefined', () => {
    const a = withOverride(undefined, 'heatC', 37);
    expect(a).toEqual({ heatC: 37 });
    expect(overrideCount({ overrides: a })).toBe(1);
    expect(withOverride(a, 'heatC', undefined)).toBeUndefined();
    expect(withOverride(a, 'frostC', Number.NaN)).toEqual({ heatC: 37 });
  });
  it('clamps to the threshold range and step', () => {
    expect(clampToMeta(-7, THRESHOLD_META.ndviAnomalyZ)).toBe(-4);
    expect(clampToMeta(-1.2300001, THRESHOLD_META.ndviAnomalyZ)).toBe(-1.2);
    expect(clampToMeta(500, THRESHOLD_META.flood72hMm)).toBe(400);
  });
});

describe('farmsPerZone', () => {
  it('counts farms and includes empty zones', () => {
    expect(farmsPerZone([{ zoneId: 'a' }, { zoneId: 'a' }], [{ id: 'a' }, { id: 'b' }])).toEqual({ a: 2, b: 0 });
  });
});
