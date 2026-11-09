import { describe, expect, it } from 'vitest';
import { fieldBeats, sceneTime, sectionProgress } from './scrollMap';

describe('landing scroll → t', () => {
  const vh = 900;
  const h = 2.6 * vh;
  it('is 0 before the block approaches and 1 after its pinned travel', () => {
    expect(sectionProgress(vh * 2, h, vh)).toBe(0);
    expect(sectionProgress(-h, h, vh)).toBe(1);
  });
  it('starts while the block slides in and grows monotonically', () => {
    expect(sectionProgress(0.3 * vh, h, vh)).toBeGreaterThan(0);
    let last = -1;
    for (let top = vh; top > -h; top -= 37) {
      const p = sectionProgress(top, h, vh);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
  it('reaches the final frame before the block ends (hold)', () => {
    const lastPinned = -(h - vh);
    expect(sectionProgress(lastPinned + 0.1 * vh, h, vh)).toBe(1);
  });
  it('maps progress to clamped scene time, rewinding when progress goes back', () => {
    expect(sceneTime(0.5, 9000)).toBe(4500);
    expect(sceneTime(1.4, 9000)).toBe(9000);
    expect(sceneTime(-1, 9000)).toBe(0);
    expect(sceneTime(Number.NaN, 9000)).toBe(0);
  });
  it('splits the field into fly-in then dive', () => {
    expect(fieldBeats(0)).toEqual({ progress: 0, dive: 0 });
    expect(fieldBeats(0.5)).toEqual({ progress: 1, dive: 0 });
    expect(fieldBeats(1)).toEqual({ progress: 1, dive: 1 });
  });
});
