import { describe, expect, it } from 'vitest';
import { emptyDraft, withFarmAdded, withFarmRemoved, withFarmUpdated, withLoan, withZoneAdded, withZoneRemoved } from './draft';

const poly = {
  type: 'Polygon' as const,
  coordinates: [[[-62.8, -17.2], [-62.79, -17.2], [-62.79, -17.21], [-62.8, -17.21], [-62.8, -17.2]]],
};

describe('draft reducers', () => {
  it('starts with one default zone and no farms', () => {
    const d = emptyDraft();
    expect(d.zones).toHaveLength(1);
    expect(d.farms).toHaveLength(0);
    expect(d.currency).toBe('USD');
  });

  it('adds a farm with area, centroid, soy and first zone', () => {
    const d = withFarmAdded(emptyDraft(), poly, 'f1');
    const f = d.farms[0];
    expect(f.id).toBe('f1');
    expect(f.crop).toBe('soy');
    expect(f.zoneId).toBe(d.zones[0].id);
    expect(f.areaHa).toBeGreaterThan(50);
    expect(f.centroid[0]).toBeCloseTo(-62.795, 2);
  });

  it('updates and removes farms', () => {
    let d = withFarmAdded(emptyDraft(), poly, 'f1');
    d = withFarmUpdated(d, 'f1', { name: 'North field', crop: 'maize' });
    expect(d.farms[0]).toMatchObject({ name: 'North field', crop: 'maize' });
    d = withFarmRemoved(d, 'f1');
    expect(d.farms).toHaveLength(0);
  });

  it('removing a zone reassigns its farms to the first zone; last zone is kept', () => {
    let d = emptyDraft();
    const first = d.zones[0].id;
    d = withZoneAdded(d, 'South', 'z2');
    d = withFarmAdded(d, poly, 'f1');
    d = withFarmUpdated(d, 'f1', { zoneId: 'z2' });
    d = withZoneRemoved(d, 'z2');
    expect(d.zones).toHaveLength(1);
    expect(d.farms[0].zoneId).toBe(first);
    expect(withZoneRemoved(d, first).zones).toHaveLength(1);
  });

  it('names a new farm with the lowest unused "Farm N"', () => {
    let d = withFarmAdded(emptyDraft(), poly, 'f1');
    d = withFarmAdded(d, poly, 'f2');
    expect(d.farms.map((f) => f.name)).toEqual(['Farm 1', 'Farm 2']);
    d = withFarmRemoved(d, 'f1');
    d = withFarmAdded(d, poly, 'f3');
    expect(d.farms.map((f) => f.name)).toEqual(['Farm 2', 'Farm 1']);
    d = withFarmAdded(d, poly, 'f4');
    expect(d.farms[2].name).toBe('Farm 3');
  });

  it('sets a loan on a farm', () => {
    let d = withFarmAdded(emptyDraft(), poly, 'f1');
    d = withLoan(d, 'f1', { originationDate: '2026-01-01', maturityDate: '2027-01-01', amount: 1000, currency: 'USD', scheduleType: 'bullet', installments: [{ dueDate: '2027-01-01', amount: 1000 }] });
    expect(d.farms[0].loan?.amount).toBe(1000);
  });
});
