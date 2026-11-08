/** Pure checks and totals for the Review step (no React; tested in node). */
import type { Portfolio, ScheduleType } from '@/domain/types';
import { installmentsTotal, outstandingAt } from '@/domain/schedule';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface ReviewIssue {
  level: IssueLevel;
  text: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const names = (list: { name: string }[]) => {
  const shown = list.slice(0, 3).map((f) => f.name);
  return list.length > 3 ? `${shown.join(', ')} and ${list.length - 3} more` : shown.join(', ');
};

/** Everything worth flagging before the portfolio is created, most serious first. */
export function reviewIssues(d: Portfolio, asOf: string): ReviewIssue[] {
  const out: ReviewIssue[] = [];
  const zoneIds = new Set(d.zones.map((z) => z.id));

  if (!d.name.trim()) out.push({ level: 'error', text: 'The portfolio has no name.' });
  if (d.farms.length === 0) out.push({ level: 'error', text: 'Add at least one farm.' });
  if (d.zones.length === 0) out.push({ level: 'error', text: 'Add at least one zone.' });

  const noLoan = d.farms.filter((f) => !f.loan);
  if (noLoan.length) out.push({ level: 'error', text: `${names(noLoan)} ${plural(noLoan.length, 'has', 'have')} no loan.` });

  const noZone = d.farms.filter((f) => !zoneIds.has(f.zoneId));
  if (noZone.length) out.push({ level: 'error', text: `${names(noZone)} ${plural(noZone.length, 'is', 'are')} not assigned to a zone.` });

  const badDates = d.farms.filter((f) => f.loan && f.loan.maturityDate <= f.loan.originationDate);
  if (badDates.length) out.push({ level: 'error', text: `${names(badDates)}: maturity must be after origination.` });

  const mismatch = d.farms.filter((f) => f.loan && f.loan.installments.length > 0 && Math.abs(installmentsTotal(f.loan.installments) - f.loan.amount) >= 0.01);
  if (mismatch.length) out.push({ level: 'warning', text: `${names(mismatch)}: installments do not add up to the loan amount.` });

  const emptyPlan = d.farms.filter((f) => f.loan && f.loan.installments.length === 0);
  if (emptyPlan.length) out.push({ level: 'warning', text: `${names(emptyPlan)} ${plural(emptyPlan.length, 'has', 'have')} no installments; treated as one payment at maturity.` });

  const currency = d.farms.filter((f) => f.loan && f.loan.currency !== d.currency);
  if (currency.length) out.push({ level: 'warning', text: `${names(currency)}: loan currency differs from the portfolio (${d.currency}).` });

  if (!d.lender.trim()) out.push({ level: 'info', text: 'No lender name entered.' });

  const repaid = d.farms.filter((f) => f.loan && outstandingAt(f.loan, asOf) === 0 && f.loan.originationDate <= asOf);
  if (repaid.length) out.push({ level: 'info', text: `${names(repaid)} ${plural(repaid.length, 'is', 'are')} fully repaid by today, so ${plural(repaid.length, 'it adds', 'they add')} no exposure.` });

  const future = d.farms.filter((f) => f.loan && f.loan.originationDate > asOf);
  if (future.length) out.push({ level: 'info', text: `${names(future)}: origination is after today, so there is no exposure yet.` });

  const noSow = d.farms.filter((f) => !f.sowingDate);
  if (noSow.length) out.push({ level: 'info', text: `${noSow.length} ${plural(noSow.length, 'farm has', 'farms have')} no sowing date; the typical date for the crop is used.` });

  const emptyZones = d.zones.filter((z) => !d.farms.some((f) => f.zoneId === z.id));
  if (emptyZones.length && d.farms.length) out.push({ level: 'info', text: `${names(emptyZones)} ${plural(emptyZones.length, 'has', 'have')} no farms.` });

  return out;
}

export interface LoanTotals {
  count: number;
  total: number;
  outstanding: number;
  installments: number;
  bySchedule: { type: ScheduleType; count: number; amount: number }[];
  earliestOrigination: string | null;
  latestMaturity: string | null;
}

export function loanTotals(d: Portfolio, asOf: string): LoanTotals {
  const loans = d.farms.flatMap((f) => (f.loan ? [f.loan] : []));
  const by = new Map<ScheduleType, { count: number; amount: number }>();
  for (const l of loans) {
    const cur = by.get(l.scheduleType) ?? { count: 0, amount: 0 };
    by.set(l.scheduleType, { count: cur.count + 1, amount: cur.amount + l.amount });
  }
  const origs = loans.map((l) => l.originationDate).sort();
  const mats = loans.map((l) => l.maturityDate).sort();
  return {
    count: loans.length,
    total: loans.reduce((s, l) => s + l.amount, 0),
    outstanding: loans.reduce((s, l) => s + outstandingAt(l, asOf), 0),
    installments: loans.reduce((s, l) => s + Math.max(1, l.installments.length), 0),
    bySchedule: [...by.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.amount - a.amount),
    earliestOrigination: origs[0] ?? null,
    latestMaturity: mats[mats.length - 1] ?? null,
  };
}
