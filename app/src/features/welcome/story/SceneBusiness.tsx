/**
 * S6 · Business model (team deck v07, slide 9). The tool at cost, the margin on insurance: (1) an annual platform fee
 * for a 1,000 ha package plus add-ons per extra 100 ha; (2) insurance in the tool, with the CLSO2 exposure by risk
 * tier from the snapshot; (3) why banks insure here. The pilot line fades in last. Pure function of `t`.
 */
import { PixelGlyph, TIER_COLOR, Typed, fmtMoney } from './pixel';
import type { StoryData } from './useStoryData';
import { clamp01, easeOut, ramp } from './timeline';

const GREEN = '#4CC072';
const MUTED = '#8DA096';
const LEAF = '#9BDB8A';

const G_BANK = ['...#...', '..###..', '.#####.', '.......', '.#.#.#.', '.#.#.#.', '#######'];
const G_SHIELD = ['.#####.', '#######', '#####.#', '##.#.##', '.##.##.', '..###..', '...#...'];
const G_STAR = ['...#...', '...#...', '.#####.', '#######', '.#####.', '.##.##.', '##...##'];

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
const BASE_CELLS = 10; // the 1,000 ha package, one cell per 100 ha
const ADDONS = 3; // +100 ha add-ons

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
        The tool is priced near cost; Suyana earns its margin on the insurance sold through the tool.
      </div>

      <div className="st-biz-cols">
        {/* 1 · Platform: annual fee for a 1,000 ha package, plus add-ons per extra 100 ha. */}
        <section className="st-biz-col st-biz-muted" style={rise(t, COL[0])}>
          <header>
            <PixelGlyph rows={G_BANK} color={MUTED} size="2.2cqw" p={ramp(t, COL[0], COL[0] + 700)} />
            <div className="st-biz-h">
              <b>Platform</b>
              <span>Annual fee · priced near cost</span>
            </div>
          </header>
          <Bullets t={t} at={COL[0] + 350} items={['Fixed annual price for a package of up to 1,000 ha', 'Add-on fee for every extra 100 ha']} />
          <div className="st-biz-ha" aria-label="1,000 ha base plus three 100 ha add-ons">
            <span className="st-biz-ha-base">
              {Array.from({ length: BASE_CELLS }, (_, c) => {
                const on = clamp01(ramp(t, COL[0] + 1000, COL[0] + 1900) * BASE_CELLS - c);
                return <i key={c} style={{ background: MUTED, opacity: 0.15 + 0.85 * on }} />;
              })}
            </span>
            <span className="st-biz-ha-l" style={{ opacity: ramp(t, COL[0] + 1500, COL[0] + 1900) }}>
              1,000 ha base
            </span>
            <span className="st-biz-ha-adds">
            {Array.from({ length: ADDONS }, (_, k) => {
              const p = easeOut(ramp(t, COL[0] + 2000 + k * 300, COL[0] + 2400 + k * 300));
              return (
                <span key={k} className="st-biz-ha-add" style={{ opacity: p, transform: `scale(${0.6 + 0.4 * p})` }}>
                  <i style={{ background: LEAF }} />
                  <em>+100</em>
                </span>
              );
            })}
            </span>
          </div>
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
            items={["The analyst sees each field's risk and the uninsured exposure", 'One click sends a quote with a policy tailored to each field', 'Suyana earns its margin on every policy sold']}
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

        {/* 3 · Competitive advantage: why banks insure here. */}
        <section className="st-biz-col st-biz-vol" style={rise(t, COL[2])}>
          <header>
            <PixelGlyph rows={G_STAR} color={LEAF} size="2.2cqw" p={ramp(t, COL[2], COL[2] + 700)} />
            <div className="st-biz-h">
              <b>Competitive advantage</b>
              <span>Why banks insure here</span>
            </div>
          </header>
          <Bullets
            t={t}
            at={COL[2] + 350}
            items={["Tailor-made policy per field, which other insurers can't price", 'The quote arrives inside the tool the bank already uses', 'Every season of data sharpens the pricing']}
          />
        </section>
      </div>

      <div className="st-biz-line" style={{ opacity: ramp(t, LINE, LINE + 600) }}>
        <i />
        <b>Pilot:</b> one lender, one season <span>→</span> portfolio rollout next season
      </div>
    </div>
  );
}
