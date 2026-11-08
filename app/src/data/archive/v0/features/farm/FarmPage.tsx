import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, MapPin } from 'lucide-react';
import { CROPS } from '@/domain/types';
import { effectiveThresholds } from '@/domain/defaults';
import { addMonths } from '@/domain/dates';
import { usePortfolio } from '@/state/store';
import { AS_OF, SERIES_START, aggregate, assessFarm, getFarmSeries } from '@/data/api';
import { CHART_COLORS } from '@/shared/chartColors';
import { date, hectares, money, number, pct } from '@/shared/format';
import { Badge, Card, EmptyState, Stat, TierBadge, buttonClass } from '@/shared/ui';
import { DriversList } from './DriversList';
import { LoanCard } from './LoanCard';
import { FarmMiniMap } from './FarmMiniMap';
import { BandChart, RainChart, TempChart, TrendChart } from './FarmCharts';
import { installmentsInRange, latestVsNormal, stressWindowIntervals, timelineEndFor, trailingSum } from './chartData';
import { monthDayLabel } from '@/features/wizard/zones/zoneLogic';

function NotFound({ title, portfolioId }: { title: string; portfolioId?: string }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <EmptyState
        icon={<MapPin size={18} />}
        title={title}
        description="It may have been removed, or it was saved in another browser."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {portfolioId && (
              <Link to={`/portfolios/${portfolioId}`} className={buttonClass('secondary')}>
                <ArrowLeft size={16} />
                Back to dashboard
              </Link>
            )}
            <Link to="/" className={buttonClass(portfolioId ? 'ghost' : 'secondary')}>
              All portfolios
            </Link>
          </div>
        }
      />
    </div>
  );
}

function signedPct(fraction: number): string {
  return `${fraction >= 0 ? '+' : ''}${pct(fraction)}`;
}

export function FarmPage() {
  const { portfolioId, farmId } = useParams();
  const portfolio = usePortfolio(portfolioId);
  const farm = useMemo(() => portfolio?.farms.find((f) => f.id === farmId), [portfolio, farmId]);
  const zone = useMemo(() => (portfolio && farm ? (portfolio.zones.find((z) => z.id === farm.zoneId) ?? portfolio.zones[0]) : undefined), [portfolio, farm]);

  const assessment = useMemo(() => (farm && zone ? assessFarm(farm, zone) : null), [farm, zone]);
  const series = useMemo(() => (farm && zone ? getFarmSeries(farm, zone) : null), [farm, zone]);
  const derived = useMemo(() => {
    if (!series || !farm || !zone) return null;
    const plan = farm.loan ? (farm.loan.installments.length ? farm.loan.installments : [{ dueDate: farm.loan.maturityDate, amount: farm.loan.amount }]) : [];
    // Extend the timeline past today so upcoming installments (the ones to act on) are visible.
    const timelineEnd = timelineEndFor(AS_OF, plan);
    const windows = stressWindowIntervals(zone.stressWindow, SERIES_START, timelineEnd);
    const windowMonths = new Set<string>();
    for (const w of windows) {
      let m = `${w.start.slice(0, 7)}-01`;
      while (m <= w.end) {
        windowMonths.add(m);
        m = addMonths(m, 1);
      }
    }
    return {
      timelineEnd,
      windows,
      windowMonths,
      installments: installmentsInRange(plan, SERIES_START, timelineEnd),
      rainMonthly: aggregate(series.precip, 'month', 'sum'),
      etoWeekly: aggregate(series.eto, 'week', 'mean'),
      soilWeekly: aggregate(series.soilMoisture, 'week', 'mean'),
      ndviLatest: latestVsNormal(series.ndvi),
      soilLatest: latestVsNormal(series.soilMoisture),
      rain30: trailingSum(series.precip, 30),
      eto30: trailingSum(series.eto, 30),
      thresholds: effectiveThresholds(farm, zone),
    };
  }, [series, farm, zone]);

  if (!portfolio) return <NotFound title="Portfolio not found" />;
  if (!farm || !zone || !assessment || !series || !derived) return <NotFound title="Farm not found" portfolioId={portfolio.id} />;

  const cur = portfolio.currency;
  const crop = CROPS[farm.crop];
  const a = assessment;
  const d = derived;

  const rainDiff = d.rain30.mean > 0 ? (d.rain30.value - d.rain30.mean) / d.rain30.mean : 0;
  const etoDiff = d.eto30.mean > 0 ? (d.eto30.value - d.eto30.mean) / d.eto30.mean : 0;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-ink">
          Portfolios
        </Link>
        <ChevronRight size={16} aria-hidden />
        <Link to={`/portfolios/${portfolio.id}`} className="hover:text-ink">
          {portfolio.name}
        </Link>
        <ChevronRight size={16} aria-hidden />
        <span className="text-ink">{farm.name}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-ink">{farm.name}</h1>
            <TierBadge tier={a.tier} className="py-1" />
            {a.inStressWindow && <Badge tone="info">In stress window</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: crop?.color }} aria-hidden />
              {crop?.label ?? farm.crop}
            </span>
            <span>·</span>
            <span>{hectares(farm.areaHa)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: zone.color }} aria-hidden />
              {zone.name}
              {zone.irrigated ? ' (irrigated)' : ''}
            </span>
            {farm.sowingDate && (
              <>
                <span>·</span>
                <span>Sown {date(farm.sowingDate)}</span>
              </>
            )}
            <span>·</span>
            <span>As of {date(AS_OF)}</span>
          </p>
          <p className="mt-3 max-w-3xl text-base text-ink">{a.headline}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Stress score" tone={a.tier === 'high' ? 'danger' : a.tier === 'watch' ? 'warn' : 'brand'} value={`${a.score} / 100`} sub="0 = normal for this field" />
        <Stat label="Exposure" value={money(a.exposure, cur)} sub="Outstanding principal today" />
        <Stat
          label="Next installment"
          value={a.nextInstallment ? money(a.nextInstallment.amount, cur) : 'None'}
          sub={a.nextInstallment ? `Due ${date(a.nextInstallment.dueDate)}` : 'No payments left'}
        />
        <Stat label="Installments in stress window" tone={a.installmentsInStress > 0 ? 'warn' : 'neutral'} value={a.installmentsInStress} sub="Due while the crop is most exposed" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DriversList assessment={a} />
          <TrendChart trend={a.trend} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card flush className="overflow-hidden">
            <div className="h-[240px]">
              <FarmMiniMap farm={farm} tier={a.tier} />
            </div>
          </Card>
          <LoanCard farm={farm} zone={zone} currency={cur} />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Last 24 months against this field’s normal</h2>
        <p className="mt-1 text-sm text-muted">
          The shaded band is this field’s usual range for each date of the year over the last {zone.baselineYears} years. The amber shading marks the zone’s crop stress window (
          {monthDayLabel(zone.stressWindow.start)} to {monthDayLabel(zone.stressWindow.end)}). The timeline runs past today to show upcoming installments. Simulated data.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <BandChart
          title="Vegetation health (NDVI)"
          subtitle={
            d.ndviLatest
              ? `Latest clear image ${date(d.ndviLatest.date)}: ${number(d.ndviLatest.value, 2)} vs normal ${number(d.ndviLatest.mean, 2)} for that date. Gaps are cloudy dates.`
              : 'Every 5 days; gaps are cloudy dates.'
          }
          points={series.ndvi}
          start={SERIES_START}
          end={d.timelineEnd}
          asOf={AS_OF}
          unit=""
          digits={2}
          color={CHART_COLORS[0]}
          valueLabel="NDVI"
          windows={d.windows}
          installments={d.installments}
          height={280}
          yDomain={[0, 1]}
          dot
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <RainChart
            title="Rain by month"
            subtitle={`Last 30 days: ${number(d.rain30.value, 0)} mm vs ${number(d.rain30.mean, 0)} mm normal (${signedPct(rainDiff)}).`}
            months={d.rainMonthly}
            windowMonths={d.windowMonths}
            asOf={AS_OF}
            end={d.timelineEnd}
            installments={d.installments}
          />
          <BandChart
            title="Soil moisture (weekly average)"
            subtitle={d.soilLatest ? `Today ${number(d.soilLatest.value, 2)} m³/m³ vs normal ${number(d.soilLatest.mean, 2)} for this date.` : undefined}
            points={d.soilWeekly}
            start={SERIES_START}
            end={d.timelineEnd}
            asOf={AS_OF}
            unit="m³/m³"
            digits={3}
            color={CHART_COLORS[3]}
            valueLabel="Soil moisture"
            windows={d.windows}
            installments={d.installments}
            connectNulls
          />
          <BandChart
            title="Crop water demand, ETo (weekly average)"
            subtitle={`Last 30 days: ${number(d.eto30.value, 0)} mm vs ${number(d.eto30.mean, 0)} mm normal (${signedPct(etoDiff)}).`}
            points={d.etoWeekly}
            start={SERIES_START}
            end={d.timelineEnd}
            asOf={AS_OF}
            unit="mm/day"
            digits={1}
            color={CHART_COLORS[2]}
            valueLabel="ETo"
            windows={d.windows}
            installments={d.installments}
            connectNulls
          />
          <TempChart
            title="Temperature"
            subtitle={`Limits for this farm: frost at or below ${number(d.thresholds.frostC, 1)} °C, heat at or above ${number(d.thresholds.heatC, 1)} °C.`}
            tmax={series.tmax}
            tmin={series.tmin}
            start={SERIES_START}
            end={d.timelineEnd}
            asOf={AS_OF}
            frostC={d.thresholds.frostC}
            heatC={d.thresholds.heatC}
            windows={d.windows}
            installments={d.installments}
          />
        </div>
      </div>
    </div>
  );
}

export default FarmPage;
