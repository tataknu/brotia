import { describe, expect, it } from 'vitest';
import type { Loan } from '@/domain/types';
import {
  defaultLoanForm,
  formInstallments,
  formToLoan,
  generatedRowId,
  harvestDateFor,
  loanToForm,
  normalizeLoan,
  parseAmount,
  validateLoanForm,
  withRowAdded,
  withRowEdited,
  withRowRemoved,
  withScheduleType,
  type LoanForm,
} from './loanLogic';

const soy = { crop: 'soy' as const };

const base: LoanForm = { originationDate: '2026-08-01', maturityDate: '2027-08-01', amount: '120000', scheduleType: 'quarterly', rows: [] };

describe('parseAmount', () => {
  it('accepts commas and rejects junk', () => {
    expect(parseAmount('12,500.5')).toBe(12500.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('harvestDateFor', () => {
  it('uses the sowing date plus the season length', () => {
    expect(harvestDateFor({ crop: 'soy', sowingDate: '2026-11-15' }, '2026-08-01')).toBe('2027-03-20');
  });
  it('without a sowing date picks the next typical harvest after origination', () => {
    // soy typical sow 11-15, 125 days -> harvest Mar 20 of the next year
    expect(harvestDateFor(soy, '2026-08-01')).toBe('2027-03-20');
    // origination in Feb: the season sown the previous November is still ahead
    expect(harvestDateFor(soy, '2026-02-01')).toBe('2026-03-20');
    expect(harvestDateFor(soy, '2026-04-01')).toBe('2027-03-20');
  });
});

describe('validateLoanForm', () => {
  it('passes a complete form', () => {
    const v = validateLoanForm(base, soy);
    expect(v.valid).toBe(true);
    expect(v.warnings).toEqual([]);
  });
  it('requires maturity after origination', () => {
    const v = validateLoanForm({ ...base, maturityDate: '2026-07-01' }, soy);
    expect(v.valid).toBe(false);
    expect(v.errors.maturityDate).toMatch(/after origination/);
  });
  it('requires a positive amount', () => {
    expect(validateLoanForm({ ...base, amount: '' }, soy).errors.amount).toBeTruthy();
    expect(validateLoanForm({ ...base, amount: '0' }, soy).errors.amount).toBeTruthy();
  });
  it('custom needs at least one valid row and warns on a mismatch', () => {
    const custom: LoanForm = { ...base, scheduleType: 'custom', rows: [] };
    expect(validateLoanForm(custom, soy).errors.rows).toBeTruthy();
    const withRows = { ...custom, rows: [{ dueDate: '2027-03-01', amount: '100000' }] };
    const v = validateLoanForm(withRows, soy);
    expect(v.valid).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/less than the loan amount/);
    const bad = { ...custom, rows: [{ dueDate: '', amount: '5' }] };
    expect(validateLoanForm(bad, soy).valid).toBe(false);
  });
});

describe('formToLoan', () => {
  it('builds a quarterly plan that sums to the amount', () => {
    const loan = formToLoan(base, soy, 'USD') as Loan;
    expect(loan.installments).toHaveLength(4);
    expect(loan.installments.at(-1)?.dueDate).toBe('2027-08-01');
    expect(loan.installments.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(120000, 2);
  });
  it('at_harvest uses the crop calendar', () => {
    const loan = formToLoan({ ...base, scheduleType: 'at_harvest' }, soy, 'BOB') as Loan;
    expect(loan.currency).toBe('BOB');
    expect(loan.installments).toEqual([{ dueDate: '2027-03-20', amount: 120000 }]);
  });
  it('returns null while invalid', () => {
    expect(formToLoan({ ...base, amount: 'x' }, soy, 'USD')).toBeNull();
  });
  it('round-trips through loanToForm', () => {
    const loan = formToLoan({ ...base, scheduleType: 'custom', rows: [{ dueDate: '2027-01-01', amount: '120000' }] }, soy, 'USD') as Loan;
    expect(formToLoan(loanToForm(loan), soy, 'USD')).toEqual(loan);
  });
});

describe('row editing', () => {
  it('switching to custom seeds rows from the generated plan', () => {
    const f = withScheduleType(base, 'custom', soy);
    expect(f.rows).toHaveLength(4);
    expect(formInstallments(f, soy)).toEqual(formInstallments(base, soy));
  });
  it('editing a generated row converts the plan to custom', () => {
    const f = withRowEdited(base, 0, { amount: '50000' }, soy);
    expect(f.scheduleType).toBe('custom');
    expect(f.rows[0].amount).toBe('50000');
    expect(f.rows).toHaveLength(4);
  });
  it('adding a row proposes the remaining balance', () => {
    const f0: LoanForm = { ...base, scheduleType: 'custom', rows: [{ dueDate: '2027-01-01', amount: '20000' }] };
    const f = withRowAdded(f0, soy);
    expect(f.rows[1]).toMatchObject({ dueDate: '2027-02-01', amount: '100000' });
    expect(f.rows[1].id).toBeTruthy();
  });
});

describe('normalizeLoan', () => {
  it('regenerates generated plans and keeps the loan currency', () => {
    const loan = formToLoan({ ...base, scheduleType: 'at_harvest' }, soy, 'USD') as Loan;
    const moved = normalizeLoan(loan, { crop: 'soy', sowingDate: '2026-12-01' });
    expect(moved.currency).toBe('USD');
    expect(moved.installments[0].dueDate).toBe('2027-04-05');
  });
  it('keeps custom plans', () => {
    const loan: Loan = { originationDate: '2026-01-01', maturityDate: '2027-01-01', amount: 10, currency: 'USD', scheduleType: 'custom', installments: [{ dueDate: '2026-06-01', amount: 10 }] };
    expect(normalizeLoan(loan, soy)).toEqual(loan);
  });
});

describe('row ids', () => {
  it('seeded custom rows reuse the generated-row key; removing a middle row keeps the other ids', () => {
    const f = withScheduleType(base, 'custom', soy);
    expect(f.rows.map((r) => r.id)).toEqual(f.rows.map((r) => generatedRowId(r.dueDate)));
    const removed = withRowRemoved(f, 1, soy);
    expect(removed.rows.map((r) => r.id)).toEqual([f.rows[0].id, f.rows[2].id, f.rows[3].id]);
  });
  it('rejects an amount too small to split', () => {
    const v = validateLoanForm({ ...base, scheduleType: 'monthly', originationDate: '2026-08-06', maturityDate: '2031-08-06', amount: '0.05' }, soy);
    expect(v.valid).toBe(false);
    expect(v.errors.amount).toBeTruthy();
  });
});

describe('defaultLoanForm', () => {
  it('starts three months before the as-of date with a one-year term', () => {
    expect(defaultLoanForm('2026-11-06')).toMatchObject({ originationDate: '2026-08-06', maturityDate: '2027-08-06', amount: '' });
  });
});
