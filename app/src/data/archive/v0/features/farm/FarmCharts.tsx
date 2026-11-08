/** Recharts charts for the farm drill-down. All time charts use a numeric UTC-ms x axis. */
import { useMemo, type ReactNode } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Installment, SeriesPoint } from '@/domain/types';
import { addMonths, parseISODate } from '@/domain/dates';
import { CHART_COLORS, PERIL_COLORS, SEMANTIC, TIER_COLORS } from '@/shared/chartColors';
import { date, number, TIER_LABELS } from '@/shared/format';
import { Card } from '@/shared/ui';
import { monthTicks, TIER_BANDS, TIER_CUTOFFS, toTimePoints, type DateInterval, type TimePoint } from './chartData';

const AXIS_TICK = { fill: SEMANTIC.muted, fontSize: 12 };
const WINDOW_FILL = '#A86A12';
const WINDOW_OPACITY = 0.07;
const INSTALLMENT_STROKE = '#141A17';
const UPCOMING_FILL = '#56615B';
const UPCOMING_OPACITY = 0.06;

/**
 * "Today" line, light "Upcoming" shading after today, and installment markers (paid ones faint,
 * upcoming ones strong). Returned as an array so it can sit directly inside a Recharts chart.
 * `x` maps an ISO date to the chart's x value (UTC ms for time axes, a month key for the rain bars).
 */
function timelineOverlay({ asOf, end, installments, x }: { asOf?: string; end: string; installments: Installment[]; x: (iso: string) => number | string }) {
  const out = [];
  if (asOf && asOf < end) {
    out.push(
      <ReferenceArea
        key="upcoming"
        x1={x(asOf)}
        x2={x(end)}
        fill={UPCOMING_FILL}
        fillOpacity={UPCOMING_OPACITY}
        strokeOpacity={0}
        ifOverflow="hidden"
        label={{ value: 'Upcoming', position: 'insideTopLeft', fill: SEMANTIC.muted, fontSize: 11 }}
      />,
    );
  }
  installments.forEach((i, idx) => {
    const upcoming = !!asOf && i.dueDate > asOf;
    out.push(
      <ReferenceLine
        key={`inst-${i.dueDate}-${idx}`}
        x={x(i.dueDate)}
        stroke={upcoming ? SEMANTIC.danger : INSTALLMENT_STROKE}
        strokeOpacity={upcoming ? 0.9 : 0.4}
        strokeWidth={upcoming ? 1.75 : 1}
        strokeDasharray={upcoming ? '5 3' : '2 3'}
        ifOverflow="hidden"
      />,
    );
  });
  if (asOf) {
    out.push(
      <ReferenceLine key="today" x={x(asOf)} stroke={SEMANTIC.ink} strokeWidth={1.5} ifOverflow="hidden" label={{ value: 'Today', position: 'top', fill: SEMANTIC.ink, fontSize: 11 }} />,
    );
  }
  return out;
}

/** Legend entries for the overlay above. */
function overlayLegend(asOf: string | undefined, end: string, installments: Installment[]) {
  const paid = installments.filter((i) => !asOf || i.dueDate <= asOf).length;
  const upcoming = installments.length - paid;
  return [
    ...(asOf ? [{ kind: 'today', label: 'Today' }] : []),
    ...(asOf && asOf < end ? [{ kind: 'upcoming', label: 'Upcoming' }] : []),
    ...(paid ? [{ kind: 'installment', label: asOf ? 'Installment paid' : 'Installment due' }] : []),
    ...(upcoming ? [{ kind: 'installmentDue', label: 'Installment due' }] : []),
  ];
}

type TooltipPayload = ReadonlyArray<{ payload?: unknown }> | undefined;

// ------------------------------------------------------------------ legend

function LegendSwatch({ kind, color }: { kind: string; color?: string }) {
  const c = color ?? SEMANTIC.ink;
  switch (kind) {
    case 'line':
      return <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: c }} />;
    case 'dashed':
      return <span className="w-4 border-t-2 border-dashed" style={{ borderColor: SEMANTIC.baselineMean }} />;
    case 'band':
      return <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: SEMANTIC.baselineBand, opacity: 0.3 }} />;
    case 'window':
      return <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: WINDOW_FILL, opacity: 0.25 }} />;
    case 'installment':
      return <span className="h-3 border-l-2 border-dotted opacity-50" style={{ borderColor: INSTALLMENT_STROKE }} />;
    case 'installmentDue':
      return <span className="h-3 border-l-2 border-dashed" style={{ borderColor: SEMANTIC.danger }} />;
    case 'today':
      return <span className="h-3 border-l-2" style={{ borderColor: SEMANTIC.ink }} />;
    case 'upcoming':
      return <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: UPCOMING_FILL, opacity: 0.2 }} />;
    case 'dashedColor':
      return <span className="w-4 border-t-2 border-dashed" style={{ borderColor: c }} />;
    case 'refline':
      return <span className="w-4 border-t-2 border-dashed" style={{ borderColor: c }} />;
    case 'bar':
      return <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />;
    default:
      return null;
  }
}

function Legend({ items }: { items: { kind: string; color?: string; label: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <LegendSwatch kind={i.kind} color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ band chart

function BandTooltip({ active, payload, unit, digits, valueLabel }: { active?: boolean; payload: TooltipPayload; unit: string; digits: number; valueLabel: string }) {
  const row = payload?.[0]?.payload as TimePoint | undefined;
  if (!active || !row) return null;
  const u = unit ? ` ${unit}` : '';
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">{date(row.date)}</p>
      <p className="mt-1 tabular-nums text-ink">
        {valueLabel}: {row.value === null ? <span className="text-muted">no clear image (clouds)</span> : `${number(row.value, digits)}${u}`}
      </p>
      <p className="tabular-nums text-muted">
        Normal {number(row.mean, digits)}
        {u} (usual range {number(row.band[0], digits)}–{number(row.band[1], digits)})
      </p>
    </div>
  );
}

export interface BandChartProps {
  title: string;
  subtitle?: ReactNode;
  points: SeriesPoint[];
  start: string;
  end: string;
  unit: string;
  digits: number;
  color: string;
  valueLabel: string;
  windows: DateInterval[];
  installments?: Installment[];
  /** Demo "today": draws a Today line and shades the period after it as upcoming. */
  asOf?: string;
  height?: number;
  yDomain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
  connectNulls?: boolean;
  dot?: boolean;
}

export function BandChart({ title, subtitle, points, start, end, unit, digits, color, valueLabel, windows, installments = [], asOf, height = 240, yDomain, connectNulls = false, dot = false }: BandChartProps) {
  const data = useMemo(() => toTimePoints(points), [points]);
  const ticks = useMemo(() => monthTicks(start, end, 3), [start, end]);
  const domain: [number, number] = [parseISODate(start), parseISODate(end)];
  const legend = [
    { kind: 'line', color, label: valueLabel },
    { kind: 'dashed', label: 'This field’s normal' },
    { kind: 'band', label: 'Usual range (p10–p90)' },
    ...(windows.length ? [{ kind: 'window', label: 'Stress window' }] : []),
    ...overlayLegend(asOf, end, installments),
  ];
  return (
    <Card title={title} subtitle={subtitle}>
      <Legend items={legend} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={(t: number) => date(new Date(t).toISOString(), 'month')} tick={AXIS_TICK} axisLine={{ stroke: SEMANTIC.line }} tickLine={false} allowDataOverflow />
            <YAxis width={44} tick={AXIS_TICK} axisLine={false} tickLine={false} domain={yDomain ?? ['auto', 'auto']} tickFormatter={(v: number) => number(v, digits > 2 ? 2 : digits)} />
            {windows.map((w) => (
              <ReferenceArea key={w.start} x1={parseISODate(w.start)} x2={parseISODate(w.end)} fill={WINDOW_FILL} fillOpacity={WINDOW_OPACITY} strokeOpacity={0} ifOverflow="hidden" />
            ))}
            <Area dataKey="band" type="monotone" stroke="none" fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity * 2} isAnimationActive={false} activeDot={false} />
            <Line dataKey="mean" type="monotone" stroke={SEMANTIC.baselineMean} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
            <Line dataKey="value" type="monotone" stroke={color} strokeWidth={2} dot={dot ? { r: 2, strokeWidth: 0, fill: color } : false} connectNulls={connectNulls} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
            {timelineOverlay({ asOf, end, installments, x: parseISODate })}
            <Tooltip content={(p) => <BandTooltip active={p.active} payload={p.payload as TooltipPayload} unit={unit} digits={digits} valueLabel={valueLabel} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ monthly rain bars

interface MonthRow {
  month: string;
  value: number | null;
  mean: number;
  /** [p10, p90] monthly rain: this field's usual range for that month. */
  band: [number, number];
  inWindow: boolean;
  /** Month after today: no rain observed yet, only the field's normal is shown. */
  upcoming: boolean;
}

function RainTooltip({ active, payload }: { active?: boolean; payload: TooltipPayload }) {
  const row = payload?.[0]?.payload as MonthRow | undefined;
  if (!active || !row) return null;
  const diff = row.value !== null && row.mean > 0 ? (row.value - row.mean) / row.mean : null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">{date(row.month, 'month')}</p>
      <p className="mt-1 tabular-nums text-ink">Rain: {row.upcoming ? <span className="text-muted">not yet observed</span> : row.value === null ? '–' : `${number(row.value, 0)} mm`}</p>
      <p className="tabular-nums text-muted">
        Normal {number(row.mean, 0)} mm{diff !== null && ` (${diff >= 0 ? '+' : ''}${number(diff * 100, 0)}%)`}
      </p>
      <p className="tabular-nums text-muted">
        Usual range {number(row.band[0], 0)}–{number(row.band[1], 0)} mm
      </p>
    </div>
  );
}

export function RainChart({
  title,
  subtitle,
  months,
  windowMonths,
  asOf,
  end,
  installments = [],
  height = 240,
}: {
  title: string;
  subtitle?: ReactNode;
  months: SeriesPoint[];
  windowMonths: Set<string>;
  /** Demo "today"; months after it (up to `end`) show only the field's normal for that month. */
  asOf?: string;
  end?: string;
  installments?: Installment[];
  height?: number;
}) {
  const data = useMemo<MonthRow[]>(() => {
    const rows: MonthRow[] = months.map((m) => ({ month: m.date, value: m.value, mean: m.mean, band: [m.p10, m.p90], inWindow: windowMonths.has(m.date), upcoming: false }));
    if (end && rows.length) {
      // Extend the axis to `end` with the same calendar month's normal from a year earlier (the baseline is by time of year).
      // The current month is only partly observed, so a month a year later borrows from two years back instead.
      const partial = rows[rows.length - 1].month;
      const byMonth = new Map(rows.map((r) => [r.month, r]));
      let m = addMonths(partial, 1);
      while (m <= end) {
        const yearAgo = addMonths(m, -12);
        const ref = byMonth.get(yearAgo === partial ? addMonths(m, -24) : yearAgo);
        rows.push({ month: m, value: null, mean: ref?.mean ?? 0, band: ref?.band ?? [0, 0], inWindow: windowMonths.has(m), upcoming: true });
        m = addMonths(m, 1);
      }
    }
    return rows;
  }, [months, windowMonths, end]);
  const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
  const lastMonth = data.length ? data[data.length - 1].month : '';
  const shownInstallments = installments.filter((i) => data.some((d) => d.month === monthOf(i.dueDate)));
  const runs = useMemo(() => {
    const out: { x1: string; x2: string }[] = [];
    data.forEach((d, i) => {
      if (!d.inWindow) return;
      if (i > 0 && data[i - 1].inWindow) out[out.length - 1].x2 = d.month;
      else out.push({ x1: d.month, x2: d.month });
    });
    return out;
  }, [data]);
  return (
    <Card title={title} subtitle={subtitle}>
      <Legend
        items={[
          { kind: 'bar', color: CHART_COLORS[1], label: 'Rain this month' },
          { kind: 'dashed', label: 'This field’s normal' },
          { kind: 'band', label: 'Usual range (p10–p90)' },
          ...(runs.length ? [{ kind: 'window', label: 'Stress window' }] : []),
          ...overlayLegend(asOf ? monthOf(asOf) : undefined, lastMonth, shownInstallments),
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 20, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
            <XAxis dataKey="month" tickFormatter={(m: string) => date(m, 'month')} tick={AXIS_TICK} axisLine={{ stroke: SEMANTIC.line }} tickLine={false} interval={Math.max(2, Math.ceil(data.length / 8) - 1)} />
            <YAxis width={44} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}`} />
            {runs.map((r) => (
              <ReferenceArea key={r.x1} x1={r.x1} x2={r.x2} fill={WINDOW_FILL} fillOpacity={WINDOW_OPACITY * 1.5} strokeOpacity={0} />
            ))}
            <Area dataKey="band" type="monotone" stroke="none" fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity * 2} isAnimationActive={false} activeDot={false} />
            <Bar dataKey="value" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Line dataKey="mean" type="monotone" stroke={SEMANTIC.baselineMean} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
            {timelineOverlay({ asOf: asOf ? monthOf(asOf) : undefined, end: lastMonth, installments: shownInstallments, x: monthOf })}
            <Tooltip cursor={{ fill: SEMANTIC.surface }} content={(p) => <RainTooltip active={p.active} payload={p.payload as TooltipPayload} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ temperature

interface TempRow {
  t: number;
  date: string;
  tmax: number | null;
  tmin: number | null;
  tmaxMean: number | null;
  tminMean: number | null;
}

function TempTooltip({ active, payload }: { active?: boolean; payload: TooltipPayload }) {
  const row = payload?.[0]?.payload as TempRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">{date(row.date)}</p>
      <p className="mt-1 tabular-nums text-ink">
        Max {row.tmax === null ? '–' : `${number(row.tmax, 1)} °C`} <span className="text-muted">(normal {row.tmaxMean === null ? '–' : number(row.tmaxMean, 1)})</span>
      </p>
      <p className="tabular-nums text-ink">
        Min {row.tmin === null ? '–' : `${number(row.tmin, 1)} °C`} <span className="text-muted">(normal {row.tminMean === null ? '–' : number(row.tminMean, 1)})</span>
      </p>
    </div>
  );
}

export function TempChart({
  title,
  subtitle,
  tmax,
  tmin,
  start,
  end,
  frostC,
  heatC,
  windows,
  installments = [],
  asOf,
  height = 240,
}: {
  title: string;
  subtitle?: ReactNode;
  tmax: SeriesPoint[];
  tmin: SeriesPoint[];
  start: string;
  end: string;
  frostC: number;
  heatC: number;
  windows: DateInterval[];
  installments?: Installment[];
  asOf?: string;
  height?: number;
}) {
  const data = useMemo<TempRow[]>(() => {
    const mins = new Map(tmin.map((p) => [p.date, p]));
    const finite = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : null);
    return tmax.map((p) => {
      const m = mins.get(p.date);
      return { t: parseISODate(p.date), date: p.date, tmax: p.value, tmin: m?.value ?? null, tmaxMean: finite(p.mean), tminMean: finite(m?.mean) };
    });
  }, [tmax, tmin]);
  const ticks = useMemo(() => monthTicks(start, end, 3), [start, end]);
  const maxColor = PERIL_COLORS.heat;
  const minColor = CHART_COLORS[1];
  return (
    <Card title={title} subtitle={subtitle}>
      <Legend
        items={[
          { kind: 'line', color: maxColor, label: 'Daily max' },
          { kind: 'line', color: minColor, label: 'Daily min' },
          { kind: 'dashedColor', color: maxColor, label: 'Normal max for this field' },
          { kind: 'dashedColor', color: minColor, label: 'Normal min for this field' },
          { kind: 'refline', color: PERIL_COLORS.heat, label: `Heat limit ${number(heatC, 1)} °C` },
          { kind: 'refline', color: PERIL_COLORS.frost, label: `Frost limit ${number(frostC, 1)} °C` },
          ...(windows.length ? [{ kind: 'window', label: 'Stress window' }] : []),
          ...overlayLegend(asOf, end, installments),
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={[parseISODate(start), parseISODate(end)]} ticks={ticks} tickFormatter={(t: number) => date(new Date(t).toISOString(), 'month')} tick={AXIS_TICK} axisLine={{ stroke: SEMANTIC.line }} tickLine={false} allowDataOverflow />
            <YAxis width={44} tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[(min: number) => Math.floor(Math.min(min, frostC) - 2), (max: number) => Math.ceil(Math.max(max, heatC) + 2)]} />
            {windows.map((w) => (
              <ReferenceArea key={w.start} x1={parseISODate(w.start)} x2={parseISODate(w.end)} fill={WINDOW_FILL} fillOpacity={WINDOW_OPACITY} strokeOpacity={0} ifOverflow="hidden" />
            ))}
            <ReferenceLine y={heatC} stroke={PERIL_COLORS.heat} strokeDasharray="5 4" strokeWidth={1.5} />
            <ReferenceLine y={frostC} stroke={PERIL_COLORS.frost} strokeDasharray="5 4" strokeWidth={1.5} />
            <Line dataKey="tmax" type="monotone" stroke={maxColor} strokeOpacity={0.45} strokeWidth={1} dot={false} isAnimationActive={false} activeDot={{ r: 3 }} />
            <Line dataKey="tmin" type="monotone" stroke={minColor} strokeOpacity={0.45} strokeWidth={1} dot={false} isAnimationActive={false} activeDot={{ r: 3 }} />
            {/* The field's own normal, drawn on top of the noisy daily lines so the comparison is readable. */}
            <Line dataKey="tmaxMean" type="monotone" stroke={maxColor} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={false} isAnimationActive={false} />
            <Line dataKey="tminMean" type="monotone" stroke={minColor} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={false} isAnimationActive={false} />
            {timelineOverlay({ asOf, end, installments, x: parseISODate })}
            <Tooltip content={(p) => <TempTooltip active={p.active} payload={p.payload as TooltipPayload} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ stress trend

function TrendTooltip({ active, payload }: { active?: boolean; payload: TooltipPayload }) {
  const row = payload?.[0]?.payload as { date: string; score: number } | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-sm shadow-panel">
      <p className="font-medium text-ink">Week of {date(row.date)}</p>
      <p className="mt-1 tabular-nums text-ink">Stress score {row.score}</p>
    </div>
  );
}

export function TrendChart({ trend, height = 200 }: { trend: { date: string; score: number }[]; height?: number }) {
  return (
    <Card title="Stress score, last 26 weeks" subtitle="Weekly score from 0 (normal for this field) to 100 (severe stress).">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
        {TIER_BANDS.map((b) => (
          <span key={b.tier} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: TIER_COLORS[b.tier].bg, outline: `1px solid ${TIER_COLORS[b.tier].fg}33` }} />
            {TIER_LABELS[b.tier]} ({b.y1}–{b.y2})
          </span>
        ))}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {TIER_BANDS.map((b) => (
              <ReferenceArea key={b.tier} y1={b.y1} y2={b.y2} fill={TIER_COLORS[b.tier].bg} fillOpacity={0.8} strokeOpacity={0} />
            ))}
            <XAxis dataKey="date" tickFormatter={(d: string) => date(d, 'short')} tick={AXIS_TICK} axisLine={{ stroke: SEMANTIC.line }} tickLine={false} interval={3} />
            <YAxis width={32} domain={[0, 100]} ticks={[0, TIER_CUTOFFS.watch, TIER_CUTOFFS.high, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Line dataKey="score" type="monotone" stroke={SEMANTIC.ink} strokeWidth={2} dot={{ r: 2.5, fill: SEMANTIC.ink, strokeWidth: 0 }} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
            <Tooltip content={(p) => <TrendTooltip active={p.active} payload={p.payload as TooltipPayload} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
