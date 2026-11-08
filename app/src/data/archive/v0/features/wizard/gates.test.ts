import { describe, expect, it } from 'vitest';
import { maxReachableStep, stepBlocker } from './gates';
import { emptyDraft, withFarmAdded, withLoan } from '@/state/draft';

const poly = {
  type: 'Polygon' as const,
  coordinates: [[[-62.8, -17.2], [-62.79, -17.2], [-62.79, -17.21], [-62.8, -17.21], [-62.8, -17.2]]],
};

describe('wizard gates', () => {
  it('portfolio step needs a name', () => {
    const d = emptyDraft();
    expect(stepBlocker(0, d)).toMatch(/name/);
    expect(stepBlocker(0, { ...d, name: 'Book A' })).toBeNull();
  });
  it('farms step needs at least one farm; credit needs a loan on every farm', () => {
    let d = { ...emptyDraft(), name: 'Book A' };
    expect(stepBlocker(1, d)).not.toBeNull();
    d = withFarmAdded(d, poly, 'f1');
    expect(stepBlocker(1, d)).toBeNull();
    expect(stepBlocker(3, d)).toBe('1 farm still needs a loan.');
    d = withLoan(d, 'f1', { originationDate: '2026-01-01', maturityDate: '2027-01-01', amount: 1, currency: 'USD', scheduleType: 'bullet', installments: [] });
    expect(stepBlocker(3, d)).toBeNull();
    expect(maxReachableStep(d)).toBe(4);
  });
});
