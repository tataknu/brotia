/** End-to-end wizard flow through the store actions the steps call (no DOM). */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CirenOrchardCollection, CropTemplate } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { DRAFT, useStore } from '@/state/store';
import { cirenPick } from './farms/farmHelpers';
import { formToLoan, defaultLoanForm, farmHarvest } from './credit/loanLogic';
import { creditChange, leafChange, thresholdPath } from './zones/rulesModel';
import { maxReachableStep, LAST_STEP } from './gates';
import { overrideEntries } from './review/reviewLogic';

const crops = () => loadFixture<CropTemplate[]>('crops.json');

describe('wizard flow', () => {
  beforeEach(() => useStore.setState({ portfolios: [], draft: null, wizardStep: 0, recommendations: {} }));

  it('creates a portfolio with a cadastre farm, a drawn farm, a shared zone, audited rules and loans', () => {
    const s = useStore.getState();
    const templates = crops();
    s.startDraft({ country: 'CL', currency: 'CLP' });
    s.updateMeta(DRAFT, { name: 'Valle test', lender: 'Banco test' });

    // Step 2: one farm from CIREN, one drawn.
    const pick = cirenPick(loadFixture<CirenOrchardCollection>('ciren-orchards.json').features[0], []);
    if (pick.kind !== 'add') throw new Error('expected add');
    const grapes = s.addFarm(DRAFT, pick.input);
    const drawn = s.addFarm(DRAFT, {
      name: 'Farm 1',
      crop: 'cherry',
      polygon: { type: 'Polygon', coordinates: [[[-71.25, -30.6], [-71.249, -30.6], [-71.249, -30.599], [-71.25, -30.599], [-71.25, -30.6]]] },
    });
    s.applyRuleChange(DRAFT, { scope: { level: 'farm', id: grapes }, path: 'covered', newValue: true, reason: '' }, templates);
    s.updateFarm(DRAFT, drawn, { plantingYear: 2019 });

    // Step 3: a shared zone over both, a zone override, a crop override, a farm credit override.
    const d1 = useStore.getState().draft!;
    const zoneId = s.addSharedZone(DRAFT, d1.farms[0].centroid);
    const d2 = useStore.getState().draft!;
    expect(d2.farms.every((f) => f.zoneId === zoneId)).toBe(true);
    s.applyRuleChange(DRAFT, { ...leafChange(d2, { level: 'zone', zoneId, crop: 'table_grape' }, thresholdPath('harvest', 'harvestRainMm72h')), newValue: 6, reason: 'Flame Seedless' }, templates);
    s.applyRuleChange(DRAFT, { ...leafChange(d2, { level: 'crop', crop: 'cherry' }, 'weights.c'), newValue: 0.4, reason: '' }, templates);
    s.applyRuleChange(DRAFT, { ...creditChange(d2, 'farm', drawn, 'cr-abandonment', 'enabled'), newValue: false, reason: 'Replanting' }, templates);

    // Step 4: loans.
    for (const f of useStore.getState().draft!.farms) {
      const md = farmHarvest(useStore.getState().draft!, templates.find((t) => t.crop === f.crop), f).md;
      s.setLoan(DRAFT, f.id, formToLoan({ ...defaultLoanForm('2026-11-07'), amount: '50000000' }, md, 'CLP'));
    }
    const d3 = useStore.getState().draft!;
    expect(maxReachableStep(d3)).toBe(LAST_STEP);
    expect(d3.audit.map((c) => [c.scope.level, c.path, c.oldValue, c.newValue])).toEqual([
      ['farm', 'covered', false, true],
      ['zone', 'overrides.table_grape.rules.stages.harvest.harvestRainMm72h', 8, 6],
      ['crop', 'weights.c', 0.3, 0.4],
      ['farm', 'creditRuleOverrides.cr-abandonment.enabled', true, false],
    ]);
    expect(overrideEntries(d3, {}).length).toBe(3);

    // Step 5: commit.
    const id = s.commitDraft();
    const st = useStore.getState();
    expect(st.draft).toBeNull();
    const p = st.portfolios.find((x) => x.id === id)!;
    expect(p.name).toBe('Valle test');
    expect(p.currency).toBe('CLP');
    expect(p.farms.map((f) => f.loan?.currency)).toEqual(['CLP', 'CLP']);
    expect(p.farms.find((f) => f.id === grapes)?.ciren?.objectId).toBe(663);
    expect(p.audit).toHaveLength(4);
  });
});
