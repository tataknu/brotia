/**
 * Welcome (`/welcome`): full-screen BrotIA title with the seed-to-plant logo animation, ported from
 * docs/design/brotia-slide-1.html (step 1), then the story slides (story/**), presentation-style, then Home.
 * Rendered outside the app shell.
 * Keys: → / Space / PageDown / click = next (skips a running animation to its end first) · ← / PageUp = back ·
 * R = replay the current slide · Enter = enter the platform · F = fullscreen · L = light/dark (logo).
 * `?scene=N` opens story scene N (1–9; 6 = business model, 7 = try-it-yourself QR, 8 = CTA, 9 = Q&A; `&qa=N` opens Q&A card N) directly; `?scene=0` is the logo. `&end=1` opens it on its final frame. `?nomap=1` swaps the map fly-in for a pixel zoom.
 * The map slide (`?scene=3`, step 4) has two beats under one step: (a) portfolio view, then → (b) the dive into one
 * orchard; `&beat=2` opens beat (b). Review only: `&at=0.5` freezes the open beat at that progress.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './welcome.css';
import { StorySlide, type SlideHandle } from './story/Story';
import { isQaTarget } from './story/qa';
import { SCENES } from './story/timeline';
import { useStoryData } from './story/useStoryData';
import { WarmUp } from './WarmUp';

const GRID = ['.....AA', '.B..AAA', 'BBBSAA.', '.BBS...', '...S...', '...S...', '0123456'];
const RAMP = ['#1F6B43', '#2FA05A', '#8CC63F', '#E3C93B', '#E8933A', '#D0533A', '#9E2F3A'];
const STEP = 14.5833; // (7.5 + 1.25) / 60, in %
const LAND = 1500; // seed impact (ms)
const NEXT_AT = 7800; // the Next arrow appears once the tagline has landed (ms)
const EASE = { out: 'cubic-bezier(.2,.8,.2,1)', back: 'cubic-bezier(.34,1.56,.64,1)' };
// 5×5 pixel arrow pointing right
const ARROW = ['..#..', '...#.', '#####', '...#.', '..#..'];

type Cell = { el: HTMLDivElement; t: string; r: number; k: number };

function anim(el: Element, frames: Keyframe[], delay: number, duration: number, easing = EASE.out) {
  return el.animate(frames, { delay, duration, easing, fill: 'both' });
}

export function WelcomePage() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<Cell[]>([]);
  const [bg, setBg] = useState<'dark' | 'light'>('dark');
  const [showNext, setShowNext] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialStep = Math.min(SCENES.length, Math.max(0, Number(params.get('scene') ?? 0) || 0));
  const noMap = params.get('nomap') === '1';
  const [startDone, setStartDone] = useState(params.get('end') === '1'); // review: open ?scene=N on its final frame
  const [step, setStep] = useState(initialStep); // 0 = logo, 1..N = story scenes
  // A fully black opening frame before the logo (skipped when ?scene= is given); → or a click starts the logo.
  const [blank, setBlank] = useState(!params.has('scene'));
  const blankRef = useRef(blank);
  blankRef.current = blank;
  const initialSub = params.get('beat') === '2' ? 1 : 0;
  const [sub, setSub] = useState(initialSub); // beat inside the map slide: 0 = portfolio, 1 = dive
  const freezeAt = params.get('at') != null ? Math.min(1, Math.max(0, Number(params.get('at')) || 0)) : undefined;
  const [replay, setReplay] = useState(0);
  const slideRef = useRef<SlideHandle>(null);
  const data = useStoryData();
  const STEPS = SCENES.length + 1;
  const onMap = SCENES[step - 1]?.id === 'field' && !noMap;

  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const play = useCallback(() => {
    const root = rootRef.current;
    const icon = iconRef.current;
    if (!root || !icon) return;
    root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    window.clearTimeout(timer.current);
    setShowNext(false);
    const cells = cellsRef.current;
    cells.forEach((c) => (c.el.style.transformOrigin = ''));
    if (reduce) {
      setShowNext(true);
      return;
    }
    const by = (t: string) => cells.filter((c) => c.t === t);
    const soil = cells.filter((c) => /\d/.test(c.t));
    const seed = icon.querySelector<HTMLElement>('.wl-seed:not(.wl-ghost)')!;
    const ghosts = [...icon.querySelectorAll<HTMLElement>('.wl-ghost')];
    const dust = [...icon.querySelectorAll<HTMLElement>('.wl-dust')];
    const letters = [...root.querySelectorAll<HTMLElement>('.wl-word .wl-ch')];
    const ia = root.querySelector<HTMLElement>('.wl-word .wl-ia')!;
    const tag = root.querySelector<HTMLElement>('.wl-tagline')!;
    const corner = root.querySelector<HTMLElement>('.wl-corner')!;
    const bySuyana = root.querySelector<HTMLElement>('.wl-by')!;

    // Soil: the risk row, left to right
    soil.forEach((c) => anim(c.el, [{ opacity: 0, transform: 'translateY(60%) scaleY(.4)' }, { opacity: 1, transform: 'none' }], c.k * 70, 400));
    // Seed pixel: falls, squashes on impact and bounces
    seed.animate(
      [
        { opacity: 0, transform: 'translateY(-30cqw) scale(1.25)', offset: 0 },
        { opacity: 1, transform: 'translateY(-26cqw) scale(1.25)', offset: 0.1, easing: 'cubic-bezier(.5,0,.9,.4)' },
        { opacity: 1, transform: 'translateY(0) scale(1.25)', offset: 0.55 },
        { opacity: 1, transform: 'translateY(0) scale(1.75,.62)', offset: 0.62 },
        { opacity: 1, transform: 'translateY(-2.4cqw) scale(1,1.35)', offset: 0.74 },
        { opacity: 1, transform: 'translateY(0) scale(1.3,.85)', offset: 0.85 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 },
      ],
      { delay: 600, duration: 1640, easing: 'ease-out', fill: 'both' },
    );
    // Trail: copies that follow the seed and vanish on impact
    ghosts.forEach((g, i) =>
      g.animate(
        [
          { opacity: 0, transform: 'translateY(-30cqw) scale(1.1)', offset: 0 },
          { opacity: 0.45 - i * 0.12, transform: 'translateY(-26cqw) scale(1.1)', offset: 0.1, easing: 'cubic-bezier(.5,0,.9,.4)' },
          { opacity: 0.3 - i * 0.08, transform: 'translateY(0) scale(1.1)', offset: 0.55 },
          { opacity: 0, transform: 'translateY(0) scale(1.1)', offset: 0.6 },
          { opacity: 0, offset: 1 },
        ],
        { delay: 600 + (i + 1) * 45, duration: 1640, easing: 'ease-out', fill: 'both' },
      ),
    );
    // Dust kicked up on impact
    dust.forEach((d, i) => {
      const dir = i % 2 ? 1 : -1;
      const x = dir * (1 + Math.random() * 2.6);
      const y = -(0.6 + Math.random() * 1.8);
      d.animate(
        [
          { opacity: 1, transform: 'translate(0,0)' },
          { opacity: 1, transform: `translate(${x * 0.7}cqw, ${y}cqw)`, offset: 0.5 },
          { opacity: 0, transform: `translate(${x}cqw, ${y * 0.3}cqw)` },
        ],
        { delay: LAND, duration: 650, easing: 'ease-out', fill: 'forwards' },
      );
    });
    // The soil dips in a wave from the point of impact
    soil.forEach((c) =>
      c.el.animate([{ transform: 'none' }, { transform: 'translateY(30%)' }, { transform: 'none' }], {
        delay: LAND + Math.abs(c.k - 3) * 55,
        duration: 360,
        easing: 'ease-in-out',
      }),
    );
    // Germination: two green pulses, then the seed melts into the first stem pixel
    seed.animate(
      [
        { boxShadow: '0 0 0 0 rgba(108,196,142,0)' },
        { boxShadow: '0 0 0 1.1cqw rgba(108,196,142,.45)', offset: 0.25 },
        { boxShadow: '0 0 0 0 rgba(108,196,142,0)', offset: 0.5 },
        { boxShadow: '0 0 0 1.1cqw rgba(108,196,142,.45)', offset: 0.75 },
        { boxShadow: '0 0 0 0 rgba(108,196,142,0)' },
      ],
      { delay: 2300, duration: 900, easing: 'ease-in-out' },
    );
    seed.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 3200, duration: 420, easing: 'ease-in-out', fill: 'forwards' });
    const base = cells.find((c) => c.t === 'S' && c.r === 5)!;
    anim(base.el, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1.12)', offset: 0.6 }, { opacity: 1, transform: 'none' }], 3200, 480);
    // Stem grows upward
    by('S')
      .filter((c) => c.r < 5)
      .sort((a, b) => b.r - a.r)
      .forEach((c, i) => {
        c.el.style.transformOrigin = '50% 100%';
        anim(c.el, [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'none' }], 3550 + i * 190, 280);
      });
    // Leaves open outward from the stem
    const leaf = (list: Cell[], from: [number, number], origin: string, start: number) =>
      list
        .sort((a, b) => Math.hypot(a.r - from[0], a.k - from[1]) - Math.hypot(b.r - from[0], b.k - from[1]))
        .forEach((c, i) => {
          c.el.style.transformOrigin = origin;
          anim(c.el, [{ opacity: 0, transform: 'scale(0) rotate(-25deg)' }, { opacity: 1, transform: 'none' }], start + i * 75, 420, EASE.back);
        });
    leaf(by('B'), [2.5, 3], '100% 50%', 4150);
    leaf(by('A'), [2, 3], '0% 100%', 4500);
    // The satellite grid lights up around it
    by('.').forEach((c) => anim(c.el, [{ opacity: 0 }, { opacity: 1 }], 5050 + Math.random() * 600, 500));
    // Name letter by letter, then IA, then tagline
    letters.forEach((l, i) => anim(l, [{ opacity: 0, transform: 'translateY(35%)' }, { opacity: 1, transform: 'none' }], 5600 + i * 110, 380));
    anim(ia, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], 6100, 520, EASE.back);
    anim(tag, [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'none' }], 6700, 600);
    anim(corner, [{ opacity: 0 }, { opacity: 0.7 }], 6900, 600);
    anim(bySuyana, [{ opacity: 0, transform: 'translateY(30%)' }, { opacity: 1, transform: 'none' }], 7200, 600);
    timer.current = window.setTimeout(() => setShowNext(true), NEXT_AT);
  }, [reduce]);

  // Build the 7×7 mark once
  useEffect(() => {
    const icon = iconRef.current;
    if (!icon || cellsRef.current.length) return;
    GRID.forEach((row, r) =>
      [...row].forEach((ch, k) => {
        const d = document.createElement('div');
        d.className = 'wl-cell';
        d.style.left = `${k * STEP}%`;
        d.style.top = `${r * STEP}%`;
        d.style.background = ch === '.' ? 'var(--faint)' : /\d/.test(ch) ? RAMP[+ch] : `var(--${ch})`;
        icon.appendChild(d);
        cellsRef.current.push({ el: d, t: ch, r, k });
      }),
    );
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      icon.appendChild(d);
    };
    for (let i = 0; i < 3; i++) mk('wl-seed wl-ghost');
    mk('wl-seed');
    for (let i = 0; i < 8; i++) mk('wl-dust');
    // Start once the font is ready so the name doesn't jump
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!blankRef.current) play();
    });
    return () => window.clearTimeout(timer.current);
  }, [play]);

  const enter = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => navigate('/'), reduce ? 0 : 480);
  }, [leaving, navigate, reduce]);

  const finishLogo = useCallback(() => {
    rootRef.current?.getAnimations({ subtree: true }).forEach((a) => {
      try {
        a.finish();
      } catch {
        /* infinite or idle animation */
      }
    });
    window.clearTimeout(timer.current);
    setShowNext(true);
  }, []);

  const next = useCallback(() => {
    if (blankRef.current) {
      setBlank(false);
      play();
      return;
    }
    if (step === 0) {
      if (!showNext) finishLogo();
      else setStep(1);
      return;
    }
    if (slideRef.current?.running()) {
      slideRef.current.finish();
      return;
    }
    if (onMap && sub === 0) {
      setSub(1); // same slide, beat (b)
      return;
    }
    if (step >= SCENES.length) enter();
    else {
      setSub(0);
      setStep(step + 1);
    }
  }, [step, showNext, finishLogo, enter, onMap, sub, play]);

  const back = useCallback(() => {
    if (step === 0) {
      setBlank(true); // back to the black opening frame
      return;
    }
    if (onMap && sub === 1) setSub(0);
    else {
      setSub(0);
      setStep((s) => Math.max(0, s - 1));
    }
  }, [onMap, sub, step]);
  useEffect(() => {
    if (step !== initialStep || sub !== initialSub) setStartDone(false);
  }, [step, initialStep, sub, initialSub]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // Q&A cards own Enter / Space / Esc (open, close); arrows still navigate.
      if (isQaTarget(e.target) && (k === 'enter' || k === ' ' || k === 'escape')) return;
      if (k === 'arrowright' || k === ' ' || k === 'pagedown') {
        e.preventDefault();
        next();
      } else if (k === 'arrowleft' || k === 'pageup') {
        e.preventDefault();
        back();
      } else if (k === 'enter') {
        e.preventDefault();
        enter();
      } else if (k === 'r') {
        e.preventDefault();
        if (step === 0) play();
        else {
          setStartDone(false);
          setSub(0);
          setReplay((n) => n + 1);
        }
      } else if (k === 'l') {
        setBg((b) => (b === 'dark' ? 'light' : 'dark'));
      } else if (k === 'f') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enter, play, next, back, step]);

  return (
    <div ref={rootRef} className={`wl${leaving ? ' wl-leaving' : ''}${step > 0 ? ' wl-in-story' : ''}${onMap ? ' wl-on-map' : ''}`} data-bg={bg}>
      {/* Loads the platform's data while the deck plays, so Home opens fully drawn */}
      <WarmUp />
      {blank && <div className="wl-blank" onClick={next} aria-label="Start" />}
      <div className="wl-slide" role="img" aria-label="BrotIA. Climate risk, agricultural lending." onClick={next}>
        <div className="wl-stage">
          <div className="wl-lockup">
            <div className="wl-icon" ref={iconRef} />
            <div className="wl-word" aria-hidden="true">
              {'Brot'.split('').map((c, i) => (
                <span key={i} className="wl-ch">
                  {c}
                </span>
              ))}
              <span className="wl-ia">IA</span>
            </div>
          </div>
          <div className="wl-tagline">Climate risk · Agricultural lending</div>
          <div className="wl-by">
            <span>by</span>
            <img src={`${import.meta.env.BASE_URL}partners/suyana.svg`} alt="" />
            <b>Suyana</b>
          </div>
        </div>
      </div>
      <div className="wl-corner">brotia · 2026</div>
      {step > 0 && (
        <div className="wl-story" onClick={(e) => !isQaTarget(e.target) && next()}>
          <StorySlide key={`${step}-${replay}`} ref={slideRef} index={step - 1} data={data} reduce={!!reduce} noMap={noMap} startDone={startDone} sub={onMap ? sub : 0} freezeAt={step === initialStep && sub === initialSub ? freezeAt : undefined} />
        </div>
      )}
      <div className="st-steps" aria-label={`Step ${step + 1} of ${STEPS}${onMap ? `, beat ${sub + 1} of 2` : ''}`}>
        <span>
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} className={i <= step ? 'on' : undefined} />
          ))}
        </span>
        {step + 1} / {STEPS}
      </div>
      <div className="st-hint" style={{ opacity: showNext && step === 0 ? 1 : 0 }} aria-hidden="true">
        → next
      </div>
      <button type="button" className={`wl-next${showNext || step > 0 ? ' wl-show' : ''}`} onClick={enter} aria-label="Enter the platform">
        Enter platform
        <span className="wl-arrow" aria-hidden="true">
          {ARROW.join('')
            .split('')
            .map((ch, i) => (
              <i key={i} className={ch === '#' ? 'on' : undefined} />
            ))}
        </span>
      </button>
    </div>
  );
}
