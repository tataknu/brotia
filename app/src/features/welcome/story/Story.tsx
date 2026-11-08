/**
 * BrotIA story slides (after the logo on /welcome). Presentation-style: each slide plays its choreography on
 * arrival from one master clock (useTimeline) and holds on its final frame. The parent owns navigation.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { FlyInScene } from '../flyin/FlyInScene';
import { Dissolve } from './pixel';
import { SceneCta } from './SceneCta';
import { SceneField } from './SceneField';
import { SceneLoan } from './SceneLoan';
import { SceneProblem } from './SceneProblem';
import { SceneSeason } from './SceneSeason';
import { SceneSolution } from './SceneSolution';
import { SceneTry } from './SceneTry';
import { SCENES, ramp, useTimeline } from './timeline';
import type { StoryData } from './useStoryData';
import './story.css';

export type SlideHandle = { running: () => boolean; finish: () => void };

const WIPE = 600; // arrival pixel wipe (ms); the scene's own clock starts under it
/** Field slide, beat (b): the dive from the portfolio view into one orchard (ms). */
export const DIVE_MS = 5200;

type SlideProps = {
  index: number;
  data: StoryData | null;
  reduce: boolean;
  noMap?: boolean;
  startDone?: boolean;
  /** Field slide only: 0 = beat (a) portfolio view, 1 = beat (b) dive into one orchard. */
  sub?: number;
  /** Review only (`?at=`): freeze the active beat at this progress (0..1). */
  freezeAt?: number;
};

export const StorySlide = forwardRef<SlideHandle, SlideProps>(function StorySlide(
  { index, data, reduce, noMap, startDone, sub = 0, freezeAt },
  ref,
) {
  const scene = SCENES[index];
  const total = scene.dur + WIPE / 2;
  const tl = useTimeline(total, reduce || startDone ? total : 0, true, !reduce && !startDone);
  const isDive = scene.id === 'field' && !noMap && sub === 1;
  const dl = useTimeline(DIVE_MS, reduce || startDone ? DIVE_MS : 0, isDive, !reduce && !startDone);
  // Once the dive has been shown, beat (a) stays on its held frame (← from (b) lands on the held portfolio view).
  const visitedDive = useRef(false);
  if (isDive) visitedDive.current = true;
  useImperativeHandle(
    ref,
    () =>
      isDive
        ? { running: () => dl.t < DIVE_MS - 1, finish: () => dl.seek(DIVE_MS) }
        : { running: () => !visitedDive.current && tl.t < total - 1, finish: () => tl.seek(total) },
    [tl, dl, total, isDive],
  );
  useEffect(() => {
    if (reduce) tl.seek(total);
  }, [reduce, tl, total]);
  useEffect(() => {
    if (reduce && isDive) dl.seek(DIVE_MS);
  }, [reduce, isDive, dl]);
  const t = Math.max(0, tl.t - WIPE / 2);
  const wipe = reduce ? 1 : 0.5 + 0.5 * ramp(tl.t, 0, WIPE);
  let body: JSX.Element;
  switch (scene.id) {
    case 'problem':
      body = <SceneProblem t={t} />;
      break;
    case 'solution':
      body = <SceneSolution t={t} />;
      break;
    case 'field':
      body = noMap ? (
        <SceneField t={t} d={data} />
      ) : (
        <div className="st-scene st-map">
          <FlyInScene
            progress={isDive || visitedDive.current ? 1 : freezeAt ?? ramp(t, 0, scene.dur - 300)}
            dive={isDive ? freezeAt ?? ramp(dl.t, 0, DIVE_MS - 200) : 0}
          />
        </div>
      );
      break;
    case 'season':
      body = <SceneSeason t={t} d={data} />;
      break;
    case 'loan':
      body = <SceneLoan t={t} d={data} />;
      break;
    case 'try':
      body = <SceneTry t={t} />;
      break;
    default:
      body = <SceneCta t={t} />;
  }
  return (
    <div className={`st-root${reduce ? ' st-reduce' : ''}`}>
      <div className="st-stage">{body}</div>
      <Dissolve p={wipe} />
    </div>
  );
});
