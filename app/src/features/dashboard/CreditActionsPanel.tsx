/**
 * Credit actions fired by the effective credit rules (service, CONTRACT §E.7): watch, field visit,
 * restructure review (and high). Most serious first, then by exposure.
 */
import { Link } from 'react-router-dom';
import { ClipboardCheck, Eye, MapPinned, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { CreditAction, Currency, Portfolio } from '@/domain/types';
import { Badge, CropPill, type BadgeTone } from '@/shared/ui';
import { CREDIT_ACTION_LABELS, date, money } from '@/shared/format';
import { actionCounts, type ActionRow } from './dashboardModel';
import { paths } from '@/shell/paths';

const ICON: Record<CreditAction, LucideIcon> = { restructure_review: ShieldAlert, high: ShieldAlert, field_visit: MapPinned, watch: Eye };
const TONE: Record<CreditAction, BadgeTone> = { restructure_review: 'danger', high: 'danger', field_visit: 'warn', watch: 'warn' };

export function CreditActionsPanel({ rows, portfolio, currency }: { rows: ActionRow[]; portfolio: Portfolio; currency: Currency }) {
  const counts = actionCounts(rows);
  return (
    <div className="flex h-full flex-col rounded-card border border-line bg-white shadow-panel">
      <div className="border-b border-line px-5 py-4">
        <h3 className="text-base font-semibold text-ink">Credit actions</h3>
        <p className="mt-0.5 text-sm text-muted">
          {rows.length === 0
            ? 'No credit rule fired today.'
            : (['restructure_review', 'high', 'field_visit', 'watch'] as CreditAction[])
                .filter((a) => counts[a])
                .map((a) => `${counts[a]} ${CREDIT_ACTION_LABELS[a].toLowerCase()}`)
                .join(' · ')}
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center text-sm text-muted">
          <ClipboardCheck size={18} />
          Rules for watch, field visits and restructure reviews are checked on every assessment.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto">
          {rows.map((r) => {
            const Icon = ICON[r.action] ?? Eye;
            return (
              <li key={`${r.farmId}:${r.ruleId}`} className="px-5 py-3">
                <div className="flex items-start gap-2">
                  <Badge tone={TONE[r.action] ?? 'neutral'} className="mt-0.5 shrink-0">
                    <Icon size={12} />
                    {CREDIT_ACTION_LABELS[r.action] ?? r.action}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link to={paths.farm(portfolio.id, r.farmId)} className="font-medium text-ink hover:text-brand">
                        {r.farmName}
                      </Link>
                      {r.crop && <CropPill crop={r.crop} />}
                    </div>
                    <p className="mt-0.5 text-sm text-ink">{r.message}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {money(r.exposure, currency)} exposed
                      {r.nextInstallment ? ` · next installment ${money(r.nextInstallment.amount, currency)} on ${date(r.nextInstallment.dueDate)}` : ''} ·{' '}
                      <span className="font-mono">{r.ruleId}</span>
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
