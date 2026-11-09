/**
 * Compact farm header, always visible above the tabs (v1.1 spec "Farm detail", tidied in v1.3): back link to the
 * portfolio report, farm name, then one quiet line (crop, area, zone, Live / offline badge), then the money and the
 * risk: score and tier (the only place the score appears), outstanding of the loan amount, next installment.
 * The Spanish crop name, CIREN record and data tier live in the Overview's "About this data".
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, Bot, MapPin } from 'lucide-react';
import type { FarmAssessment, Farm, Portfolio } from '@/domain/types';
import type { DataSource } from '@/data/api';
import { useConnection } from '@/data/hooks';
import { date, hectares, money, number } from '@/shared/format';
import { Button, CropPill, PortfolioName, TierBadge } from '@/shared/ui';
import { TIER_COLORS } from '@/shared/chartColors';
import { dueInLabel } from './farmData';
import { Skeleton } from './parts';
import { paths } from '@/shell/paths';

export function SourceBadge({ source, snapshotDate }: { source: DataSource | undefined; snapshotDate: string | null }) {
  const cls = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';
  const { mode } = useConnection();
  if (source === 'live' && mode === 'snapshot')
    // RT-11: fetched live earlier, but the service is down now: do not claim "Live" under an offline header
    return (
      <span className={`${cls} bg-surface text-muted`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Live data from earlier (service offline now)
      </span>
    );
  if (source === 'live')
    return (
      <span className={`${cls} bg-brand-soft text-brand-ink`}>
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Live
      </span>
    );
  if (source === 'snapshot')
    return (
      <span className={`${cls} bg-warn-soft text-warn`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {snapshotDate ? `Offline snapshot of ${date(snapshotDate)}` : 'Offline snapshot'}
      </span>
    );
  return null;
}

/** Display name of the farm's effective zone. */
export function zoneDisplayName(portfolio: Portfolio, zoneId: string): string {
  const zone = portfolio.zones.find((z) => z.id === zoneId);
  return zone ? (zone.auto ? 'Own zone (35 km² around the farm)' : zone.name) : zoneId;
}

function Metric({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export function FarmHeader({
  portfolio,
  farm,
  assessment,
  source,
  snapshotDate,
  loading,
  onAskFarm,
  onAskZone,
}: {
  portfolio: Portfolio;
  farm: Farm;
  assessment: FarmAssessment | undefined;
  source: DataSource | undefined;
  snapshotDate: string | null;
  loading: boolean;
  onAskFarm: () => void;
  onAskZone: (zoneId: string) => void;
}) {
  const a = assessment;
  const zoneId = a?.zoneId ?? farm.zoneId;
  const loan = farm.loan;
  const busy = loading || !a;
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          to={paths.portfolio(portfolio.id)}
          className="inline-flex items-center gap-1.5 rounded-card text-sm text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <ArrowLeft size={16} />
          <span>
            <PortfolioName name={portfolio.name} code={portfolio.code} /> report
          </span>
        </Link>
        <div className="-mx-2 flex flex-wrap items-center gap-1 sm:mx-0">
          <Button variant="ghost" size="sm" icon={<Bot size={16} />} onClick={onAskFarm} aria-label="Ask the agent about this farm">
            <span className="sm:hidden">Ask the agent</span>
            <span className="hidden sm:inline">Ask the agent about this farm</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<Bot size={16} />} onClick={() => onAskZone(zoneId)}>
            About this zone
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{farm.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <CropPill crop={farm.crop} />
            <span className="font-mono tabular-nums">{hectares(farm.areaHa)}</span>
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} />
              {zoneDisplayName(portfolio, zoneId)}
            </span>
            <SourceBadge source={source} snapshotDate={snapshotDate} />
          </div>
        </div>

        <dl className="grid w-full grid-cols-2 items-start gap-x-6 gap-y-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-8">
          <Metric label="Risk score">
            {busy ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-xl font-semibold tabular-nums" style={{ color: TIER_COLORS[a.risk.tier].fg }}>
                  {number(a.risk.score, 1)}
                </span>
                <TierBadge tier={a.risk.tier} />
              </span>
            )}
          </Metric>
          <Metric label="Outstanding">
            {busy ? (
              <Skeleton className="h-7 w-36" />
            ) : (
              <p className="sm:whitespace-nowrap">
                <span className="font-mono text-xl font-semibold tabular-nums text-ink">{money(a.exposure, portfolio.currency)}</span>
                <span className="text-sm text-muted">{loan ? <> of <span className="font-mono tabular-nums">{money(loan.amount, portfolio.currency)}</span></> : ' · no loan recorded'}</span>
              </p>
            )}
          </Metric>
          <Metric label="Next installment" className="col-span-2">
            {busy ? (
              <Skeleton className="h-7 w-36" />
            ) : a.nextInstallment ? (
              <p className="sm:whitespace-nowrap">
                <span className="font-mono text-xl font-semibold tabular-nums text-ink">{money(a.nextInstallment.amount, portfolio.currency)}</span>
                <span className="text-sm text-muted">
                  {' '}
                  {date(a.nextInstallment.dueDate)} · {dueInLabel(a.asOf, a.nextInstallment.dueDate).toLowerCase()}
                </span>
              </p>
            ) : (
              <p className="pt-1 text-sm text-muted">None upcoming</p>
            )}
          </Metric>
        </dl>
      </div>
    </header>
  );
}
