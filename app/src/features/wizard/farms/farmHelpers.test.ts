import { describe, expect, it } from 'vitest';
import type { CirenOrchardCollection, CropTemplate, Farm, Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { withFarmAdded, emptyPortfolio } from '@/state/portfolio';
import { areaLabel, cirenPick, coverHint, fromTri, isNameTaken, normalizeDrawnPolygon, titleCase, toTri, totalAreaHa, uniqueFarmName } from './farmHelpers';

const ciren = () => loadFixture<CirenOrchardCollection>('ciren-orchards.json');
const crops = () => loadFixture<CropTemplate[]>('crops.json');

describe('farm helpers', () => {
  it('names farms uniquely', () => {
    const farms = [
      { id: 'a', name: 'Farm 1' },
      { id: 'b', name: 'farm 2' },
    ];
    expect(uniqueFarmName(farms)).toBe('Farm 3');
    expect(uniqueFarmName(farms, 'a')).toBe('Farm 1');
    expect(uniqueFarmName([{ id: 'x', name: 'Ovalle table grape' }], undefined, 'Ovalle table grape')).toBe('Ovalle table grape 2');
    expect(uniqueFarmName([], undefined, 'Ovalle table grape')).toBe('Ovalle table grape');
    expect(isNameTaken(farms, 'a', ' FARM 2 ')).toBe(true);
    expect(isNameTaken(farms, 'b', 'farm 2')).toBe(false);
  });
  it('normalizes drawn polygons and rejects degenerate ones', () => {
    const p = normalizeDrawnPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(p?.coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(normalizeDrawnPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] })).toBeNull();
    expect(normalizeDrawnPolygon({ type: 'Point', coordinates: [0, 0] })).toBeNull();
  });
  it('formats areas and title case', () => {
    expect(areaLabel(1234.56)).toBe('1,234.6 ha');
    expect(totalAreaHa([{ areaHa: 1.24 }, { areaHa: 2.03 }])).toBe(3.3);
    expect(titleCase('SAN FERNANDO')).toBe('San Fernando');
    expect(titleCase('REQUÍNOA')).toBe('Requínoa');
  });
  it('turns a CIREN orchard into a new farm with crop and reference prefilled', () => {
    const f = ciren().features[0];
    const pick = cirenPick(f, []);
    expect(pick.kind).toBe('add');
    if (pick.kind !== 'add') return;
    expect(pick.input.crop).toBe('table_grape');
    expect(pick.input.name).toBe('Ovalle table grape');
    expect(pick.input.ciren).toEqual({ especie: 'VID DE MESA', variedad: null, sourceLayer: 'CATASTRO_FRUTICOLA/58', objectId: 663 });
    const [p, id] = withFarmAdded({ ...emptyPortfolio('pf'), name: 'x' }, pick.input);
    const farm = p.farms.find((x) => x.id === id)!;
    expect(farm.zoneId).toBe(`auto-${id}`);
    expect(farm.areaHa).toBeGreaterThan(4);
    // Clicking it again selects the existing farm.
    expect(cirenPick(f, p.farms)).toEqual({ kind: 'exists', farmId: id });
  });
  it('refuses species outside the six crops', () => {
    const f = ciren().features[0];
    const pick = cirenPick({ ...f, properties: { ...f.properties, crop: null, especie: 'LIMONERO' } }, []);
    expect(pick).toEqual({ kind: 'unsupported', message: 'Limonero (CIREN 663) is not one of the six crops this version monitors.' });
  });
  it('hints about covers only when undeclared and likely', () => {
    const grape = crops().find((t) => t.crop === 'table_grape');
    const walnut = crops().find((t) => t.crop === 'walnut');
    expect(coverHint('table_grape', null, grape)).toMatch(/often under covers/);
    expect(coverHint('table_grape', false, grape)).toBeNull();
    expect(coverHint('walnut', null, walnut)).toBeNull();
  });
  it('maps tri-state values', () => {
    expect(toTri(null)).toBe('unset');
    expect(toTri(true)).toBe('yes');
    expect(toTri(false)).toBe('no');
    expect(fromTri('unset')).toBeNull();
    expect(fromTri('no')).toBe(false);
  });
  it('sample farms keep their CIREN refs', () => {
    const s = loadFixture<Portfolio>('portfolio-sample.json');
    const farms: Farm[] = s.farms;
    expect(farms.every((f) => f.ciren)).toBe(true);
  });
});
