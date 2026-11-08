/**
 * Pure loan-form logic for the Credit step (no React, no DOM; tested in node).
 *
 * The form keeps raw strings so half-typed values never reach the store. A loan is written to the
 * store only when the form is valid (see `formToLoan`), so the wizard's "every farm has a loan" gate
 * stays truthful.
 */
import type { Currency, Farm, Installment, Loan, ScheduleType } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { addDays, addMonths } from '@/domain/dates';
import { newId } from '@/state/ids';
import { generateInstallments, installmentsTotal } from '@/domain/schedule';

export interface RowForm {
  /** Stable React key; rows can be removed from the middle of the list. */
  id?: string;
  dueDate: string;
  amount: string;
}

/** Key for a row generated from a schedule. Seeded custom rows reuse it so inputs keep focus on the switch to custom. */
export function generatedRowId(dueDate: string): string {
  return `gen-${dueDate}`;
}

export interface LoanForm {
  originationDate: string;
  maturityDate: string;
  amount: string;
  scheduleType: ScheduleType;
  /** Only used when scheduleType is 'custom'. */
  rows: RowForm[];
}

export type LoanFieldErrors = Partial<Record<'originationDate' | 'maturityDate' | 'amount' | 'rows', string>>;

export interface LoanValidation {
  valid: boolean;
  errors: LoanFieldErrors;
  /** Per custom row: an error message or null. */
  rowErrors: (string | null)[];
  /** Non-blocking notices (e.g. installments do not add up to the amount). */
  warnings: string[];
}

export const SCHEDULE_ORDER: ScheduleType[] = ['at_harvest', 'bullet', 'monthly', 'quarterly', 'semiannual', 'custom'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: string | undefined | null): s is string {
  if (!s || !ISO_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Parses a user-typed amount ("12,500.50" is fine). Returns null when empty or not a finite number. */
export function parseAmount(s: string): number | null {
  const clean = s.replace(/[,\s]/g, '');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Expected harvest date for a farm, used by the 'at_harvest' schedule.
 * - With a sowing date: sowingDate + crop season length.
 * - Without one: the crop's typical sowing day; picks the earliest harvest strictly after origination
 *   among the seasons starting in the origination year -1, 0, +1.
 */
export function harvestDateFor(farm: Pick<Farm, 'crop' | 'sowingDate'>, originationDate: string): string | undefined {
  const crop = CROPS[farm.crop];
  if (!crop) return undefined;
  if (isISODate(farm.sowingDate)) return addDays(farm.sowingDate, crop.seasonDays);
  if (!isISODate(originationDate)) return undefined;
  const y = Number(originationDate.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    const harvest = addDays(`${year}-${crop.typicalSowMonthDay}`, crop.seasonDays);
    if (harvest > originationDate) return harvest;
  }
  return undefined;
}

/** Default (unsaved) form for a farm without a loan. Amount is left empty on purpose. */
export function defaultLoanForm(asOf: string): LoanForm {
  const originationDate = addMonths(asOf, -3);
  return { originationDate, maturityDate: addMonths(originationDate, 12), amount: '', scheduleType: 'at_harvest', rows: [] };
}

export function loanToForm(loan: Loan): LoanForm {
  return {
    originationDate: loan.originationDate,
    maturityDate: loan.maturityDate,
    amount: String(loan.amount),
    scheduleType: loan.scheduleType,
    rows: loan.scheduleType === 'custom' ? loan.installments.map((i, k) => ({ id: `saved-${k}`, dueDate: i.dueDate, amount: String(i.amount) })) : [],
  };
}

/** Installments the form currently describes (generated, or parsed custom rows). Invalid rows are skipped. */
export function formInstallments(form: LoanForm, farm: Pick<Farm, 'crop' | 'sowingDate'>): Installment[] {
  if (form.scheduleType === 'custom') {
    return form.rows
      .map((r) => ({ dueDate: r.dueDate, amount: parseAmount(r.amount) }))
      .filter((r): r is Installment => isISODate(r.dueDate) && r.amount !== null && r.amount > 0)
      .map((r) => ({ dueDate: r.dueDate, amount: round2(r.amount) }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
  const amount = parseAmount(form.amount);
  if (!isISODate(form.originationDate) || !isISODate(form.maturityDate) || amount === null || amount <= 0) return [];
  if (form.maturityDate <= form.originationDate) return [];
  return generateInstallments(form.scheduleType, form.originationDate, form.maturityDate, amount, {
    harvestDate: harvestDateFor(farm, form.originationDate),
  });
}

export function validateLoanForm(form: LoanForm, farm: Pick<Farm, 'crop' | 'sowingDate'>, currencyLabel = ''): LoanValidation {
  const errors: LoanFieldErrors = {};
  const warnings: string[] = [];
  if (!isISODate(form.originationDate)) errors.originationDate = 'Enter the origination date.';
  if (!isISODate(form.maturityDate)) errors.maturityDate = 'Enter the maturity date.';
  else if (isISODate(form.originationDate) && form.maturityDate <= form.originationDate) errors.maturityDate = 'Maturity must be after origination.';
  const amount = parseAmount(form.amount);
  if (amount === null) errors.amount = 'Enter the loan amount.';
  else if (amount <= 0) errors.amount = 'The amount must be greater than zero.';

  const rowErrors: (string | null)[] = [];
  if (form.scheduleType === 'custom') {
    const datesOk = !errors.originationDate && !errors.maturityDate;
    for (const r of form.rows) {
      const a = parseAmount(r.amount);
      if (!isISODate(r.dueDate)) rowErrors.push('Enter a due date.');
      else if (a === null || a <= 0) rowErrors.push('Enter an amount above zero.');
      else if (datesOk && (r.dueDate <= form.originationDate || r.dueDate > form.maturityDate)) rowErrors.push('Due date should fall between origination and maturity.');
      else rowErrors.push(null);
    }
    if (form.rows.length === 0) errors.rows = 'Add at least one installment.';
    else if (rowErrors.some((e) => e && !e.startsWith('Due date should'))) errors.rows = 'Fix the highlighted installments.';
    else if (rowErrors.some((e) => e)) warnings.push('Some installments fall outside the loan term.');
  }

  if (amount !== null && amount > 0) {
    const plan = formInstallments(form, farm);
    if (form.scheduleType !== 'custom' && plan.some((i) => i.amount <= 0)) {
      errors.amount = 'The amount is too small to split into this many installments.';
    }
    if (plan.length > 0) {
      const total = installmentsTotal(plan);
      const diff = round2(total - amount);
      if (Math.abs(diff) >= 0.01) {
        const sign = diff > 0 ? 'more' : 'less';
        warnings.push(`Installments add up to ${currencyLabel}${fmt(total)}, ${currencyLabel}${fmt(Math.abs(diff))} ${sign} than the loan amount.`);
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, rowErrors, warnings };
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/** The loan the form describes, or null when the form is not valid yet. */
export function formToLoan(form: LoanForm, farm: Pick<Farm, 'crop' | 'sowingDate'>, currency: Currency): Loan | null {
  if (!validateLoanForm(form, farm).valid) return null;
  return {
    originationDate: form.originationDate,
    maturityDate: form.maturityDate,
    amount: round2(parseAmount(form.amount) as number),
    currency,
    scheduleType: form.scheduleType,
    installments: formInstallments(form, farm),
  };
}

/** Changes the schedule type; switching to custom seeds the rows from the current generated plan. */
export function withScheduleType(form: LoanForm, type: ScheduleType, farm: Pick<Farm, 'crop' | 'sowingDate'>): LoanForm {
  if (type === form.scheduleType) return form;
  if (type === 'custom') {
    const seed = formInstallments(form, farm).map((i) => ({ id: generatedRowId(i.dueDate), dueDate: i.dueDate, amount: String(i.amount) }));
    return { ...form, scheduleType: 'custom', rows: form.rows.length ? form.rows : seed };
  }
  return { ...form, scheduleType: type, rows: [] };
}

/**
 * Edits one installment row. On a generated schedule the plan is first converted to custom (rows
 * copied), so later term changes never silently overwrite the user's edits.
 */
export function withRowEdited(form: LoanForm, index: number, patch: Partial<RowForm>, farm: Pick<Farm, 'crop' | 'sowingDate'>): LoanForm {
  const base = form.scheduleType === 'custom' ? form : withScheduleType({ ...form, rows: [] }, 'custom', farm);
  return { ...base, rows: base.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) };
}

export function withRowAdded(form: LoanForm, farm: Pick<Farm, 'crop' | 'sowingDate'>): LoanForm {
  const base = form.scheduleType === 'custom' ? form : withScheduleType({ ...form, rows: [] }, 'custom', farm);
  const amount = parseAmount(base.amount) ?? 0;
  const plan = formInstallments(base, farm);
  const remaining = round2(amount - installmentsTotal(plan));
  const last = base.rows[base.rows.length - 1]?.dueDate;
  const due = isISODate(last) ? addMonths(last, 1) : isISODate(base.maturityDate) ? base.maturityDate : '';
  return { ...base, rows: [...base.rows, { id: newId('row'), dueDate: due, amount: remaining > 0 ? String(remaining) : '' }] };
}

export function withRowRemoved(form: LoanForm, index: number, farm: Pick<Farm, 'crop' | 'sowingDate'>): LoanForm {
  const base = form.scheduleType === 'custom' ? form : withScheduleType({ ...form, rows: [] }, 'custom', farm);
  return { ...base, rows: base.rows.filter((_, i) => i !== index) };
}

/** Copies the terms of one form to another farm (installments are regenerated for that farm's crop calendar). */
export function copyTerms(source: LoanForm): LoanForm {
  return { ...source, rows: source.rows.map((r) => ({ ...r })) };
}

/**
 * Brings a stored loan in line with the farm's crop calendar (generated schedules are recomputed,
 * e.g. after the crop or sowing date changed). Custom plans are kept. The loan keeps its own currency:
 * amounts are never relabelled without conversion (the portfolio currency is locked once loans exist).
 */
export function normalizeLoan(loan: Loan, farm: Pick<Farm, 'crop' | 'sowingDate'>): Loan {
  const installments =
    loan.scheduleType === 'custom' || loan.maturityDate <= loan.originationDate
      ? loan.installments
      : generateInstallments(loan.scheduleType, loan.originationDate, loan.maturityDate, loan.amount, {
          harvestDate: harvestDateFor(farm, loan.originationDate),
        });
  return { ...loan, installments };
}

export function sameLoan(a: Loan | undefined, b: Loan | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
