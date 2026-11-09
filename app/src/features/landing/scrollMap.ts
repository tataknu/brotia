/**
 * Scroll → scene time for the landing scroll story. Pure, so it is unit-tested.
 *
 * Each section is a tall block holding a sticky, viewport-high stage. Progress runs from 0 when the block's top is
 * `lead` viewports below the top of the screen (the stage starts playing while it slides in) to 1 when the block has
 * scrolled `hold` of the way through its pinned travel, so the final frame holds for the rest of the block.
 */
export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export type ProgressOpts = { lead?: number; hold?: number };

/**
 * @param top    block's getBoundingClientRect().top (px)
 * @param height block height (px)
 * @param vh     viewport height (px)
 */
export function sectionProgress(top: number, height: number, vh: number, { lead = 0.35, hold = 0.18 }: ProgressOpts = {}): number {
  const travel = Math.max(1, height - vh + lead * vh); // px of scroll from "starts" to "block bottom meets viewport bottom"
  const raw = (lead * vh - top) / travel;
  return clamp01(raw / Math.max(0.01, 1 - hold));
}

/** Scene-local time (ms) at a progress value: t = clamp(p) · dur. */
export function sceneTime(p: number, dur: number): number {
  return clamp01(p) * dur;
}

/** The field section splits its scroll in two beats: fly-in (portfolio view), then the dive into one orchard. */
export function fieldBeats(p: number): { progress: number; dive: number } {
  const v = clamp01(p);
  return { progress: clamp01(v / 0.5), dive: clamp01((v - 0.55) / 0.44) };
}
