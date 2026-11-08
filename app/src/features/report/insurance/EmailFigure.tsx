/**
 * The small figure inside the insurance email (about 140 px tall): plain SVG in the BrotIA palette, sized to its
 * container (ResizeObserver; a fixed width on the server so it renders in tests). One series per figure, so no legend
 * box: the caption names it and a one-line key explains the band or the reference line. Hover shows the value.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { SeriesPoint } from '@/domain/types';
import { parseISODate } from '@/domain/dates';
import { SEMANTIC, riskColor } from '@/shared/chartColors';
import { date, number } from '@/shared/format';
import type { FigureSpec } from './emailModel';

const H = 140;
const PAD = { l: 34, r: 12, t: 22, b: 20 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function useWidth(initial = 560) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

const t = (iso: string) => parseISODate(iso);
const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function niceTicks(lo: number, hi: number, n = 3): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Month ticks on the 1st, every `every` months. */
function monthTicks(t0: number, t1: number, every: number): { t: number; label: string }[] {
  const d = new Date(t0);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  const out: { t: number; label: string }[] = [];
  for (let i = 0; i < 40; i++) {
    if (m > 11) {
      m -= 12;
      y += 1;
    }
    const tt = Date.UTC(y, m, 1);
    if (tt > t1) break;
    if (tt >= t0 && m % every === 0) out.push({ t: tt, label: m === 0 ? String(y) : MONTHS[m] });
    m += 1;
  }
  return out;
}

/** The line above the plot: the reference point by default, the hovered date while hovering. */
function readout(p: SeriesPoint, isLast: boolean, band: boolean, digits: number, fmt: (v: number) => string): string {
  const v = fin(p.value) ? fmt(p.value) : 'no clear image';
  const usual = band && fin(p.p10) && fin(p.p90) ? ` · usual ${number(p.p10, digits)}–${number(p.p90, digits)}` : '';
  const when = isLast ? `${band ? 'Last clear image' : 'Latest'}, ${date(p.date)}` : date(p.date);
  return `${when}: ${v}${usual}${!isLast && p.estimated ? ' · gap-filled' : ''}`;
}

function TimeChart({ spec, w }: { spec: Extract<FigureSpec, { kind: 'band' | 'daily' }>; w: number }) {
  const pts = spec.points;
  const g = useMemo(() => {
    const xs = pts.map((p) => t(p.date));
    const t0 = xs[0];
    const t1 = xs[xs.length - 1];
    const vals: number[] = [];
    for (const p of pts) {
      if (fin(p.value)) vals.push(p.value);
      if (spec.kind === 'band') {
        if (fin(p.p10)) vals.push(p.p10);
        if (fin(p.p90)) vals.push(p.p90);
      }
    }
    if (spec.kind === 'daily' && spec.threshold !== null) vals.push(spec.threshold);
    if (spec.kind === 'daily' && spec.variable === 'precip') vals.push(0);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || 0.05;
    lo = spec.kind === 'daily' && spec.variable === 'precip' ? 0 : lo - pad;
    hi += pad;
    const iw = w - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (tt: number) => PAD.l + ((tt - t0) / (t1 - t0 || 1)) * iw;
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
    return { xs, t0, t1, lo, hi, x, y, iw, ih };
  }, [pts, spec, w]);

  const [hover, setHover] = useState<number | null>(null);
  const digits = spec.kind === 'band' ? spec.digits : 1;
  const unit = spec.kind === 'daily' ? spec.unit : '';
  const fmt = (v: number) => `${v < 0 ? '−' : ''}${number(Math.abs(v), digits)}${unit ? ` ${unit}` : ''}`;

  // band (p10..p90) as one polygon over the dates that have both ends
  let band = '';
  let mean = '';
  if (spec.kind === 'band') {
    const b = pts.map((p, i) => ({ i, p })).filter(({ p }) => fin(p.p10) && fin(p.p90));
    if (b.length > 1)
      band = [...b.map(({ i, p }) => `${g.x(g.xs[i])},${g.y(p.p90!)}`), ...[...b].reverse().map(({ i, p }) => `${g.x(g.xs[i])},${g.y(p.p10!)}`)].join(' ');
    mean = pts
      .map((p, i) => (fin(p.p50) ? `${g.x(g.xs[i])},${g.y(p.p50)}` : null))
      .filter(Boolean)
      .join(' ');
  }

  // the farm's line, split into solid (observed) and dashed (gap-filled) segments; gaps break the line
  const solid: string[] = [];
  const dashed: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!fin(a.value) || !fin(b.value)) continue;
    const seg = `M${g.x(g.xs[i - 1])},${g.y(a.value)}L${g.x(g.xs[i])},${g.y(b.value)}`;
    (a.estimated || b.estimated ? dashed : solid).push(seg);
  }
  // the reference point: the last clear (observed) value for a band series, the last value for a daily one
  let last: { i: number; p: SeriesPoint } | null = null;
  for (let i = pts.length - 1; i >= 0; i--)
    if (fin(pts[i].value) && (spec.kind !== 'band' || !pts[i].estimated)) {
      last = { i, p: pts[i] };
      break;
    }

  const months = (g.t1 - g.t0) / (30.4 * 864e5);
  const every = w < 420 ? (months > 8 ? 4 : 2) : months > 8 ? 2 : 1;
  const xt = monthTicks(g.t0, g.t1, every);
  const yt = niceTicks(g.lo, g.hi, 4);
  const isRain = spec.kind === 'daily' && spec.variable === 'precip';
  const barW = Math.max(1, g.iw / pts.length - 0.5);

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tt = g.t0 + ((e.clientX - r.left) / r.width) * (g.t1 - g.t0);
    let best = 0;
    for (let i = 1; i < g.xs.length; i++) if (Math.abs(g.xs[i] - tt) < Math.abs(g.xs[best] - tt)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? pts[hover] : null;

  return (
    <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={spec.caption} className="block font-mono">
      {yt.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={w - PAD.r} y1={g.y(v)} y2={g.y(v)} stroke={SEMANTIC.line} strokeWidth={1} />
          <text x={PAD.l - 6} y={g.y(v) + 3} textAnchor="end" fontSize={10} fill={SEMANTIC.muted}>
            {v < 0 ? `−${number(-v, isRain ? 0 : digits)}` : number(v, isRain ? 0 : digits)}
          </text>
        </g>
      ))}
      {xt.map((m) => (
        <text key={m.t} x={g.x(m.t)} y={H - 6} textAnchor="middle" fontSize={10} fill={SEMANTIC.muted}>
          {m.label}
        </text>
      ))}
      {band && <polygon points={band} fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity} />}
      {mean && <polyline points={mean} fill="none" stroke={SEMANTIC.baselineMean} strokeWidth={1} strokeOpacity={0.7} />}
      {spec.kind === 'daily' && spec.threshold !== null && (
        <line x1={PAD.l} x2={w - PAD.r} y1={g.y(spec.threshold)} y2={g.y(spec.threshold)} stroke={SEMANTIC.danger} strokeWidth={1.25} strokeDasharray="4 3" />
      )}
      {isRain ? (
        pts.map((p, i) =>
          fin(p.value) && p.value > 0 ? (
            <rect key={i} x={g.x(g.xs[i]) - barW / 2} y={g.y(p.value)} width={barW} height={g.y(0) - g.y(p.value)} fill={SEMANTIC.brand} />
          ) : null,
        )
      ) : (
        <>
          <path d={solid.join('')} fill="none" stroke={SEMANTIC.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={dashed.join('')} fill="none" stroke={SEMANTIC.brand} strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" />
        </>
      )}
      {last && !isRain && <circle cx={g.x(g.xs[last.i])} cy={g.y(last.p.value!)} r={4} fill={SEMANTIC.brand} stroke="#fff" strokeWidth={2} />}
      {hp && hover !== null && (
        <g pointerEvents="none">
          <line x1={g.x(g.xs[hover])} x2={g.x(g.xs[hover])} y1={PAD.t} y2={H - PAD.b} stroke={SEMANTIC.muted} strokeWidth={1} strokeDasharray="2 2" />
          {fin(hp.value) && <circle cx={g.x(g.xs[hover])} cy={g.y(hp.value)} r={3.5} fill="#fff" stroke={SEMANTIC.brand} strokeWidth={2} />}
        </g>
      )}
      <rect x={PAD.l} y={PAD.t} width={g.iw} height={g.ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {(hp || last) && (
        <text x={w - PAD.r} y={12} textAnchor="end" fontSize={11} fill={SEMANTIC.ink} pointerEvents="none" className="font-sans">
          {readout(hp ?? last!.p, !hp, spec.kind === 'band', digits, fmt)}
        </text>
      )}
    </svg>
  );
}

function Bars({ rows, max, ref100, w, label }: { rows: { label: string; value: number; color: string; text: string }[]; max: number; ref100?: number; w: number; label: string }) {
  const labelW = Math.min(150, Math.round(w * 0.36));
  const valueW = 56;
  const bw = w - labelW - valueW;
  const rowH = 26;
  const h = rows.length * rowH + 6;
  const x = (v: number) => labelW + (Math.max(0, v) / max) * bw;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="block">
      {rows.map((r, i) => (
        <g key={r.label}>
          <text x={0} y={i * rowH + 17} fontSize={11} fill={SEMANTIC.ink}>
            {r.label}
          </text>
          <rect x={labelW} y={i * rowH + 7} width={bw} height={12} rx={4} fill={SEMANTIC.surface} />
          <rect x={labelW} y={i * rowH + 7} width={Math.max(4, x(r.value) - labelW)} height={12} rx={4} fill={r.color}>
            <title>{`${r.label}: ${r.text}`}</title>
          </rect>
          <text x={w} y={i * rowH + 17} textAnchor="end" fontSize={11} fontWeight={600} fill={SEMANTIC.ink} className="font-mono">
            {r.text}
          </text>
        </g>
      ))}
      {ref100 !== undefined && <line x1={x(ref100)} x2={x(ref100)} y1={2} y2={h - 2} stroke={SEMANTIC.ink} strokeWidth={1.25} strokeDasharray="3 2" />}
    </svg>
  );
}

export function EmailFigure({ spec }: { spec: FigureSpec }) {
  const { ref, w } = useWidth();
  let chart;
  if (spec.kind === 'band' || spec.kind === 'daily') chart = <TimeChart spec={spec} w={w} />;
  else if (spec.kind === 'snowmelt')
    chart = (
      <Bars
        label={spec.caption}
        w={w}
        max={Math.max(150, spec.pct * 1.1)}
        ref100={100}
        rows={[
          {
            label: 'Snowmelt forecast',
            value: spec.pct,
            color: SEMANTIC.brand,
            text: `${number(spec.pct, 0)} %`,
          },
        ]}
      />
    );
  else
    chart = (
      <Bars
        label={spec.caption}
        w={w}
        max={1}
        rows={spec.parts.map((p) => ({
          label: `${p.label} (${p.letter})`,
          value: p.value,
          color: riskColor(p.value * 100),
          text: number(p.value, 2),
        }))}
      />
    );
  return (
    <figure className="my-4 rounded-card border border-line px-3 pb-2.5 pt-3">
      <div ref={ref} className="w-full overflow-hidden">
        {chart}
      </div>
      <figcaption className="mt-1.5 text-xs leading-snug text-muted">
        <span className="text-ink">{spec.caption}</span> {spec.legend}
      </figcaption>
    </figure>
  );
}
