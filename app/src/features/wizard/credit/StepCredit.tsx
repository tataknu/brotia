/** Wizard step 4: one loan per farm (terms, schedule, installments). */
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Copy, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Currency, CropTemplate, Farm, Portfolio, ScheduleType } from '@/domain/types';
import { CROP_META } from '@/domain/constants';
import { todayUTC } from '@/domain/dates';
import { SCHEDULE_LABELS, installmentsTotal } from '@/domain/schedule';
import { DRAFT, useStore } from '@/state/store';
import { Badge, Button, Card, Field, Input, Modal, Select } from '@/shared/ui';
import { date, hectares, money } from '@/shared/format';
import { useTemplates } from '../common/templates';
import {
  SCHEDULE_ORDER,
  copyTerms,
  defaultLoanForm,
  farmHarvest,
  formInstallments,
  formToLoan,
  generatedRowId,
  harvestDateFor,
  loanToForm,
  normalizeLoan,
  parseAmount,
  sameLoan,
  validateLoanForm,
  withRowAdded,
  withRowEdited,
  withRowRemoved,
  withScheduleType,
  type LoanForm,
} from './loanLogic';

const SCHEDULE_OPTIONS = SCHEDULE_ORDER.map((t) => ({ value: t, label: SCHEDULE_LABELS[t] }));
const EMPTY: Farm[] = [];

const currencyPrefix = (c: Currency) => (c === 'USD' ? '$' : 'CLP');

export function StepCredit() {
  const draft = useStore((s) => s.draft);
  const setLoan = useStore((s) => s.setLoan);
  const farms = draft?.farms ?? EMPTY;
  const currency: Currency = draft?.currency ?? 'USD';
  const { byCrop } = useTemplates();
  const asOf = useMemo(() => todayUTC(), []);

  // Local form state per farm; the store only ever receives valid loans.
  const [forms, setForms] = useState<Record<string, LoanForm>>({});
  const [selectedId, setSelectedId] = useState<string | null>(() => (draft?.farms.find((f) => !f.loan) ?? draft?.farms[0])?.id ?? null);
  const [applyFrom, setApplyFrom] = useState<string | null>(null);

  const harvestOf = useMemo(() => {
    const m = new Map<string, ReturnType<typeof farmHarvest>>();
    if (draft) for (const f of draft.farms) m.set(f.id, farmHarvest(draft, byCrop[f.crop], f));
    return m;
  }, [draft, byCrop]);
  const mdOf = (f: Farm) => harvestOf.get(f.id)?.md ?? null;

  // Keep generated schedules in line with each farm's crop calendar.
  useEffect(() => {
    for (const f of farms) {
      if (!f.loan) continue;
      const next = normalizeLoan(f.loan, harvestOf.get(f.id)?.md ?? null);
      if (!sameLoan(next, f.loan)) setLoan(DRAFT, f.id, next);
    }
  }, [farms, harvestOf, setLoan]);

  const formFor = (f: Farm): LoanForm => forms[f.id] ?? (f.loan ? loanToForm(f.loan) : defaultLoanForm(asOf));

  const update = (f: Farm, next: LoanForm) => {
    setForms((prev) => ({ ...prev, [f.id]: next }));
    const loan = formToLoan(next, mdOf(f), currency);
    if (loan) {
      if (!sameLoan(loan, f.loan)) setLoan(DRAFT, f.id, loan);
    } else if (f.loan) setLoan(DRAFT, f.id, null);
  };

  const withLoan = farms.filter((f) => f.loan);
  const total = withLoan.reduce((s, f) => s + (f.loan?.amount ?? 0), 0);
  const selected = farms.find((f) => f.id === selectedId) ?? farms[0];
  const nextMissing = farms.find((f) => !f.loan && f.id !== selected?.id);

  if (!draft) return null;

  const applyTerms = (source: Farm, onlyMissing: boolean) => {
    const src = formFor(source);
    const targets = farms.filter((f) => f.id !== source.id && (!onlyMissing || !f.loan));
    const nextForms: Record<string, LoanForm> = {};
    for (const f of targets) {
      const form = copyTerms(src);
      nextForms[f.id] = form;
      const loan = formToLoan(form, mdOf(f), currency);
      if (loan) setLoan(DRAFT, f.id, loan);
    }
    setForms((prev) => ({ ...prev, ...nextForms }));
    setApplyFrom(null);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Credit</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Enter the loan on each farm: when it was disbursed, when it matures, how much, and how it is repaid. The outstanding balance is the money exposed
          to climate stress, and installments that fall due during a stress period are flagged.
        </p>
      </div>

      <div className="grid gap-3 rounded-card border border-line bg-white p-4 shadow-panel sm:grid-cols-3">
        <SummaryItem label="Farms with a loan" value={`${withLoan.length} of ${farms.length}`} tone={withLoan.length === farms.length && farms.length > 0 ? 'brand' : 'warn'} />
        <SummaryItem label="Total lent" value={money(total, currency)} />
        <SummaryItem label="Still missing" value={farms.length - withLoan.length === 0 ? 'None' : `${farms.length - withLoan.length} ${farms.length - withLoan.length === 1 ? 'farm' : 'farms'}`} />
      </div>

      {farms.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No farms yet. Go back to Farms to add them.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <nav aria-label="Farms" className="flex flex-col gap-1.5">
            {farms.map((f) => {
              const touchedInvalid = !f.loan && forms[f.id] !== undefined;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  aria-current={f.id === selected?.id ? 'true' : undefined}
                  className={clsx(
                    'flex items-center justify-between gap-3 rounded-card border px-3 py-2.5 text-left transition-colors',
                    f.id === selected?.id ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:bg-surface',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{f.name}</span>
                    <span className="block text-xs text-muted">
                      {CROP_META[f.crop].label} · {hectares(f.areaHa)}
                    </span>
                  </span>
                  {f.loan ? (
                    <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-ink">
                      <CheckCircle2 size={16} className="text-brand" />
                      {money(f.loan.amount, currency, { compact: true })}
                    </span>
                  ) : touchedInvalid ? (
                    <Badge tone="warn">Incomplete</Badge>
                  ) : (
                    <Badge>No loan</Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {selected && (
            <LoanEditor
              key={selected.id}
              farm={selected}
              portfolio={draft}
              template={byCrop[selected.crop]}
              harvest={harvestOf.get(selected.id) ?? { md: null, from: 'default' }}
              form={formFor(selected)}
              currency={currency}
              onChange={(next) => update(selected, next)}
              onClear={() => {
                setForms((prev) => {
                  const next = { ...prev };
                  delete next[selected.id];
                  return next;
                });
                setLoan(DRAFT, selected.id, null);
              }}
              onApplyAll={farms.length > 1 ? () => setApplyFrom(selected.id) : undefined}
              onNext={nextMissing ? () => setSelectedId(nextMissing.id) : undefined}
              nextLabel={nextMissing?.name}
            />
          )}
        </div>
      )}

      {applyFrom &&
        (() => {
          const source = farms.find((f) => f.id === applyFrom);
          if (!source) return null;
          const src = formFor(source);
          const others = farms.filter((f) => f.id !== source.id);
          const missing = others.filter((f) => !f.loan);
          return (
            <Modal
              title="Copy these terms to other farms?"
              onClose={() => setApplyFrom(null)}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setApplyFrom(null)}>
                    Cancel
                  </Button>
                  {missing.length > 0 && missing.length < others.length && (
                    <Button variant="secondary" onClick={() => applyTerms(source, true)}>
                      Only farms without a loan ({missing.length})
                    </Button>
                  )}
                  <Button onClick={() => applyTerms(source, false)}>All other farms ({others.length})</Button>
                </>
              }
            >
              <div className="space-y-3 text-sm text-muted">
                <p>
                  {source.name}'s terms will be copied: {money(parseAmount(src.amount) ?? 0, currency)}, {date(src.originationDate)} to {date(src.maturityDate)},{' '}
                  {SCHEDULE_LABELS[src.scheduleType].toLowerCase()}.
                </p>
                {src.scheduleType === 'at_harvest' && <p>Harvest dates are recalculated from each farm's own crop calendar.</p>}
                {others.length - missing.length > 0 && (
                  <p className="text-warn">
                    {others.length - missing.length === 1 ? '1 farm already has a loan' : `${others.length - missing.length} farms already have a loan`}; choosing all
                    other farms replaces it.
                  </p>
                )}
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: 'brand' | 'warn' }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx('mt-0.5 text-lg font-semibold tabular-nums', tone === 'brand' ? 'text-brand-ink' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</p>
    </div>
  );
}

function harvestHint(
  farm: Farm,
  harvest: { md: string | null; from: 'template' | 'default' },
  harvestDate: string | undefined,
  template: CropTemplate | undefined,
  payments: number,
): string {
  const crop = CROP_META[farm.crop].label;
  if (!harvest.md) return `${crop} has no single harvest stage in its template, so the payment falls on the maturity date.`;
  if (!harvestDate) return 'One payment at each expected harvest.';
  const src = harvest.from === 'template' ? `start of the ${template?.stages.find((s) => s.start === harvest.md)?.label.toLowerCase() ?? 'harvest'} stage` : 'typical harvest start';
  if (payments > 1) return `One equal payment at each harvest until maturity (${payments} payments), the first on ${date(harvestDate)} (${src}, approximate).`;
  return `One payment at the expected harvest, ${date(harvestDate)} (${src}, approximate).`;
}

function LoanEditor({
  farm,
  template,
  harvest,
  form,
  currency,
  onChange,
  onClear,
  onApplyAll,
  onNext,
  nextLabel,
}: {
  farm: Farm;
  portfolio: Portfolio;
  template: CropTemplate | undefined;
  harvest: { md: string | null; from: 'template' | 'default' };
  form: LoanForm;
  currency: Currency;
  onChange: (f: LoanForm) => void;
  onClear: () => void;
  onApplyAll?: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  const md = harvest.md;
  const prefix = currencyPrefix(currency);
  const v = validateLoanForm(form, md, `${prefix}${currency === 'USD' ? '' : ' '}`);
  const rows =
    form.scheduleType === 'custom' ? form.rows : formInstallments(form, md).map((i) => ({ id: generatedRowId(i.dueDate), dueDate: i.dueDate, amount: String(i.amount) }));
  const plan = formInstallments(form, md);
  const planTotal = installmentsTotal(plan);
  const amount = parseAmount(form.amount);
  const harvestDate = harvestDateFor(md, form.originationDate);
  const harvestOutside = form.scheduleType === 'at_harvest' && harvestDate && v.valid && !(harvestDate > form.originationDate && harvestDate <= form.maturityDate);
  const today = todayUTC();
  // RT-1: an unmatured loan whose whole plan is already due has zero exposure: say so instead of hiding it
  const allDueBeforeToday = v.valid && plan.length > 0 && form.maturityDate > today && plan.every((i) => i.dueDate <= today);

  return (
    <Card
      title={farm.name}
      subtitle={`${CROP_META[farm.crop].label} · ${hectares(farm.areaHa)}${farm.plantingYear ? ` · planted ${farm.plantingYear}` : ''}`}
      actions={
        <>
          {onApplyAll && (
            <Button variant="secondary" size="sm" icon={<Copy size={16} />} disabled={!v.valid} title={v.valid ? undefined : 'Complete this loan first'} onClick={onApplyAll}>
              Apply to all farms
            </Button>
          )}
          {farm.loan && (
            <Button variant="ghost" size="sm" icon={<X size={16} />} onClick={onClear}>
              Clear
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Origination date" error={v.errors.originationDate} hint="When the money was disbursed.">
          {(id) => <Input id={id} type="date" value={form.originationDate} invalid={!!v.errors.originationDate} onChange={(e) => onChange({ ...form, originationDate: e.target.value })} />}
        </Field>
        <Field label="Maturity date" error={v.errors.maturityDate} hint="When the last payment is due.">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={form.maturityDate}
              min={form.originationDate || undefined}
              invalid={!!v.errors.maturityDate}
              onChange={(e) => onChange({ ...form, maturityDate: e.target.value })}
            />
          )}
        </Field>
        <Field label={`Amount (${currency})`} error={v.errors.amount} hint="Principal lent on this farm.">
          {(id) => (
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{prefix}</span>
              <Input
                id={id}
                inputMode="decimal"
                placeholder={currency === 'USD' ? 'e.g. 150,000' : 'e.g. 120,000,000'}
                value={form.amount}
                invalid={!!v.errors.amount}
                className={clsx('tabular-nums', currency === 'USD' ? 'pl-7' : 'pl-12')}
                onChange={(e) => onChange({ ...form, amount: e.target.value })}
              />
            </div>
          )}
        </Field>
        <Field
          label="Payment schedule"
          hint={
            form.scheduleType === 'at_harvest'
              ? harvestHint(farm, harvest, harvestDate, template, plan.length)
              : form.scheduleType === 'custom'
                ? 'Enter each installment below.'
                : 'Equal principal installments, the last one on the maturity date.'
          }
        >
          {(id) => <Select id={id} options={SCHEDULE_OPTIONS} value={form.scheduleType} onChange={(e) => onChange(withScheduleType(form, e.target.value as ScheduleType, md))} />}
        </Field>
      </div>

      {allDueBeforeToday && (
        <p className="mt-3 flex items-start gap-2 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Every installment of this plan is already due, so the loan shows nothing outstanding today although it matures on {date(form.maturityDate)}. If it is still being repaid, enter the remaining installments with a custom schedule.
        </p>
      )}

      {harvestOutside && (
        <p className="mt-3 flex items-start gap-2 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          The expected harvest ({date(harvestDate)}) falls outside the loan term, so the payment is set on the maturity date.
        </p>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <CalendarClock size={16} className="text-muted" />
              Installments
            </p>
            {form.scheduleType !== 'custom' && rows.length > 0 && <p className="mt-0.5 text-xs text-muted">Editing a row switches this loan to a custom schedule.</p>}
          </div>
          <Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => onChange(withRowAdded(form, md))}>
            Add installment
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className={clsx('mt-3 rounded-card border border-dashed px-4 py-5 text-center text-sm', v.errors.rows ? 'border-danger text-danger' : 'border-line text-muted')}>
            {form.scheduleType === 'custom' ? (v.errors.rows ?? 'No installments yet.') : 'Installments appear once the dates and amount are filled in.'}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="w-12 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Due date</th>
                  <th className="px-3 py-2 text-right font-medium">Amount ({currency})</th>
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const err = form.scheduleType === 'custom' ? v.rowErrors[i] : null;
                  return (
                    <tr key={r.id ?? `idx-${i}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5 tabular-nums text-muted">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <Input
                          type="date"
                          aria-label={`Installment ${i + 1} due date`}
                          value={r.dueDate}
                          invalid={!!err && !err.startsWith('Enter an amount')}
                          onChange={(e) => onChange(withRowEdited(form, i, { dueDate: e.target.value }, md))}
                        />
                        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          inputMode="decimal"
                          aria-label={`Installment ${i + 1} amount`}
                          value={r.amount}
                          invalid={!!err && err.startsWith('Enter an amount')}
                          className="text-right tabular-nums"
                          onChange={(e) => onChange(withRowEdited(form, i, { amount: e.target.value }, md))}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button variant="ghost" size="sm" aria-label={`Remove installment ${i + 1}`} onClick={() => onChange(withRowRemoved(form, i, md))}>
                          <Trash2 size={16} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 font-medium text-ink">Total</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{money(planTotal, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {v.warnings.map((w) => (
          <p key={w} className="mt-3 flex items-start gap-2 rounded-card bg-warn-soft px-3 py-2 text-sm text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {w}
          </p>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className={clsx('flex items-center gap-2 text-sm', v.valid ? 'text-brand-ink' : 'text-muted')}>
          {v.valid ? (
            <>
              <CheckCircle2 size={16} />
              Saved: {money(amount ?? 0, currency)} over {plan.length === 1 ? '1 installment' : `${plan.length} installments`}.
            </>
          ) : (
            'Complete the dates and amount to save this loan.'
          )}
        </p>
        {onNext && (
          <Button variant="secondary" size="sm" onClick={onNext}>
            Next without a loan: {nextLabel}
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </Card>
  );
}

export default StepCredit;
