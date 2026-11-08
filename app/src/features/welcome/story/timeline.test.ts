import { describe, expect, it } from 'vitest';
import { Clock, SCENES, TOTAL, sceneAt, sceneStart } from './timeline';

describe('story timeline', () => {
  it('maps time to scene and local time', () => {
    expect(sceneAt(0)).toEqual({ index: 0, local: 0 });
    expect(sceneAt(SCENES[0].dur + 10)).toEqual({ index: 1, local: 10 });
    expect(sceneAt(sceneStart(3) + 5)).toEqual({ index: 3, local: 5 });
    expect(sceneAt(TOTAL + 999).index).toBe(SCENES.length - 1);
  });

  it('pauses, resumes and seeks exactly', () => {
    let now = 1000;
    const c = new Clock(() => now);
    c.play();
    now += 500;
    expect(c.time()).toBe(500);
    c.pause();
    now += 10_000;
    expect(c.time()).toBe(500);
    c.seek(2000);
    expect(c.time()).toBe(2000);
    c.play();
    now += 250;
    expect(c.time()).toBe(2250);
  });
});
