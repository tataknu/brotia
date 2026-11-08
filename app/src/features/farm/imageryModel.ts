/**
 * Pure logic for the imagery viewer (CONTRACT §E.12, trust rule). No React; unit-tested.
 *
 * - Layer 'ndvi' (vigour map) or 'rgb' (true colour). True colour exists only for observed frames: on an
 *   interpolated frame the viewer shows that date's NDVI and says why. It never shows another date's picture.
 * - 'Enhanced' (AI super-resolution, or the resampled fallback) is display-only. When a frame has no SR image the
 *   viewer shows the native 10 m image and says so. Statistics always come from native pixels (frame.ndvi*).
 */
import type { ImageryFrame, ImageryTimeline } from '@/domain/types';
import { parseISODate } from '@/domain/dates';
import { srLabel } from '@/shared/labels';

export type ImageryLayer = 'ndvi' | 'rgb';

export interface DisplayChoice {
  /** Service path ('/files/imagery/...'), resolve with imageUrl(). null = nothing to show. */
  path: string | null;
  /** What is actually displayed. */
  layer: ImageryLayer;
  /** true when the displayed pixels are SR (AI or resampled): display only. */
  enhanced: boolean;
  /** Native pixels are drawn square (`pixelated`); SR images are not. */
  pixelated: boolean;
  /** Ground pixel size of the displayed image, metres. */
  resolutionM: number | null;
  /** Why the request could not be honoured exactly (shown under the image), else null. */
  fallbackNote: string | null;
}

/** True when the timeline has any SR image (the 'Enhanced' toggle is offered only then). */
export function hasEnhanced(t: Pick<ImageryTimeline, 'frames'>, layer?: ImageryLayer): boolean {
  return t.frames.some((f) => (layer === 'rgb' ? !!f.urls.rgbSr : layer === 'ndvi' ? !!f.urls.ndviSr : !!(f.urls.ndviSr || f.urls.rgbSr)));
}

/** Kind of SR used across the timeline ('ai' wins over 'resampled'), for the toggle label. */
export function timelineSrKind(t: Pick<ImageryTimeline, 'frames'>): ImageryFrame['srKind'] {
  if (t.frames.some((f) => f.srKind === 'ai' && (f.urls.ndviSr || f.urls.rgbSr))) return 'ai';
  if (t.frames.some((f) => f.srKind === 'resampled' && (f.urls.ndviSr || f.urls.rgbSr))) return 'resampled';
  return null;
}

/**
 * Label of the enhanced toggle: 'AI-enhanced' when every SR frame is AI, 'Resampled, not AI' when every one is
 * resampled, and plain 'Enhanced' when the timeline mixes both (e.g. AI on observed dates, resampled on
 * interpolated ones). The per-frame badge then says which one is on screen.
 */
export function enhancedToggleLabel(t: Pick<ImageryTimeline, 'frames'>): string {
  const sr = t.frames.filter((f) => f.urls.ndviSr || f.urls.rgbSr);
  const ai = sr.some((f) => f.srKind === 'ai');
  const res = sr.some((f) => f.srKind === 'resampled');
  if (ai && res) return 'Enhanced';
  return srLabel(ai ? 'ai' : res ? 'resampled' : null) ?? 'Enhanced';
}

export function chooseDisplay(frame: ImageryFrame, want: ImageryLayer, wantEnhanced: boolean, t: Pick<ImageryTimeline, 'nativeResolutionM' | 'srResolutionM'>): DisplayChoice {
  const notes: string[] = [];
  let layer: ImageryLayer = want;
  if (want === 'rgb' && !frame.urls.rgb) {
    layer = 'ndvi';
    notes.push(
      frame.kind === 'interpolated'
        ? 'True colour exists only for observed dates; this interpolated date shows the vigour map.'
        : 'No true-colour image for this date; showing the vigour map.',
    );
  }
  const native = layer === 'rgb' ? frame.urls.rgb : frame.urls.ndvi;
  const sr = layer === 'rgb' ? frame.urls.rgbSr : frame.urls.ndviSr;
  if (wantEnhanced && sr && frame.srKind) {
    return { path: sr, layer, enhanced: true, pixelated: false, resolutionM: t.srResolutionM, fallbackNote: notes.join(' ') || null };
  }
  if (wantEnhanced && !sr) notes.push(`No enhanced image for this date; showing native ${t.nativeResolutionM} m pixels.`);
  return { path: native ?? null, layer, enhanced: false, pixelated: true, resolutionM: t.nativeResolutionM, fallbackNote: notes.join(' ') || null };
}

/** Index of the frame nearest a date (ties → earlier frame). -1 without frames. */
export function nearestFrameIndex(frames: readonly Pick<ImageryFrame, 'date'>[], d: string): number {
  if (frames.length === 0) return -1;
  const t = parseISODate(d);
  let best = 0;
  let bestDist = Infinity;
  frames.forEach((f, i) => {
    const dist = Math.abs(parseISODate(f.date) - t);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

/** Index of the latest observed frame (the default view), else the last frame; -1 without frames. */
export function defaultFrameIndex(frames: readonly Pick<ImageryFrame, 'kind'>[]): number {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].kind === 'observed') return i;
  return frames.length - 1;
}

/** Next index during playback (wraps to 0 after the last frame). */
export function nextIndex(i: number, n: number): number {
  if (n <= 0) return -1;
  return i + 1 >= n ? 0 : i + 1;
}

/** Paths to preload around the current frame for smooth playback. */
export function preloadPaths(frames: readonly ImageryFrame[], i: number, want: ImageryLayer, wantEnhanced: boolean, t: Pick<ImageryTimeline, 'nativeResolutionM' | 'srResolutionM'>, ahead = 3): string[] {
  const out: string[] = [];
  for (let k = 1; k <= ahead && frames.length > 0; k++) {
    const f = frames[(i + k) % frames.length];
    const p = chooseDisplay(f, want, wantEnhanced, t).path;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Leaflet bounds [[south, west], [north, east]] from a contract bbox [minLng, minLat, maxLng, maxLat]. */
export function bboxToLeafletBounds(b: ImageryTimeline['bbox']): [[number, number], [number, number]] {
  return [
    [b[1], b[0]],
    [b[3], b[2]],
  ];
}

/** Counts for the caption: observed vs interpolated frames, and frames with AI / resampled enhanced images. */
export function frameCounts(frames: readonly ImageryFrame[]): { observed: number; interpolated: number; enhanced: number; ai: number; resampled: number } {
  const sr = frames.filter((f) => !!(f.urls.ndviSr || f.urls.rgbSr));
  return {
    observed: frames.filter((f) => f.kind === 'observed').length,
    interpolated: frames.filter((f) => f.kind === 'interpolated').length,
    enhanced: sr.length,
    ai: sr.filter((f) => f.srKind === 'ai').length,
    resampled: sr.filter((f) => f.srKind === 'resampled').length,
  };
}

/** Legend swatches from the service legend stops (flat, no gradients): one swatch per stop, labelled. */
export function legendSwatches(stops: readonly [number, string][]): { value: number; color: string }[] {
  return stops.map(([value, color]) => ({ value, color }));
}
