/**
 * Story timeline: one master clock (a single requestAnimationFrame loop) drives every scene from elapsed time,
 * so playback is deterministic, pausable and seekable. Scenes are pure functions of their local time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SceneDef = { id: string; label: string; dur: number };

export const SCENES: SceneDef[] = [
  { id: 'problem', label: 'Problem', dur: 9000 },
  { id: 'solution', label: 'Solution', dur: 11500 },
  { id: 'field', label: 'Field', dur: 5000 },
  { id: 'season', label: 'Season', dur: 10500 },
  { id: 'loan', label: 'Loan', dur: 9300 },
  { id: 'try', label: 'Try it', dur: 5000 },
  { id: 'cta', label: 'CTA', dur: 3000 },
];

export const TOTAL = SCENES.reduce((s, x) => s + x.dur, 0);

export function sceneStart(i: number, scenes = SCENES): number {
  return scenes.slice(0, Math.max(0, i)).reduce((s, x) => s + x.dur, 0);
}

/** Scene index and local time at story time t (clamped to the story). */
export function sceneAt(t: number, scenes = SCENES): { index: number; local: number } {
  const total = scenes.reduce((s, x) => s + x.dur, 0);
  let rest = Math.min(Math.max(0, t), total);
  for (let i = 0; i < scenes.length; i++) {
    if (rest < scenes[i].dur || i === scenes.length - 1) return { index: i, local: Math.min(rest, scenes[i].dur) };
    rest -= scenes[i].dur;
  }
  return { index: 0, local: 0 };
}

/** Pure clock: time advances only while playing; seek and pause are exact. */
export class Clock {
  private base = 0;
  private startedAt: number | null = null;
  constructor(private now: () => number = () => performance.now()) {}
  get playing() {
    return this.startedAt !== null;
  }
  time(): number {
    return this.startedAt === null ? this.base : this.base + (this.now() - this.startedAt);
  }
  play() {
    if (this.startedAt === null) this.startedAt = this.now();
  }
  pause() {
    this.base = this.time();
    this.startedAt = null;
  }
  seek(t: number) {
    this.base = Math.max(0, t);
    if (this.startedAt !== null) this.startedAt = this.now();
  }
}

/** React binding: rAF loop re-renders with the clock's time; stops advancing at `total`. */
export function useTimeline(total: number, startAt = 0, active = true, autoplay = true) {
  const clock = useRef(new Clock());
  const [t, setT] = useState(startAt);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active) return;
    clock.current.seek(startAt);
    if (autoplay) clock.current.play();
    setPlaying(autoplay);
    let raf = 0;
    const tick = () => {
      const c = clock.current;
      if (c.time() >= total && c.playing) {
        c.pause();
        c.seek(total);
        setPlaying(false);
      }
      setT(c.time());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, startAt, total, autoplay]);

  const toggle = useCallback(() => {
    const c = clock.current;
    if (c.playing) c.pause();
    else {
      if (c.time() >= total) c.seek(0);
      c.play();
    }
    setPlaying(c.playing);
  }, [total]);
  const seek = useCallback((ms: number) => {
    clock.current.seek(Math.min(total, ms));
    setT(clock.current.time());
  }, [total]);
  const restart = useCallback(() => {
    clock.current.seek(0);
    clock.current.play();
    setPlaying(true);
  }, []);
  return { t, playing, toggle, seek, restart };
}

/** Easing + helpers shared by scenes. */
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
