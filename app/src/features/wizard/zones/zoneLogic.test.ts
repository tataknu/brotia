import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { withSharedZoneAdded, withZoneUpdated } from '@/state/portfolio';
import { circleBounds, zoneAreaKm2, zoneRows, zonesFitGeo } from './zoneLogic';

const sample = () => loadFixture<Portfolio>('portfolio-sample.json');

describe('zone helpers', () => {
  it('3,338 m radius is 35 km²', () => {
    expect(zoneAreaKm2(3338)).toBe(35);
    expect(zoneAreaKm2(5000)).toBe(78.5);
  });
  it('bounds a circle', () => {
    const b = circleBounds([-70.8, -34.28], 3338).coordinates[0];
    expect(b[0][1]).toBeCloseTo(-34.28 - 3338 / 111320, 6);
    expect(b[2][0]).toBeGreaterThan(-70.8);
  });
  it('a shared zone captures the farm whose centroid is inside; its auto zone is reported unused', () => {
    const s = sample();
    const farm = s.farms[0];
    const [p, id] = withSharedZoneAdded(s, [farm.centroid[0] + 0.01, farm.centroid[1]], { name: 'Cachapoal valley' });
    expect(p.farms[0].zoneId).toBe(id);
    const rows = zoneRows(p);
    expect(rows[0].zone.id).toBe(id);
    expect(rows[0].farms.map((f) => f.id)).toEqual([farm.id]);
    const auto = rows.find((r) => r.zone.id === `auto-${farm.id}`)!;
    expect(auto.unused).toBe(true);
    expect(auto.capturedBy?.name).toBe('Cachapoal valley');
    // Shrinking the radius below the distance releases the farm.
    const p2 = withZoneUpdated(p, id, { radiusM: 500 });
    expect(p2.farms[0].zoneId).toBe(`auto-${farm.id}`);
    expect(zonesFitGeo(p2)?.features.length).toBe(3);
  });
  it('counts zone overrides', () => {
    const rows = zoneRows(sample());
    expect(rows.find((r) => r.zone.id === 'auto-cl-ovalle-table-grape')?.overrides).toBe(1);
  });
});
