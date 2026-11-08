import { describe, expect, it } from 'vitest';
import type { Farm, Portfolio } from '@/domain/types';
import { makeDefaultZone } from '@/domain/defaults';
import { loanTotals, reviewIssues } from './reviewLogic';

const poly = { type: 'Polygon' as const, coordinates: [[[-62.8, -17.2], [-62.79, -17.2], [-62.79, -17.21], [-62.8, -17.2]]] };

function farm(id: string, extra: Partial<Farm> = {}): Farm {
  return { id, name: id, crop: 'soy', polygon: poly, areaHa: 100, centroid: [-62.8, -17.2], zoneId: 'z1', sowingDate: '2026-11-15', ...extra };
}

const loan = (amount: number, extra = {}) => ({
  originationDate: '2026-08-01',
  maturityDate: '2027-08-01',
  amount,
  currency: 'USD' as const,
  scheduleType: 'bullet' as const,
  installments: [{ dueDate: '2027-08-01', amount }],
  ...extra,
});

function portfolio(farms: Farm[]): Portfolio {
  return { id: 'p', name: 'Test', lender: 'Bank', currency: 'USD', createdAt: '', zones: [makeDefaultZone('Z', { id: 'z1' })], farms };
}

describe('reviewIssues', () => {
  it('is empty for a complete portfolio', () => {
    expect(reviewIssues(portfolio([farm('a', { loan: loan(1000) })]), '2026-11-06')).toEqual([]);
  });
  it('flags missing loans as errors and mismatches as warnings', () => {
    const p = portfolio([farm('a'), farm('b', { loan: loan(1000, { installments: [{ dueDate: '2027-08-01', amount: 900 }] }) })]);
    const issues = reviewIssues(p, '2026-11-06');
    expect(issues[0]).toEqual({ level: 'error', text: 'a has no loan.' });
    expect(issues.some((i) => i.level === 'warning' && i.text.includes('do not add up'))).toBe(true);
  });
  it('notes repaid loans and missing sowing dates', () => {
    const p = portfolio([farm('a', { sowingDate: undefined, loan: loan(10, { originationDate: '2024-01-01', maturityDate: '2025-01-01', installments: [{ dueDate: '2025-01-01', amount: 10 }] }) })]);
    const texts = reviewIssues(p, '2026-11-06').map((i) => i.text);
    expect(texts.some((t) => t.includes('fully repaid'))).toBe(true);
    expect(texts.some((t) => t.includes('no sowing date'))).toBe(true);
  });
});

describe('loanTotals', () => {
  it('sums amounts, outstanding and groups schedule types', () => {
    const p = portfolio([farm('a', { loan: loan(1000) }), farm('b', { loan: loan(500, { scheduleType: 'at_harvest' }) }), farm('c')]);
    const t = loanTotals(p, '2026-11-06');
    expect(t.count).toBe(2);
    expect(t.total).toBe(1500);
    expect(t.outstanding).toBe(1500);
    expect(t.bySchedule.map((s) => s.type)).toEqual(['bullet', 'at_harvest']);
    expect(t.latestMaturity).toBe('2027-08-01');
  });
});
