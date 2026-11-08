/**
 * S5 · Linked to the loan. A playhead sweeps from loan origination to today; each installment it passes lands as paid
 * (bar stacks, green check, outstanding steps down). At today the field signal arrives: the risk column pulses, a red
 * scan line reaches the timeline, the next installment turns red and the at-risk window is bracketed with the lead
 * time. An alert log types in below and the cover request goes to Suyana. Every value comes from the snapshot.
 */
import { RiskColumn } from './SceneSeason';
import { PixelGlyph, Typed, fmtDate, fmtMoney } from './pixel';
import type { StoryData } from './useStoryData';
import { clamp01, easeInOut, easeOut, ramp } from './timeline';
import { firstPersistentBelow, monthsBetween } from './leadTime';

const RED = '#D0533A';
const GREEN = '#4CC072';
const CHECK = ['.....', '....#', '...#.', '#.#..', '.#...'];
const CELLS = 8;

// Choreography (ms of scene time).
const SWEEP = [300, 4600] as const; // playhead: origination → today
const SIGNAL = 4700; // risk column pulses, scan line sweeps
const ALERT = 5400; // next installment turns red
const BRACKET = 6100;
const EXPOSE = 6600;
const FEED = 7000;
const ROW = 420;
const CHIP = 8700;

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function SceneLoan({ t, d }: { t: number; d: StoryData | null }) {
  if (!d || !d.installments.length) return <div className="st-scene" />;
  const insts = [...d.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const origIso = d.origination ?? insts[0].dueDate;
  const matIso = d.maturity ?? insts[insts.length - 1].dueDate;
  // Continuous month axis: start of the origination month → end of the maturity month.
  const o = new Date(ms(origIso));
  const m = new Date(ms(matIso));
  const nMonths = (m.getUTCFullYear() - o.getUTCFullYear()) * 12 + (m.getUTCMonth() - o.getUTCMonth()) + 1;
  const monthPos = (iso: string) => {
    const x = new Date(ms(iso));
    const mi = (x.getUTCFullYear() - o.getUTCFullYear()) * 12 + (x.getUTCMonth() - o.getUTCMonth());
    const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    return mi + (x.getUTCDate() - 1) / dim;
  };
  const pct = (pos: number) => (pos / nMonths) * 100;
  const barPct = (iso: string) => pct(Math.floor(monthPos(iso)) + 0.5);

  // Playhead: origination → as-of.
  const sweep = easeInOut(ramp(t, SWEEP[0], SWEEP[1]));
  const headMs = ms(origIso) + sweep * (ms(d.asOf) - ms(origIso));
  const headIso = new Date(headMs).toISOString().slice(0, 10);
  const headPos = monthPos(headIso);
  const nowPos = monthPos(d.asOf);
  const atToday = t >= SWEEP[1];
  // Time at which the playhead crosses a date (inverse of the eased sweep, by bisection: deterministic).
  const crossAt = (iso: string) => {
    const target = (ms(iso) - ms(origIso)) / (ms(d.asOf) - ms(origIso));
    let lo: number = SWEEP[0];
    let hi: number = SWEEP[1];
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (easeInOut(ramp(mid, SWEEP[0], SWEEP[1])) < target) lo = mid;
      else hi = mid;
    }
    return hi;
  };

  const maxAmt = Math.max(...insts.map((i) => i.amount));
  const next = d.nextInstallment ?? insts.find((i) => i.dueDate > d.asOf) ?? null;
  const paid = insts.filter((i) => i.dueDate <= d.asOf); // before as-of: paid as scheduled (same assumption as the app)
  const later = next ? insts.filter((i) => i.dueDate > next.dueDate) : [];
  const total = insts.reduce((s, i) => s + i.amount, 0);
  const landP = (iso: string) => ramp(t, crossAt(iso), crossAt(iso) + 450);
  const outstanding = total - paid.reduce((s, i) => s + (landP(i.dueDate) > 0.5 ? i.amount : 0), 0);
  const laterSum = later.reduce((s, i) => s + i.amount, 0);

  // Lead time from the field signal (shared with the Season slide).
  const signal = firstPersistentBelow(d.ndmi.map((p) => ({ date: p.date, value: p.value, p10: p.p10 ?? null })));
  const lead = next ? monthsBetween(signal, next.dueDate) : null;

  // Beats.
  const pulse = ramp(t, SIGNAL, SIGNAL + 350) * (1 - ramp(t, SIGNAL + 500, SIGNAL + 1300));
  const scan = easeOut(ramp(t, SIGNAL + 150, SIGNAL + 750));
  const scanFade = 1 - 0.7 * ramp(t, SIGNAL + 800, SIGNAL + 1400);
  const redP = ramp(t, ALERT, ALERT + 700);
  const glow = redP > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(((t - ALERT) / 900) * Math.PI)) * (1 - ramp(t, ALERT + 1800, ALERT + 2700)) : 0;
  const proj = easeOut(ramp(t, ALERT + 200, ALERT + 800));
  const bracket = easeOut(ramp(t, BRACKET, BRACKET + 500));
  const bracketTxt = ramp(t, BRACKET + 300, BRACKET + 800);
  const callout = ramp(t, BRACKET + 200, BRACKET + 700);
  const expose = ramp(t, EXPOSE, EXPOSE + 600);
  const chip = easeOut(ramp(t, CHIP, CHIP + 450));
  const chipCheck = ramp(t, CHIP + 250, CHIP + 750);

  const tierWord = d.tier.toUpperCase();
  const driver = d.driverText.replace(/\.$/, '');
  const rows: { at: string; text: string; tag?: string; color?: string }[] = [
    { at: fmtDate(d.asOf), text: driver, color: RED },
    { at: fmtDate(d.asOf), text: `Risk ${d.score.toFixed(1)} → ${tierWord}`, color: RED },
    d.fieldVisit
      ? { at: '→', text: d.fieldVisit }
      : { at: '→', text: next ? `Review repayment capacity before ${fmtDate(next.dueDate)}` : 'Review repayment capacity', tag: 'suggested' },
    { at: '→', text: 'Cover request queued for Suyana', color: GREEN },
  ];

  const nowX = pct(nowPos);
  const nextX = next ? barPct(next.dueDate) : nowX;
  const years = Array.from({ length: nMonths }, (_, i) => i).filter((i) => (o.getUTCMonth() + i) % 12 === 0);

  return (
    <div className="st-scene st-loan">
      <div className="st-kicker">05 · Linked to the loan</div>

      <div className="st-loan-risk" style={{ filter: pulse > 0 ? `drop-shadow(0 0 ${0.9 * pulse}cqw rgba(208,83,58,${0.9 * pulse}))` : undefined, opacity: 0.55 + 0.45 * ramp(t, SIGNAL - 200, SIGNAL + 200) }}>
        <RiskColumn fill={1} score={d.score} label={d.farmName} />
      </div>
      {/* Red scan line: risk column → today's playhead. */}
      <div className="st-loan-scan" style={{ width: `calc(22cqw + ${(nowX / 100) * 64}cqw)`, transform: `scaleX(${scan})`, opacity: scan > 0 ? scanFade : 0 }} />

      <div className="st-loan-c">
        <div className="st-loan-h">
          <span>
            Payment schedule · {fmtMoney(total, d.currency)} · {d.portfolioCode}
          </span>
          <span className="st-loan-out">
            Outstanding <b>{fmtMoney(outstanding, d.currency)}</b>
          </span>
        </div>

        {/* Bars + month ticks. */}
        <div className="st-loan-bars">
          {Array.from({ length: nMonths }, (_, i) => (
            <b key={i} className="st-loan-tick" style={{ left: `${pct(i + 0.5)}%`, opacity: headPos >= i ? 0.9 : 0.25 }} />
          ))}
          {insts.map((inst, bi) => {
            const isPaid = inst.dueDate <= d.asOf;
            const isNext = !!next && inst.dueDate === next.dueDate;
            const isLater = later.includes(inst);
            const lp = isPaid ? landP(inst.dueDate) : 0;
            const n = Math.max(1, Math.round((inst.amount / maxAmt) * CELLS));
            return (
              <div
                key={inst.dueDate}
                className="st-loan-bar"
                style={{ left: `${barPct(inst.dueDate)}%`, boxShadow: isNext && glow > 0 ? `0 0 ${1.4 * glow}cqw rgba(208,83,58,${0.55 * glow})` : undefined }}
              >
                {Array.from({ length: n }, (_, k) => {
                  let bg = 'rgba(141,160,150,0.14)';
                  let op = 1;
                  if (isPaid) {
                    const v = clamp01(lp * n - k);
                    bg = v > 0 ? '#5f7d6c' : bg;
                    op = v > 0 ? 0.4 + 0.6 * v : 1;
                  } else if (isNext) {
                    const v = clamp01(redP * n - k);
                    bg = v > 0 ? RED : atToday ? '#8DA096' : 'rgba(141,160,150,0.22)';
                    op = v > 0 ? 0.5 + 0.5 * v : 1;
                  } else if (isLater) {
                    bg = expose > 0 ? `rgba(208,83,58,${0.1 + 0.12 * expose})` : bg;
                  }
                  return <i key={k} style={{ background: bg, opacity: op }} />;
                })}
                {isLater && <span className="st-loan-hatch" style={{ opacity: expose, height: `${(n / CELLS) * 100}%` }} />}
                {isPaid && (
                  <>
                    <PixelGlyph rows={CHECK} color={GREEN} size="1.5cqw" p={ramp(t, crossAt(inst.dueDate) + 300, crossAt(inst.dueDate) + 700)} style={{ position: 'absolute', left: '50%', bottom: 'calc(100% + 0.5cqw)', transform: 'translateX(-50%)' }} />
                    <span className="st-loan-paid" style={{ opacity: ramp(t, crossAt(inst.dueDate) + 450, crossAt(inst.dueDate) + 900), bottom: `calc(100% + 2.4cqw + ${bi % 2 ? 1.6 : 0}cqw)` }}>
                      {fmtMoney(inst.amount, d.currency)} · paid as scheduled
                    </span>
                  </>
                )}
              </div>
            );
          })}

          {/* Red dashed projection: today → next installment. */}
          {next && (
            <div className="st-loan-proj" style={{ left: `${nowX}%`, width: `${Math.max(0, nextX - nowX)}%`, transform: `scaleX(${proj})` }} />
          )}

          {/* Playhead. */}
          <div className="st-loan-head" style={{ left: `${pct(headPos)}%`, opacity: ramp(t, 0, 300) }}>
            <span style={{ transform: `translateX(-${pct(headPos)}%)` }}>
              {fmtDate(headIso)}
              {atToday ? ' · today' : ''}
            </span>
          </div>
        </div>

        <div className="st-loan-axis">
          {years.map((i) => (
            <span key={i} style={{ left: `${pct(i)}%` }}>
              {o.getUTCFullYear() + Math.floor((o.getUTCMonth() + i) / 12)}
            </span>
          ))}
        </div>

        {/* At-risk window bracket: today → due date, labelled with the lead time. */}
        {next && (
          <div className="st-loan-bracket" style={{ left: `${nowX}%`, width: `${Math.max(0, pct(monthPos(next.dueDate)) - nowX)}%`, transform: `scaleX(${bracket})` }} />
        )}
        {next && (
          <div className="st-loan-bracket-t" style={{ left: `${nowX}%`, opacity: bracketTxt }}>
            {signal ? `signal since ${fmtDate(signal)}` : 'signal at today'}
            {lead != null ? ` · flagged ${lead} month${lead === 1 ? '' : 's'} ahead` : ''}
          </div>
        )}

        {/* Alert callout. */}
        {next && (
          <div className="st-loan-alert" style={{ left: `${nowX}%`, opacity: callout, transform: `translateY(${(1 - callout) * 0.4}cqw)` }}>
            <b>ALERT</b> · {fmtMoney(next.amount, d.currency)} due {fmtDate(next.dueDate)} · at {d.tier} risk
          </div>
        )}

        {/* Remaining exposure over the later installments. */}
        {later.length > 0 && (
          <div className="st-loan-later" style={{ opacity: expose }}>
            + {fmtMoney(laterSum, d.currency)} still outstanding
          </div>
        )}
      </div>

      {/* Alert log. */}
      <div className="st-loan-feed" style={{ opacity: ramp(t, FEED - 300, FEED) }}>
        <div className="st-loan-feed-k">Alert log · {d.farmName}</div>
        {rows.map((r, i) => {
          const p = ramp(t, FEED + i * ROW, FEED + (i + 1) * ROW - 40);
          return (
            <div key={i} className="st-loan-row" style={{ opacity: p > 0 ? 1 : 0.15 }}>
              <span className="st-loan-row-at">{r.at}</span>
              <i className="st-dot" style={{ background: r.color ?? '#8DA096', opacity: p > 0 ? 1 : 0 }} />
              <span className="st-loan-row-tx">
                <Typed text={r.text} p={p} />
                {r.tag && <em style={{ opacity: ramp(t, FEED + (i + 1) * ROW - 40, FEED + (i + 1) * ROW + 200) }}>{r.tag}</em>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Cover request → Suyana. */}
      <div className="st-loan-chip" style={{ opacity: chip, transform: `scale(${0.92 + 0.08 * chip})` }}>
        <PixelGlyph rows={CHECK} color={GREEN} size="1.6cqw" p={chipCheck} />
        Cover request →
        <img src={`${import.meta.env.BASE_URL}partners/suyana.svg`} alt="Suyana" />
      </div>
    </div>
  );
}
