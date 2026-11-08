import { describe, expect, it } from 'vitest';
import type { CropTemplate, Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { commitChange, makeChange } from '@/domain/rules';
import {
  HARVEST_START_FALLBACK,
  defaultLoanForm,
  farmHarvest,
  formInstallments,
  formToLoan,
  harvestDateFor,
  harvestStart,
  loanToForm,
  normalizeLoan,
  validateLoanForm,
  withRowAdded,
  withRowEdited,
  withScheduleType,
} from './loanLogic';

const crops = () => loadFixture<CropTemplate[]>('crops.json');
const sample = () => loadFixture<Portfolio>('portfolio-sample.json');
const user = { kind: 'user' as const, name: 'Credit analyst' };

describe('harvest date (v1: from the crop template harvest stage)', () => {
  it('reads the harvest stage start from each template; avocado has none', () => {
    const byCrop = Object.fromEntries(crops().map((t) => [t.crop, harvestStart(t.stages)]));
    expect(byCrop).toEqual(HARVEST_START_FALLBACK);
  });
  it('takes the first harvest start strictly after origination, across the year end', () => {
    expect(harvestDateFor('11-10', '2026-07-01')).toBe('2026-11-10');
    expect(harvestDateFor('11-10', '2026-11-10')).toBe('2027-11-10');
    expect(harvestDateFor('03-15', '2026-08-01')).toBe('2027-03-15');
    expect(harvestDateFor(null, '2026-08-01')).toBeUndefined();
    expect(harvestDateFor('11-10', 'nope')).toBeUndefined();
  });
  it('follows rule edits: a zone override of the harvest window moves the payment', () => {
    const s = sample();
    const grapes = s.farms.find((f) => f.crop === 'table_grape')!;
    const t = crops().find((x) => x.crop === 'table_grape');
    expect(farmHarvest(s, t, grapes)).toEqual({ md: '12-15', from: 'template' });
    const change = makeChange(s, crops(), { scope: { level: 'zone', id: grapes.zoneId }, path: 'overrides.table_grape.stages.harvest.start', newValue: '01-05', reason: '', actor: user });
    const s2 = commitChange(s, change, crops());
    expect(farmHarvest(s2, t, s2.farms.find((f) => f.id === grapes.id)!)).toEqual({ md: '01-05', from: 'template' });
    expect(farmHarvest(s, undefined, grapes)).toEqual({ md: '12-15', from: 'default' });
  });
});

describe('loan form', () => {
  const form = { ...defaultLoanForm('2026-11-07'), amount: '120,000' };
  it('defaults to an unsaved at-harvest form three months back', () => {
    const d = defaultLoanForm('2026-11-07');
    expect(d).toMatchObject({ originationDate: '2026-08-07', maturityDate: '2027-08-07', amount: '', scheduleType: 'at_harvest' });
    expect(validateLoanForm(d, '11-10').valid).toBe(false);
  });
  it('pays at harvest, or at maturity when the crop has no harvest stage', () => {
    expect(formInstallments(form, '11-10')).toEqual([{ dueDate: '2026-11-10', amount: 120000 }]);
    expect(formInstallments(form, null)).toEqual([{ dueDate: '2027-08-07', amount: 120000 }]);
    const loan = formToLoan(form, '11-10', 'CLP')!;
    expect(loan).toMatchObject({ amount: 120000, currency: 'CLP', scheduleType: 'at_harvest' });
  });
  it('validates dates and amounts', () => {
    const v = validateLoanForm({ ...form, maturityDate: '2026-01-01', amount: '-3' }, '11-10');
    expect(v.errors.maturityDate).toMatch(/after origination/);
    expect(v.errors.amount).toMatch(/greater than zero/);
  });
  it('switches to custom when a generated row is edited, and warns when totals differ', () => {
    const q = withScheduleType(form, 'quarterly', '11-10');
    const plan = formInstallments(q, '11-10');
    expect(plan).toHaveLength(4);
    const edited = withRowEdited(q, 0, { amount: '10000' }, '11-10');
    expect(edited.scheduleType).toBe('custom');
    const v = validateLoanForm(edited, '11-10', '$');
    expect(v.valid).toBe(true);
    expect(v.warnings[0]).toMatch(/less than the loan amount/);
    const added = withRowAdded(edited, '11-10');
    expect(added.rows).toHaveLength(5);
  });
  it('round-trips the sample loans and keeps custom plans when normalizing', () => {
    const s = sample();
    for (const f of s.farms) {
      const loan = f.loan!;
      expect(formToLoan(loanToForm(loan), '11-10', loan.currency)).toEqual(loan);
      expect(normalizeLoan(loan, '11-10')).toEqual(loan);
    }
  });
});
