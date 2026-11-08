import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { outstandingAt } from '@/domain/schedule';
import type { ClimateEvent, Farm, Loan, Portfolio, PortfolioAssessment } from '@/domain/types';
import {
  NO_SCORE_FILL,
  RISK_RAMP,
  allocation,
  assessmentOf,
  currenciesOf,
  dueWithin,
  farmRows,
  homeKpis,
  incidentsLast24h,
  paymentSchedule,
  portfolioRows,
  rampColor,
  repaymentCurve,
  stressedFarms,
  tierMix,
  upcomingInstallments,
  weightedRisk,
  type FarmRow,
  type PortfolioEntry,
} from './homeModel';

const sample = loadFixture<Portfolio>('portfolio-sample.json');
const assessment = loadFixture<PortfolioAssessment>('assessment-portfolio.json');
const AS_OF = assessment.asOf;

const loan = (amount: number, installments: { dueDate: string; amount: number }[], o = '2026-01-01', m = '2027-12-31'): Loan => ({
  originationDate: o,
  maturityDate: m,
  amount,
  currency: 'USD',
  scheduleType: 'custom',
  installments,
});

const farm = (id: string, crop: Farm['crop'], l: Loan | null): Farm => ({ ...sample.farms[0], id, name: id, crop, loan: l });

const row = (p: Partial<FarmRow>): FarmRow => ({
  portfolioId: 'p1',
  portfolioName: 'P1',
  country: 'CL',
  currency: 'USD',
  farmId: 'f',
  farmName: 'F',
  crop: 'cherry',
  outstanding: 0,
  score: null,
  tier: null,
  from: 'schedule',
  ...p,
});

const event = (id: string, start: string, affected: string[] = []): ClimateEvent => ({
  ...assessment.events[0],
  id,
  start,
  end: null,
  affectedFarmIds: affected,
  affectedExposure: affected.length ? 1000 : 0,
});

describe('rampColor', () => {
  it('maps the ends of the score scale to the ends of the ramp', () => {
    expect(rampColor(0)).toBe(RISK_RAMP[0]);
    expect(rampColor(100)).toBe(RISK_RAMP[6]);
    expect(rampColor(50)).toBe(RISK_RAMP[3]);
    expect(rampColor(-5)).toBe(RISK_RAMP[0]);
    expect(rampColor(140)).toBe(RISK_RAMP[6]);
  });
  it('gives the neutral fill when there is no score', () => {
    expect(rampColor(null)).toBe(NO_SCORE_FILL);
    expect(rampColor(undefined)).toBe(NO_SCORE_FILL);
  });
});

describe('farmRows', () => {
  it('reads exposure and score from the assessment', () => {
    const rows = farmRows({ portfolio: sample, assessment }, AS_OF);
    const ovalle = rows.find((r) => r.farmId === 'cl-ovalle-table-grape')!;
    expect(ovalle).toMatchObject({ outstanding: 120000, score: 58.6, tier: 'watch', from: 'assessment' });
  });
  it('falls back to the loan schedule without an assessment, with no risk', () => {
    const rows = farmRows({ portfolio: sample, assessment: null }, AS_OF);
    for (const r of rows) {
      const f = sample.farms.find((x) => x.id === r.farmId)!;
      expect(r).toMatchObject({ score: null, tier: null, from: 'schedule', outstanding: f.loan ? outstandingAt(f.loan, AS_OF) : 0 });
    }
  });
  it('ignores an assessment for another portfolio', () => {
    const other = { ...sample, id: 'other' };
    expect(assessmentOf({ portfolio: other, assessment })).toBeNull();
    expect(farmRows({ portfolio: other, assessment }, AS_OF).every((r) => r.score === null)).toBe(true);
  });
  it('the local schedule reconciles with the service exposure at the as-of', () => {
    const local = farmRows({ portfolio: sample, assessment: null }, AS_OF).reduce((s, r) => s + r.outstanding, 0);
    expect(local).toBeCloseTo(assessment.totalExposure, 2);
  });
});

describe('weightedRisk', () => {
  it('weights scores by outstanding', () => {
    const w = weightedRisk([row({ outstanding: 300, score: 80 }), row({ outstanding: 100, score: 0 })]);
    expect(w.score).toBeCloseTo(60);
    expect(w.coverage).toBe(1);
  });
  it('leaves unscored outstanding out and reports coverage', () => {
    const w = weightedRisk([row({ outstanding: 100, score: 40 }), row({ outstanding: 300, score: null })]);
    expect(w.score).toBeCloseTo(40);
    expect(w.coverage).toBeCloseTo(0.25);
  });
  it('is null with no scored outstanding, coverage null with no outstanding', () => {
    expect(weightedRisk([row({ outstanding: 100 })])).toEqual({ score: null, coverage: 0 });
    expect(weightedRisk([row({ outstanding: 0, score: 50 })])).toEqual({ score: null, coverage: null });
    expect(weightedRisk([])).toEqual({ score: null, coverage: null });
  });
  it('matches the fixture: (120k × 58.6 + 120k × 13.4) / 240k', () => {
    const w = weightedRisk(farmRows({ portfolio: sample, assessment }, AS_OF));
    expect(w.score).toBeCloseTo(36, 6);
  });
});

describe('tierMix', () => {
  it('sums outstanding by tier and keeps unscored apart', () => {
    expect(tierMix([row({ outstanding: 1, tier: 'normal' }), row({ outstanding: 2, tier: 'high' }), row({ outstanding: 4, tier: 'high' }), row({ outstanding: 8 })])).toEqual({
      normal: 1,
      watch: 0,
      high: 6,
      unscored: 8,
    });
  });
});

describe('allocation', () => {
  const rows = [
    row({ portfolioId: 'a', portfolioName: 'A', country: 'CL', crop: 'cherry', outstanding: 300, score: 80, tier: 'high' }),
    row({ portfolioId: 'a', portfolioName: 'A', country: 'CL', crop: 'walnut', outstanding: 100, score: 20, tier: 'normal' }),
    row({ portfolioId: 'b', portfolioName: 'B', country: 'PE', crop: 'cherry', outstanding: 600, score: null }),
  ];
  it('shares sum to 1 and slices are largest first', () => {
    for (const dim of ['portfolio', 'country', 'crop'] as const) {
      const s = allocation(rows, dim);
      expect(s.reduce((x, y) => x + y.share, 0)).toBeCloseTo(1);
      expect(s.map((x) => x.outstanding)).toEqual([...s.map((x) => x.outstanding)].sort((a, b) => b - a));
    }
  });
  it('groups by portfolio with the exposure-weighted score of each slice', () => {
    const [b, a] = allocation(rows, 'portfolio');
    expect(b).toMatchObject({ key: 'b', label: 'B', outstanding: 600, share: 0.6, farms: 1 });
    expect(b.risk.score).toBeNull();
    expect(a).toMatchObject({ key: 'a', label: 'A', outstanding: 400, share: 0.4, farms: 2 });
    expect(a.risk.score).toBeCloseTo(65);
  });
  it('groups by crop with crop labels and by country with a custom label', () => {
    const crops = allocation(rows, 'crop');
    expect(crops.map((c) => [c.label, c.outstanding])).toEqual([
      ['Cherry', 900],
      ['Walnut', 100],
    ]);
    expect(crops[0].risk).toEqual({ score: 80, coverage: 300 / 900 });
    expect(allocation(rows, 'country', (k) => `Country ${k}`).map((c) => c.label)).toEqual(['Country PE', 'Country CL']);
  });
  it('gives zero shares when nothing is outstanding', () => {
    expect(allocation([row({ outstanding: 0 })], 'crop')[0].share).toBe(0);
  });
});

describe('currenciesOf', () => {
  it('lists the most common currency first', () => {
    expect(currenciesOf([{ currency: 'CLP' }, { currency: 'USD' }, { currency: 'CLP' }])).toEqual(['CLP', 'USD']);
    expect(currenciesOf([{ currency: 'CLP' }, { currency: 'USD' }])).toEqual(['USD', 'CLP']);
    expect(currenciesOf([])).toEqual([]);
  });
});

describe('incidentsLast24h', () => {
  const at = (pid: string, events: ClimateEvent[]): PortfolioAssessment => ({ ...assessment, portfolioId: pid, events });
  it('sums the report definition across portfolios: farm-touching events in the window plus credit-rule triggers', () => {
    const a1 = at('p1', [event('e1', '2026-11-07', ['f1']), event('e2', '2026-11-06'), event('old', '2026-10-01', ['f1'])]);
    const a2 = at('p2', [event('e3', '2026-11-06', ['f2']), event('e4', '2026-11-05', ['f2']), event('future', '2026-11-08', ['f2'])]);
    const inc = incidentsLast24h([a1, a2]);
    const rules = assessment.creditActions.length;
    expect(inc.events).toBe(2);
    expect(inc.triggers).toBe(rules * 2);
    expect(inc.total).toBe(2 + rules * 2);
    expect(inc.nearby).toBe(1);
    expect(inc.items.filter((i) => i.kind === 'event').map((i) => [i.portfolioId, i.id])).toEqual([
      ['p1', 'e1'],
      ['p2', 'e3'],
    ]);
  });
  it('is empty without assessments', () => {
    expect(incidentsLast24h([])).toEqual({ items: [], events: 0, triggers: 0, total: 0, nearby: 0 });
  });
});

describe('homeKpis', () => {
  it('reads the fixture assessment', () => {
    const k = homeKpis([{ portfolio: sample, assessment }], AS_OF);
    expect(k.outstanding).toBe(assessment.totalExposure);
    expect(k.stressed).toBe(assessment.exposureByTier.watch + assessment.exposureByTier.high);
    expect(k.stressedShare).toBeCloseTo(0.5);
    expect(k).toMatchObject({ portfolios: 1, farms: 2, creditActions: assessment.creditActions.length, assessed: 1 });
  });
  it('still totals outstanding when an assessment is missing', () => {
    const second: PortfolioEntry = { portfolio: { ...sample, id: 'copy' }, assessment: null };
    const k = homeKpis([{ portfolio: sample, assessment }, second], AS_OF);
    expect(k.outstanding).toBeCloseTo(assessment.totalExposure * 2);
    expect(k.stressedShare).toBeCloseTo(0.5);
    expect(k).toMatchObject({ portfolios: 2, farms: 4, assessed: 1 });
  });
});

describe('repaymentCurve', () => {
  const p = {
    farms: [
      farm('a', 'cherry', loan(1000, [{ dueDate: '2026-12-15', amount: 400 }, { dueDate: '2027-02-01', amount: 600 }])),
      farm('b', 'walnut', loan(500, [], '2026-11-20', '2027-01-31')),
      farm('c', 'walnut', null),
    ],
  };
  it('starts at the as-of with the outstanding, then steps through month ends to the last maturity', () => {
    const c = repaymentCurve([p], '2026-11-07');
    expect(c.map((x) => x.date)).toEqual(['2026-11-07', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    expect(c.map((x) => x.outstanding)).toEqual([1000, 1500, 1100, 600, 0]);
    expect(c.map((x) => x.due)).toEqual([0, 0, 400, 500, 600]);
  });
  it('repayments add up to the outstanding at the as-of plus later disbursements', () => {
    const c = repaymentCurve([p], '2026-11-07');
    expect(c.reduce((s, x) => s + x.due, 0)).toBe(1500);
  });
  it('agrees with the service exposure at the fixture as-of', () => {
    expect(repaymentCurve([sample], AS_OF)[0].outstanding).toBeCloseTo(assessment.totalExposure, 2);
  });
  it('is empty without loans', () => {
    expect(repaymentCurve([{ farms: [farm('c', 'walnut', null)] }], '2026-11-07')).toEqual([]);
  });
});

describe('upcomingInstallments', () => {
  it('lists every installment in the next 60 days with the farm tier', () => {
    const portfolio: Portfolio = {
      ...sample,
      farms: [
        farm('cl-ovalle-table-grape', 'table_grape', loan(900, [
          { dueDate: '2026-11-07', amount: 100 },
          { dueDate: '2026-11-30', amount: 200 },
          { dueDate: '2026-12-30', amount: 300 },
          { dueDate: '2027-01-07', amount: 300 },
        ])),
        farm('x', 'cherry', loan(50, [{ dueDate: '2026-11-20', amount: 50 }])),
      ],
    };
    const u = upcomingInstallments([{ portfolio, assessment }], '2026-11-07', 60);
    expect(u.map((i) => [i.farmId, i.dueDate, i.days, i.tier])).toEqual([
      ['x', '2026-11-20', 13, null],
      ['cl-ovalle-table-grape', '2026-11-30', 23, 'watch'],
      ['cl-ovalle-table-grape', '2026-12-30', 53, 'watch'],
    ]);
  });
});

describe('portfolioRows', () => {
  it('gives shares within the group and the weighted score per portfolio', () => {
    const rows = portfolioRows([{ portfolio: sample, assessment }, { portfolio: { ...sample, id: 'copy', name: 'Copy' }, assessment: null }], AS_OF);
    expect(rows.map((r) => r.share)).toEqual([0.5, 0.5]);
    const live = rows.find((r) => r.id === sample.id)!;
    expect(live.risk.score).toBeCloseTo(36);
    expect(live.creditActions).toBe(assessment.creditActions.length);
    expect(live.asOf).toBe(AS_OF);
    const copy = rows.find((r) => r.id === 'copy')!;
    expect(copy).toMatchObject({ creditActions: null, asOf: null });
    expect(copy.risk.score).toBeNull();
  });
});

describe('paymentSchedule', () => {
  // Ovalle is 'watch' in the fixture assessment; 'x' is not assessed.
  const portfolio: Portfolio = {
    ...sample,
    farms: [
      farm('cl-ovalle-table-grape', 'table_grape', loan(1000, [
        { dueDate: '2026-11-07', amount: 100 },
        { dueDate: '2026-11-30', amount: 200 },
        { dueDate: '2026-12-01', amount: 300 },
        { dueDate: '2027-06-15', amount: 400 },
      ])),
      farm('x', 'cherry', loan(500, [], '2026-11-20', '2027-01-31')),
      farm('nil', 'walnut', null),
    ],
  };
  const entries = (a: PortfolioAssessment | null): PortfolioEntry[] => [{ portfolio, assessment: a }];

  it('buckets installments by calendar month from the as-of: the as-of day is excluded, the month end included', () => {
    const s = paymentSchedule(entries(assessment), '2026-11-07', 6, 'USD');
    expect(s.months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(s.months[0]).toMatchObject({ from: '2026-11-07', to: '2026-11-30', total: 200, count: 1 });
    expect(s.months[1]).toMatchObject({ from: '2026-11-30', to: '2026-12-31', total: 300, count: 1 });
    expect(s.months.map((m) => m.total)).toEqual([200, 300, 500, 0, 0, 0]);
    expect(s.total).toBe(1000);
    expect(s.count).toBe(3);
  });

  it('treats a loan with no installments as one payment at maturity', () => {
    const jan = paymentSchedule(entries(assessment), '2026-11-07', 3, 'USD').months[2];
    expect(jan.payments.map((p) => [p.farmId, p.dueDate, p.amount])).toEqual([['x', '2027-01-31', 500]]);
  });

  it('colours each payment by the farm\'s current tier, and unscored while there is no assessment', () => {
    const s = paymentSchedule(entries(assessment), '2026-11-07', 12, 'USD');
    expect(s.byTier).toEqual({ normal: 0, watch: 900, high: 0, unscored: 500 });
    for (const m of s.months) expect(m.byTier.normal + m.byTier.watch + m.byTier.high + m.byTier.unscored).toBeCloseTo(m.total, 6);
    const pending = paymentSchedule(entries(null), '2026-11-07', 12, 'USD');
    expect(pending.byTier).toEqual({ normal: 0, watch: 0, high: 0, unscored: 1400 });
    expect(pending.months.map((m) => m.total)).toEqual(s.months.map((m) => m.total));
  });

  it('gives 6, 12 or 24 months, largest payment first within a month', () => {
    for (const n of [6, 12, 24]) expect(paymentSchedule(entries(null), '2026-11-07', n, 'USD').months).toHaveLength(n);
    const p2: Portfolio = { ...portfolio, farms: [farm('a', 'cherry', loan(30, [{ dueDate: '2026-12-02', amount: 10 }, { dueDate: '2026-12-03', amount: 20 }]))] };
    expect(paymentSchedule([{ portfolio: p2, assessment: null }], '2026-11-07', 2, 'USD').months[1].payments.map((p) => p.amount)).toEqual([20, 10]);
  });

  it('reconciles with the repayment curve month by month on the sample', () => {
    const s = paymentSchedule([{ portfolio: sample, assessment }], AS_OF, 24, 'USD');
    const curve = repaymentCurve([sample], AS_OF).slice(1, 25);
    expect(curve.length).toBeGreaterThan(6);
    expect(s.months.slice(0, curve.length).map((m) => m.to)).toEqual(curve.map((c) => c.date));
    s.months.forEach((m, i) => expect(m.total).toBeCloseTo(curve[i]?.due ?? 0, 2));
  });

  it('never adds a loan in another currency', () => {
    const mixed: Portfolio = { ...portfolio, farms: [...portfolio.farms, farm('clp', 'cherry', { ...loan(9e6, [{ dueDate: '2026-12-10', amount: 9e6 }]), currency: 'CLP' })] };
    const s = paymentSchedule([{ portfolio: mixed, assessment }], '2026-11-07', 12, 'USD');
    expect(s.total).toBe(1400);
    expect(s.otherCurrencyLoans).toBe(1);
  });
});

describe('dueWithin', () => {
  const portfolio: Portfolio = {
    ...sample,
    farms: [
      farm('cl-ovalle-table-grape', 'table_grape', loan(1000, [{ dueDate: '2026-11-30', amount: 200 }, { dueDate: '2027-03-01', amount: 800 }])),
      farm('cl-requinoa-cherry', 'cherry', loan(600, [{ dueDate: '2026-12-15', amount: 600 }])),
      farm('x', 'cherry', loan(100, [{ dueDate: '2026-12-20', amount: 100 }])),
    ],
  };
  it('sums the next 90 days and the share due from farms at watch or high, over the amount with a tier', () => {
    const d = dueWithin([{ portfolio, assessment }], '2026-11-07', 90, 'USD');
    const requinoa = assessment.ranked.find((r) => r.farmId === 'cl-requinoa-cherry')!.tier;
    expect(requinoa).toBe('normal');
    expect(d).toMatchObject({ amount: 900, count: 3, farms: 3, stressed: 200, unscored: 100 });
    expect(d.stressedShare).toBeCloseTo(200 / 800);
  });
  it('has no share while every tier is pending', () => {
    const d = dueWithin([{ portfolio, assessment: null }], '2026-11-07', 90, 'USD');
    expect(d).toMatchObject({ amount: 900, stressed: 0, unscored: 900, stressedShare: null });
  });
});

describe('stressedFarms', () => {
  it('lists farms at watch or high, largest outstanding first', () => {
    const s = stressedFarms({ portfolio: sample, assessment }, AS_OF);
    expect(s.map((f) => [f.farmId, f.tier])).toEqual([['cl-ovalle-table-grape', 'watch']]);
    expect(stressedFarms({ portfolio: sample, assessment: null }, AS_OF)).toEqual([]);
  });
});
