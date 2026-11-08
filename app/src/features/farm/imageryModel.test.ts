import { describe, expect, it } from 'vitest';
import type { ImageryTimeline } from '@/domain/types';
import { ImageryTimelineSchema } from '@/domain/schemas';
import { loadFixture } from '@/shared/testing/fixtures';
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
  timelineSrKind,
} from './imageryModel';

const t = ImageryTimelineSchema.parse(loadFixture('imagery-cl-ovalle-table-grape.json')) as ImageryTimeline;
const [obsAi, interpAi, obsNative] = t.frames;

describe('chooseDisplay (trust rule labels)', () => {
  it('shows native NDVI pixelated by default', () => {
    const c = chooseDisplay(obsAi, 'ndvi', false, t);
    expect(c).toMatchObject({ path: obsAi.urls.ndvi, layer: 'ndvi', enhanced: false, pixelated: true, resolutionM: 10, fallbackNote: null });
  });
  it('shows the SR image, not pixelated, when enhanced and available', () => {
    const c = chooseDisplay(obsAi, 'rgb', true, t);
    expect(c).toMatchObject({ path: obsAi.urls.rgbSr, layer: 'rgb', enhanced: true, pixelated: false, resolutionM: 2.5 });
  });
  it('never shows true colour for an interpolated date: falls back to that date’s NDVI and says why', () => {
    const c = chooseDisplay(interpAi, 'rgb', false, t);
    expect(c.layer).toBe('ndvi');
    expect(c.path).toBe(interpAi.urls.ndvi);
    expect(c.fallbackNote).toMatch(/only for observed dates/);
    const e = chooseDisplay(interpAi, 'rgb', true, t);
    expect(e.path).toBe(interpAi.urls.ndviSr);
    expect(e.enhanced).toBe(true);
  });
  it('shows native pixels with a note when the frame has no SR image', () => {
    const c = chooseDisplay(obsNative, 'ndvi', true, t);
    expect(c).toMatchObject({ path: obsNative.urls.ndvi, enhanced: false, pixelated: true });
    expect(c.fallbackNote).toMatch(/native 10 m/);
  });
});

describe('timeline helpers', () => {
  it('detects SR and its kind', () => {
    expect(hasEnhanced(t)).toBe(true);
    expect(hasEnhanced(t, 'rgb')).toBe(true);
    expect(timelineSrKind(t)).toBe('ai');
    expect(enhancedToggleLabel(t)).toBe('AI-enhanced');
    const resampled = { frames: t.frames.map((f) => ({ ...f, srKind: f.srKind ? ('resampled' as const) : null })) };
    expect(enhancedToggleLabel(resampled)).toBe('Resampled, not AI');
    const mixed = { frames: [obsAi, { ...interpAi, srKind: 'resampled' as const }] };
    expect(enhancedToggleLabel(mixed)).toBe('Enhanced');
    const none = { frames: [obsNative] };
    expect(hasEnhanced(none)).toBe(false);
    expect(timelineSrKind(none)).toBeNull();
  });
  it('finds the nearest frame and the default (latest observed) frame', () => {
    expect(nearestFrameIndex(t.frames, '2026-10-01')).toBe(0);
    expect(nearestFrameIndex(t.frames, '2026-10-30')).toBe(1);
    expect(nearestFrameIndex(t.frames, '2026-11-20')).toBe(2);
    expect(nearestFrameIndex([], '2026-11-20')).toBe(-1);
    expect(defaultFrameIndex(t.frames)).toBe(2);
    expect(defaultFrameIndex([{ kind: 'interpolated' }, { kind: 'interpolated' }])).toBe(1);
  });
  it('wraps playback and preloads the next frames', () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
    expect(preloadPaths(t.frames, 0, 'ndvi', false, t, 2)).toEqual([interpAi.urls.ndvi, obsNative.urls.ndvi]);
  });
  it('converts the bbox to Leaflet bounds and counts frames', () => {
    expect(bboxToLeafletBounds(t.bbox)).toEqual([
      [t.bbox[1], t.bbox[0]],
      [t.bbox[3], t.bbox[2]],
    ]);
    expect(frameCounts(t.frames)).toEqual({ observed: 2, interpolated: 1, enhanced: 2, ai: 2, resampled: 0 });
    expect(legendSwatches(t.legend.stops)).toHaveLength(6);
  });
});
