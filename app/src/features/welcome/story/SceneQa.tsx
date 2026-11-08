/**
 * S10 · Q&A (last step). Six cards, 3×2, each with a mini visual that previews its answer; a card opens a large answer
 * panel over the grid with a pixel wipe: a topic visual on the left, the answer bullets on the right. Close with ×,
 * Esc or a click outside; one card open at a time. Every event inside `[data-qa]` is kept away from the deck navigation
 * (stopPropagation here, plus `isQaTarget` guards in WelcomePage), but → still advances while a panel is open.
 * The entrance is a pure function of `t`; the wipe runs on its own short clock. `?qa=N` opens card N (review only).
 * All visuals are deterministic. Facts are checked against ADR-0007, 0013–0020 and service/app/risk/formula.py.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Dissolve, PixelGlyph, RAMP, Typed } from './pixel';
import { qaParam } from './qa';
import { easeOut, ramp } from './timeline';

const GREEN = '#4CC072';
const LEAF = '#9BDB8A';
const FROST = '#7FDBFF';
const RED = '#D0533A';
const AMBER = '#E3C93B';
const WIPE_MS = 650;

type Topic = 'data' | 'risk' | 'clouds' | 'normal' | 'ai' | 'limits';
type Item = { k?: string; v: string };
type MonoLine = { l: string; tag?: string };
type Card = {
  q: string;
  topic: Topic;
  tag: string;
  teaser: string;
  glyph: string[];
  color: string;
  items: Item[];
  mono?: MonoLine[];
  weights?: string[];
  note?: string;
};

const G_SAT = ['..###..', '.#...#.', '#..#..#', '..#.#..', '...#...', '...#...', '..###..'];
const G_BARS = ['......#', '....#.#', '....#.#', '..#.#.#', '..#.#.#', '#.#.#.#', '#######'];
const G_CLOUD = ['.......', '...##..', '.#####.', '#######', '#######', '.......', '.#.#.#.'];
const G_BELL = ['...#...', '..###..', '..###..', '.#####.', '.#####.', '#######', '#######'];
const G_SPARK = ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'];
const G_WARN = ['...#...', '..###..', '..#.#..', '.##.##.', '.#####.', '###.###', '#######'];

export const QA_CARDS: Card[] = [
  {
    q: 'What data do you use?',
    topic: 'data',
    tag: 'Sources',
    teaser: '6 sources · 2 tiers',
    glyph: G_SAT,
    color: GREEN,
    items: [
      { k: 'Satellite', v: 'Sentinel-2 L2A · 10 m · about every 5 days · via Microsoft Planetary Computer' },
      { k: 'Weather', v: 'Chile: CR2MET gridded daily + RAN agromet stations (hourly, within 12 km) · fallback ERA5' },
      { k: 'Fire & disasters', v: 'CONAF / GWIS burned areas · NASA FIRMS active fires · Copernicus EMS' },
      { k: 'Water', v: 'DGA scarcity decrees + snowmelt forecast vs 1991–2020 (Chile)' },
      { k: 'Fields', v: 'CIREN fruit cadastre or a drawn polygon · terrain from Copernicus DEM GLO-30' },
      { k: 'Tiers', v: 'Enhanced = Chilean national sources · Standard = global sources (ERA5, Sentinel-2, GWIS) for the rest of South America' },
    ],
  },
  {
    q: 'How is the risk score built?',
    topic: 'risk',
    tag: 'Scoring',
    teaser: 'noisy-OR, 3 components',
    glyph: G_BARS,
    color: GREEN,
    mono: [
      { l: 'impact = s(crop, stage) · x' },
      { l: 'C, D   = 1 − ∏(1 − impact)', tag: 'noisy-OR' },
      { l: 'G      = mean(geography factors)' },
      { l: 'base   = ½·(a·C + b·D)/(a+b) + ½·max(C, D)' },
      { l: 'score  = 100·min(1, base·(1 + c·G))' },
    ],
    weights: ['a = 0.65', 'b = 0.35', 'c = 0.30'],
    items: [
      { k: 'sₚ', v: 'crop sensitivity to peril p at its growth stage, 0–1 (crop template)' },
      { k: 'xₚ', v: 'severity of peril p right now, 0–1 (satellite, weather, events)' },
      { k: 'C', v: 'climate: frost, heat, harvest rain, chill, water, vigour, abandonment' },
      { k: 'D', v: 'disaster: fire, flood, declared emergency · same product over its perils' },
      { k: 'G', v: 'geography: frost pocket, fire recurrence, water security · mean' },
      { k: 'a · b · c', v: 'climate 0.65 · disaster 0.35 · geography amplifier 0.30' },
    ],
    note: 'One severe driver is enough (½·max). Geography amplifies, never scores alone.',
  },
  {
    q: 'What about clouds?',
    topic: 'clouds',
    tag: 'Imagery',
    teaser: 'SCL mask · Whittaker',
    glyph: G_CLOUD,
    color: LEAF,
    items: [
      { k: 'Mask', v: 'scene classification (SCL) keeps clear pixels only; cloud shadow counts as cloudy' },
      { k: 'Use', v: 'scene used when the polygon is ≥ 50 % clear · frame labelled observed at ≥ 80 %' },
      { k: 'Fill', v: 'per-pixel Whittaker smoothing (λ = 500), frames on a 5-day grid; ends held, not extrapolated' },
      { k: 'Gaps', v: '> 32 days from a clear image → left empty, never invented' },
      { k: 'Labels', v: 'every frame says observed, interpolated or AI-enhanced' },
      { k: 'Super-res', v: 'SEN2SRLite 10 m → 2.5 m is display only · scores read native 10 m pixels' },
    ],
  },
  {
    q: 'Compared with what normal?',
    topic: 'normal',
    tag: 'Baseline',
    teaser: 'own history · 8 peers',
    glyph: G_BELL,
    color: LEAF,
    items: [
      { k: 'Own history', v: 'same date ±8 days in the previous 5 years (≥ 4 values from ≥ 2 years) → z-score' },
      { k: 'Persistence', v: '2 composites in a row, or a 32-day mean z, before it alarms' },
      { k: 'Peers', v: 'nearest 8 CIREN orchards of the same crop in its 35 km² zone (r = 3,338 m)' },
      { k: 'Weather', v: 'against CR2MET 1991–2020 normals for the same cell' },
      { k: 'Abandonment', v: 'dry-season collapse vs own history and peers, and no recovery (z ≤ −1.0)' },
    ],
  },
  {
    q: 'Where does AI come in?',
    topic: 'ai',
    tag: 'AI',
    teaser: 'agent proposes, you apply',
    glyph: G_SPARK,
    color: GREEN,
    items: [
      { k: 'Farming agent', v: 'Claude with 6 tools: crop template, zone, history, events, backtest, propose change' },
      { k: 'Crop library', v: '6 crops × growth stage: sensitivity to 10 perils, frost / heat / rain thresholds, Kc · sourced from FAO and Agroseguros' },
      { k: 'Backtests', v: 'against curated reference events, e.g. 14 frost seasons incl. the Sept 2013 frost' },
      { k: 'Guard rails', v: 'it only proposes numbers its tools produced; values inherit template → zone → farm, audited, applied only by the user' },
      { k: 'Super-res', v: 'SEN2SRLite, 10 m → 2.5 m, for imagery display only' },
      { k: 'Not AI', v: 'the score is transparent math, explainable driver by driver; gap-filling is Whittaker smoothing' },
    ],
    note: 'no black box: every number traces to a tool, a source or the formula',
  },
  {
    q: 'What are the limits?',
    topic: 'limits',
    tag: 'Scope',
    teaser: 'what it can’t see',
    glyph: G_WARN,
    color: AMBER,
    items: [
      { k: 'Covers', v: 'orchards under nets or plastic: NDVI reads the cover, not the trees · flagged per crop' },
      { k: 'Signal', v: 'a risk signal, not a default prediction: prices, insurance and management also drive default' },
      { k: 'Demo', v: 'bank, farm names and loans are illustrative; CIREN orchards, satellite and weather are real' },
    ],
  },
];

/** The risk formula typeset as math (MathML), as in the team deck; s_p and x_p in green. */
const G_ = 'mathcolor="#4CC072"';
const RISK_MATHML = [
  `<math display="block"><mrow><mtext>Risk</mtext><mo>=</mo><mn>100</mn><mo>·</mo><mi>min</mi><mo stretchy="false">(</mo><mn>1</mn><mo>,</mo><mspace width="0.3em"/><mtext>base</mtext><mo>·</mo><mo stretchy="false">(</mo><mn>1</mn><mo>+</mo><mi>c</mi><mi>G</mi><mo stretchy="false">)</mo><mo stretchy="false">)</mo></mrow></math>`,
  `<math display="block"><mrow><mtext>base</mtext><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>·</mo><mfrac><mrow><mi>a</mi><mi>C</mi><mo>+</mo><mi>b</mi><mi>D</mi></mrow><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></mfrac><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>max</mi><mo stretchy="false">(</mo><mi>C</mi><mo>,</mo><mi>D</mi><mo stretchy="false">)</mo></mrow></math>`,
  `<math display="block"><mrow><mi>C</mi><mo>=</mo><mn>1</mn><mo>−</mo><munder><mo>∏</mo><mi>p</mi></munder><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><msub ${G_}><mi>s</mi><mi>p</mi></msub><mo stretchy="false" ${G_}>(</mo><mtext ${G_}>crop, stage</mtext><mo stretchy="false" ${G_}>)</mo><mo>·</mo><msub ${G_}><mi>x</mi><mi>p</mi></msub><mo stretchy="false">)</mo></mrow></math>`,
].join('');

/* ---------- small deterministic pixel helpers ---------- */

/** A grid of rounded pixel cells; `map` turns a character into a colour ('.' is empty). */
function Px({ rows, map, cell, gap = 0.12, className, style }: { rows: string[]; map: Record<string, string>; cell: number; gap?: number; className?: string; style?: CSSProperties }) {
  const cols = rows[0].length;
  return (
    <span
      className={`st-qa-px${className ? ` ${className}` : ''}`}
      style={{ gridTemplateColumns: `repeat(${cols}, ${cell}cqw)`, gridAutoRows: `${cell}cqw`, gap: `${gap}cqw`, ...style }}
    >
      {rows.flatMap((r, i) => [...r].map((ch, k) => <i key={`${i}-${k}`} style={{ background: map[ch] ?? 'transparent' }} />))}
    </span>
  );
}

const PX_MAP: Record<string, string> = { x: 'rgba(141,160,150,0.13)', g: GREEN, l: LEAF, d: '#1F6B43', f: FROST, w: '#d9eef7', s: '#3b4b55', '#': GREEN, r: RED, a: AMBER, m: '#5f7d6c' };

const I_NET = ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'];
const I_NEQ = ['.....', 'aaaaa', '..a..', 'aaaaa', '.....'];
const I_DEMO = ['mmmmm', 'm...m', 'm.l.m', 'm...m', 'mmmmm'];
const I_NEQ2 = ['....a', 'aaaaa', '..a..', 'aaaaa', 'a....'];

/** Before/after cloud cells: f = cloud, s = shadow, w = bright cloud, g/l = clear vegetation. */
const CLOUDY = ['ffwgl', 'fwwfg', 'gfssg', 'lgsgl'];
const CLEAR = ['glggl', 'lgglg', 'gglgl', 'lgglg'];
const CLOUDY_BIG = ['ffwwgglg', 'fwwwfglg', 'gfwfsslg', 'lgffssgl', 'glgssglg', 'lgglgglf', 'gglgllff'];

/** A series with a seasonal band; index `dip` falls below the band. Deterministic. */
const SERIES = [0.52, 0.56, 0.61, 0.66, 0.7, 0.72, 0.71, 0.67, 0.6, 0.5, 0.44, 0.4];
const BAND = SERIES.map((v, i) => (i === 8 ? 0.64 : i === 9 ? 0.6 : v));

function Spark({ w, h, dip = 9, band = true, peers = false, className }: { w: number; h: number; dip?: number; band?: boolean; peers?: boolean; className?: string }) {
  const n = SERIES.length;
  const x = (i: number) => 4 + (i / (n - 1)) * (w - 8);
  const y = (v: number) => h - 4 - ((v - 0.3) / 0.5) * (h - 8);
  const val = (i: number) => (i === dip ? BAND[i] - 0.17 : i === dip - 1 ? BAND[i] - 0.07 : BAND[i]);
  const hi = BAND.map((v, i) => `${x(i)},${y(v + 0.06)}`).join(' ');
  const lo = BAND.map((v, i) => `${x(n - 1 - i)},${y(BAND[n - 1 - i] - 0.06)}`).join(' ');
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {band && <polygon points={`${hi} ${lo}`} fill="rgba(155,219,138,0.16)" stroke="rgba(155,219,138,0.35)" strokeWidth="0.6" strokeDasharray="2 2" />}
      {peers &&
        [-0.035, -0.02, -0.01, 0.0, 0.012, 0.025, 0.035, 0.045].map((o, k) => (
          <polyline key={k} points={BAND.map((v, i) => `${x(i)},${y(v + o)}`).join(' ')} fill="none" stroke="rgba(141,160,150,0.28)" strokeWidth="0.6" />
        ))}
      <polyline points={SERIES.map((_, i) => `${x(i)},${y(val(i))}`).join(' ')} fill="none" stroke={GREEN} strokeWidth="1.4" strokeLinejoin="round" />
      {SERIES.map((_, i) => (
        <rect key={i} x={x(i) - 1.6} y={y(val(i)) - 1.6} width="3.2" height="3.2" rx="0.7" fill={i === dip ? RED : GREEN} />
      ))}
      <rect className="st-qa-dip" x={x(dip) - 3.4} y={y(val(dip)) - 3.4} width="6.8" height="6.8" rx="1.4" fill="none" stroke={RED} strokeWidth="0.8" />
    </svg>
  );
}

function Ramp7({ big = false }: { big?: boolean }) {
  return (
    <span className={`st-qa-ramp${big ? ' st-qa-ramp-big' : ''}`}>
      {RAMP.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/* ---------- mini visuals on the cards ---------- */

function Mini({ topic }: { topic: Topic }) {
  switch (topic) {
    case 'data':
      return (
        <span className="st-qa-mini st-qa-m-data">
          {['Sentinel-2', 'CR2MET', 'ERA5', 'GWIS', 'FIRMS'].map((s) => (
            <span key={s} className="st-qa-chip">
              <i />
              {s}
            </span>
          ))}
        </span>
      );
    case 'risk':
      return (
        <span className="st-qa-mini st-qa-m-risk">
          <code>100·min(1, base·(1+c·G))</code>
          <Ramp7 />
          <span className="st-qa-m-scale">
            <span>0</span>
            <span>100</span>
          </span>
        </span>
      );
    case 'clouds':
      return (
        <span className="st-qa-mini st-qa-m-clouds">
          <Px rows={CLOUDY} map={PX_MAP} cell={0.95} />
          <span className="st-qa-arrow">→</span>
          <Px rows={CLEAR} map={PX_MAP} cell={0.95} className="st-qa-clear" />
        </span>
      );
    case 'normal':
      return (
        <span className="st-qa-mini st-qa-m-normal">
          <Spark w={120} h={44} />
        </span>
      );
    case 'ai':
      return (
        <span className="st-qa-mini st-qa-m-ai">
          <span className="st-qa-chip st-qa-chip-on">
            <i />
            Agent · Claude
          </span>
          <span className="st-qa-chip st-qa-chip-on">
            <i />
            Super-res · display only
          </span>
          <span className="st-qa-chip st-qa-chip-off">Score: no AI</span>
        </span>
      );
    case 'limits':
      return (
        <span className="st-qa-mini st-qa-m-limits">
          {[
            [I_NET, 'net'],
            [I_NEQ, 'signal ≠ default'],
            [I_DEMO, 'illustrative'],
          ].map(([rows, l]) => (
            <span key={l as string} className="st-qa-ic">
              <Px rows={rows as string[]} map={{ ...PX_MAP, '#': '#8da096' }} cell={0.5} gap={0.1} />
              <em>{l as string}</em>
            </span>
          ))}
        </span>
      );
  }
}

/* ---------- large visuals in the panel ---------- */

const d = (k: number): CSSProperties => ({ animationDelay: `${330 + k * 70}ms` });

function Big({ card }: { card: Card }): ReactNode {
  switch (card.topic) {
    case 'data':
      return (
        <div className="st-qa-v st-qa-v-data">
          <div className="st-qa-v-l st-qa-in" style={d(0)}>Sources</div>
          <div className="st-qa-v-src st-qa-in" style={d(1)}>
            {['Sentinel-2', 'CR2MET', 'RAN', 'ERA5', 'GWIS', 'FIRMS', 'DGA', 'CIREN', 'DEM'].map((s) => (
              <span key={s} className="st-qa-chip">
                <i />
                {s}
              </span>
            ))}
          </div>
          <div className="st-qa-v-down st-qa-in" style={d(2)} />
          <div className="st-qa-v-tiers st-qa-in" style={d(3)}>
            <div>
              <b>Enhanced</b>
              <span>Chilean national sources</span>
            </div>
            <div>
              <b>Standard</b>
              <span>global sources · rest of South America</span>
            </div>
          </div>
          <div className="st-qa-v-down st-qa-in" style={d(4)} />
          <div className="st-qa-v-out st-qa-in" style={d(5)}>
            <span>
              <b>per-field series</b>
              <em>satellite · weather · fire</em>
            </span>
            <Spark w={120} h={36} band={false} dip={-1} className="st-qa-v-spark" />
          </div>
        </div>
      );
    case 'risk':
      return (
        <div className="st-qa-v st-qa-v-risk">
          <div className="st-qa-math st-qa-in" style={d(0)} dangerouslySetInnerHTML={{ __html: RISK_MATHML }} />
          <div className="st-qa-weights st-qa-in" style={d(1)}>
            {card.weights!.map((w) => (
              <span key={w} className="st-qa-chip st-qa-chip-on">
                {w}
              </span>
            ))}
          </div>
          <div className="st-qa-v-scale st-qa-in" style={d(2)}>
            <Ramp7 big />
            <span className="st-qa-tick" style={{ left: '35%' }}>
              <i />
              watch ≥ 35
            </span>
            <span className="st-qa-tick st-qa-tick-hi" style={{ left: '60%' }}>
              <i />
              high ≥ 60
            </span>
            <span className="st-qa-v-ends">
              <span>0</span>
              <span>100</span>
            </span>
          </div>
        </div>
      );
    case 'clouds':
      return (
        <div className="st-qa-v st-qa-v-clouds">
          <div className="st-qa-v-pair st-qa-in" style={d(0)}>
            <figure>
              <Px rows={CLOUDY_BIG} map={PX_MAP} cell={1.25} gap={0.16} />
              <figcaption>SCL mask · cloud + shadow</figcaption>
            </figure>
            <span className="st-qa-arrow">→</span>
            <figure>
              <Px rows={CLOUDY_BIG.map((r) => r.replace(/[fws]/g, 'x'))} map={PX_MAP} cell={1.25} gap={0.16} />
              <figcaption>clear pixels kept</figcaption>
            </figure>
          </div>
          <div className="st-qa-v-fill st-qa-in" style={d(1)}>
            <svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
              <polyline points="4,30 22,24 40,18 58,14 76,13 94,15 112,20" fill="none" stroke={GREEN} strokeWidth="1.4" strokeDasharray="3 2" />
              {[4, 40, 76, 112].map((x, k) => (
                <rect key={x} x={x - 2} y={[30, 18, 13, 20][k] - 2} width="4" height="4" rx="0.9" fill={GREEN} />
              ))}
              <rect x="150" y="6" width="44" height="30" rx="2" fill="none" stroke="rgba(141,160,150,0.45)" strokeDasharray="2 2" />
            </svg>
            <span className="st-qa-v-fill-l">
              <span>
                <i className="st-qa-sw" /> observed
              </span>
              <span>
                <i className="st-qa-sw st-qa-sw-dash" /> gap-filled
              </span>
              <span className="st-qa-v-gap">&gt; 32 d · empty</span>
            </span>
          </div>
          <div className="st-qa-callouts st-qa-in" style={d(2)}>
            <span>
              <b>50 %</b>clear → scene used
            </span>
            <span>
              <b>80 %</b>clear → observed
            </span>
            <span>
              <b>32 d</b>max gap
            </span>
          </div>
        </div>
      );
    case 'normal':
      return (
        <div className="st-qa-v st-qa-v-normal">
          <div className="st-qa-v-band st-qa-in" style={d(0)}>
            <Spark w={200} h={92} peers className="st-qa-v-bandsvg" />
          </div>
          <div className="st-qa-v-legend st-qa-in" style={d(1)}>
            <span>
              <i className="st-qa-sw st-qa-sw-band" /> own history ±8 d, 5 yrs
            </span>
            <span>
              <i className="st-qa-sw st-qa-sw-peer" /> 8 peers · same crop
            </span>
            <span>
              <i className="st-qa-sw st-qa-sw-red" /> below band → z-score
            </span>
          </div>
          <div className="st-qa-v-peers st-qa-in" style={d(2)}>
            <Px
              rows={['...m...', '.m...m.', '...g...', 'm.ggg.m', '...g...', '.m...m.', '...m...']}
              map={PX_MAP}
              cell={0.62}
              gap={0.1}
            />
            <span>
              <b>8 peers</b>
              <em>nearest CIREN orchards · 35 km² zone</em>
            </span>
          </div>
        </div>
      );
    case 'ai':
      return (
        <div className="st-qa-v st-qa-v-ai">
          <div className="st-qa-v-split st-qa-in" style={d(0)}>
            <div className="st-qa-v-yes">
              <b>AI</b>
              <span className="st-qa-chip st-qa-chip-on">
                <i />
                Agent · Claude
              </span>
              <em>proposes thresholds · you apply</em>
              <span className="st-qa-chip st-qa-chip-on">
                <i />
                Super-res
              </span>
              <em>10 m → 2.5 m · display only</em>
            </div>
            <div className="st-qa-v-no">
              <b>Not AI</b>
              <span className="st-qa-chip">
                <i />
                Risk score
              </span>
              <em>transparent formula</em>
              <span className="st-qa-chip">
                <i />
                Gap-filling
              </span>
              <em>Whittaker smoothing</em>
            </div>
          </div>
          {card.note && (
            <div className="st-qa-note st-qa-in" style={d(1)}>
              {card.note}
            </div>
          )}
        </div>
      );
    case 'limits':
      return (
        <div className="st-qa-v st-qa-v-limits">
          {[
            [I_NET, 'Nets & plastic', 'NDVI reads the cover'],
            [I_NEQ2, 'Signal ≠ default', 'not a default prediction'],
            [I_DEMO, 'Illustrative', 'bank, farms, loans'],
          ].map(([rows, h, s], k) => (
            <div key={h as string} className="st-qa-v-row st-qa-in" style={d(k)}>
              <Px rows={rows as string[]} map={{ ...PX_MAP, '#': AMBER }} cell={0.85} gap={0.14} />
              <span>
                <b>{h as string}</b>
                <em>{s as string}</em>
              </span>
            </div>
          ))}
        </div>
      );
  }
}

const HEAD = [250, 1100] as const;
const CARD0 = 1000;
const STAGGER = 140;

/** Stop the deck from seeing an event that belongs to the Q&A UI. */
const own = (e: MouseEvent) => e.stopPropagation();

export function SceneQa({ t }: { t: number }) {
  const [open, setOpen] = useState<number | null>(() => (typeof window === 'undefined' ? null : qaParam(window.location.search, QA_CARDS.length)));
  const [wipe, setWipe] = useState(1); // 0..1 progress of the panel's pixel wipe
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastOpen = useRef<number | null>(null);

  const show = useCallback((i: number) => {
    setOpen(i);
    setWipe(0);
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / WIPE_MS);
      setWipe(p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);
  const close = useCallback(() => setOpen(null), []);

  // Esc closes the open panel (before anything else); focus moves to × on open and back to the card on close.
  useEffect(() => {
    if (open === null) {
      if (lastOpen.current !== null) cardRefs.current[lastOpen.current]?.focus({ preventScroll: true });
      lastOpen.current = null;
      return;
    }
    lastOpen.current = open;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const card = open === null ? null : QA_CARDS[open];
  const shown = ramp(wipe, 0.35, 0.6);

  return (
    <div className="st-scene st-qa">
      <div className="st-kicker">Q&amp;A</div>
      <div className="st-title">
        <Typed text="Questions? Open a card." p={ramp(t, HEAD[0], HEAD[1])} />
      </div>
      <div className="st-qa-hint" style={{ opacity: ramp(t, 2200, 2700) }}>
        click a card · Enter opens · Esc closes
      </div>

      <div className="st-qa-grid" data-qa onClick={own}>
        {QA_CARDS.map((c, i) => {
          const at = CARD0 + i * STAGGER;
          const p = easeOut(ramp(t, at, at + 450));
          return (
            <button
              key={i}
              ref={(el) => (cardRefs.current[i] = el)}
              type="button"
              className={`st-qa-card st-qa-t-${c.topic}${open === i ? ' st-qa-on' : ''}`}
              style={{ opacity: p, transform: `translateY(${(1 - p) * 0.8}cqw)` }}
              aria-expanded={open === i}
              aria-controls="st-qa-panel"
              onClick={(e) => {
                e.stopPropagation();
                if (open === i) close();
                else show(i);
              }}
            >
              <span className="st-qa-top">
                <span className="st-qa-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="st-qa-tag">{c.tag}</span>
                <span className="st-qa-open" aria-hidden="true">
                  Open <b>+</b>
                </span>
              </span>
              <span className="st-qa-mid">
                <span className="st-qa-glyph">
                  <PixelGlyph rows={c.glyph} color={c.color} size="3cqw" p={ramp(t, at, at + 700)} />
                </span>
                <Mini topic={c.topic} />
              </span>
              <span className="st-qa-foot">
                <span className="st-qa-q">{c.q}</span>
                <span className="st-qa-teaser">{c.teaser}</span>
              </span>
            </button>
          );
        })}
      </div>

      {card && open !== null && (
        <>
          <div className="st-qa-backdrop" data-qa onClick={(e) => (e.stopPropagation(), close())} style={{ opacity: shown }} />
          <div id="st-qa-panel" className="st-qa-panel" data-qa role="dialog" aria-modal="false" aria-label={card.q} onClick={own}>
            <div key={open} className="st-qa-panel-in" style={{ opacity: shown }}>
              <header>
                <PixelGlyph rows={card.glyph} color={card.color} size="2.6cqw" p={1} />
                <span className="st-qa-n">{String(open + 1).padStart(2, '0')}</span>
                <h2>{card.q}</h2>
                <span className="st-qa-tag">{card.tag}</span>
                <button ref={closeRef} type="button" className="st-qa-x" aria-label="Close answer" onClick={(e) => (e.stopPropagation(), close())}>
                  ×
                </button>
              </header>
              <div className="st-qa-body">
                <div className="st-qa-vis">
                  <Big card={card} />
                </div>
                <div className="st-qa-ans">
                  <ul className={`st-qa-list${card.topic === 'risk' ? ' st-qa-list-math' : ''}`}>
                    {card.items.map((x, k) => (
                      <li key={k} className="st-qa-in" style={d(k + 1)}>
                        {x.k && <b>{x.k}</b>}
                        <span>{x.v}</span>
                      </li>
                    ))}
                  </ul>
                  {card.note && card.topic !== 'ai' && (
                    <div className="st-qa-note st-qa-in" style={d(card.items.length + 1)}>
                      {card.note}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <Dissolve p={wipe >= 1 ? 1 : wipe} cols={28} rows={11} />
          </div>
        </>
      )}
    </div>
  );
}
