/**
 * Report tab "Payments": next installments by month (6 or 12 months, split by the farm's current tier), the
 * installments due in the next 60 days, and the credit actions fired by the effective credit rules.
 * Lazy-loaded by the report page.
 */
import { useMemo, useState } from 'react';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';
import { actionRows } from '@/features/dashboard/dashboardModel';
import { CreditActionsPanel } from '@/features/dashboard/CreditActionsPanel';
import { installmentsByMonth, upcomingInstallments } from '../reportModel';
import { InstallmentsChart, UpcomingInstallmentsList } from '../ReportCharts';

export default function PaymentsTab({ portfolio, assessment: a }: { portfolio: Portfolio; assessment: PortfolioAssessment }) {
  const [horizon, setHorizon] = useState<6 | 12>(6);
  const months = useMemo(() => {
    const tiers = new Map(a.ranked.map((r) => [r.farmId, r.tier]));
    return installmentsByMonth(portfolio, (id) => tiers.get(id), a.asOf, horizon);
  }, [a, portfolio, horizon]);
  const upcoming = useMemo(() => upcomingInstallments(portfolio, a.ranked, a.asOf, 60), [portfolio, a]);
  const actions = useMemo(() => actionRows(a, portfolio), [a, portfolio]);
  return (
    <div className="space-y-4">
      <InstallmentsChart months={months} currency={a.currency} horizon={horizon} onHorizon={setHorizon} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <UpcomingInstallmentsList portfolioId={portfolio.id} rows={upcoming} currency={a.currency} asOf={a.asOf} days={60} />
        <div className="h-[440px]">
          <CreditActionsPanel rows={actions} portfolio={portfolio} currency={a.currency} />
        </div>
      </div>
    </div>
  );
}
