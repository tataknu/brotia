import type { Installment, Loan, ScheduleType } from './types';
import { addMonths } from './dates';

export const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  bullet: 'Bullet (single payment at maturity)',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Every 6 months',
  at_harvest: 'At harvest',
  custom: 'Custom',
};

const STEP_MONTHS: Partial<Record<ScheduleType, number>> = { monthly: 1, quarterly: 3, semiannual: 6 };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Generates an installment plan.
 * - bullet: one installment at maturity.
 * - monthly / quarterly / semiannual: equal principal installments, stepping back from maturity
 *   (the last one falls on maturity; every due date is after origination). Rounded to cents; the
 *   rounding remainder goes into the final installment so the sum equals `amount` exactly.
 * - at_harvest: one equal installment per yearly harvest, from opts.harvestDate (the first harvest after
 *   origination) up to maturity; with no harvest inside the term, one installment at maturity.
 * - custom: [] (the user enters installments).
 */
export function generateInstallments(
  type: ScheduleType,
  originationDate: string,
  maturityDate: string,
  amount: number,
  opts?: { harvestDate?: string },
): Installment[] {
  const total = round2(amount);
  switch (type) {
    case 'custom':
      return [];
    case 'bullet':
      return [{ dueDate: maturityDate, amount: total }];
    case 'at_harvest': {
      // One equal installment per harvest from the first harvest after origination up to maturity (a
      // multi-year loan repays every season, not all at the first harvest). No harvest inside the term → maturity.
      const h = opts?.harvestDate;
      if (!h || !(h > originationDate && h <= maturityDate)) return [{ dueDate: maturityDate, amount: total }];
      const dates: string[] = [];
      for (let i = 0; i < 100; i++) {
        const d = addMonths(h, 12 * i);
        if (d > maturityDate) break;
        dates.push(d);
      }
      return splitEqual(dates, total);
    }
    default: {
      const step = STEP_MONTHS[type] ?? 1;
      const dates: string[] = [];
      for (let i = 0; i < 600; i++) {
        const d = addMonths(maturityDate, -i * step);
        if (d <= originationDate) break;
        dates.push(d);
      }
      if (dates.length === 0) return [{ dueDate: maturityDate, amount: total }];
      dates.reverse();
      return splitEqual(dates, total);
    }
  }
}

/** Split in whole cents: every installment gets the floor share and the leftover cents go to the
 * last installments (one cent each), so amounts are never negative and the sum is exact. */
function splitEqual(dates: string[], total: number): Installment[] {
  const n = dates.length;
  const cents = Math.round(total * 100);
  const baseCents = Math.floor(cents / n);
  const rem = cents - baseCents * n;
  return dates.map((dueDate, i) => ({ dueDate, amount: round2((baseCents + (i >= n - rem ? 1 : 0)) / 100) }));
}

/** Sum of installment amounts. */
export function installmentsTotal(installments: Installment[]): number {
  return round2(installments.reduce((s, i) => s + i.amount, 0));
}

/**
 * Outstanding principal at `dateISO`.
 * - 0 before origination (not yet disbursed).
 * - Installments with dueDate <= dateISO are treated as paid.
 * - If the loan has no installments (e.g. custom, not yet entered) it behaves like a bullet at maturity.
 * Never negative.
 */
export function outstandingAt(loan: Loan, dateISO: string): number {
  if (dateISO < loan.originationDate) return 0;
  const plan = loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }];
  const paid = plan.filter((i) => i.dueDate <= dateISO).reduce((s, i) => s + i.amount, 0);
  return Math.max(0, round2(loan.amount - paid));
}

/** Next installment strictly after `dateISO`, or null. */
export function nextInstallment(loan: Loan, dateISO: string): Installment | null {
  // Same plan as outstandingAt (CONTRACT §E.8): an empty plan behaves like a bullet at maturity.
  const plan = loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }];
  const sorted = [...plan].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return sorted.find((i) => i.dueDate > dateISO) ?? null;
}
