/**
 * Home charts. One measure per chart and one axis per chart, never a dual axis. The payment schedule is a flow
 * (installments per month) stacked by the farm's CURRENT tier; outstanding (a stock) is stated as a number beside it.
 */
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Currency, Tier } from '@/domain/types';
import { TIER_CUTOFFS } from '@/domain/constants';
import { TIER_LABELS, date, money, number, pct } from '@/shared/format';
import { RISK_RAMP } from '@/shared/chartColors';
import { NO_SCORE_FILL, TIER_FILL, TIER_KEYS, rampColor, type PaymentSchedule, type ScheduleMonth, type Slice, type TierKey } from './homeModel';

const MUTED = '#6A766F';
const LINE = '#E4EBE6';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
const AXIS_TICK = { fontSize: 11, fill: MUTED, fontFamily: MONO };

type TooltipPayload = ReadonlyArray<{ payload?: unknown; dataKey?: unknown; value?: unknown }> | undefined;

function TipBox({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-ink shadow-panel">{children}</div>;
}

export function ScoreText({ score, digits = 1 }: { score: number | null; digits?: number }) {
  if (score === null) return <span className="font-mono text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: rampColor(score) }} />
      {number(score, digits)}
    </span>
  );
}

/* ───────────────────────── allocation ───────────────────────── */

/** One 100 % stacked bar of outstanding, each slice coloured by its exposure-weighted risk, with its legend table. */
export function AllocationBar({ title, slices, currency }: { title: string; slices: Slice[]; currency: Currency }) {
  const total = slices.reduce((s, x) => s + x.outstanding, 0);
  const keyed = slices.map((s, i) => ({ ...s, k: `s${i}` }));
  const data = [Object.fromEntries([['name', title], ...keyed.map((s) => [s.k, s.outstanding])])];
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h4>
      <div className="mt-2 h-7" role="img" aria-label={`${title}: ${keyed.map((s) => `${s.label} ${pct(s.share)}`).join(', ')}`}>
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={0}>
              <XAxis type="number" hide domain={[0, total]} />
              <YAxis type="category" dataKey="name" hide />
              {keyed.map((s) => (
                <Bar key={s.k} dataKey={s.k} stackId="a" fill={rampColor(s.risk.score)} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
              ))}
              <Tooltip
                shared={false}
                cursor={false}
                content={(p) => {
                  const k = (p.payload as TooltipPayload)?.[0]?.dataKey;
                  const s = keyed.find((x) => x.k === k);
                  if (!p.active || !s) return null;
                  return (
                    <TipBox>
                      <div className="font-medium">{s.label}</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {money(s.outstanding, currency)} · {pct(s.share, 1)}
                      </div>
                      <div className="text-muted">
                        Weighted risk <span className="font-mono text-ink">{s.risk.score === null ? '–' : number(s.risk.score, 1)}</span>
                      </div>
                    </TipBox>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full rounded bg-surface" />
        )}
      </div>
      <table className="mt-2 w-full table-fixed text-xs">
        <caption className="sr-only">{title}</caption>
        <colgroup>
          <col />
          <col className="w-[4.5rem]" />
          <col className="w-12" />
          <col className="w-12" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Slice</th>
            <th scope="col">Outstanding</th>
            <th scope="col">Share</th>
            <th scope="col">Weighted risk</th>
          </tr>
        </thead>
        <tbody>
          {keyed.map((s) => (
            <tr key={s.k} className="border-b border-line last:border-0">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink" title={s.label}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: rampColor(s.risk.score) }} />
                  <span className="truncate">{s.label}</span>
                </span>
              </th>
              <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono tabular-nums text-ink">{money(s.outstanding, currency, { compact: true })}</td>
              <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono tabular-nums text-muted">{pct(s.share)}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-mono tabular-nums text-ink">{s.risk.score === null ? '–' : number(s.risk.score, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Legend of the continuous risk colouring. */
export function RiskScaleLegend() {
  const stops = [0, 17, 33, 50, 67, 83, 100];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>Weighted risk</span>
      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
        0
        <span aria-hidden className="flex">
          {stops.map((s) => (
            <span key={s} className="h-2.5 w-3 first:rounded-l-[3px] last:rounded-r-[3px]" style={{ background: rampColor(s) }} />
          ))}
        </span>
        100
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: NO_SCORE_FILL }} />
        Not assessed
      </span>
    </div>
  );
}

/* ───────────────────────── tiers ───────────────────────── */

const MIX_FILL: Record<TierKey, string> = { ...TIER_FILL, unscored: NO_SCORE_FILL };
const mixLabel = (k: TierKey, pending: string) => (k === 'unscored' ? pending : TIER_LABELS[k]);
/** Display order low → high, then the farms without a tier. */
const MIX_ORDER: TierKey[] = ['normal', 'watch', 'high', 'unscored'];

export function TierDot({ tier, className }: { tier: Tier | null; className?: string }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${className ?? ''}`} style={{ background: tier ? TIER_FILL[tier] : NO_SCORE_FILL }} />;
}

/** Small 100 % tier-mix bar for table cells. */
export function MixBar({ mix, total, pending = 'Not assessed', className = 'h-2 w-24' }: { mix: Record<TierKey, number>; total: number; pending?: string; className?: string }) {
  if (!(total > 0)) return <div className={`rounded-full bg-surface ${className}`} />;
  const keys = MIX_ORDER.filter((k) => mix[k] > 0);
  return (
    <div className={`flex gap-px overflow-hidden rounded-full bg-surface ${className}`} role="img" aria-label={keys.map((k) => `${mixLabel(k, pending)} ${pct(mix[k] / total)}`).join(', ')}>
      {keys.map((k) => (
        <span key={k} style={{ width: `${(mix[k] / total) * 100}%`, background: MIX_FILL[k] }} />
      ))}
    </div>
  );
}

/** Tier legend; with `amounts`, each entry carries its total (direct labels instead of colour alone). */
export function TierLegend({ keys, pending, amounts, currency }: { keys: TierKey[]; pending: string; amounts?: Record<TierKey, number>; currency?: Currency }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MIX_FILL[k] }} />
          {mixLabel(k, pending)}
          {amounts && currency && <span className="font-mono tabular-nums text-ink">{money(amounts[k], currency, { compact: true })}</span>}
        </span>
      ))}
    </div>
  );
}

/* ───────────────────────── score gauge ───────────────────────── */

const RAMP_GRADIENT = `linear-gradient(to right, ${RISK_RAMP.map((c, i) => `${c} ${((i / (RISK_RAMP.length - 1)) * 100).toFixed(1)}%`).join(', ')})`;

/** Horizontal 0–100 gauge on the risk ramp with the watch (35) and high (60) cut-offs and a marker at the score. */
export function ScoreGauge({ score }: { score: number | null }) {
  const at = score === null ? null : Math.min(100, Math.max(0, score));
  return (
    <div className="relative pb-4 pt-1" role="img" aria-label={at === null ? 'Weighted risk not assessed yet' : `Weighted risk ${number(at, 1)} of 100; watch from ${TIER_CUTOFFS.watch}, high from ${TIER_CUTOFFS.high}`}>
      <div className={`h-2 rounded-full ${at === null ? 'opacity-25' : 'opacity-90'}`} style={{ background: RAMP_GRADIENT }} />
      {[TIER_CUTOFFS.watch, TIER_CUTOFFS.high].map((c) => (
        <span key={c} aria-hidden className="absolute top-0 h-4 w-px bg-ink/50" style={{ left: `${c}%` }}>
          <span className="absolute left-1/2 top-4 -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted">{c}</span>
        </span>
      ))}
      <span aria-hidden className="absolute left-0 top-4 font-mono text-[10px] tabular-nums text-muted">0</span>
      <span aria-hidden className="absolute right-0 top-4 font-mono text-[10px] tabular-nums text-muted">100</span>
      {at !== null && (
        <span aria-hidden className="absolute top-[-1px] h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(14,25,20,0.35)]" style={{ left: `${at}%`, background: rampColor(at) }} />
      )}
    </div>
  );
}

/* ───────────────────────── payment schedule ───────────────────────── */

const monthTick = (month: string, i: number) => {
  const [y, m] = month.split('-').map(Number);
  const mon = date(`${month}-01`, 'month').slice(0, 3);
  return i === 0 || m === 1 ? `${mon} '${String(y).slice(2)}` : mon;
};

/**
 * Scheduled installments per month, stacked by the farm's current tier (high at the base, so the money due
 * from stressed farms reads off the baseline). One axis: amount due.
 */
export function PaymentScheduleChart({ schedule, currency, pending }: { schedule: PaymentSchedule; currency: Currency; pending: string }) {
  const data = schedule.months.map((m, i) => ({ ...m.byTier, label: monthTick(m.month, i), m }));
  const present = TIER_KEYS.filter((k) => schedule.byTier[k] > 0);
  const compact = (v: number) => money(v, currency, { compact: true });
  const yW = currency === 'CLP' ? 72 : 52;
  const describe = schedule.months
    .filter((m) => m.total > 0)
    .map((m) => `${date(`${m.month}-01`, 'month')} ${compact(m.total)}${m.byTier.watch + m.byTier.high > 0 ? ` (${compact(m.byTier.watch + m.byTier.high)} at watch or high)` : ''}`)
    .join('; ');
  return (
    <div>
      <div className="h-64 sm:h-72" role="img" aria-label={`Scheduled installments per month by current tier: ${describe || 'none'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke={LINE} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: LINE }} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis width={yW} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} />
            {present.map((k) => (
              <Bar key={k} dataKey={k} stackId="due" fill={MIX_FILL[k]} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
            ))}
            <Tooltip cursor={{ fill: '#F6F8F7' }} content={(p) => <MonthTip active={p.active} payload={p.payload as TooltipPayload} currency={currency} pending={pending} />} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3">
        <TierLegend keys={MIX_ORDER.filter((k) => present.includes(k))} pending={pending} amounts={schedule.byTier} currency={currency} />
      </div>
    </div>
  );
}

function MonthTip({ active, payload, currency, pending }: { active?: boolean; payload: TooltipPayload; currency: Currency; pending: string }) {
  const m = (payload?.[0]?.payload as { m?: ScheduleMonth } | undefined)?.m;
  if (!active || !m) return null;
  const tiers = TIER_KEYS.filter((k) => m.byTier[k] > 0);
  const top = m.payments.slice(0, 3);
  return (
    <TipBox>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{date(`${m.month}-01`, 'month')}</span>
        <span className="font-mono font-semibold tabular-nums">{money(m.total, currency)}</span>
      </div>
      <div className="text-muted">
        {m.count} {m.count === 1 ? 'installment' : 'installments'}
        {m.from.slice(0, 7) === m.month && <> after {date(m.from, 'short')}</>}
      </div>
      {tiers.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {tiers.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: MIX_FILL[k] }} />
              <span className="w-24">{mixLabel(k, pending)}</span>
              <span className="ml-auto font-mono tabular-nums">{money(m.byTier[k], currency)}</span>
            </div>
          ))}
        </div>
      )}
      {top.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          <div className="text-muted">Largest</div>
          {top.map((p) => (
            <div key={`${p.portfolioId}/${p.farmId}/${p.dueDate}`} className="flex items-center gap-2">
              <TierDot tier={p.tier} />
              <span className="max-w-[11rem] truncate">{p.farmName}</span>
              <span className="ml-auto pl-3 font-mono tabular-nums">{money(p.amount, currency, { compact: true })}</span>
            </div>
          ))}
          {m.payments.length > 3 && <div className="text-muted">+{m.payments.length - 3} more</div>}
        </div>
      )}
    </TipBox>
  );
}
