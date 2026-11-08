/**
 * Series charts for the farm page (recharts). Every chart shares one numeric UTC-ms time axis over the 13-month
 * window, so stage bands, the "today" line and installment lines sit at the same x on every chart.
 * Values and baselines come from FarmAssessment.series (service, native data); thresholds are the farm's
 * effective rules (labelled approximate).
 */
import { useMemo, type ReactNode } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FarmAssessment, Installment, Series, StageBand } from '@/domain/types';
import { addDays, parseISODate } from '@/domain/dates';
import { CHART_COLORS, PERIL_COLORS, SEMANTIC } from '@/shared/chartColors';
import { date, money, number, signed } from '@/shared/format';
import { Card, DataAsOf, ProvenanceBadge } from '@/shared/ui';
import type { Currency } from '@/domain/types';
import {
  STAGE_FILLS,
  installmentsIn,
  latestPoint,
  layoutStageBands,
  monthTicks,
  monthlyTotals,
  msToISO,
  toTimeRows,
  type ChartWindow,
  type StageThresholdBand,
  type TimeRow,
} from './farmData';
import { StageStrip } from './parts';

const AXIS_TICK = { fill: SEMANTIC.muted, fontSize: 12 };
const Y_AXIS_W = 48;
const MARGIN = { top: 16, right: 12, bottom: 0, left: 0 };
const T = (iso: string) => parseISODate(iso);

type TooltipPayload = ReadonlyArray<{ payload?: unknown }> | undefined;

/** Why a series is empty, from its provenance note (without a leading 'unavailable:' tag). */
function unavailableReason(series: Series): string {
  const note = series.provenance.note?.replace(/^unavailable:\s*/i, '').trim();
  return note || 'The source returned no data for this window.';
}

/* ───────────────────────── shared overlays ───────────────────────── */

interface Overlay {
  win: ChartWindow;
  bands: readonly StageBand[];
  installments: readonly Installment[];
}

/** Stage bands (soft fills), installment lines and the today line, as recharts children. */
function overlays({ win, bands, installments }: Overlay) {
  const out: ReactNode[] = [];
  for (const b of layoutStageBands(bands, win.start, win.end)) {
    out.push(
      <ReferenceArea
        key={`stage-${b.band.start}`}
        x1={T(b.band.start < win.start ? win.start : b.band.start)}
        x2={T(addDays(b.band.end > win.end ? win.end : b.band.end, 1))}
        fill={STAGE_FILLS[b.colorIndex]}
        fillOpacity={0.55}
        strokeOpacity={0}
        ifOverflow="hidden"
      />,
    );
  }
  installmentsIn(installments, win.start, win.end).forEach((i, k) => {
    const upcoming = i.dueDate > win.asOf;
    out.push(
      <ReferenceLine
        key={`inst-${i.dueDate}-${k}`}
        x={T(i.dueDate)}
        stroke={upcoming ? SEMANTIC.danger : SEMANTIC.ink}
        strokeOpacity={upcoming ? 0.9 : 0.4}
        strokeWidth={upcoming ? 1.75 : 1}
        strokeDasharray={upcoming ? '5 3' : '2 3'}
        ifOverflow="hidden"
      />,
    );
  });
  out.push(<ReferenceLine key="today" x={T(win.asOf)} stroke={SEMANTIC.ink} strokeWidth={1.5} ifOverflow="hidden" label={{ value: 'Today', position: 'top', fill: SEMANTIC.ink, fontSize: 11 }} />);
  return out;
}

function xAxis(win: ChartWindow) {
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[T(win.start), T(addDays(win.end, 1))]}
      ticks={monthTicks(win.start, win.end, 2)}
      tickFormatter={(t: number) => date(msToISO(t), 'month')}
      tick={AXIS_TICK}
      axisLine={{ stroke: SEMANTIC.line }}
      tickLine={false}
      allowDataOverflow
    />
  );
}

/* ───────────────────────── legend ───────────────────────── */

type SwatchKind = 'line' | 'dashed' | 'band' | 'bar' | 'threshold' | 'paid' | 'due' | 'today';

function Swatch({ kind, color }: { kind: SwatchKind; color?: string }) {
  const c = color ?? SEMANTIC.ink;
  switch (kind) {
    case 'line':
      return <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: c }} />;
    case 'dashed':
      return <span className="w-4 border-t-2 border-dashed" style={{ borderColor: SEMANTIC.baselineMean }} />;
    case 'band':
      return <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: SEMANTIC.baselineBand, opacity: 0.3 }} />;
    case 'bar':
      return <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />;
    case 'threshold':
      return <span className="w-4 border-t-2 border-dashed" style={{ borderColor: c }} />;
    case 'paid':
      return <span className="h-3 border-l-2 border-dotted opacity-50" style={{ borderColor: SEMANTIC.ink }} />;
    case 'due':
      return <span className="h-3 border-l-2 border-dashed" style={{ borderColor: SEMANTIC.danger }} />;
    case 'today':
      return <span className="h-3 border-l-2" style={{ borderColor: SEMANTIC.ink }} />;
  }
}

function Legend({ items }: { items: { kind: SwatchKind; color?: string; label: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch kind={i.kind} color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function overlayLegend(win: ChartWindow, installments: readonly Installment[]) {
  const shown = installmentsIn(installments, win.start, win.end);
  const paid = shown.filter((i) => i.dueDate <= win.asOf).length;
  return [
    { kind: 'today' as const, label: 'Today' },
    ...(paid ? [{ kind: 'paid' as const, label: 'Installment (past)' }] : []),
    ...(shown.length - paid ? [{ kind: 'due' as const, label: 'Installment due' }] : []),
  ];
}

/* ───────────────────────── band chart (ndvi, ndmi, tmin, tmax, eto) ───────────────────────── */

function BandTooltip({ active, payload, unit, digits, valueLabel }: { active?: boolean; payload: TooltipPayload; unit: string; digits: number; valueLabel: string }) {
  const row = payload?.[0]?.payload as TimeRow | undefined;
  if (!active || !row) return null;
  const u = unit && unit !== 'index' ? ` ${unit}` : '';
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">{date(row.date)}</p>
      <p className="mt-1 tabular-nums text-ink">
        {valueLabel}: {row.value === null ? <span className="text-muted">no valid observation</span> : `${signed(row.value, digits)}${u}`}
        {row.value !== null && row.estimated && <span className="text-muted"> (gap-filled)</span>}
      </p>
      <p className="tabular-nums text-muted">
        {row.p50 === null ? 'No baseline for this date' : `Normal ${signed(row.p50, digits)}${u}`}
        {row.band && ` (usual ${signed(row.band[0], digits)} to ${signed(row.band[1], digits)})`}
      </p>
    </div>
  );
}

export interface BandChartProps {
  title: string;
  subtitle?: ReactNode;
  series: Series;
  dataAsOf?: string | null;
  win: ChartWindow;
  bands: readonly StageBand[];
  installments: readonly Installment[];
  color: string;
  valueLabel: string;
  digits: number;
  /** Per-stage threshold reference segments. */
  thresholds?: { bands: StageThresholdBand[]; key: 'frostCriticalC' | 'heatC'; label: string; color: string; fallback: number | null };
  yDomain?: [number, number];
  height?: number;
  footer?: ReactNode;
}

/** Even ticks for index charts (NDVI 0–1 → 0, 0.2 … 1; NDMI −1–1 → −1, −0.5 … 1) so labels never round unevenly. */
function indexTicks(domain: unknown, digits: number): number[] | undefined {
  if (digits <= 1 || !Array.isArray(domain) || typeof domain[0] !== 'number' || typeof domain[1] !== 'number') return undefined;
  const [lo, hi] = domain as [number, number];
  const step = hi - lo <= 1 ? 0.2 : 0.5;
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
}

export function BandChart({ title, subtitle, series, dataAsOf, win, bands, installments, color, valueLabel, digits, thresholds, yDomain, height = 220, footer }: BandChartProps) {
  const rows = useMemo(() => toTimeRows(series.points), [series.points]);
  const segments = useMemo(() => {
    if (!thresholds) return [];
    return thresholds.bands
      .filter((b) => b[thresholds.key] !== null)
      .map((b) => ({ x1: T(b.start < win.start ? win.start : b.start), x2: T(addDays(b.end, 1)), y: b[thresholds.key] as number, label: b.label }));
  }, [thresholds, win.start]);
  const useFallback = thresholds && segments.length === 0 && thresholds.fallback !== null;
  const allY = [
    ...rows.flatMap((r) => [r.value, r.band?.[0], r.band?.[1]]),
    ...segments.map((s) => s.y),
    ...(useFallback ? [thresholds!.fallback] : []),
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const domain: [number, number] | ['auto', 'auto'] =
    yDomain ?? (allY.length ? [Math.floor(Math.min(...allY) - (digits > 1 ? 0.05 : 1)), Math.ceil(Math.max(...allY) + (digits > 1 ? 0.05 : 1))] : ['auto', 'auto']);
  const empty = series.points.length === 0;
  const unit = series.unit === 'index' ? '' : series.unit;
  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataAsOf value={dataAsOf ?? series.provenance.observedAt} />
          <ProvenanceBadge provenance={series.provenance} title={title} />
        </div>
      }
    >
      {empty ? (
        <div className="flex h-40 items-center justify-center rounded-card bg-surface px-4 text-center text-sm text-muted">
          Not available. {unavailableReason(series)}
        </div>
      ) : (
        <>
          <Legend
            items={[
              { kind: 'line', color, label: valueLabel },
              { kind: 'dashed', label: 'Own normal (p50)' },
              { kind: 'band', label: 'Usual range (p10–p90)' },
              ...(thresholds && (segments.length || useFallback) ? [{ kind: 'threshold' as const, color: thresholds.color, label: thresholds.label }] : []),
              ...overlayLegend(win, installments),
            ]}
          />
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={MARGIN}>
                <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
                {xAxis(win)}
                <YAxis width={Y_AXIS_W} tick={AXIS_TICK} axisLine={false} tickLine={false} domain={domain} allowDataOverflow ticks={indexTicks(domain, digits)} tickFormatter={(v: number) => signed(v, digits > 1 ? 1 : 0)} />
                {overlays({ win, bands, installments })}
                <Area dataKey="band" type="monotone" stroke="none" fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity * 2} isAnimationActive={false} activeDot={false} connectNulls={false} />
                <Line dataKey="p50" type="monotone" stroke={SEMANTIC.baselineMean} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
                <Line dataKey="value" type="monotone" stroke={color} strokeWidth={series.variable === 'ndvi' || series.variable === 'ndmi' ? 2 : 1.25} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                {segments.map((s) => (
                  <ReferenceLine
                    key={`th-${s.x1}`}
                    segment={[
                      { x: s.x1, y: s.y },
                      { x: s.x2, y: s.y },
                    ]}
                    stroke={thresholds!.color}
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    ifOverflow="hidden"
                  />
                ))}
                {useFallback && <ReferenceLine y={thresholds!.fallback!} stroke={thresholds!.color} strokeDasharray="5 4" strokeWidth={1.5} />}
                <Tooltip content={(p) => <BandTooltip active={p.active} payload={p.payload as TooltipPayload} unit={unit} digits={digits} valueLabel={valueLabel} />} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {footer && <div className="mt-3 text-sm text-muted">{footer}</div>}
    </Card>
  );
}

/* ───────────────────────── monthly rain ───────────────────────── */

interface RainRow {
  t: number;
  month: string;
  value: number | null;
  normal: number | null;
  band: [number, number] | null;
  daysObserved: number;
  days: number;
  partial: boolean;
}

function RainTooltip({ active, payload }: { active?: boolean; payload: TooltipPayload }) {
  const row = payload?.[0]?.payload as RainRow | undefined;
  if (!active || !row) return null;
  const diff = row.value !== null && row.normal !== null && row.normal > 0 ? (row.value - row.normal) / row.normal : null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">
        {date(row.month, 'month')}
        {row.partial && <span className="font-normal text-muted"> (part of the month)</span>}
      </p>
      <p className="mt-1 tabular-nums text-ink">Rain: {row.value === null ? <span className="text-muted">no observation</span> : `${number(row.value, 0)} mm`}</p>
      <p className="tabular-nums text-muted">
        {row.normal === null ? 'No baseline' : `Normal ${number(row.normal, 0)} mm`}
        {diff !== null && ` (${diff >= 0 ? '+' : '−'}${number(Math.abs(diff) * 100, 0)} %)`}
      </p>
      {row.daysObserved < row.days && <p className="tabular-nums text-muted">{row.days - row.daysObserved} days without data</p>}
    </div>
  );
}

export function RainChart({ series, dataAsOf, win, bands, installments, height = 220 }: Omit<BandChartProps, 'title' | 'color' | 'valueLabel' | 'digits' | 'thresholds'>) {
  const rows = useMemo<RainRow[]>(
    () => monthlyTotals(series.points).map((m) => ({ ...m, t: T(addDays(m.month, 14)) })),
    [series.points],
  );
  const empty = series.points.length === 0;
  return (
    <Card
      title="Rain"
      subtitle="Monthly totals against this farm’s 1991–2020 normal; the usual range is approximate (sum of daily-rate p10/p90)."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DataAsOf value={dataAsOf ?? series.provenance.observedAt} />
          <ProvenanceBadge provenance={series.provenance} title="Rain" />
        </div>
      }
    >
      {empty ? (
        <div className="flex h-40 items-center justify-center rounded-card bg-surface px-4 text-center text-sm text-muted">
          Not available. {unavailableReason(series)}
        </div>
      ) : (
        <>
          <Legend
            items={[
              { kind: 'bar', color: CHART_COLORS[1], label: 'Rain this month' },
              { kind: 'dashed', label: 'Normal' },
              { kind: 'band', label: 'Usual range (p10–p90)' },
              ...overlayLegend(win, installments),
            ]}
          />
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={MARGIN}>
                <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
                {xAxis(win)}
                <YAxis width={Y_AXIS_W} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => number(v, 0)} />
                {overlays({ win, bands, installments })}
                <Area dataKey="band" type="monotone" stroke="none" fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity * 2} isAnimationActive={false} activeDot={false} />
                <Bar dataKey="value" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} barSize={14} isAnimationActive={false} />
                <Line dataKey="normal" type="monotone" stroke={SEMANTIC.baselineMean} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
                <Tooltip cursor={{ fill: SEMANTIC.surface }} content={(p) => <RainTooltip active={p.active} payload={p.payload as TooltipPayload} />} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── section ───────────────────────── */

export function SeriesSection({
  assessment,
  win,
  thresholds,
  installments,
  currency,
  fallbackFrost,
  fallbackHeat,
}: {
  assessment: FarmAssessment;
  win: ChartWindow;
  thresholds: StageThresholdBand[];
  installments: readonly Installment[];
  currency: Currency;
  fallbackFrost: number | null;
  fallbackHeat: number | null;
}) {
  const { series, stageBands: bands, dataAsOf, water } = assessment;
  const common = { win, bands, installments };
  const ndviLatest = latestPoint(series.ndvi.points);
  const ndmiLatest = latestPoint(series.ndmi.points);
  // Current stage = the last band (bands end at asOf). Templates not loaded → the bands carry nulls: use the drivers' normals.
  const frostNow = thresholds[thresholds.length - 1]?.frostCriticalC ?? fallbackFrost;
  const heatNow = thresholds[thresholds.length - 1]?.heatC ?? fallbackHeat;
  const next = assessment.nextInstallment;
  return (
    <section aria-labelledby="farm-series" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="farm-series" className="text-lg font-semibold text-ink">
            Signals over 13 months
          </h2>
          <p className="text-sm text-muted">
            Shaded bands are crop stages (approximate). Dashed red lines are installments due
            {next ? `; next ${money(next.amount, currency)} on ${date(next.dueDate)}` : ''}.
          </p>
        </div>
      </div>
      <div className="rounded-card border border-line bg-white px-3 py-2 shadow-panel">
        <div style={{ marginLeft: Y_AXIS_W, marginRight: MARGIN.right }}>
          <StageStrip bands={bands} start={win.start} end={win.end} marker={win.asOf} markerLabel="Today" compact />
        </div>
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <BandChart
          {...common}
          title="Vigour (NDVI)"
          subtitle={
            ndviLatest
              ? `Latest ${number(ndviLatest.value as number, 2)} on ${date(ndviLatest.date)}${ndviLatest.p50 !== null ? `, normal ${number(ndviLatest.p50, 2)}` : ''}. Polygon mean of native 10 m pixels.`
              : 'Polygon mean of native 10 m pixels.'
          }
          series={series.ndvi}
          dataAsOf={dataAsOf.ndvi}
          color={CHART_COLORS[0]}
          valueLabel="NDVI"
          digits={2}
        />
        <BandChart
          {...common}
          title="Canopy moisture (NDMI)"
          subtitle={
            ndmiLatest
              ? `Latest ${signed(ndmiLatest.value as number, 2)} on ${date(ndmiLatest.date)}${ndmiLatest.p50 !== null ? `, normal ${signed(ndmiLatest.p50, 2)}` : ''}.`
              : 'Polygon mean of native 10 m pixels.'
          }
          series={series.ndmi}
          dataAsOf={dataAsOf.ndmi}
          color={CHART_COLORS[1]}
          valueLabel="NDMI"
          digits={2}
        />
        <BandChart
          {...common}
          title="Night temperature (Tmin)"
          subtitle={frostNow !== null ? `Frost damage starts at ${signed(frostNow, 1)} °C in the current stage (approximate, per stage).` : 'Daily minimum against its 1991–2020 normal.'}
          series={series.tmin}
          dataAsOf={dataAsOf.tmin}
          color={PERIL_COLORS.frost}
          valueLabel="Daily min"
          digits={1}
          thresholds={{ bands: thresholds, key: 'frostCriticalC', label: 'Frost damage threshold by stage', color: PERIL_COLORS.frost, fallback: fallbackFrost }}
        />
        <BandChart
          {...common}
          title="Day temperature (Tmax)"
          subtitle={heatNow !== null ? `Heat stress starts at ${signed(heatNow, 1)} °C in the current stage (approximate, per stage).` : 'Daily maximum against its 1991–2020 normal.'}
          series={series.tmax}
          dataAsOf={dataAsOf.tmax}
          color={PERIL_COLORS.heat}
          valueLabel="Daily max"
          digits={1}
          thresholds={{ bands: thresholds, key: 'heatC', label: 'Heat threshold by stage', color: PERIL_COLORS.heat, fallback: fallbackHeat }}
        />
        <RainChart {...common} series={series.precip} dataAsOf={dataAsOf.precip} />
        <BandChart
          {...common}
          title="Evaporative demand (ETo)"
          subtitle="Reference evapotranspiration, mm per day."
          series={series.eto}
          dataAsOf={dataAsOf.eto}
          color={CHART_COLORS[2]}
          valueLabel="ETo"
          digits={1}
          footer={
            <span>
              Crop need now (Kc {number(water.demand.kc, 2)} × ETo): {water.demand.need7dMm === null ? '–' : `${number(water.demand.need7dMm, 0)} mm`} in the last 7 days,{' '}
              {water.demand.need30dMm === null ? '–' : `${number(water.demand.need30dMm, 0)} mm`} in the last 30 days.
            </span>
          }
        />
      </div>
    </section>
  );
}
