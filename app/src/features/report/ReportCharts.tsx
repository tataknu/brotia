/**
 * The report's charts, one tab each (v1.2): next installments, tier mix, exposure by crop / zone / region (split by
 * tier), risk score distribution, water status, stress drivers, and the demographics panels. Plain HTML so they
 * render on the server for tests and stay crisp at any size. Colours: tiers and scores use the risk ramp
 * (TIER_COLORS, riskColor); crops use their own colour as an identity dot only; perils use PERIL_COLORS.
 * Imported only by the lazy tab modules, so it is not in the report's first chunk.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Currency, Tier } from '@/domain/types';
import { PERIL_COLORS, TIER_COLORS, riskColor } from '@/shared/chartColors';
import { cropColor, cropLabel } from '@/shared/ui';
import { PERIL_LABELS, TIER_LABELS, date, hectares, money, pct } from '@/shared/format';
import { dueLabel, type WaterLevel } from '@/features/dashboard/dashboardModel';
import type {
  CountRow,
  CropProfile,
  DriverRow,
  InstallmentMonth,
  RecordCoverage,
  ScoreBin,
  StageRow,
  TierSlice,
  TieredRow,
  UpcomingInstallment,
  WaterReport,
} from './reportModel';
import { TIERS_DESC } from './reportModel';
import { ChartCard, TierChip } from './parts';
import { paths } from '@/shell/paths';

const num = 'font-mono tabular-nums';
const th = 'px-3 py-2 text-xs font-medium text-muted';

/* ───────────────────────── small pieces ───────────────────────── */

export function TierLegend({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted', className)} aria-hidden>
      {TIERS_DESC.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TIER_COLORS[t].fg }} />
          {TIER_LABELS[t]}
        </span>
      ))}
    </div>
  );
}

/** Segmented control (aria-pressed buttons in a labelled group). */
export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-card border border-line p-0.5 text-sm" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={String(k)}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={clsx(
            'rounded-[6px] px-2.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
            value === k ? 'bg-brand-soft font-medium text-brand-ink' : 'text-muted hover:text-ink',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** One horizontal bar split by tier (most serious first), scaled to `max`. */
function TierBar({ byTier, max, className }: { byTier: Record<Tier, number>; max: number; className?: string }) {
  return (
    <div className={clsx('flex h-2.5 w-full gap-[2px] overflow-hidden rounded-sm bg-surface', className)} aria-hidden>
      {TIERS_DESC.map((t) => (byTier[t] > 0 ? <div key={t} style={{ width: `${(byTier[t] / max) * 100}%`, background: TIER_COLORS[t].fg }} /> : null))}
    </div>
  );
}

/* ───────────────────────── Payments ───────────────────────── */

export function InstallmentsChart({
  months,
  currency,
  horizon,
  onHorizon,
}: {
  months: InstallmentMonth[];
  currency: Currency;
  horizon: 6 | 12;
  onHorizon: (h: 6 | 12) => void;
}) {
  const max = Math.max(1, ...months.map((m) => m.total));
  const total = months.reduce((s, m) => s + m.total, 0);
  const count = months.reduce((s, m) => s + m.count, 0);
  return (
    <ChartCard
      title="Next installments"
      subtitle={
        <>
          Scheduled, not observed payments, by month and the farm&apos;s current tier ·{' '}
          <span className={clsx('text-ink', num)}>{money(total, currency)}</span> in <span className={num}>{count}</span> {count === 1 ? 'installment' : 'installments'}
        </>
      }
      actions={
        <Segmented
          label="Months shown"
          value={horizon}
          onChange={onHorizon}
          options={[
            [6, '6 months'],
            [12, '12 months'],
          ]}
        />
      }
    >
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No installment due in the next {horizon} months.</p>
      ) : (
        <div className="flex h-[260px] items-end gap-2 border-b border-line pb-px sm:gap-3">
          {months.map((m) => {
            return (
              <div
                key={m.month}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                title={`${date(`${m.month}-01`, 'month')}: ${money(m.total, currency)} in ${m.count} ${m.count === 1 ? 'installment' : 'installments'}${TIERS_DESC.filter((t) => m.byTier[t] > 0)
                  .map((t) => `; ${TIER_LABELS[t]} ${money(m.byTier[t], currency)}`)
                  .join('')}`}
              >
                <span className={clsx('mb-1 whitespace-nowrap text-[11px] text-ink', num)}>{m.total > 0 ? money(m.total, currency, { compact: true }) : ''}</span>
                <div className="flex w-full max-w-[56px] flex-col gap-[2px] overflow-hidden rounded-t-sm" style={{ height: m.total > 0 ? `${(m.total / max) * 200}px` : '0px' }} aria-hidden>
                  {TIERS_DESC.map((t) => (m.byTier[t] > 0 ? <div key={t} className="w-full" style={{ flexGrow: m.byTier[t], background: TIER_COLORS[t].fg }} /> : null))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {total > 0 && (
        <div className="mt-1.5 flex gap-2 sm:gap-3" aria-hidden>
          {months.map((m, i) => {
            const [y, mo] = m.month.split('-');
            return (
              <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
                {date(`${m.month}-01`, 'month').slice(0, 3)}
                {(i === 0 || mo === '01') && <span className={clsx('block text-[10px]', num)}>{y}</span>}
              </span>
            );
          })}
        </div>
      )}
      <TierLegend className="mt-3" />
      <span className="sr-only">{months.map((m) => `${date(`${m.month}-01`, 'month')}: ${money(m.total, currency)}`).join('; ')}</span>
    </ChartCard>
  );
}

export function UpcomingInstallmentsList({ portfolioId, rows, currency, asOf, days = 60 }: { portfolioId: string; rows: UpcomingInstallment[]; currency: Currency; asOf: string; days?: number }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <ChartCard title={`Installments due in the next ${days} days`} subtitle={`After ${date(asOf)}, soonest first, with each farm's current tier.`}>
      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted">No installment falls due in the next {days} days.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="border-y border-line bg-surface">
              <tr>
                <th scope="col" className={clsx(th, 'pl-5 text-left')}>
                  Farm
                </th>
                <th scope="col" className={clsx(th, 'text-left')}>
                  Due
                </th>
                <th scope="col" className={clsx(th, 'text-right')}>
                  Amount
                </th>
                <th scope="col" className={clsx(th, 'pr-5 text-left')}>
                  Tier
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((r) => (
                <tr key={`${r.farmId}:${r.dueDate}`}>
                  <th scope="row" className="px-3 py-2 pl-5 text-left font-normal">
                    <Link to={paths.farm(portfolioId, r.farmId)} className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-brand">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cropColor(r.crop) }} aria-hidden />
                      {r.farmName}
                    </Link>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={clsx('text-ink', num)}>{date(r.dueDate)}</span>
                    <span className="ml-1.5 text-xs text-muted">{dueLabel(r.days)}</span>
                  </td>
                  <td className={clsx('px-3 py-2 text-right text-ink', num)}>{money(r.amount, currency)}</td>
                  <td className="px-3 py-2 pr-5">{r.tier ? <TierChip tier={r.tier} /> : <span className="text-muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line">
              <tr>
                <th scope="row" className="px-3 py-2 pl-5 text-left text-xs font-semibold uppercase tracking-wide text-ink" colSpan={2}>
                  Total
                </th>
                <td className={clsx('px-3 py-2 text-right font-semibold text-ink', num)}>{money(total, currency)}</td>
                <td className="px-3 py-2 pr-5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

/* ───────────────────────── Exposures ───────────────────────── */

export function TierMixChart({ slices, currency }: { slices: TierSlice[]; currency: Currency }) {
  const total = slices.reduce((s, x) => s + x.exposure, 0);
  const farms = slices.reduce((s, x) => s + x.farms, 0);
  return (
    <ChartCard title="Exposure by tier" subtitle="Outstanding by the farms' current risk tier">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-sm bg-surface" aria-hidden>
        {total > 0 &&
          slices.map((s) =>
            s.exposure > 0 ? <div key={s.tier} style={{ width: `${(s.exposure / total) * 100}%`, background: TIER_COLORS[s.tier].fg }} title={`${TIER_LABELS[s.tier]}: ${money(s.exposure, currency)}`} /> : null,
          )}
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={clsx(th, 'pl-0 text-left')}>
              Tier
            </th>
            <th scope="col" className={clsx(th, 'text-right')}>
              Farms
            </th>
            <th scope="col" className={clsx(th, 'text-right')}>
              Outstanding
            </th>
            <th scope="col" className={clsx(th, 'pr-0 text-right')}>
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {slices.map((s) => (
            <tr key={s.tier}>
              <th scope="row" className="py-2 text-left font-normal">
                <TierChip tier={s.tier} />
              </th>
              <td className={clsx('px-3 py-2 text-right text-ink', num)}>{s.farms}</td>
              <td className={clsx('px-3 py-2 text-right text-ink', num)}>{money(s.exposure, currency)}</td>
              <td className={clsx('py-2 text-right text-muted', num)}>{s.share === null ? '–' : pct(s.share, 1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink">
              Total
            </th>
            <td className={clsx('px-3 py-2 text-right font-semibold text-ink', num)}>{farms}</td>
            <td className={clsx('px-3 py-2 text-right font-semibold text-ink', num)}>{money(total, currency)}</td>
            <td className={clsx('py-2 text-right text-muted', num)}>{total > 0 ? '100.0%' : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </ChartCard>
  );
}

/** Rows of outstanding split by tier (crop, zone, region). High reads red, watch amber, normal green. */
export function TieredBarsChart({ title, subtitle, rows, currency, note }: { title: string; subtitle: ReactNode; rows: TieredRow[]; currency: Currency; note?: ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No exposure.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const tiers = TIERS_DESC.filter((t) => r.byTier[t] > 0 && t !== 'normal');
            return (
              <li key={r.key} title={`${r.label}: ${money(r.total, currency)}${TIERS_DESC.filter((t) => r.byTier[t] > 0).map((t) => `; ${TIER_LABELS[t]} ${money(r.byTier[t], currency)}`).join('')}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink">
                    {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />}
                    <span className="truncate">{r.label}</span>
                    <span className={clsx('shrink-0 text-xs text-muted', num)}>
                      {r.farms} {r.farms === 1 ? 'farm' : 'farms'}
                    </span>
                  </span>
                  <span className={clsx('shrink-0 text-ink', num)}>{money(r.total, currency, { compact: true })}</span>
                </div>
                <TierBar byTier={r.byTier} max={max} className="mt-1" />
                {tiers.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {tiers.map((t) => (
                      <span key={t} style={{ color: TIER_COLORS[t].ink }}>
                        {TIER_LABELS[t]} <span className={num}>{money(r.byTier[t], currency, { compact: true })}</span>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <TierLegend className="mt-4" />
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </ChartCard>
  );
}

/* ───────────────────────── Risks ───────────────────────── */

export function ScoreDistributionChart({ bins }: { bins: ScoreBin[] }) {
  const max = Math.max(1, ...bins.map((b) => b.farms));
  return (
    <ChartCard title="Risk score distribution" subtitle="Farms per 10-point band of the 0–100 score; colour follows the score">
      <div className="flex h-[220px] items-end gap-1 border-b border-line pb-px">
        {bins.map((b) => (
          <div key={b.from} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`Score ${b.from}–${b.to}: ${b.farms} ${b.farms === 1 ? 'farm' : 'farms'}`}>
            <span className={clsx('mb-1 text-xs text-ink', num)}>{b.farms > 0 ? b.farms : ''}</span>
            <div className="w-full rounded-t-sm" style={{ height: b.farms > 0 ? `${(b.farms / max) * 176}px` : '0px', background: riskColor((b.from + b.to) / 2) }} aria-hidden />
          </div>
        ))}
      </div>
      <div className={clsx('mt-1 flex justify-between text-[11px] text-muted', num)} aria-hidden>
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      <span className="sr-only">{bins.filter((b) => b.farms > 0).map((b) => `Score ${b.from} to ${b.to}: ${b.farms} farms`).join('; ')}</span>
    </ChartCard>
  );
}

const WATER: { key: WaterLevel; label: string; color: string }[] = [
  { key: 'stress', label: 'Stress', color: TIER_COLORS.high.fg },
  { key: 'watch', label: 'Supply at risk', color: TIER_COLORS.watch.fg },
  { key: 'ok', label: 'No stress', color: TIER_COLORS.normal.fg },
  { key: 'unknown', label: 'Unknown', color: '#C3CCC6' },
];

/**
 * Water status counts. `state`: 'waiting' while the portfolio assessment is not current (nothing is looked up),
 * 'checking' while the per-farm lookups run, 'done' when every farm answered.
 */
export function WaterChart({ report, farms, names, state }: { report: WaterReport; farms: number; names: ReadonlyMap<string, string>; state: 'waiting' | 'checking' | 'done' }) {
  const max = Math.max(1, ...Object.values(report.counts));
  const subtitle =
    state === 'waiting' ? (
      'Read from each farm’s own assessment once the portfolio assessment is current.'
    ) : (
      <>
        Farms by water ladder reading ·{' '}
        <span className={num}>
          {report.checked} of {farms}
        </span>{' '}
        {state === 'checking' ? 'farms checked…' : 'farms checked'}
        {report.failed > 0 && (
          <>
            {' '}
            · <span className={num}>{report.failed}</span> could not be read
          </>
        )}
      </>
    );
  return (
    <ChartCard title="Water status" subtitle={subtitle}>
      <dl className="space-y-3 text-sm">
        {WATER.map((w) => {
          const ids = report.farms[w.key];
          return (
            <div key={w.key}>
              <div className="grid grid-cols-[110px_1fr_32px] items-center gap-3">
                <dt className="truncate text-ink">{w.label}</dt>
                <div className="h-2.5 rounded-sm bg-surface" aria-hidden>
                  {report.counts[w.key] > 0 && <div className="h-full rounded-sm" style={{ width: `${(report.counts[w.key] / max) * 100}%`, background: w.color }} />}
                </div>
                <dd className={clsx('text-right text-ink', num)}>{state === 'waiting' ? '–' : report.counts[w.key]}</dd>
              </div>
              {w.key !== 'ok' && ids.length > 0 && <p className="mt-0.5 pl-[122px] text-xs text-muted">{ids.map((id) => names.get(id) ?? id).join(', ')}</p>}
            </div>
          );
        })}
      </dl>
      <p className="mt-4 text-xs text-muted">Display only: the risk score already includes water. The farm page shows the full ladder.</p>
    </ChartCard>
  );
}

export function DriversChart({ rows, checked, farms, currency, state }: { rows: DriverRow[]; checked: number; farms: number; currency: Currency; state: 'waiting' | 'checking' | 'done' }) {
  const max = Math.max(1, ...rows.map((r) => r.present));
  return (
    <ChartCard
      title="Stress drivers"
      subtitle={
        state === 'waiting' ? (
          'Read from each farm’s own assessment once the portfolio assessment is current.'
        ) : (
          <>
            Leading driver of each farm&apos;s score, and how often a peril is among its top drivers ·{' '}
            <span className={num}>
              {checked} of {farms}
            </span>{' '}
            {state === 'checking' ? 'farms read…' : 'farms read'}
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{state === 'done' ? 'No farm has a driver above zero.' : 'No driver read yet.'}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="border-y border-line bg-surface">
              <tr>
                <th scope="col" className={clsx(th, 'pl-5 text-left')}>
                  Peril
                </th>
                <th scope="col" className={clsx(th, 'text-right')}>
                  Leading on
                </th>
                <th scope="col" className={clsx(th, 'text-right')}>
                  Their outstanding
                </th>
                <th scope="col" className={clsx(th, 'pr-5 text-left')}>
                  Among top drivers
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((r) => (
                <tr key={r.peril}>
                  <th scope="row" className="px-3 py-2 pl-5 text-left font-normal text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: PERIL_COLORS[r.peril] }} aria-hidden />
                      {PERIL_LABELS[r.peril] ?? r.peril}
                    </span>
                  </th>
                  <td className={clsx('px-3 py-2 text-right text-ink', num)}>{r.leading > 0 ? `${r.leading} ${r.leading === 1 ? 'farm' : 'farms'}` : '–'}</td>
                  <td className={clsx('px-3 py-2 text-right text-ink', num)}>{r.leading > 0 ? money(r.leadingExposure, currency) : '–'}</td>
                  <td className="px-3 py-2 pr-5">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-24 shrink-0 rounded-sm bg-surface" aria-hidden>
                        <span className="block h-full rounded-sm" style={{ width: `${(r.present / max) * 100}%`, background: PERIL_COLORS[r.peril] }} />
                      </span>
                      <span className={clsx('text-ink', num)}>{r.present}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

/* ───────────────────────── Demographics ───────────────────────── */

export function CropProfileTable({ rows }: { rows: CropProfile[] }) {
  const max = Math.max(1, ...rows.map((r) => r.farms));
  const farms = rows.reduce((s, r) => s + r.farms, 0);
  const ha = rows.reduce((s, r) => s + r.totalHa, 0);
  return (
    <ChartCard title="Farms by crop" subtitle="Count and planted area from the portfolio's farm records">
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="border-y border-line bg-surface">
            <tr>
              <th scope="col" className={clsx(th, 'pl-5 text-left')}>
                Crop
              </th>
              <th scope="col" className={clsx(th, 'text-left')}>
                Farms
              </th>
              <th scope="col" className={clsx(th, 'text-right')}>
                Total area
              </th>
              <th scope="col" className={clsx(th, 'pr-5 text-right')}>
                Median area
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((r) => (
              <tr key={r.crop}>
                <th scope="row" className="px-3 py-2 pl-5 text-left font-normal text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                    {r.label}
                  </span>
                </th>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-16 shrink-0 rounded-sm bg-surface" aria-hidden>
                      <span className="block h-full rounded-sm bg-brand" style={{ width: `${(r.farms / max) * 100}%` }} />
                    </span>
                    <span className={clsx('text-ink', num)}>{r.farms}</span>
                  </span>
                </td>
                <td className={clsx('px-3 py-2 text-right text-ink', num)}>{hectares(r.totalHa)}</td>
                <td className={clsx('px-3 py-2 pr-5 text-right text-ink', num)}>{hectares(r.medianHa)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <tr>
              <th scope="row" className="px-3 py-2 pl-5 text-left text-xs font-semibold uppercase tracking-wide text-ink">
                Total
              </th>
              <td className={clsx('px-3 py-2 font-semibold text-ink', num)}>{farms}</td>
              <td className={clsx('px-3 py-2 text-right font-semibold text-ink', num)}>{hectares(ha)}</td>
              <td className="px-3 py-2 pr-5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </ChartCard>
  );
}

/** Farm counts per group (region, zone) with their area. */
export function CountBars({ title, subtitle, rows, note }: { title: string; subtitle: ReactNode; rows: CountRow[]; note?: ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.farms));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} title={r.names.join(', ')}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{r.label}</span>
              <span className="shrink-0 text-xs text-muted">
                <span className={clsx('text-sm text-ink', num)}>{r.farms}</span> {r.farms === 1 ? 'farm' : 'farms'} · <span className={num}>{hectares(r.ha)}</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-sm bg-surface" aria-hidden>
              <div className="h-full rounded-sm bg-brand" style={{ width: `${(r.farms / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </ChartCard>
  );
}

export function StageMixChart({ rows, asOf }: { rows: StageRow[]; asOf: string }) {
  const max = Math.max(1, ...rows.map((r) => r.farms));
  return (
    <ChartCard title="Growth stage now" subtitle={`Each farm's stage on ${date(asOf)}, from its crop calendar`}>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">
                {r.label} <span className="text-xs text-muted">· {r.crops.map((c) => cropLabel(c)).join(', ')}</span>
              </span>
              <span className={clsx('shrink-0 text-ink', num)}>{r.farms}</span>
            </div>
            <div className="mt-1 h-2 rounded-sm bg-surface" aria-hidden>
              <div className="h-full rounded-sm bg-brand" style={{ width: `${(r.farms / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/** What the farm records carry and what they do not (so nothing is guessed). */
export function RecordsNote({ c }: { c: RecordCoverage }) {
  const item = (label: string, n: number) => (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-ink">{label}</span>
      <span className={clsx(n === 0 ? 'text-muted' : 'text-ink', num)}>
        {n} of {c.farms}
      </span>
    </li>
  );
  return (
    <ChartCard title="Farm records" subtitle="Optional fields filled in this portfolio">
      <ul className="space-y-1.5 text-sm">
        {item('Linked to the CIREN fruit cadastre', c.cadastre)}
        {item('Irrigation declared by the lender', c.irrigationDeclared)}
        {item('Cover or net declared', c.coverDeclared)}
        {item('Planting year', c.plantingYear)}
      </ul>
      <p className="mt-3 text-xs text-muted">Commune and owner details are not stored on the farm record. Empty fields are left empty, not estimated.</p>
    </ChartCard>
  );
}
