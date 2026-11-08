import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { Currency, Farm, Zone } from '@/domain/types';
import { inMonthDayWindow } from '@/domain/dates';
import { outstandingAt, SCHEDULE_LABELS } from '@/domain/schedule';
import { AS_OF } from '@/data/api';
import { date, money } from '@/shared/format';
import { Badge, Card } from '@/shared/ui';
import { monthDayLabel } from '@/features/wizard/zones/zoneLogic';

export function LoanCard({ farm, zone, currency }: { farm: Farm; zone: Zone | undefined; currency: Currency }) {
  const loan = farm.loan;
  const rows = useMemo(() => {
    if (!loan) return [];
    const plan = loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }];
    const sorted = [...plan].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nextIdx = sorted.findIndex((i) => i.dueDate > AS_OF);
    return sorted.map((i, idx) => ({
      ...i,
      status: i.dueDate <= AS_OF ? 'paid' : idx === nextIdx ? 'next' : 'upcoming',
      inStress: zone ? inMonthDayWindow(i.dueDate, zone.stressWindow) : false,
    }));
  }, [loan, zone]);

  if (!loan) {
    return (
      <Card title="Loan">
        <p className="text-sm text-muted">No loan recorded for this farm.</p>
      </Card>
    );
  }
  const cur = loan.currency ?? currency;
  const outstanding = outstandingAt(loan, AS_OF);
  const stressCount = rows.filter((r) => r.inStress && r.status !== 'paid').length;

  return (
    <Card title="Loan" subtitle={SCHEDULE_LABELS[loan.scheduleType]} flush>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
        <div>
          <dt className="text-muted">Amount</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink">{money(loan.amount, cur)}</dd>
        </div>
        <div>
          <dt className="text-muted">Outstanding today</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink">{money(outstanding, cur)}</dd>
        </div>
        <div>
          <dt className="text-muted">Origination</dt>
          <dd className="mt-0.5 tabular-nums text-ink">{date(loan.originationDate)}</dd>
        </div>
        <div>
          <dt className="text-muted">Maturity</dt>
          <dd className="mt-0.5 tabular-nums text-ink">{date(loan.maturityDate)}</dd>
        </div>
      </dl>
      {stressCount > 0 && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-card bg-warn-soft px-3 py-2 text-sm text-warn">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {stressCount} upcoming {stressCount === 1 ? 'installment falls' : 'installments fall'} inside this zone’s crop stress window
            {zone ? ` (${monthDayLabel(zone.stressWindow.start)} to ${monthDayLabel(zone.stressWindow.end)})` : ''}.
          </span>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto border-t border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-line text-left text-muted">
              <th className="px-5 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.dueDate}-${idx}`} className={clsx('border-b border-line last:border-b-0', r.status === 'paid' && 'text-muted')}>
                <td className="px-5 py-2 tabular-nums">{date(r.dueDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.amount, cur)}</td>
                <td className="px-5 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.status === 'paid' ? <span>Paid</span> : r.status === 'next' ? <Badge tone="brand">Next</Badge> : <span className="text-ink">Upcoming</span>}
                    {r.inStress && r.status !== 'paid' && <Badge tone="warn">Due in stress window</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2.5 text-sm text-muted">Installments due before {date(AS_OF)} are treated as paid.</p>
    </Card>
  );
}
