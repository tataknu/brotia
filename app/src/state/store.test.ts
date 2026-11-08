import { beforeEach, describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { loadFixture } from '@/shared/testing/fixtures';
import { CropTemplateListSchema, PortfolioSchema } from '@/domain/schemas';
import { FARM_ID_RE } from '@/domain/constants';
import { getAtPath, proposalState } from '@/domain/rules';
import type { AgentRecommendation, Portfolio } from '@/domain/types';
import { emptyPortfolio, uniqueFarmId, withFarmAdded, withFarmUpdated, withMeta, withSharedZoneAdded, withZoneRemoved, withZoneUpdated } from './portfolio';
import { DRAFT, useStore } from './store';
import { newId } from './ids';

const templates = CropTemplateListSchema.parse(loadFixture('crops.json'));
const sample = (): Portfolio => PortfolioSchema.parse(loadFixture('portfolio-sample.json'));

/** ~200 m square around [lng, lat]. */
function square(lng: number, lat: number, d = 0.001): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
  };
}

describe('portfolio reducers', () => {
  it('new portfolios follow the v1 contract defaults', () => {
    const p = emptyPortfolio('pf-x');
    expect(p).toMatchObject({ schemaVersion: 1, country: 'CL', currency: 'USD', zones: [], farms: [], creditRules: [], cropOverrides: {}, audit: [] });
    expect(PortfolioSchema.safeParse(p).success).toBe(true);
  });

  it('adding a farm creates a slug id, its auto zone and sets zoneId', () => {
    const [p, id] = withFarmAdded(emptyPortfolio('pf'), { polygon: square(-70.8, -34.28), name: 'Requínoa cherries', crop: 'cherry' });
    expect(id).toBe('requinoa-cherries');
    expect(id).toMatch(FARM_ID_RE);
    const farm = p.farms[0];
    expect(farm.zoneId).toBe('auto-requinoa-cherries');
    expect(p.zones).toHaveLength(1);
    expect(p.zones[0]).toMatchObject({ id: 'auto-requinoa-cherries', auto: true, radiusM: 3338, center: farm.centroid });
    expect(farm.areaHa).toBeGreaterThan(0);
    expect(PortfolioSchema.safeParse(p).success).toBe(true);
    const [q, id2] = withFarmAdded(p, { polygon: square(-70.7, -34.2), name: 'Requínoa cherries' });
    expect(id2).toBe('requinoa-cherries-2');
    expect(q.farms[1].name).toBe('Requínoa cherries');
  });

  it('generated ids are contract slugs', () => {
    expect(newId('pf')).toMatch(FARM_ID_RE);
    expect(uniqueFarmId({ farms: [], zones: [] }, 'Fundo  Ñuble #1')).toBe('fundo-nuble-1');
  });

  it('moving a farm re-centres its auto zone; shared zones capture and release farms', () => {
    let [p, id] = withFarmAdded(emptyPortfolio('pf'), { polygon: square(-70.8, -34.28), name: 'A' });
    p = withFarmUpdated(p, id, { polygon: square(-70.9, -34.3) });
    expect(p.zones.find((z) => z.auto)!.center).toEqual(p.farms[0].centroid);
    let zid: string;
    [p, zid] = withSharedZoneAdded(p, p.farms[0].centroid, { name: 'Valley' });
    expect(p.farms[0].zoneId).toBe(zid);
    // Move the shared zone ~11 km away: the farm falls back to its own zone.
    p = withZoneUpdated(p, zid, { center: [p.farms[0].centroid[0], p.farms[0].centroid[1] + 0.1] });
    expect(p.farms[0].zoneId).toBe(`auto-${id}`);
    p = withZoneUpdated(p, zid, { center: p.farms[0].centroid });
    expect(p.farms[0].zoneId).toBe(zid);
    p = withZoneRemoved(p, zid);
    expect(p.farms[0].zoneId).toBe(`auto-${id}`);
  });

  it('auto zones cannot be moved or removed', () => {
    const [p, id] = withFarmAdded(emptyPortfolio('pf'), { polygon: square(-70.8, -34.28), name: 'A' });
    const z = `auto-${id}`;
    expect(withZoneRemoved(p, z)).toBe(p);
    const moved = withZoneUpdated(p, z, { center: [0, 0], name: 'Renamed' });
    expect(moved.zones[0].center).toEqual(p.zones[0].center);
    expect(moved.zones[0].name).toBe('Renamed');
  });

  it('currency change re-labels loans (no FX)', () => {
    const p = withMeta(sample(), { currency: 'CLP' });
    expect(p.farms.every((f) => f.loan?.currency === 'CLP')).toBe(true);
  });
});

describe('store v2', () => {
  beforeEach(() => {
    useStore.setState({ portfolios: [], draft: null, wizardStep: 0, recommendations: {} });
  });

  it('draft lifecycle', () => {
    const s = useStore.getState();
    const id = s.startDraft();
    s.updateMeta(DRAFT, { name: '  Orchards  ', lender: 'Bank' });
    const farmId = useStore.getState().addFarm(DRAFT, { polygon: square(-71.24, -30.58), crop: 'table_grape', name: 'Ovalle' });
    expect(useStore.getState().draft!.farms[0].id).toBe(farmId);
    expect(useStore.getState().commitDraft()).toBe(id);
    const st = useStore.getState();
    expect(st.draft).toBeNull();
    expect(st.portfolios[0].name).toBe('Orchards');
    expect(st.portfolios[0].zones[0].id).toBe(`auto-${farmId}`);
  });

  it('rule changes are applied and audited; revert restores', () => {
    const s = useStore.getState();
    s.addPortfolio(sample());
    const ch = useStore.getState().applyRuleChange(
      'sample-cl',
      { scope: { level: 'zone', id: 'auto-cl-requinoa-cherry' }, path: 'overrides.cherry.rules.stages.bloom.frostCriticalC', newValue: -1.8, reason: 'test' },
      templates,
    )!;
    expect(ch.actor).toEqual({ kind: 'user', name: 'Credit analyst' });
    expect(ch.oldValue).toBe(-2.4);
    let p = useStore.getState().portfolios[0];
    expect(p.audit.at(-1)!.id).toBe(ch.id);
    expect(getAtPath(p.zones[0], ch.path)).toBe(-1.8);
    useStore.getState().revertChange('sample-cl', ch.id, templates);
    p = useStore.getState().portfolios[0];
    expect(getAtPath(p.zones[0], ch.path)).toBeUndefined();
    expect(p.audit).toHaveLength(sample().audit.length + 2);
  });

  it('agent proposals: apply and dismiss go through the audit', () => {
    useStore.getState().addPortfolio(sample());
    const rec = loadFixture<AgentRecommendation>('agent-recommendation.json');
    useStore.getState().addRecommendation('sample-cl', rec);
    useStore.getState().applyProposal('sample-cl', rec.id, rec.proposals[0].id, templates);
    useStore.getState().dismissProposal('sample-cl', rec.id, rec.proposals[1].id, templates);
    const p = useStore.getState().portfolios[0];
    expect(proposalState(p, rec, rec.proposals[0])).toBe('applied');
    expect(proposalState(p, rec, rec.proposals[1])).toBe('dismissed');
    const applied = p.audit.at(-2)!;
    expect(applied).toMatchObject({ status: 'applied', actor: { kind: 'user' }, recommendationId: rec.id });
  });

  it('unknown portfolio ids are no-ops', () => {
    expect(useStore.getState().addFarm('nope', { polygon: square(0, 0) })).toBe('');
    expect(useStore.getState().applyRuleChange('nope', { scope: { level: 'crop', id: 'cherry' }, path: 'weights.a', newValue: 1, reason: '' }, templates)).toBeNull();
  });
});
