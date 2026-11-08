/** Wizard step 1: portfolio name, lender and default currency. */
import { useEffect, useRef } from 'react';
import { Banknote, Layers, Map as MapIcon, ShieldCheck, Wallet } from 'lucide-react';
import type { Currency } from '@/domain/types';
import { useStore } from '@/state/store';
import { Card, Field, Input, Select } from '@/shared/ui';

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'USD', label: 'USD, US dollar' },
  { value: 'BOB', label: 'BOB, Bolivian boliviano' },
];

const NEXT_STEPS = [
  { icon: MapIcon, title: 'Farms', text: 'Draw each field on a satellite map and pick its crop.' },
  { icon: Layers, title: 'Zones and baselines', text: 'Group farms and set the thresholds that define each field’s normal.' },
  { icon: Wallet, title: 'Credit', text: 'Add the loan on each farm: dates, amount and payment schedule.' },
  { icon: ShieldCheck, title: 'Review', text: 'Check everything, then open the portfolio dashboard.' },
];

export function StepPortfolio() {
  const draft = useStore((s) => s.draft);
  const updateDraft = useStore((s) => s.updateDraft);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft && !draft.name) nameRef.current?.focus();
    // Focus only when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!draft) return null;
  const loanCount = draft.farms.filter((f) => f.loan).length;
  const loansWithOtherCurrency = draft.farms.filter((f) => f.loan && f.loan.currency !== draft.currency).length;
  // Amounts are never converted, so the currency is fixed once loans exist (avoids silently relabelling them).
  const currencyLocked = loanCount > 0 && loansWithOtherCurrency === 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Portfolio details" subtitle="Name the loan book you want to monitor and who holds it.">
          <div className="flex flex-col gap-5">
            <Field label="Portfolio name" hint="Required. Shown on the dashboard and in the portfolio list.">
              {(id) => (
                <Input
                  id={id}
                  ref={nameRef}
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  placeholder="e.g. Soy belt 2026/27"
                />
              )}
            </Field>
            <Field label="Lender" hint="The bank, cooperative or fund that holds these loans.">
              {(id) => (
                <Input
                  id={id}
                  value={draft.lender}
                  maxLength={80}
                  onChange={(e) => updateDraft({ lender: e.target.value })}
                  placeholder="e.g. Eastern Lowlands Farm Credit"
                />
              )}
            </Field>
            <Field
              label="Currency"
              hint={
                loansWithOtherCurrency > 0
                  ? `${loansWithOtherCurrency} ${loansWithOtherCurrency === 1 ? 'loan uses' : 'loans use'} a different currency. Amounts are not converted; re-enter those loans in the Credit step.`
                  : currencyLocked
                    ? `Fixed because ${loanCount === 1 ? '1 loan has' : `${loanCount} loans have`} been entered in this currency. Amounts are not converted; remove the loans in the Credit step to change it.`
                    : 'Currency for the loans and the portfolio totals.'
              }
            >
              {(id) => (
                <Select
                  id={id}
                  className="sm:max-w-xs"
                  options={CURRENCY_OPTIONS}
                  value={draft.currency}
                  disabled={currencyLocked}
                  onChange={(e) => updateDraft({ currency: e.target.value as Currency })}
                />
              )}
            </Field>
          </div>
        </Card>

        <aside className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-ink">
            <Banknote size={18} className="text-brand" />
            <h3 className="text-base font-semibold">What happens next</h3>
          </div>
          <ol className="mt-4 flex flex-col gap-4">
            {NEXT_STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-muted ring-1 ring-line">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {i + 2}. {title}
                  </p>
                  <p className="text-sm text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm text-muted">
            Satellite and weather data in this version are simulated, so you can explore the full flow right away.
          </p>
        </aside>
      </div>
    </div>
  );
}

export default StepPortfolio;
