/**
 * Landing (`/`): the /welcome deck retold as a scroll story.
 * Desktop/tablet (≥ 900 px): every section is a tall block with a sticky 16:9 stage that renders the real deck scene;
 * the scene's time comes from scroll (`t = clamp(progress) · dur`, see scrollMap.ts), so scrolling plays it and
 * scrolling back rewinds it. Scenes are pure functions of `t`, so jumps and reversals are safe.
 * Mobile (< 900 px): stacked sections with headline, caption and key numbers in HTML, plus the scene's final frame in a
 * horizontally scrollable card. Stages mount only near the viewport (IntersectionObserver); one passive, rAF-throttled
 * scroll listener drives every mounted section. `prefers-reduced-motion` shows final frames.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { FlyInScene } from '../welcome/flyin/FlyInScene';
import { MiniQr } from '../welcome/story/MiniQr';
import { SceneBusiness } from '../welcome/story/SceneBusiness';
import { SceneField } from '../welcome/story/SceneField';
import { SceneLoan } from '../welcome/story/SceneLoan';
import { SceneProblem } from '../welcome/story/SceneProblem';
import { SceneQa } from '../welcome/story/SceneQa';
import { SceneSeason } from '../welcome/story/SceneSeason';
import { SceneSolution } from '../welcome/story/SceneSolution';
import { SceneTry } from '../welcome/story/SceneTry';
import { SCENES } from '../welcome/story/timeline';
import { useStoryData, type StoryData } from '../welcome/story/useStoryData';
import { WarmUp } from '../welcome/WarmUp';
import { paths } from '@/shell/paths';
import '../welcome/story/story.css';
import './landing.css';
import { fieldBeats, sceneTime, sectionProgress } from './scrollMap';

const PLATFORM = paths.home;
const STORY = '/welcome';
const TITLE = 'BrotIA · Climate risk for agricultural lending';

// ---------- the 7×7 mark (same grid and ramp as the deck's logo) ----------
const GRID = ['.....AA', '.B..AAA', 'BBBSAA.', '.BBS...', '...S...', '...S...', '0123456'];
const RAMP = ['#1F6B43', '#2FA05A', '#8CC63F', '#E3C93B', '#E8933A', '#D0533A', '#9E2F3A'];
const STEP = 14.5833;
const ARROW = ['..#..', '...#.', '#####', '...#.', '..#..'];
const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function Mark({ size, animate = false }: { size?: number; animate?: boolean }) {
  let b = 0;
  let a = 0;
  const cells: ReactNode[] = [];
  GRID.forEach((row, r) =>
    [...row].forEach((ch, k) => {
      const soil = /\d/.test(ch);
      const cls = soil ? 'ld-soil' : ch === 'S' ? 'ld-stem' : ch === '.' ? 'ld-dot' : undefined;
      const delay = soil ? 100 + k * 70 : ch === 'S' ? 700 + (5 - r) * 170 : ch === 'B' ? 1400 + b++ * 70 : ch === 'A' ? 1650 + a++ * 70 : 2100 + hash(r * 7 + k) * 500;
      cells.push(
        <i key={`${r}-${k}`} className={cls}
          style={{ left: `${k * STEP}%`, top: `${r * STEP}%`, background: ch === '.' ? 'var(--faint)' : soil ? RAMP[+ch] : `var(--${ch})`, '--d': `${delay}ms` } as CSSProperties} />,
      );
    }),
  );
  return (
    <div className={`ld-mark${animate ? ' ld-mark-anim' : ''}`} style={size ? { width: size } : undefined} aria-hidden="true">
      {cells}
    </div>
  );
}

function Arrow() {
  return (
    <span className="ld-arrow" aria-hidden="true">
      {ARROW.join('')
        .split('')
        .map((ch, i) => (
          <i key={i} className={ch === '#' ? 'on' : undefined} />
        ))}
    </span>
  );
}

// ---------- hooks ----------
function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** True while the element is within ~1 viewport of the screen. */
function useNear(ref: RefObject<HTMLElement>, margin = '100% 0px'): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

// One passive scroll/resize listener, throttled to one rAF, shared by every section.
const subs = new Set<() => void>();
let raf = 0;
const schedule = () => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    subs.forEach((f) => f());
  });
};
function useScrollFrame(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const f = () => ref.current();
    subs.add(f);
    if (subs.size === 1) {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
    }
    f();
    return () => {
      subs.delete(f);
      if (!subs.size) {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
      }
    };
  }, []);
}

// ---------- sections ----------
type SceneId = 'problem' | 'solution' | 'field' | 'season' | 'loan' | 'business' | 'qa' | 'try';
type Fact = { v: string; l: string };
type Sec = { id: SceneId; anchor: string; kicker: string; title: string; caption: string; vh: number; facts: (d: StoryData | null) => Fact[] };

const durOf = (id: SceneId) => SCENES.find((s) => s.id === id)?.dur ?? 5000;
const money = (v: number, c: string) => `${c} ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const SECTIONS: Sec[] = [
  {
    id: 'problem', anchor: 'problem', kicker: '01 · The problem', vh: 260,
    title: 'Orchards are financed for years. Climate risk changes every week.',
    caption: 'Lenders find out at the missed payment. One frost night at bloom, dry years stacking up or one hail afternoon can take the season.',
    facts: () => [{ v: '$123B', l: 'of crops and livestock lost to disasters every year (FAO 2023)' }, { v: '≈5%', l: 'of global agricultural GDP, lost the same way (FAO 2023)' }],
  },
  {
    id: 'solution', anchor: 'solution', kicker: '02 · BrotIA', vh: 280,
    title: 'BrotIA watches every financed field from space.',
    caption: 'Sentinel-2 vegetation and canopy moisture, plus station and gridded climate, become one risk score per field, with insurance cover suggested when it matters.',
    facts: () => [{ v: '10 m', l: 'Sentinel-2 resolution, every 5 days' }, { v: '1 score', l: 'per field, against its own history' }, { v: 'Cover', l: 'suggested when the risk calls for it' }],
  },
  {
    id: 'field', anchor: 'demo', kicker: '03 · The portfolio', vh: 300,
    title: 'From the whole portfolio down to one orchard.',
    caption: 'Every financed field on real satellite imagery, pinned by risk tier. Keep scrolling to dive into one cherry orchard in southern Chile.',
    facts: (d) => (d ? [{ v: `${d.areaHa.toLocaleString('en-US', { maximumFractionDigits: 1 })} ha`, l: `${d.crop} · ${d.farmName}` }, { v: d.portfolioCode, l: d.portfolioName }] : []),
  },
  {
    id: 'season', anchor: 'season', kicker: '04 · One season, every five days', vh: 280,
    title: 'The season, read every five days.',
    caption: "Vegetation, canopy moisture, rain and night temperatures against the field's own usual range. A persistent drop is flagged months before the payment is due.",
    facts: (d) => (d ? [{ v: d.score.toFixed(1), l: `risk score · ${d.tier} tier` }, { v: d.asOf, l: 'assessment date' }] : []),
  },
  {
    id: 'loan', anchor: 'loan', kicker: '05 · Linked to the loan', vh: 260,
    title: 'The risk lands on the loan.',
    caption: 'Installments are tracked against the field signal. The next payment at risk is flagged with its lead time, and a cover request can go straight to Suyana.',
    facts: (d) =>
      d
        ? [
            ...(d.nextInstallment ? [{ v: money(d.nextInstallment.amount, d.currency), l: `next installment · due ${d.nextInstallment.dueDate}` }] : []),
            ...(d.exposure != null ? [{ v: money(d.exposure, d.currency), l: 'exposure on this field' }] : []),
          ]
        : [],
  },
  {
    id: 'business', anchor: 'business', kicker: '06 · Business model', vh: 260,
    title: 'The tool at cost. The margin on insurance.',
    caption: 'Banks pay a near-cost annual fee per package of fields. Suyana earns its margin on each policy tailored to a field, quoted inside the tool the bank already uses.',
    facts: () => [{ v: '1,000 ha', l: 'per annual package, priced near cost' }, { v: '+100 ha', l: 'add-on blocks beyond the package' }, { v: '1 click', l: 'sends a quote tailored to each field' }],
  },
  {
    id: 'qa', anchor: 'qa', kicker: '07 · Q&A', vh: 220,
    title: 'Questions? Open a card.',
    caption: "What data we use, how the score is built, clouds, what 'normal' means, where AI comes in, and the limits.",
    facts: () => [],
  },
  {
    id: 'try', anchor: 'try', kicker: '08 · Try it yourself', vh: 220,
    title: 'Try it yourself.',
    caption: 'The CLSO2 sample portfolio report: farms, loans and the field under the highest stress, live in the platform.',
    facts: () => [],
  },
];

function Scene({ id, t, p, d, mobile }: { id: SceneId; t: number; p: number; d: StoryData | null; mobile: boolean }) {
  switch (id) {
    case 'problem':
      return <SceneProblem t={t} />;
    case 'solution':
      return <SceneSolution t={t} />;
    case 'field': {
      if (mobile) return <SceneField t={t} d={d} />;
      const b = fieldBeats(p);
      return (
        <div className="ld-map">
          <FlyInScene progress={b.progress} dive={b.dive} />
        </div>
      );
    }
    case 'season':
      return <SceneSeason t={t} d={d} />;
    case 'loan':
      return <SceneLoan t={t} d={d} />;
    case 'business':
      return <SceneBusiness t={t} d={d} />;
    case 'qa':
      return (
        <>
          <SceneQa t={t} />
          <MiniQr t={t} />
        </>
      );
    default:
      return <SceneTry t={t} />;
  }
}

function Kicker({ text }: { text: string }) {
  return (
    <div className="ld-kicker">
      <i />
      {text}
    </div>
  );
}

function ScrollSection({ sec, d, reduce }: { sec: Sec; d: StoryData | null; reduce: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const near = useNear(ref);
  const [p, setP] = useState(reduce ? 1 : 0);
  useScrollFrame(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) return setP(1);
    const r = el.getBoundingClientRect();
    if (r.bottom < -window.innerHeight || r.top > 2 * window.innerHeight) return; // far away: keep the last value
    setP(sectionProgress(r.top, r.height, window.innerHeight));
  });
  const t = sceneTime(p, durOf(sec.id));
  return (
    <section id={sec.anchor} ref={ref} className="ld-sec" style={{ height: `${sec.vh}vh` }} aria-labelledby={`${sec.anchor}-h`}>
      <div className="ld-pin">
        <header className="ld-copy">
          <Kicker text={sec.kicker} />
          <h2 id={`${sec.anchor}-h`}>{sec.title}</h2>
          <p>{sec.caption}</p>
        </header>
        <div className="ld-frame">
          <div className="ld-stage">{near && <Scene id={sec.id} t={t} p={p} d={d} mobile={false} />}</div>
        </div>
        <div className="ld-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${p})` }} />
        </div>
      </div>
    </section>
  );
}

function MobileSection({ sec, d }: { sec: Sec; d: StoryData | null }) {
  const ref = useRef<HTMLElement>(null);
  const near = useNear(ref, '60% 0px');
  const facts = sec.facts(d);
  return (
    <section id={sec.anchor} ref={ref} className="ld-msec" aria-labelledby={`${sec.anchor}-h`}>
      <Kicker text={sec.kicker} />
      <h2 id={`${sec.anchor}-h`}>{sec.title}</h2>
      <p>{sec.caption}</p>
      {facts.length > 0 && (
        <ul className="ld-facts">
          {facts.map((f) => (
            <li key={f.l}>
              <b>{f.v}</b>
              <span>{f.l}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="ld-mcard">
        <div className="ld-stage">{near && <Scene id={sec.id} t={durOf(sec.id)} p={1} d={d} mobile />}</div>
      </div>
      <div className="ld-swipe" aria-hidden="true">
        swipe for the full frame →
      </div>
    </section>
  );
}

function Nav() {
  const [solid, setSolid] = useState(false);
  useScrollFrame(() => setSolid(window.scrollY > 24));
  return (
    <nav className={`ld-nav${solid ? ' ld-solid' : ''}`} aria-label="BrotIA">
      <a href="#top" className="ld-brand" aria-label="BrotIA, back to top">
        <Mark size={24} />
        <span>
          Brot<b>IA</b>
        </span>
      </a>
      <div className="ld-links">
        <a href="#problem">Problem</a>
        <a href="#solution">Solution</a>
        <a href="#demo">Demo</a>
        <a href="#business">Business</a>
        <a href="#qa">Q&amp;A</a>
      </div>
      <Link to={PLATFORM} className="ld-pill">
        Open platform
      </Link>
    </nav>
  );
}

function Hero({ reduce }: { reduce: boolean }) {
  const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
  return (
    <header id="top" className={`ld-hero${reduce ? '' : ' ld-hero-in'}`}>
      <h1 className="ld-lockup" style={{ animation: 'none', margin: 0 }} aria-label="BrotIA">
        <Mark animate={!reduce} />
        <span className="ld-word" aria-hidden="true">
          {'Brot'.split('').map((c, i) => (
            <span key={i} style={reduce ? undefined : { animation: `ld-up 0.4s cubic-bezier(.2,.8,.2,1) ${2500 + i * 90}ms both` }}>
              {c}
            </span>
          ))}
          <span className="ld-ia" style={reduce ? undefined : { animation: 'ld-pop 0.5s cubic-bezier(.34,1.56,.64,1) 2900ms both' }}>
            IA
          </span>
        </span>
      </h1>
      <div className="ld-tagline" style={d(3150)}>
        Climate risk · Agricultural lending
      </div>
      <div className="ld-by" style={d(3350)}>
        <span>by</span>
        <img src={`${import.meta.env.BASE_URL}partners/suyana.svg`} alt="" />
        <b>Suyana</b>
      </div>
      <div className="ld-cta-row" style={d(3550)}>
        <Link to={PLATFORM} className="ld-btn ld-btn-primary">
          Open the platform
          <Arrow />
        </Link>
        <Link to={STORY} className="ld-btn">
          Watch the story
        </Link>
      </div>
      <a href="#problem" className="ld-cue" aria-label="Scroll to the story">
        Scroll
        <span aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </a>
    </header>
  );
}

function Closing() {
  return (
    <footer className="ld-end">
      <Mark size={56} />
      <h2>
        See your portfolio&apos;s <b>climate risk</b>, field by field.
      </h2>
      <p>Open the platform with the sample portfolios already loaded, or watch the full story as a presentation.</p>
      <div className="ld-cta-row">
        <Link to={PLATFORM} className="ld-btn ld-btn-primary ld-btn-big">
          Open the platform
          <Arrow />
        </Link>
        <Link to={STORY} className="ld-btn">
          Watch the story
        </Link>
      </div>
      <div className="ld-team">
        <b>Rafael Ferrada · Josefina Larrain · Cristian Vildosola · Fernanda Villablanca</b>
        <br />
        MIT Energy &amp; Climate Hack 2026
      </div>
      <div className="ld-foot">© 2026 · All rights reserved</div>
    </footer>
  );
}

export function LandingPage() {
  const mobile = useMedia('(max-width: 899px)');
  const reduce = useMedia('(prefers-reduced-motion: reduce)');
  const data = useStoryData();

  useEffect(() => {
    const prevTitle = document.title;
    const prevBg = document.body.style.background;
    document.title = TITLE;
    document.body.style.background = '#0e1914';
    return () => {
      document.title = prevTitle;
      document.body.style.background = prevBg;
    };
  }, []);

  return (
    <div className="ld">
      {/* Loads the platform's data while the page is read, so /app opens fully drawn */}
      <WarmUp />
      <Nav />
      <main>
        <Hero reduce={reduce} />
        {SECTIONS.map((s) => (mobile ? <MobileSection key={s.id} sec={s} d={data} /> : <ScrollSection key={s.id} sec={s} d={data} reduce={reduce} />))}
      </main>
      <Closing />
    </div>
  );
}
