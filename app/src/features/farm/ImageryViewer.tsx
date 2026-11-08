/**
 * Imagery viewer (CONTRACT §E.12, ADR-0013 D8): a time-lapse of the farm over 13 months.
 * NDVI or true colour; optional enhanced (AI super-resolution or the resampled fallback) for display only;
 * every frame labelled Observed / Interpolated (n days from a clear image) / AI-enhanced / Resampled, not AI.
 * The statistics (mean, p10, p90) always come from native 10 m pixels.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ImageOff, Pause, Play, ShieldCheck, SkipBack, SkipForward, TriangleAlert } from 'lucide-react';
import type { Farm, ImageryFrame, ImageryTimeline, Portfolio, StageBand } from '@/domain/types';
import { addDays, daysBetween, parseISODate } from '@/domain/dates';
import { imageUrl, type DataSource } from '@/data/api';
import { useFarmImagery } from '@/data/hooks';
import { SEMANTIC } from '@/shared/chartColors';
import { date, number, pct } from '@/shared/format';
import { Card, FrameKindBadge, ProvenanceBadge } from '@/shared/ui';
import { frameConfidence } from '@/shared/labels';
import {
  bboxToLeafletBounds,
  chooseDisplay,
  defaultFrameIndex,
  enhancedToggleLabel,
  frameCounts,
  hasEnhanced,
  legendSwatches,
  nearestFrameIndex,
  nextIndex,
  preloadPaths,
  type ImageryLayer,
} from './imageryModel';
import { monthTicks, msToISO } from './farmData';
import { ErrorPanel, Skeleton, StageStrip } from './parts';

const PLAY_MS = 650;

// Leaflet needs `window` at import time: load the map lazily (keeps SSR smoke tests and the first bundle clean).
const ImageryMap = lazy(() => import('./ImageryMap'));

function Toggle({ options, value, onChange, label }: { options: { value: string; label: string; disabled?: boolean; title?: string }[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-card border border-line bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-[6px] px-2.5 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-brand text-white' : 'text-ink hover:bg-surface',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatsChart({ frames, index, onPick }: { frames: ImageryFrame[]; index: number; onPick: (i: number) => void }) {
  const rows = useMemo(
    () => frames.map((f) => ({ t: parseISODate(f.date), date: f.date, mean: f.ndviMean, band: [f.ndviP10, f.ndviP90] as [number, number], observed: f.kind === 'observed' ? f.ndviMean : null })),
    [frames],
  );
  const start = frames[0].date;
  const end = frames[frames.length - 1].date;
  const cur = frames[index];
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">NDVI of the farm, frame by frame</p>
        <p className="text-xs tabular-nums text-muted">
          {date(cur.date)}: mean {number(cur.ndviMean, 2)} (p10 {number(cur.ndviP10, 2)}, p90 {number(cur.ndviP90, 2)}), native 10 m pixels
        </p>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            onClick={(s) => {
              const i = typeof s?.activeTooltipIndex === 'number' ? s.activeTooltipIndex : Number(s?.activeTooltipIndex);
              if (Number.isInteger(i) && i >= 0 && i < frames.length) onPick(i);
            }}
          >
            <CartesianGrid vertical={false} stroke={SEMANTIC.line} strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[parseISODate(start), parseISODate(end)]}
              ticks={monthTicks(start, end, 2)}
              tickFormatter={(t: number) => date(msToISO(t), 'month')}
              tick={{ fill: SEMANTIC.muted, fontSize: 11 }}
              axisLine={{ stroke: SEMANTIC.line }}
              tickLine={false}
            />
            <YAxis width={36} domain={[0, 1]} ticks={[0, 0.5, 1]} tick={{ fill: SEMANTIC.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Area dataKey="band" type="monotone" stroke="none" fill={SEMANTIC.baselineBand} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Line dataKey="mean" type="monotone" stroke={SEMANTIC.brand} strokeWidth={1.75} dot={false} isAnimationActive={false} activeDot={{ r: 3 }} />
            <Line dataKey="observed" stroke="none" dot={{ r: 2.5, fill: SEMANTIC.ink, strokeWidth: 0 }} activeDot={false} isAnimationActive={false} />
            <ReferenceLine x={parseISODate(cur.date)} stroke={SEMANTIC.ink} strokeWidth={1.5} />
            <Tooltip
              content={(p) => {
                const row = (p.payload?.[0]?.payload ?? null) as { date: string; mean: number; band: [number, number]; observed: number | null } | null;
                if (!p.active || !row) return null;
                return (
                  <div className="rounded-card border border-line bg-white px-3 py-2 text-xs shadow-panel">
                    <p className="font-medium text-ink">
                      {date(row.date)} · {row.observed !== null ? 'observed' : 'interpolated'}
                    </p>
                    <p className="tabular-nums text-ink">
                      Mean {number(row.mean, 2)} (p10 {number(row.band[0], 2)}, p90 {number(row.band[1], 2)})
                    </p>
                    <p className="text-muted">Click to show this frame</p>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-brand" /> Mean
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-brand/20" /> p10–p90 of pixels
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink" /> Observed date
        </span>
      </div>
    </div>
  );
}

export function Viewer({ timeline, source, farm, bands }: { timeline: ImageryTimeline; source: DataSource; farm: Farm; bands: readonly StageBand[] }) {
  const frames = timeline.frames;
  const [index, setIndex] = useState(() => defaultFrameIndex(frames));
  const [layer, setLayer] = useState<ImageryLayer>('ndvi');
  const [enhanced, setEnhanced] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // A new timeline (other farm, refetch) resets the view to the latest observed frame.
  useEffect(() => {
    setIndex(defaultFrameIndex(frames));
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setIndex((i) => nextIndex(i, frames.length)), PLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, frames.length]);

  const i = Math.min(Math.max(0, index), frames.length - 1);
  const frame = frames[i];
  const choice = chooseDisplay(frame, layer, enhanced, timeline);
  const url = imageUrl(choice.path, source);

  // Preload the next frames so playback does not flicker.
  useEffect(() => {
    for (const p of preloadPaths(frames, i, layer, enhanced, timeline)) {
      const u = imageUrl(p, source);
      if (u) new Image().src = u;
    }
  }, [frames, i, layer, enhanced, timeline, source]);

  const bounds = useMemo(() => bboxToLeafletBounds(timeline.bbox), [timeline.bbox]);
  const counts = frameCounts(frames);
  const canEnhance = hasEnhanced(timeline);
  const enhancedLabel = enhancedToggleLabel(timeline);
  const start = frames[0].date;
  const end = frames[frames.length - 1].date;
  const span = Math.max(1, daysBetween(start, end));
  const conf = frame.kind === 'interpolated' ? frameConfidence(frame.daysToClear) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          label="Image layer"
          value={layer}
          onChange={(v) => setLayer(v as ImageryLayer)}
          options={[
            { value: 'ndvi', label: 'Vigour (NDVI)' },
            { value: 'rgb', label: 'True colour', title: 'Available on observed dates only' },
          ]}
        />
        {canEnhance && (
          <Toggle
            label="Resolution"
            value={enhanced ? 'sr' : 'native'}
            onChange={(v) => setEnhanced(v === 'sr')}
            options={[
              { value: 'native', label: `Native ${timeline.nativeResolutionM} m` },
              { value: 'sr', label: `${enhancedLabel}${timeline.srResolutionM ? ` ${timeline.srResolutionM} m` : ''}`, title: 'For viewing only: numbers always use native pixels' },
            ]}
          />
        )}
        <div className="flex-1" />
        <ProvenanceBadge provenance={timeline.provenance} title="Satellite imagery" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),220px]">
        <div className="relative h-[420px] overflow-hidden rounded-card border border-line">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <ImageryMap
              bounds={bounds}
              polygon={farm.polygon}
              url={url && failed !== url ? url : null}
              pixelated={choice.pixelated}
              onError={(u) => setFailed(u)}
              onLoad={(u) => setFailed((f) => (f === u ? null : f))}
            />
          </Suspense>
          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col items-start gap-1.5">
            <span className="rounded-card bg-white/95 px-2.5 py-1 text-sm font-semibold tabular-nums text-ink shadow-panel">{date(frame.date)}</span>
            <FrameKindBadge frame={frame} showSr={choice.enhanced} className="rounded-full bg-white/95 p-0.5 shadow-panel" />
          </div>
          {(!url || failed === url) && (
            <div className="absolute inset-x-3 bottom-3 z-[500] flex items-center gap-2 rounded-card bg-white/95 px-3 py-2 text-sm text-muted shadow-panel">
              <ImageOff size={16} className="shrink-0" />
              The image for this date is not available{source === 'snapshot' ? ' in the offline snapshot' : ''}. The numbers below are unaffected.
            </div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-ink">This frame</p>
            <dl className="mt-1 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-0.5">
              <dt className="text-muted">Kind</dt>
              <dd className="text-ink">{frame.kind === 'observed' ? 'Observed' : `Interpolated, ${frame.daysToClear} d from a clear image`}</dd>
              {frame.kind === 'observed' && frame.clearFraction !== null && frame.clearFraction !== undefined && (
                <>
                  <dt className="whitespace-nowrap text-muted">Clear sky</dt>
                  <dd className="tabular-nums text-ink">{pct(frame.clearFraction)}</dd>
                </>
              )}
              {conf && (
                <>
                  <dt className="text-muted">Confidence</dt>
                  <dd className="text-ink">{conf}</dd>
                </>
              )}
              <dt className="text-muted">Showing</dt>
              <dd className="text-ink">
                {choice.layer === 'rgb' ? 'True colour' : 'NDVI'}, {choice.resolutionM ?? '–'} m pixels
              </dd>
              {choice.enhanced && frame.srKind === 'ai' && (
                <>
                  <dt className="text-muted">Model</dt>
                  <dd className="break-all font-mono text-xs text-ink">{frame.srModel ?? 'unknown'}</dd>
                </>
              )}
              <dt className="whitespace-nowrap text-muted">NDVI mean</dt>
              <dd className="tabular-nums text-ink">{number(frame.ndviMean, 2)}</dd>
            </dl>
            {choice.fallbackNote && <p className="mt-2 rounded-card bg-surface px-2.5 py-1.5 text-xs text-muted">{choice.fallbackNote}</p>}
          </div>

          {choice.layer === 'ndvi' ? (
            <div>
              <p className="font-medium text-ink">Legend (NDVI)</p>
              <div className="mt-1.5 flex gap-0.5">
                {legendSwatches(timeline.legend.stops).map((s) => (
                  <div key={s.value} className="flex-1 text-center">
                    <div className="h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] tabular-nums text-muted">{number(s.value, 1)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">Low vigour (red) to dense healthy canopy (green).</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-ink">True colour</p>
              <p className="mt-0.5 text-xs text-muted">Sentinel-2 red, green and blue bands, observed dates only.</p>
            </div>
          )}

          {timeline.coveredWarning && (
            <p className="flex items-start gap-2 rounded-card bg-warn-soft px-2.5 py-2 text-xs text-warn">
              <TriangleAlert size={16} className="shrink-0" />
              {timeline.coveredWarning}
            </p>
          )}
        </div>
      </div>

      {/* Time slider: positioned by date, so the stage strip below lines up with it. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIndex((k) => Math.max(0, k - 1))}
            className="rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink"
            aria-label="Previous frame"
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-card bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            aria-pressed={playing}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setIndex((k) => Math.min(frames.length - 1, k + 1))}
            className="rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink"
            aria-label="Next frame"
          >
            <SkipForward size={16} />
          </button>
          <span className="ml-auto text-xs tabular-nums text-muted">
            Frame {i + 1} of {frames.length} · {counts.observed} observed, {counts.interpolated} interpolated
            {counts.ai ? `, ${counts.ai} AI-enhanced` : ''}
            {counts.resampled ? `, ${counts.resampled} resampled (not AI)` : ''}
          </span>
        </div>
        <div className="px-2">
          <input
            type="range"
            min={0}
            max={span}
            step={1}
            value={daysBetween(start, frame.date)}
            onChange={(e) => {
              setPlaying(false);
              setIndex(nearestFrameIndex(frames, addDays(start, Number(e.target.value))));
            }}
            aria-label="Image date"
            aria-valuetext={date(frame.date)}
            className="block w-full accent-brand"
          />
        </div>
        <div className="px-2">
          {/* Frame ticks: filled = observed (clear image), hollow = interpolated. */}
          <div className="relative h-2.5">
            {frames.map((f) => (
              <span
                key={f.date}
                className={clsx('absolute top-0.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full', f.kind === 'observed' ? 'bg-ink' : 'border border-muted/60')}
                style={{ left: `${(daysBetween(start, f.date) / span) * 100}%` }}
              />
            ))}
          </div>
          <StageStrip bands={bands} start={start} end={end} marker={frame.date} markerLabel="Selected date" compact className="mt-1" />
        </div>
      </div>

      <StatsChart frames={frames} index={i} onPick={(k) => { setPlaying(false); setIndex(k); }} />

      <div className="flex items-start gap-2.5 rounded-card border border-brand/20 bg-brand-soft px-3 py-2.5 text-sm">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand" />
        <div>
          <p className="font-medium text-brand-ink">Numbers use native {timeline.nativeResolutionM} m data; AI images are for viewing.</p>
          <p className="text-ink">{timeline.trustNote}</p>
        </div>
      </div>
    </div>
  );
}

export function ImageryCard({ portfolio, farm, bands }: { portfolio: Portfolio; farm: Farm; bands: readonly StageBand[] }) {
  const q = useFarmImagery(portfolio, farm.id, { sr: true });
  return (
    <Card title="Satellite time-lapse" subtitle="Sentinel-2 over the last 13 months: observed images plus interpolated frames every 5 days.">
      {q.data && q.data.frames.length > 0 && q.source ? (
        <Viewer timeline={q.data} source={q.source} farm={farm} bands={bands} />
      ) : q.data ? (
        <div className="rounded-card bg-surface px-4 py-8 text-center text-sm text-muted">
          No imagery for this farm in the window. {q.data.provenance.note ?? ''}
        </div>
      ) : q.error ? (
        <ErrorPanel error={q.error} onRetry={q.refetch} what="Imagery" />
      ) : (
        <div className="space-y-3" aria-busy>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),220px]">
            <Skeleton className="h-[420px]" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-10" />
            </div>
          </div>
          <Skeleton className="h-8" />
          <p className="text-sm text-muted">Building the time-lapse from Sentinel-2. The first request for a farm can take up to two minutes; later ones are cached.</p>
        </div>
      )}
    </Card>
  );
}
