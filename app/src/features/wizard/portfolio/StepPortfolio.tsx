/** Wizard step 1: portfolio name, lender, country and currency. */
import { useEffect, useMemo, useRef } from 'react';
import { Banknote, Layers, Map as MapIcon, ShieldCheck, Wallet } from 'lucide-react';
import { COUNTRIES_FALLBACK } from '@/domain/constants';
import type { Currency } from '@/domain/types';
import { useCountries } from '@/data/hooks';
import { DRAFT, useStore } from '@/state/store';
import { Card, CountrySelect, DataTierPill, Field, Input, Select } from '@/shared/ui';
import { countryHint, currencyAfterCountryChange, currencyOptions } from './portfolioLogic';

const NEXT_STEPS = [
  { icon: MapIcon, title: 'Farms', text: 'Pick orchards from the CIREN fruit cadastre or draw them on a satellite map.' },
  { icon: Layers, title: 'Zones and rules', text: 'Each farm gets a 35 km² zone. Group farms into shared zones and adjust crop rules if you need to.' },
  { icon: Wallet, title: 'Credit', text: 'Add the loan on each farm: dates, amount and repayment schedule.' },
  { icon: ShieldCheck, title: 'Review', text: 'Check everything, then open the portfolio dashboard.' },
];

export function StepPortfolio() {
  const draft = useStore((s) => s.draft);
  const updateMeta = useStore((s) => s.updateMeta);
  const nameRef = useRef<HTMLInputElement>(null);
  const { data } = useCountries();
  const countries = data ?? COUNTRIES_FALLBACK;
  const country = useMemo(() => countries.find((c) => c.code === draft?.country), [countries, draft?.country]);
  const options = useMemo(() => currencyOptions(country, draft?.currency), [country, draft?.currency]);

  useEffect(() => {
    if (draft && !draft.name) nameRef.current?.focus();
    // Focus only when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!draft) return null;
  const loanCount = draft.farms.filter((f) => f.loan).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Portfolio details" subtitle="Name the loan book you want to monitor, who holds it and where the orchards are.">
          <div className="flex flex-col gap-5">
            <Field label="Portfolio name" hint="Required. Shown on the dashboard and in the portfolio list.">
              {(id) => (
                <Input
                  id={id}
                  ref={nameRef}
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => updateMeta(DRAFT, { name: e.target.value })}
                  placeholder="e.g. Central Chile orchards 2026/27"
                />
              )}
            </Field>
            <Field label="Lender" hint="The bank, cooperative or fund that holds these loans.">
              {(id) => (
                <Input
                  id={id}
                  value={draft.lender}
                  maxLength={80}
                  onChange={(e) => updateMeta(DRAFT, { lender: e.target.value })}
                  placeholder="e.g. Banco del Valle, agricultural credit"
                />
              )}
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Country {country && <DataTierPill tier={country.dataTier} />}
                </span>
              }
              hint={countryHint(country)}
            >
              {(id) => (
                <CountrySelect
                  id={id}
                  className="sm:max-w-xs"
                  value={draft.country}
                  onChange={(code, c) => updateMeta(DRAFT, { country: code, currency: loanCount > 0 ? draft.currency : currencyAfterCountryChange(draft.currency, c) })}
                />
              )}
            </Field>
            <Field
              label="Currency"
              hint={
                loanCount > 0
                  ? `Amounts are not converted: changing the currency relabels the ${loanCount === 1 ? 'loan' : `${loanCount} loans`} already entered.`
                  : draft.country === 'CL'
                    ? 'Currency for the loans and the portfolio totals. Amounts are never converted.'
                    : 'Currency for the loans and the portfolio totals. Local currencies outside Chile come later; use USD for now.'
              }
            >
              {(id) => (
                <Select
                  id={id}
                  className="sm:max-w-xs"
                  options={options}
                  value={draft.currency}
                  onChange={(e) => updateMeta(DRAFT, { currency: e.target.value as Currency })}
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
            Risk is computed by the service from real weather, water, satellite and disaster sources. Every value shows where it came from.
          </p>
        </aside>
      </div>
    </div>
  );
}

export default StepPortfolio;
