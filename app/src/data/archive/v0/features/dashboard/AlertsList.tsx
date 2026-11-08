import { Link } from 'react-router-dom';
import { ArrowRight, Bell } from 'lucide-react';
import type { Alert, Farm } from '@/domain/types';
import { date } from '@/shared/format';
import { Card, TierBadge } from '@/shared/ui';

export function AlertsList({ alerts, farms, portfolioId, limit = 8 }: { alerts: Alert[]; farms: Map<string, Farm>; portfolioId: string; limit?: number }) {
  const shown = alerts.slice(0, limit);
  return (
    <Card title="Alerts" subtitle="Tier changes in the last 26 weeks, newest first." flush>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-muted">
          <Bell size={18} aria-hidden />
          No tier changes.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => {
            const farm = farms.get(a.farmId);
            return (
              <li key={a.id}>
                <Link to={`/portfolios/${portfolioId}/farms/${a.farmId}`} className="block px-5 py-3 hover:bg-surface focus:bg-surface focus:outline-none">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-ink">{farm?.name ?? 'Removed farm'}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted">{date(a.date)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <TierBadge tier={a.fromTier} />
                    <ArrowRight size={16} className="text-muted" aria-label="to" />
                    <TierBadge tier={a.toTier} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{a.reason}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {alerts.length > limit && <p className="border-t border-line px-5 py-2.5 text-sm text-muted">{alerts.length - limit} older alerts not shown.</p>}
    </Card>
  );
}
