import { describe, expect, it } from 'vitest';
import { generateInstallments, installmentsTotal, nextInstallment, outstandingAt } from './schedule';
import type { Loan } from './types';
import { addMonths } from './dates';

describe('generateInstallments', () => {
  it('bullet: one installment at maturity', () => {
    expect(generateInstallments('bullet', '2026-01-10', '2027-01-10', 100_000)).toEqual([
      { dueDate: '2027-01-10', amount: 100_000 },
    ]);
  });

  it('monthly: 12 equal installments ending at maturity, sum exact', () => {
    const r = generateInstallments('monthly', '2026-01-15', '2027-01-15', 100_000);
    expect(r).toHaveLength(12);
    expect(r[0].dueDate).toBe('2026-02-15');
    expect(r[11].dueDate).toBe('2027-01-15');
    expect(installmentsTotal(r)).toBe(100_000);
  });

  it('monthly: rounding remainder goes to the last installment', () => {
    const r = generateInstallments('monthly', '2026-01-01', '2026-04-01', 100);
    expect(r.map((i) => i.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('monthly: small amounts are split in cents and never go negative', () => {
    const r = generateInstallments('monthly', '2026-08-06', '2031-08-06', 10);
    expect(r).toHaveLength(60);
    expect(r.every((i) => i.amount >= 0.16 && i.amount <= 0.17)).toBe(true);
    expect(installmentsTotal(r)).toBe(10);
  });

  it('quarterly: ends on maturity, all after origination', () => {
    const r = generateInstallments('quarterly', '2026-03-01', '2027-03-01', 40_000);
    expect(r.map((i) => i.dueDate)).toEqual(['2026-06-01', '2026-09-01', '2026-12-01', '2027-03-01']);
    expect(r.every((i) => i.amount === 10_000)).toBe(true);
  });

  it('semiannual: partial period at the start still yields installments after origination', () => {
    const r = generateInstallments('semiannual', '2026-02-01', '2027-06-30', 30_000);
    expect(r.map((i) => i.dueDate)).toEqual(['2026-06-30', '2026-12-30', '2027-06-30']);
    expect(installmentsTotal(r)).toBe(30_000);
  });

  it('month-end maturity clamps (no drift)', () => {
    expect(addMonths('2027-03-31', -1)).toBe('2027-02-28');
    const r = generateInstallments('monthly', '2026-12-31', '2027-03-31', 3000);
    expect(r.map((i) => i.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('at_harvest: uses harvest date when inside the loan term, else maturity', () => {
    expect(generateInstallments('at_harvest', '2026-10-01', '2027-06-01', 5000, { harvestDate: '2027-04-10' })).toEqual([
      { dueDate: '2027-04-10', amount: 5000 },
    ]);
    expect(generateInstallments('at_harvest', '2026-10-01', '2027-06-01', 5000)).toEqual([{ dueDate: '2027-06-01', amount: 5000 }]);
    expect(generateInstallments('at_harvest', '2026-10-01', '2027-06-01', 5000, { harvestDate: '2027-08-01' })[0].dueDate).toBe(
      '2027-06-01',
    );
  });

  it('at_harvest: a multi-year loan pays at every harvest until maturity (RT-1)', () => {
    const r = generateInstallments('at_harvest', '2025-06-01', '2029-06-01', 150000, { harvestDate: '2025-11-10' });
    expect(r.map((i) => i.dueDate)).toEqual(['2025-11-10', '2026-11-10', '2027-11-10', '2028-11-10']);
    expect(r.every((i) => i.amount === 37500)).toBe(true);
    const loan: Loan = { originationDate: '2025-06-01', maturityDate: '2029-06-01', amount: 150000, currency: 'CLP', scheduleType: 'at_harvest', installments: r };
    expect(outstandingAt(loan, '2026-11-07')).toBe(112500);
  });

  it('custom returns an empty plan', () => {
    expect(generateInstallments('custom', '2026-01-01', '2027-01-01', 1000)).toEqual([]);
  });
});

describe('outstandingAt', () => {
  const loan: Loan = {
    originationDate: '2026-01-15',
    maturityDate: '2026-07-15',
    amount: 60_000,
    currency: 'USD',
    scheduleType: 'monthly',
    installments: generateInstallments('monthly', '2026-01-15', '2026-07-15', 60_000),
  };

  it('is 0 before origination', () => {
    expect(outstandingAt(loan, '2026-01-01')).toBe(0);
  });
  it('is the full amount between origination and the first due date', () => {
    expect(outstandingAt(loan, '2026-02-01')).toBe(60_000);
  });
  it('counts installments due on or before the date as paid', () => {
    expect(outstandingAt(loan, '2026-03-15')).toBe(40_000);
  });
  it('is 0 after the last installment', () => {
    expect(outstandingAt(loan, '2026-12-31')).toBe(0);
  });
  it('treats an empty plan as a bullet at maturity', () => {
    const custom: Loan = { ...loan, scheduleType: 'custom', installments: [] };
    expect(outstandingAt(custom, '2026-06-01')).toBe(60_000);
    expect(outstandingAt(custom, '2026-07-15')).toBe(0);
  });
  it('nextInstallment returns the first one strictly after the date', () => {
    expect(nextInstallment(loan, '2026-03-15')?.dueDate).toBe('2026-04-15');
    expect(nextInstallment(loan, '2026-08-01')).toBeNull();
  });
});
