/**
 * S6 · Business model. Printer-and-ink: the platform is a flat fee at cost; the margin is the Suyana cover sold inside
 * the tool. Three columns assemble in sequence: (1) platform fee, muted; (2) insurance in the tool, with the CLSO2
 * exposure by risk tier from the snapshot; (3) the volume discount, whose stepped bars grow and discounts count in.
 * The pilot line fades in last. Pure function of `t`.
 */
import { PixelGlyph, TIER_COLOR, Typed, fmtMoney } from './pixel';
import type { StoryData } from './useStoryData';
import { clamp01, easeOut, ramp } from './timeline';

const GREEN = '#4CC072';
const MUTED = '#8DA096';
const LEAF = '#9BDB8A';

const G_BANK = ['...#...', '..###..', '.#####.', '.......', '.#.#.#.', '.#.#.#.', '#######'];
const G_SHIELD = ['.#####.', '#######', '#####.#', '##.#.##', '.##.##.', '..###..', '...#...'];
const G_STEPS = ['......#', '......#', '....#.#', '....#.#', '..#.#.#', '..#.#.#', '#.#.#.#'];

// Choreography (ms of scene time).
const HEAD = [250, 1900] as const;
const SUB = 1900;
const COL = [2500, 3600, 5300];
const BULLET = 260;
const EXPO = 4700;
const VOL = 5900;
const LINE = 7400;

const TIERS = ['normal', 'watch', 'high'] as const;
const EXPO_CELLS = 12;
const STEPS = [
  { share: 'Under 25%', cells: 2, off: 0 },
  { share: '25–60%', cells: 5, off: 5 },
  { share: 'Over 60%', cells: 8, off: 10 },
];

const rise = (t: number, a: number, dur = 500) => {
  const p = easeOut(ramp(t, a, a + dur));
  return { opacity: p, transform: `translateY(${(1 - p) * 0.8}cqw)` };
};

function Bullets({ t, at, items }: { t: number; at: number; items: string[] }) {
  return (
    <ul className="st-biz-list">
      {items.map((x, i) => (
        <li key={i} style={{ opacity: ramp(t, at + i * BULLET, at + i * BULLET + 350) }}>
          <i />
          {x}
        </li>
      ))}
    </ul>
  );
}

function Tag({ t, at }: { t: number; at: number }) {
  return (
    <span className="st-biz-tag" style={{ opacity: ramp(t, at, at + 400) }}>
      <i />
      Suyana margin
    </span>
  );
}

export function SceneBusiness({ t, d }: { t: number; d: StoryData | null }) {
  const head = ramp(t, HEAD[0], HEAD[1]);
  const byTier = d?.exposureByTier ?? null;
  const maxTier = byTier ? Math.max(...TIERS.map((k) => byTier[k] ?? 0)) : 0;
  const cur = d?.currency ?? 'USD';

  return (
    <div className="st-scene st-biz">
      <div className="st-kicker">06 · Business model</div>
      <div className="st-title">
        <Typed text="The tool at cost. The margin on insurance." p={head} />
      </div>
      <div className="st-biz-sub" style={{ opacity: ramp(t, SUB, SUB + 500) }}>
        Printer-and-ink: banks pay a flat fee; Suyana earns on the cover sold inside the tool.
      </div>

      <div className="st-biz-cols">
        {/* 1 · Platform: muted, at cost. */}
        <section className="st-biz-col st-biz-muted" style={rise(t, COL[0])}>
          <header>
            <PixelGlyph rows={G_BANK} color={MUTED} size="2.2cqw" p={ramp(t, COL[0], COL[0] + 700)} />
            <div className="st-biz-h">
              <b>Platform</b>
              <span>One simple fee</span>
            </div>
          </header>
          <Bullets t={t} at={COL[0] + 350} items={['Flat annual subscription per bank, sized by portfolio', 'No per-loan charges', 'Goal: adoption, not profit']} />
        </section>

        {/* 2 · Insurance in the tool: the margin. */}
        <section className="st-biz-col st-biz-main" style={rise(t, COL[1])}>
          <header>
            <PixelGlyph rows={G_SHIELD} color={GREEN} size="2.2cqw" p={ramp(t, COL[1], COL[1] + 700)} />
            <div className="st-biz-h">
              <b>Insurance in the tool</b>
              <span className="st-biz-by">
                <span style={{ opacity: ramp(t, COL[1] + 300, COL[1] + 700) }}>
                  with <img src={`${import.meta.env.BASE_URL}partners/suyana.svg`} alt="Suyana" />
                </span>
                <Tag t={t} at={COL[1] + 500} />
              </span>
            </div>
          </header>
          <Bullets
            t={t}
            at={COL[1] + 350}
            items={['Uninsured exposure by zone, at a glance', 'Quote and bind in one click, prefilled with loan data', 'Cover for next season, before bloom, never after an event']}
          />
          {byTier && maxTier > 0 && (
            <div className="st-biz-expo" style={{ opacity: ramp(t, EXPO - 200, EXPO + 200) }}>
              <div className="st-biz-k">
                Exposure by risk tier · {d?.portfolioCode}
              </div>
              {TIERS.map((k, i) => {
                const v = byTier[k] ?? 0;
                const n = v > 0 ? Math.max(1, Math.round((v / maxTier) * EXPO_CELLS)) : 0;
                const p = ramp(t, EXPO + i * 220, EXPO + i * 220 + 700);
                return (
                  <div key={k} className="st-biz-expo-row">
                    <span className="st-biz-expo-l">{k}</span>
                    <span className="st-biz-expo-bar">
                      {Array.from({ length: EXPO_CELLS }, (_, c) => {
                        const on = c < n ? clamp01(p * n - c) : 0;
                        return <i key={c} style={{ background: on > 0 ? TIER_COLOR[k] : 'rgba(141,160,150,0.12)', opacity: on > 0 ? 0.35 + 0.65 * on : 1 }} />;
                      })}
                    </span>
                    <span className="st-biz-expo-v" style={{ opacity: ramp(t, EXPO + i * 220 + 500, EXPO + i * 220 + 900), color: k === 'high' ? TIER_COLOR.high : undefined }}>
                      {fmtMoney(v, cur)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 3 · Volume discount: more of the exposure insured, lower premium. */}
        <section className="st-biz-col st-biz-vol" style={rise(t, COL[2])}>
          <header>
            <PixelGlyph rows={G_STEPS} color={LEAF} size="2.2cqw" p={ramp(t, COL[2], COL[2] + 700)} />
            <div className="st-biz-h">
              <b>Volume discount</b>
              <span className="st-biz-by">
                <Tag t={t} at={COL[2] + 400} />
              </span>
            </div>
          </header>
          <div className="st-biz-k" style={{ opacity: ramp(t, COL[2] + 300, COL[2] + 700) }}>
            Share of exposure insured → premium
          </div>
          <div className="st-biz-steps">
            {STEPS.map((s, i) => {
              const a = VOL + i * 330;
              const p = easeOut(ramp(t, a, a + 650));
              const lp = ramp(t, a + 350, a + 900);
              const off = Math.round(easeOut(lp) * s.off);
              return (
                <div key={i} className="st-biz-step" aria-label={`${s.share} → ${s.off ? `−${s.off}%` : 'list price'}`}>
                  <span className={`st-biz-off${s.off ? '' : ' st-biz-list-price'}`} style={{ opacity: lp > 0 ? 0.3 + 0.7 * lp : 0 }}>
                    {s.off ? `−${off}%` : 'list price'}
                  </span>
                  <span className="st-biz-stack">
                    {Array.from({ length: s.cells }, (_, c) => {
                      const on = clamp01(p * s.cells - c);
                      return <i key={c} style={{ background: s.off ? GREEN : MUTED, opacity: on, transform: `scale(${0.5 + 0.5 * on})` }} />;
                    })}
                  </span>
                  <span className="st-biz-share" style={{ opacity: ramp(t, a, a + 400) }}>
                    {s.share}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="st-biz-note" style={{ opacity: ramp(t, VOL + 1200, VOL + 1600) }}>
            Illustrative tiers
          </div>
        </section>
      </div>

      <div className="st-biz-line" style={{ opacity: ramp(t, LINE, LINE + 600) }}>
        <i />
        <b>Pilot:</b> one lender, one season <span>→</span> portfolio rollout next season
      </div>
    </div>
  );
}
