import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { emptyPortfolio } from '@/state/portfolio';
import { LAST_STEP, WIZARD_STEPS, maxReachableStep, stepBlocker } from './gates';

const sample = () => loadFixture<Portfolio>('portfolio-sample.json');

describe('wizard gates', () => {
  it('has five steps with the v1 labels', () => {
    expect(WIZARD_STEPS).toEqual(['Portfolio', 'Farms', 'Zones & rules', 'Credit', 'Review']);
    expect(LAST_STEP).toBe(4);
  });
  it('blocks without a draft or a name', () => {
    expect(stepBlocker(0, null)).toMatch(/Starting/);
    expect(stepBlocker(0, emptyPortfolio('pf-1'))).toMatch(/name/);
    expect(maxReachableStep(emptyPortfolio('pf-1'))).toBe(0);
  });
  it('requires a named farm, never blocks zones, requires loans', () => {
    const p = { ...emptyPortfolio('pf-1'), name: 'Test' };
    expect(stepBlocker(1, p)).toMatch(/at least one farm/);
    const s = sample();
    expect(stepBlocker(1, s)).toBeNull();
    expect(stepBlocker(1, { ...s, farms: [{ ...s.farms[0], name: '  ' }, s.farms[1]] })).toBe('1 farm needs a name.');
    expect(stepBlocker(2, s)).toBeNull();
    expect(stepBlocker(3, s)).toBeNull();
    expect(stepBlocker(3, { ...s, farms: s.farms.map((f) => ({ ...f, loan: null })) })).toBe('2 farms still need a loan.');
    expect(maxReachableStep(s)).toBe(LAST_STEP);
    expect(maxReachableStep({ ...s, farms: s.farms.map((f) => ({ ...f, loan: null })) })).toBe(3);
  });
});
