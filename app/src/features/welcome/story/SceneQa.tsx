/**
 * S10 · Q&A (last step). Six cards, 3×2; a card opens a large answer panel over the grid with a pixel wipe. Close with ×,
 * Esc or a click outside; one card open at a time. Every event inside `[data-qa]` is kept away from the deck navigation
 * (stopPropagation here, plus `isQaTarget` guards in WelcomePage), but → still advances while a panel is open.
 * The entrance is a pure function of `t`; the wipe runs on its own short clock. `?qa=N` opens card N (review only).
 * Facts are checked against ADR-0007, 0013–0020 and service/app/risk/formula.py.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Dissolve, PixelGlyph, Typed } from './pixel';
import { qaParam } from './qa';
import { easeOut, ramp } from './timeline';

const GREEN = '#4CC072';
const LEAF = '#9BDB8A';
const WIPE_MS = 650;

type Item = { k?: string; v: string };
type Card = { q: string; glyph: string[]; color: string; items: Item[]; mono?: string[]; note?: string };

const G_SAT = ['#.....#', '##...##', '.#####.', '..#.#..', '.#####.', '##...##', '#.....#'];
const G_SIGMA = ['#######', '.#.....', '..#....', '...#...', '..#....', '.#.....', '#######'];
const G_CLOUD = ['.......', '..###..', '.#####.', '#######', '#######', '.......', '#.#.#.#'];
const G_PEERS = ['.......', '.#...#.', '###.###', '.#...#.', '...#...', '..###..', '...#...'];
const G_SPARK = ['...#...', '...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.'];
const G_WARN = ['...#...', '..###..', '..#.#..', '.##.##.', '.#####.', '##.#.##', '#######'];

export const QA_CARDS: Card[] = [
  {
    q: 'What data do you use?',
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
    glyph: G_SIGMA,
    color: GREEN,
    mono: [
      'impact = s(crop, stage) · x',
      'C, D   = 1 − ∏(1 − impact)        noisy-OR',
      'G      = mean(geography factors)',
      'base   = ½·(a·C + b·D)/(a+b) + ½·max(C, D)',
      'score  = 100·min(1, base·(1 + c·G))',
      'a = 0.65 · b = 0.35 · c = 0.30',
    ],
    items: [
      { k: 'C · D', v: 'climate and disaster perils, x = severity 0–1, s = crop-stage sensitivity' },
      { k: 'Tiers', v: 'watch ≥ 35 · high ≥ 60 · credit rules can raise the tier, never lower it' },
    ],
    note: 'One severe driver is enough (½·max). Geography amplifies, never scores alone.',
  },
  {
    q: 'What about clouds?',
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
    glyph: G_PEERS,
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
    glyph: G_SPARK,
    color: GREEN,
    items: [
      { k: 'Farming agent', v: "Claude reads the field's history and runs backtests, e.g. 14 frost seasons incl. the Sept 2013 frost" },
      { k: 'Proposals', v: 'zone and farm thresholds and baseline length; it can only propose numbers its tools produced' },
      { k: 'Guard rails', v: 'changes land in the crop templates (6 crops × growth stage, per zone and farm) with an audit trail, and only on the user’s Apply' },
      { k: 'Super-res', v: 'SEN2SRLite, 10 m → 2.5 m, for imagery display only' },
      { k: 'Not AI', v: 'the score is transparent math, explainable driver by driver; gap-filling is Whittaker smoothing' },
    ],
    note: 'no black box: every number traces to a tool, a source or the formula',
  },
  {
    q: 'What are the limits?',
    glyph: G_WARN,
    color: '#E3C93B',
    items: [
      { k: 'Covers', v: 'orchards under nets or plastic: NDVI reads the cover, not the trees · flagged per crop' },
      { k: 'Signal', v: 'a risk signal, not a default prediction: prices, insurance and management also drive default' },
      { k: 'Demo', v: 'bank, farm names and loans are illustrative; CIREN orchards, satellite and weather are real' },
    ],
  },
];

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
              className={`st-qa-card${open === i ? ' st-qa-on' : ''}`}
              style={{ opacity: p, transform: `translateY(${(1 - p) * 0.8}cqw)` }}
              aria-expanded={open === i}
              aria-controls="st-qa-panel"
              onClick={(e) => {
                e.stopPropagation();
                if (open === i) close();
                else show(i);
              }}
            >
              <span className="st-qa-n">{String(i + 1).padStart(2, '0')}</span>
              <PixelGlyph rows={c.glyph} color={c.color} size="2.6cqw" p={ramp(t, at, at + 700)} />
              <span className="st-qa-q">{c.q}</span>
              <span className="st-qa-plus" aria-hidden="true">
                +
              </span>
            </button>
          );
        })}
      </div>

      {card && open !== null && (
        <>
          <div className="st-qa-backdrop" data-qa onClick={(e) => (e.stopPropagation(), close())} style={{ opacity: shown }} />
          <div id="st-qa-panel" className="st-qa-panel" data-qa role="dialog" aria-modal="false" aria-label={card.q} onClick={own}>
            <div className="st-qa-panel-in" style={{ opacity: shown }}>
              <header>
                <PixelGlyph rows={card.glyph} color={card.color} size="3cqw" p={1} />
                <span className="st-qa-n">{String(open + 1).padStart(2, '0')}</span>
                <h2>{card.q}</h2>
                <button ref={closeRef} type="button" className="st-qa-x" aria-label="Close answer" onClick={(e) => (e.stopPropagation(), close())}>
                  ×
                </button>
              </header>
              <div className={`st-qa-body${card.mono ? ' st-qa-split' : ''}`}>
                {card.mono && (
                  <pre className="st-qa-mono">
                    {card.mono.map((l, k) => (
                      <span key={k}>{l}</span>
                    ))}
                  </pre>
                )}
                <ul className="st-qa-list">
                  {card.items.map((x, k) => (
                    <li key={k}>
                      <i />
                      <span>
                        {x.k && <b>{x.k}</b>}
                        {x.v}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {card.note && <div className="st-qa-note">{card.note}</div>}
            </div>
            <Dissolve p={wipe >= 1 ? 1 : wipe} cols={28} rows={11} />
          </div>
        </>
      )}
    </div>
  );
}
