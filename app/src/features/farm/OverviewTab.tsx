/**
 * Overview tab (v1.3): decision first, evidence second, detail on demand. A credit officer reads top to bottom:
 *   verdict (one plain sentence, confidence, next payment) → what to do (fired credit actions, most severe first)
 *   → why (two or three evidence cards with a small real visual) → details (season, loan, map, "About this data").
 * A normal farm gets a short, calm "All clear" with small green cards.
 *
 * The wording and priorities come from the pure overviewModel; every number from the assessment, its series or the
 * imagery timeline (native frames only). The risk score is shown once, in the sticky header.
 */
import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowRight, CalendarClock, CheckCircle2, ChevronRight, Info, MapPin } from 'lucide-react';
import type { FarmAssessment, Farm, ImageryTimeline, Portfolio, SeriesPoint } from '@/domain/types';
import type { DataSource } from '@/data/api';
import { imageUrl } from '@/data/api';
import { CROP_META } from '@/domain/constants';
import { SCHEDULE_LABELS } from '@/domain/schedule';
import { zoneColor } from '@/domain/rules';
import { TIER_LABELS, date, money } from '@/shared/format';
import { DataAsOf, DataTierPill, FrameKindBadge, Popover } from '@/shared/ui';
import { SEMANTIC, TIER_COLORS } from '@/shared/chartColors';
import { chartWindow, dueInLabel, repaymentPlan, tierRaised } from './farmData';
import { buildOverview, type ClearItem, type EvidenceCard, type FramePair, type Plan, type Spark, type Tone, type Verdict } from './overviewModel';
import { Skeleton, StageStrip } from './parts';
import type { FarmTab } from './tabModel';

const FarmMiniMap = lazy(() => import('./FarmMiniMap'));

/** One accent per state: the tier palette, plus a quiet blue for context (site history). */
const TONES: Record<Tone, { fg: string; bg: string; ink: string }> = {
  alert: TIER_COLORS.high,
  watch: TIER_COLORS.watch,
  ok: TIER_COLORS.normal,
  info: { fg: '#3A6EA5', bg: '#E8EFF7', ink: '#2F5C8C' },
};

const EYEBROW = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted';

/** Wrap the numbers of a plain string in IBM Plex Mono. */
function Nums({ text }: { text: string }) {
  const parts = text.split(/([−-]?\d+(?:[.,]\d+)*)/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono tabular-nums">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

function TabLink({ tab, onSelect, children, className }: { tab: FarmTab; onSelect: (t: FarmTab) => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className={clsx(
        'inline-flex items-center gap-1 rounded-card text-sm font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        className,
      )}
    >
      {children}
      <ArrowRight size={14} aria-hidden />
    </button>
  );
}

/* ───────────────────────── 1. verdict ───────────────────────── */

function VerdictBlock({ v, a, farm, portfolio }: { v: Verdict; a: FarmAssessment; farm: Farm; portfolio: Portfolio }) {
  const t = TONES[v.tone];
  const next = a.nextInstallment;
  const covered = farm.covered === true ? a.warnings.find((w) => /cover/i.test(w)) : undefined;
  return (
    <section aria-label="Verdict" className="relative pl-5">
      <span aria-hidden className="absolute inset-y-0.5 left-0 w-1 rounded-full" style={{ backgroundColor: t.fg }} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={EYEBROW}>Verdict</h2>
        {v.confidence && (
          <span
            title={v.confidenceHint ?? undefined}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
            style={{ borderColor: `${t.fg}66`, color: t.ink }}
          >
            {v.confidence === 'Confirmed' ? <CheckCircle2 size={12} aria-hidden /> : v.confidence === 'Likely' ? <Info size={12} aria-hidden /> : <MapPin size={12} aria-hidden />}
            {v.confidence}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-[46rem] text-[22px] font-semibold leading-[1.35] text-ink [text-wrap:balance]" data-testid="overview-verdict">
        {v.text}
      </p>
      {v.confidenceHint && v.confidence && <p className="mt-1 text-sm text-muted">{v.confidenceHint}</p>}
      {tierRaised(a.risk) && (
        <p className="mt-1 text-sm text-muted">
          Raised to {TIER_LABELS[a.risk.tier].toLowerCase()} by a credit rule; the score alone reads {TIER_LABELS[a.risk.scoreTier].toLowerCase()}.
        </p>
      )}
      {covered && <p className="mt-2 rounded-card bg-warn-soft px-3 py-2 text-sm text-warn-ink">{covered}</p>}
      <p className="mt-4 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink">
        <CalendarClock size={16} className="text-muted" aria-hidden />
        {!farm.loan ? (
          <span className="text-muted">No loan recorded for this farm.</span>
        ) : next ? (
          <>
            <span>Next payment</span>
            <span className="font-mono font-semibold tabular-nums">{money(next.amount, portfolio.currency)}</span>
            <span>{dueInLabel(a.asOf, next.dueDate).toLowerCase()}</span>
            <span className="text-muted">({date(next.dueDate)})</span>
          </>
        ) : (
          <span className="text-muted">No payment due.</span>
        )}
      </p>
    </section>
  );
}

/* ───────────────────────── 2. what to do ───────────────────────── */

function PlanBlock({ plan, onSelectTab }: { plan: Plan; onSelectTab: (t: FarmTab) => void }) {
  return (
    <section aria-labelledby="ov-todo">
      <h2 id="ov-todo" className={EYEBROW}>
        What to do
      </h2>
      {plan.none ? (
        <div className="mt-2 flex items-start gap-3 rounded-card border border-line bg-white px-4 py-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-ink">No action needed</p>
            {plan.note && <p className="mt-0.5 text-sm text-muted">{plan.note}</p>}
          </div>
        </div>
      ) : (
        <ol className="mt-2 overflow-hidden rounded-card border border-line bg-white" data-testid="overview-actions">
          {plan.items.map((it, i) => {
            const t = TONES[it.tone];
            const first = i === 0;
            return (
              <li
                key={it.key}
                className={clsx('flex items-start gap-3 px-4', first ? 'py-3.5' : 'border-t border-line py-2.5')}
                style={first ? { backgroundColor: t.bg, boxShadow: `inset 3px 0 0 ${t.fg}` } : undefined}
              >
                {first ? (
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: t.ink }}>
                    <ChevronRight size={16} aria-hidden />
                  </span>
                ) : (
                  <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.fg }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={clsx('text-ink', first ? 'text-base font-semibold' : 'text-sm font-medium')}>{it.title}</p>
                  <p className={clsx('mt-0.5 text-muted', first ? 'text-sm' : 'text-xs')}>{it.reason}</p>
                </div>
                {it.ruleId ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab('rules')}
                    title={`Credit rule ${it.ruleId}`}
                    className="mt-0.5 shrink-0 rounded-card px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-white hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                  >
                    Rule
                  </button>
                ) : (
                  <span className="mt-0.5 shrink-0 text-xs text-muted">From the score</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ───────────────────────── 3. why: evidence ───────────────────────── */

const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/** Tiny line over the field's usual band (p10–p90), with an optional dashed threshold. Pure SVG, no chart library. */
function Sparkline({ spark, tone }: { spark: Spark; tone: Tone }) {
  const W = 300;
  const H = 52;
  const pts = spark.points;
  const x0 = dayNum(pts[0].date);
  const x1 = dayNum(pts[pts.length - 1].date);
  const ys: number[] = [];
  for (const p of pts) for (const v of [p.value, p.p10, p.p90]) if (v !== null && v !== undefined) ys.push(v);
  if (spark.threshold !== null) ys.push(spark.threshold);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.08;
  const X = (d: string) => ((dayNum(d) - x0) / (x1 - x0 || 1)) * W;
  const Y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const band = pts.filter((p): p is SeriesPoint & { p10: number; p90: number } => p.p10 !== null && p.p90 !== null);
  const bandPath =
    band.length > 1 ? `M${band.map((p) => `${X(p.date).toFixed(1)},${Y(p.p90).toFixed(1)}`).join('L')}L${[...band].reverse().map((p) => `${X(p.date).toFixed(1)},${Y(p.p10).toFixed(1)}`).join('L')}Z` : null;
  const line = `M${pts.map((p) => `${X(p.date).toFixed(1)},${Y(p.value as number).toFixed(1)}`).join('L')}`;
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[52px] w-full" role="img" aria-label={spark.caption}>
        {bandPath && <path d={bandPath} fill={SEMANTIC.baselineBand} fillOpacity={SEMANTIC.baselineBandOpacity} />}
        {spark.threshold !== null && (
          <line x1={0} x2={W} y1={Y(spark.threshold)} y2={Y(spark.threshold)} stroke={SEMANTIC.muted} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeWidth={1} />
        )}
        <path d={line} fill="none" stroke={TONES[tone].fg === TIER_COLORS.normal.fg ? SEMANTIC.brand : TONES[tone].fg} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-muted">
        <span className="whitespace-nowrap">{date(pts[0].date, 'month')}</span>
        <span className="min-w-0 truncate">{spark.caption}</span>
        <span className="whitespace-nowrap">{date(pts[pts.length - 1].date, 'month')}</span>
      </figcaption>
    </figure>
  );
}

function FramePairView({ pair, source }: { pair: FramePair; source: DataSource }) {
  const items = [
    { f: pair.then, label: pair.thenLabel },
    { f: pair.now, label: pair.nowLabel },
  ];
  const kind = pair.now.layer === 'rgb' ? 'True colour' : 'Vigour map (NDVI)';
  return (
    <figure className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ f, label }) => {
          const src = imageUrl(f.path, source);
          return (
            <div key={label} className="min-w-0">
              <div className="flex h-[72px] items-center justify-center rounded-card bg-surface">
                {src && <img src={src} alt={`${kind}, ${date(f.date)}`} className="h-[64px] w-auto max-w-full object-contain" style={{ imageRendering: 'pixelated' }} loading="lazy" />}
              </div>
              <p className="mt-1 flex justify-between gap-1 text-[11px] leading-4 text-muted">
                <span className="truncate">
                  <span className="font-medium text-ink">{label}</span> · {date(f.date)}
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums" title="Mean NDVI of the orchard, native pixels">
                  {f.ndviMean.toFixed(2)}
                </span>
              </p>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <FrameKindBadge kind="observed" />
        <span>{kind}, native 10 m, not AI</span>
      </figcaption>
    </figure>
  );
}

function EvidenceCardView({ card, source, onSelectTab }: { card: EvidenceCard; source: DataSource | undefined; onSelectTab: (t: FarmTab) => void }) {
  const t = TONES[card.tone];
  return (
    <article className="flex min-w-0 flex-col rounded-card border border-line bg-white p-4" data-testid={`evidence-${card.theme}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.fg }} />
        <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
        {card.detail && (
          <Popover
            label={`Technical detail: ${card.title}`}
            align="end"
            className="ml-auto"
            trigger={<Info size={15} className="text-muted" aria-hidden />}
            panelClassName="w-80 text-xs leading-5 text-ink"
          >
            {card.detail}
          </Popover>
        )}
      </div>
      <p className="mt-3 text-[22px] font-semibold leading-7 text-ink" title={card.detail || undefined}>
        <Nums text={card.value} />
      </p>
      {card.compare && <p className="mt-0.5 text-sm text-muted">{card.compare}</p>}
      {card.spark && <Sparkline spark={card.spark} tone={card.tone} />}
      {card.frames && source && <FramePairView pair={card.frames} source={source} />}
      {card.note && <p className="mt-3 text-sm text-ink/80">{card.note}</p>}
      <div className="mt-auto pt-3">
        <TabLink tab={card.link.tab} onSelect={onSelectTab}>
          {card.link.label}
        </TabLink>
      </div>
    </article>
  );
}

function ClearCards({ items }: { items: ClearItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-3" aria-label="Checks within normal">
      {items.map((c) => (
        <li key={c.key} className="flex items-start gap-2.5 rounded-card border border-line bg-white px-3.5 py-3">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{c.title}</p>
            <p className="mt-0.5 text-xs text-muted">{c.value}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── 4. details ───────────────────────── */

function LoanDetails({ farm, a, portfolio }: { farm: Farm; a: FarmAssessment; portfolio: Portfolio }) {
  const loan = farm.loan;
  const cur = portfolio.currency;
  if (!loan) return <p className="text-sm text-muted">No loan recorded for this farm.</p>;
  const plan = repaymentPlan(loan);
  const paid = plan.filter((i) => i.dueDate <= a.asOf).length;
  const upcoming = plan.filter((i) => i.dueDate > a.asOf).slice(0, 3);
  const rows: [string, string, boolean][] = [
    ['Amount', money(loan.amount, cur), true],
    ['Outstanding', money(a.exposure, cur), true],
    ['Originated', date(loan.originationDate), true],
    ['Matures', date(loan.maturityDate), true],
    ['Schedule', SCHEDULE_LABELS[loan.scheduleType], false],
    ['Installments', `${paid} of ${plan.length} due so far`, false],
  ];
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v, mono]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className={clsx('text-right text-ink', mono && 'font-mono tabular-nums')}>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-sm text-muted">Next installments</p>
        {upcoming.length === 0 ? (
          <p className="mt-1 text-sm text-muted">None upcoming.</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th scope="col">Due date</th>
                <th scope="col">Due in</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {upcoming.map((i) => (
                <tr key={i.dueDate}>
                  <td className="py-1 font-mono tabular-nums text-ink">{date(i.dueDate)}</td>
                  <td className="py-1 text-xs text-muted">{dueInLabel(a.asOf, i.dueDate).replace(/^Due /, '')}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-ink">{money(i.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AboutData({ a, farm, sample }: { a: FarmAssessment; farm: Farm; sample?: boolean }) {
  const asOf: [string, string | null | undefined][] = [
    ['Weather', a.dataAsOf.tmin],
    ['Rain', a.dataAsOf.precip],
    ['Imagery', a.dataAsOf.imagery ?? a.dataAsOf.ndvi],
    ['Events', a.dataAsOf.events],
    ['Water supply', a.dataAsOf.water_supply],
  ];
  return (
    <details className="group rounded-card border border-line bg-white" data-testid="about-data">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} className="text-muted transition-transform group-open:rotate-90" aria-hidden />
        About this data
        {a.warnings.length > 0 && <span className="text-xs font-normal text-muted">({a.warnings.length} {a.warnings.length === 1 ? 'note' : 'notes'})</span>}
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
        {sample && <p className="text-muted">Loan amounts and schedules are illustrative; orchard polygons and climate data are real.</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {asOf.map(([label, v]) => (
            <DataAsOf key={label} value={v} label={label} />
          ))}
          <DataTierPill tier={a.dataTier} />
        </div>
        {a.warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {a.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-4 gap-y-1 text-muted">
          <dt>Crop</dt>
          <dd className="text-ink">
            {CROP_META[farm.crop].label} <span lang="es">({CROP_META[farm.crop].labelEs})</span>
            {farm.ciren && (
              <>
                {' '}
                · CIREN {farm.ciren.especie.toLowerCase()}
                {farm.ciren.variedad ? `, ${farm.ciren.variedad}` : ''}
              </>
            )}
          </dd>
          <dt>Service summary</dt>
          <dd className="text-ink">{a.risk.headline}</dd>
        </dl>
      </div>
    </details>
  );
}

function Details({ portfolio, farm, a }: { portfolio: Portfolio; farm: Farm; a: FarmAssessment }) {
  const zoneId = a.zoneId ?? farm.zoneId;
  const zone = portfolio.zones.find((z) => z.id === zoneId);
  const win = chartWindow(a);
  return (
    <section aria-labelledby="ov-details" className="space-y-5 border-t border-line pt-6">
      <h2 id="ov-details" className={EYEBROW}>
        Details
      </h2>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm text-ink">
              <span className="font-medium">Season</span>
              <span className="text-muted"> · stage now </span>
              <span className="font-medium">{a.risk.stage.label}</span>
              <span className="text-muted"> (approximate crop calendar)</span>
            </p>
            <StageStrip bands={a.stageBands} start={win.start} end={a.asOf} marker={a.asOf} markerLabel="Today" compact />
            <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-muted">
              <span>{date(win.start)}</span>
              <span>Today, {date(a.asOf)}</span>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Loan</p>
            <LoanDetails farm={farm} a={a} portfolio={portfolio} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm text-ink">
            <span className="font-medium">Location</span>
            <span className="text-muted"> · {zone?.auto ? 'farm outline and its own 35 km² zone' : `farm outline and the zone ${zone?.name ?? zoneId}`}</span>
          </p>
          <div className="relative h-[200px] overflow-hidden rounded-card border border-line">
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <FarmMiniMap farm={farm} zone={zone} zoneColor={zone ? zoneColor(portfolio, zone) : '#1F6B43'} />
            </Suspense>
          </div>
        </div>
      </div>
      <AboutData a={a} farm={farm} sample={portfolio.id.startsWith('sample-')} />
    </section>
  );
}

/* ───────────────────────── the tab ───────────────────────── */

export function OverviewTab({
  portfolio,
  farm,
  assessment: a,
  imagery,
  imagerySource,
  onSelectTab,
}: {
  portfolio: Portfolio;
  farm: Farm;
  assessment: FarmAssessment | undefined;
  /** Time-lapse (for then-vs-now thumbnails); cards render without them until it arrives. */
  imagery?: ImageryTimeline;
  imagerySource?: DataSource;
  onSelectTab: (t: FarmTab) => void;
}) {
  const m = useMemo(() => (a ? buildOverview(a, farm.crop, imagery) : null), [a, farm.crop, imagery]);
  if (!a || !m) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-[150px]" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-[240px]" />
          <Skeleton className="h-[240px]" />
          <Skeleton className="h-[240px]" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
        <VerdictBlock v={m.verdict} a={a} farm={farm} portfolio={portfolio} />
        <PlanBlock plan={m.plan} onSelectTab={onSelectTab} />
      </div>

      {m.clear ? (
        <ClearCards items={m.clear} />
      ) : (
        m.evidence.length > 0 && (
          <section aria-labelledby="ov-why">
            <h2 id="ov-why" className={clsx(EYEBROW, 'mb-2')}>
              Why
            </h2>
            <div className={clsx('grid grid-cols-1 gap-4 md:grid-cols-2', m.evidence.length >= 3 && 'xl:grid-cols-3')}>
              {m.evidence.map((c) => (
                <EvidenceCardView key={c.theme} card={c} source={imagerySource} onSelectTab={onSelectTab} />
              ))}
            </div>
          </section>
        )
      )}

      <Details portfolio={portfolio} farm={farm} a={a} />
    </div>
  );
}
