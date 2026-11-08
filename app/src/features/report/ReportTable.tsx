/**
 * The portfolio report's finance table: one row per farm, (a) farm, (b) outstanding, (c) % of portfolio,
 * (d) risk score, (e) weighted risk = (c)×(d), then water, next installment, credit action and (optional) insurance.
 * A TOTAL row with total outstanding, 100 % and the exposure-weighted portfolio risk. Pure: rows, totals, sort and
 * the insurance cells come in as props (reportModel, features/report/insurance), so it renders on the server for tests.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock } from 'lucide-react';
import type { CreditAction, Currency } from '@/domain/types';
import { CropPill } from '@/shared/ui';
import { riskColor } from '@/shared/chartColors';
import { CREDIT_ACTION_LABELS, date, money, number, pct } from '@/shared/format';
import { dueLabel, installmentInfo } from '@/features/dashboard/dashboardModel';
import type { ReportRow, ReportTotals, SortKey, SortState } from './reportModel';
import { TierChip } from './parts';

const ACTION_TONE: Record<CreditAction, string> = {
  restructure_review: 'bg-danger-soft text-danger-ink',
  high: 'bg-danger-soft text-danger-ink',
  field_visit: 'bg-warn-soft text-warn-ink',
  watch: 'bg-warn-soft text-warn-ink',
};

interface Col {
  key: SortKey | null;
  label: string;
  /** Header content when it is more than the label (e.g. a partner logo). */
  header?: ReactNode;
  /** Let a long header label wrap to two lines, so a narrow numeric column stays narrow. */
  wrap?: boolean;
  letter: string;
  align: 'left' | 'right';
  className?: string;
}

const COLS: Col[] = [
  { key: 'farm', label: 'Farm', letter: '(a)', align: 'left' },
  { key: 'outstanding', label: 'Outstanding', letter: '(b)', align: 'right' },
  { key: 'share', label: '% of portfolio', letter: '(c)', align: 'right', wrap: true },
  { key: 'score', label: 'Risk score', letter: '(d)', align: 'right' },
  { key: 'weighted', label: 'Weighted risk', letter: '(e)=(c)×(d)', align: 'right', wrap: true },
  { key: null, label: 'Water', letter: '', align: 'left' },
  { key: 'installment', label: 'Next installment', letter: '', align: 'left' },
  { key: 'action', label: 'Credit action', letter: '', align: 'left' },
];

const num = 'font-mono tabular-nums';

/** The Insurance column (v1.1, ADR-0025): after the credit columns, the last column. */
export interface InsuranceColumn {
  header: ReactNode;
  render: (row: ReportRow) => ReactNode;
  /** TOTAL row cell, e.g. "2 queued". */
  total?: ReactNode;
}

export function ReportTable({
  portfolioId,
  rows,
  totals,
  currency,
  asOf,
  sort,
  onSort,
  onOpen,
  renderWater,
  hoverFarmId,
  onHoverFarm,
  insurance,
}: {
  portfolioId: string;
  rows: readonly ReportRow[];
  totals: ReportTotals;
  currency: Currency;
  asOf: string;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onOpen: (farmId: string) => void;
  renderWater?: (row: ReportRow) => ReactNode;
  hoverFarmId?: string | null;
  onHoverFarm?: (farmId: string | null) => void;
  insurance?: InsuranceColumn;
}) {
  const cols: Col[] = insurance ? [...COLS, { key: null, label: 'Insurance', header: insurance.header, letter: '', align: 'left' }] : COLS;
  const last = insurance ? 'px-2.5' : 'pl-2.5 pr-4';
  return (
    <div className="relative overflow-x-auto">
      <table className={clsx('w-full border-collapse text-left text-sm', insurance ? 'min-w-[1040px]' : 'min-w-[960px]')}>
        <caption className="sr-only">
          Farms in this portfolio with outstanding, share of the portfolio, risk score and weighted risk{insurance ? ', and insurance requests queued for Suyana' : ''}. Select a column header to sort; select a farm to open it.
        </caption>
        <thead>
          <tr className="border-t-2 border-brand bg-brand-soft text-brand-ink">
            {cols.map((c, i) => {
              const active = c.key !== null && sort.key === c.key;
              return (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={clsx('px-2.5 py-2 align-bottom text-xs font-semibold', !c.wrap && 'whitespace-nowrap', c.align === 'right' && 'text-right', i === 0 && 'pl-4')}
                >
                  {c.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key!)}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                        c.align === 'right' && 'flex-row-reverse text-right',
                      )}
                    >
                      {c.label}
                      {active ? sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : <ArrowUpDown size={12} className="opacity-40" aria-hidden />}
                    </button>
                  ) : (
                    (c.header ?? c.label)
                  )}
                </th>
              );
            })}
          </tr>
          <tr className="border-b border-brand/40 bg-white" aria-hidden>
            {cols.map((c, i) => (
              <td key={c.label} className={clsx('whitespace-nowrap px-2.5 py-0.5 font-mono text-[11px] text-muted', c.align === 'right' && 'text-right', i === 0 && 'pl-4')}>
                {c.letter}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const inst = installmentInfo(r.nextInstallment, asOf);
            const top = r.actions[0];
            return (
              <tr
                key={r.farmId}
                onClick={() => onOpen(r.farmId)}
                onMouseEnter={() => onHoverFarm?.(r.farmId)}
                onMouseLeave={() => onHoverFarm?.(null)}
                className={clsx(
                  'cursor-pointer border-b border-line/60 align-middle',
                  hoverFarmId === r.farmId ? 'bg-brand-soft' : i % 2 === 1 ? 'bg-surface hover:bg-brand-soft/60' : 'bg-white hover:bg-brand-soft/60',
                )}
              >
                <th scope="row" className="max-w-[300px] py-2 pl-4 pr-2.5 text-left font-normal">
                  <Link
                    to={`/portfolios/${portfolioId}/farms/${r.farmId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate rounded font-medium text-ink hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    title={r.headline}
                  >
                    {r.name}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <CropPill crop={r.crop} className="!px-1.5 !py-0 !text-[11px]" />
                    <span className="truncate">{r.stage}</span>
                  </span>
                </th>
                <td className={clsx('whitespace-nowrap px-2.5 py-2 text-right text-ink', num)}>{money(r.outstanding, currency)}</td>
                <td className={clsx('whitespace-nowrap px-2.5 py-2 text-right text-ink', num)}>{r.share === null ? '–' : pct(r.share, 1)}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    <span className={clsx('font-semibold text-ink', num)}>{number(r.score, 1)}</span>
                    <TierChip tier={r.tier} />
                  </span>
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: riskColor(r.score) }} aria-hidden />
                    <span className={clsx('font-medium text-ink', num)}>{r.weighted === null ? '–' : number(r.weighted, 2)}</span>
                  </span>
                </td>
                <td className="px-2.5 py-2" onClick={(e) => e.stopPropagation()}>
                  {renderWater ? renderWater(r) : <span className="text-muted">–</span>}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2">
                  {inst ? (
                    <div>
                      <p className={clsx('text-ink', num)}>{money(inst.amount, currency)}</p>
                      <p className={clsx('flex items-center gap-1 text-xs', inst.soon ? 'text-warn-ink' : 'text-muted')}>
                        {inst.soon && <CalendarClock size={12} aria-hidden />}
                        <span className={num}>{date(inst.dueDate, 'short')}</span> · {dueLabel(inst.days)}
                      </p>
                    </div>
                  ) : (
                    <span className="text-muted">None due</span>
                  )}
                </td>
                <td className={clsx('whitespace-nowrap py-2', last)}>
                  {top ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={clsx('rounded-full px-1.5 py-px text-[11px] font-medium', ACTION_TONE[top])}>{CREDIT_ACTION_LABELS[top] ?? top}</span>
                      {r.actions.length > 1 && <span className="text-xs text-muted">+{r.actions.length - 1}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </td>
                {insurance && (
                  <td className="whitespace-nowrap py-2 pl-2.5 pr-4" onClick={(e) => e.stopPropagation()}>
                    {insurance.render(r)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-y-[3px] border-double border-brand bg-white font-semibold text-ink">
            <th scope="row" className="py-2.5 pl-4 pr-2.5 text-left text-xs uppercase tracking-wide">
              Total <span className="font-normal normal-case tracking-normal text-muted">· {totals.farms} {totals.farms === 1 ? 'farm' : 'farms'}</span>
            </th>
            <td className={clsx('whitespace-nowrap px-2.5 py-2.5 text-right', num)}>{money(totals.outstanding, currency)}</td>
            <td className={clsx('whitespace-nowrap px-2.5 py-2.5 text-right', num)}>{totals.share === null ? '–' : pct(totals.share, 1)}</td>
            <td className="px-2.5 py-2.5" />
            <td className="whitespace-nowrap px-2.5 py-2.5 text-right">
              <span className="inline-flex items-center justify-end gap-2">
                <span className={num} title="Exposure-weighted portfolio risk: the sum of (e)">
                  {totals.weightedRisk === null ? '–' : number(totals.weightedRisk, 2)}
                </span>
              </span>
            </td>
            <td className="px-2.5 py-2.5" />
            <td className="px-2.5 py-2.5" />
            <td className={clsx('whitespace-nowrap py-2.5 text-xs font-normal text-muted', last)}>
              {totals.actions} {totals.actions === 1 ? 'action' : 'actions'}
            </td>
            {insurance && <td className="whitespace-nowrap py-2.5 pl-2.5 pr-4 text-xs font-normal text-muted">{insurance.total}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
