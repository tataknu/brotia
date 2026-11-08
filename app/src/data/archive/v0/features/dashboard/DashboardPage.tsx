import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CalendarClock, FolderOpen, Info, Plus } from 'lucide-react';
import { CROPS, TIERS } from '@/domain/types';
import { usePortfolio } from '@/state/store';
import { AS_OF, assessPortfolio, getAlerts, getClimateEvents } from '@/data/api';
import { date, money, pct, TIER_LABELS } from '@/shared/format';
import { TIER_COLORS } from '@/shared/chartColors';
import { Badge, EmptyState, Stat, buttonClass } from '@/shared/ui';
import { DashboardMap } from './DashboardMap';
import { EventsPanel } from './EventsPanel';
import { Watchlist } from './Watchlist';
import { ExposureChart, type ExposureRow } from './ExposureCharts';
import { AlertsList } from './AlertsList';
import { buildRows, share } from './watchlistModel';

export function DashboardPage() {
  const { portfolioId } = useParams();
  const portfolio = usePortfolio(portfolioId);
  const navigate = useNavigate();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const assessment = useMemo(() => (portfolio ? assessPortfolio(portfolio) : null), [portfolio]);
  const events = useMemo(() => (portfolio ? getClimateEvents(portfolio) : []), [portfolio]);
  const alerts = useMemo(() => (portfolio ? getAlerts(portfolio) : []), [portfolio]);
  const byFarmId = useMemo(() => new Map((assessment?.ranked ?? []).map((a) => [a.farmId, a])), [assessment]);
  const farmsById = useMemo(() => new Map((portfolio?.farms ?? []).map((f) => [f.id, f])), [portfolio]);
  const rows = useMemo(() => (portfolio && assessment ? buildRows(portfolio, assessment.ranked) : []), [portfolio, assessment]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;
  const highlightedIds = useMemo(() => (selectedEvent ? new Set(selectedEvent.affectedFarmIds) : null), [selectedEvent]);

  const cropRows = useMemo<ExposureRow[]>(
    () => (assessment?.byCrop ?? []).map((r) => ({ label: CROPS[r.crop]?.label ?? r.crop, exposure: r.exposure, stressedExposure: r.stressedExposure })).sort((a, b) => b.exposure - a.exposure),
    [assessment],
  );
  const zoneRows = useMemo<ExposureRow[]>(
    () =>
      (assessment?.byZone ?? [])
        .map((r) => ({ label: portfolio?.zones.find((z) => z.id === r.zoneId)?.name ?? 'Unassigned', exposure: r.exposure, stressedExposure: r.stressedExposure }))
        .sort((a, b) => b.exposure - a.exposure),
    [assessment, portfolio],
  );

  if (!portfolio || !assessment) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <EmptyState
          icon={<FolderOpen size={18} />}
          title="Portfolio not found"
          description="It may have been deleted, or it was saved in another browser."
          action={
            <Link to="/" className={buttonClass('secondary')}>
              <ArrowLeft size={16} />
              Back to portfolios
            </Link>
          }
        />
      </div>
    );
  }

  const cur = portfolio.currency;
  const total = assessment.totalExposure;
  const high = assessment.exposureByTier.high;
  const watch = assessment.exposureByTier.watch;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} />
        Portfolios
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-ink">{portfolio.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{portfolio.lender || 'No lender set'}</span>
            <span className="flex items-center gap-1.5">
              <CalendarClock size={16} aria-hidden />
              As of {date(AS_OF)}
            </span>
            <span>
              {portfolio.farms.length} {portfolio.farms.length === 1 ? 'farm' : 'farms'}
            </span>
          </p>
        </div>
        <Badge tone="info" className="py-1">
          <Info size={14} aria-hidden />
          Simulated satellite and weather data for demonstration
        </Badge>
      </div>

      {portfolio.farms.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<Plus size={18} />}
          title="This portfolio has no farms"
          description="Create a new portfolio and draw the financed fields on the map."
          action={
            <Link to="/" className={buttonClass('secondary')}>
              Back to portfolios
            </Link>
          }
        />
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total exposure" icon={<Banknote size={16} aria-hidden />} value={money(total, cur)} sub="Outstanding principal across all loans" />
            <Stat label="In high stress" tone="danger" value={money(high, cur)} sub={`${pct(share(high, total))} of the book`} />
            <Stat label="On watch" tone="warn" value={money(watch, cur)} sub={`${pct(share(watch, total))} of the book`} />
            <div className="rounded-card border border-line bg-white p-4 shadow-panel">
              <div className="text-sm text-muted">Farms by status</div>
              <div className="mt-2 flex items-end gap-5">
                {TIERS.map((t) => (
                  <div key={t}>
                    <div className="text-2xl font-semibold tabular-nums" style={{ color: TIER_COLORS[t].ink }}>
                      {assessment.farmsByTier[t]}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TIER_COLORS[t].fg }} aria-hidden />
                      {TIER_LABELS[t]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="h-[460px] overflow-hidden rounded-card border border-line shadow-panel lg:h-[560px]">
              <DashboardMap farms={portfolio.farms} assessments={byFarmId} highlightedIds={highlightedIds} onFarmClick={(id) => navigate(`/portfolios/${portfolio.id}/farms/${id}`)} />
            </div>
            <div className="lg:h-[560px] lg:overflow-y-auto">
              <EventsPanel events={events} currency={cur} selectedId={selectedEventId} onSelect={setSelectedEventId} />
            </div>
          </div>

          <div className="mt-6">
            <Watchlist portfolio={portfolio} rows={rows} />
          </div>

          <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
            <ExposureChart title="Exposure by crop" rows={cropRows} currency={cur} />
            <ExposureChart title="Exposure by zone" rows={zoneRows} currency={cur} />
            <AlertsList alerts={alerts} farms={farmsById} portfolioId={portfolio.id} />
          </div>
        </>
      )}
    </div>
  );
}

export default DashboardPage;
