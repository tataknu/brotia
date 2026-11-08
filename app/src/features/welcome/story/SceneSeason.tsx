/**
 * S4 · The season on the polygon (hero): real native Sentinel-2 NDVI frames clipped to the farm, a date ticker,
 * NDVI/NDMI against their usual band, the weather strip, then the risk column filling to the real score.
 * Only the final score is real (as of the assessment date); the column fill is a gauge, not a history.
 */
import { TIER_CUTOFFS } from '../../../domain/constants';
import { FieldFrame } from './FieldFrame';
import { firstPersistentBelow, monthsBetween } from './leadTime';
import { RAMP, TIER_COLOR, Typed, fmtDate, fmtMoney } from './pixel';
import type { StoryData } from './useStoryData';
import { easeInOut, easeOut, ramp } from './timeline';

const DAY = 86400000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
/** "18 Sep 2026" (3-letter month, unlike en-GB's "Sept"). */
const dmy = (s: string) => {
  const dt = new Date(`${s}T12:00:00Z`);
  return `${dt.getUTCDate()} ${dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${dt.getUTCFullYear()}`;
};
type Pt = { date: string; value: number | null; p10?: number | null; p90?: number | null };

function Line({ pts, x, y, upTo, color }: { pts: Pt[]; x: (s: string) => number; y: (v: number) => number; upTo: number; color: string }) {
  const d = pts
    .filter((p) => p.value != null && ms(p.date) <= upTo)
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(2)} ${y(p.value as number).toFixed(2)}`)
    .join(' ');
  return <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
}

function Band({ pts, x, y }: { pts: Pt[]; x: (s: string) => number; y: (v: number) => number }) {
  const ok = pts.filter((p) => p.p10 != null && p.p90 != null);
  if (!ok.length) return null;
  const top = ok.map((p) => `${x(p.date).toFixed(2)} ${y(p.p90 as number).toFixed(2)}`);
  const bot = ok.map((p) => `${x(p.date).toFixed(2)} ${y(p.p10 as number).toFixed(2)}`).reverse();
  return <path d={`M${top.join(' L')} L${bot.join(' L')}Z`} fill="#8DA096" opacity="0.16" />;
}

export function tierOf(score: number) {
  return score >= TIER_CUTOFFS.high ? 'high' : score >= TIER_CUTOFFS.watch ? 'watch' : 'normal';
}

export function RiskColumn({ fill, score, label }: { fill: number; score: number; label: string }) {
  const shown = score * fill;
  const tier = tierOf(shown);
  return (
    <div className="st-risk">
      <div className="st-risk-col">
        {Array.from({ length: 20 }, (_, i) => {
          const lit = (i + 0.5) * 5 <= shown;
          return <i key={i} style={{ background: RAMP[Math.min(6, Math.floor((i / 20) * 7))], opacity: lit ? 1 : 0.08 }} />;
        }).reverse()}
        <span className="st-thr" style={{ bottom: `${TIER_CUTOFFS.watch}%` }}>{TIER_CUTOFFS.watch}</span>
        <span className="st-thr" style={{ bottom: `${TIER_CUTOFFS.high}%` }}>{TIER_CUTOFFS.high}</span>
      </div>
      <div className="st-risk-read">
        <div className="st-risk-k">{label}</div>
        <div className="st-risk-n">{shown.toFixed(1)}</div>
        <div className="st-chip" style={{ borderColor: TIER_COLOR[tier], color: TIER_COLOR[tier] }}>
          <i style={{ background: TIER_COLOR[tier] }} />
          {tier}
        </div>
      </div>
    </div>
  );
}

export function SceneSeason({ t, d }: { t: number; d: StoryData | null }) {
  if (!d) return <div className="st-scene" />;
  const startIso = d.frames.find((f) => f.date >= '2025-11-01')?.date ?? d.frames[0]?.date ?? d.asOf;
  const t0 = ms(startIso);
  const t1 = ms(d.asOf);
  const sweep = easeInOut(ramp(t, 600, 6400));
  const now = t0 + sweep * (t1 - t0);
  const nowIso = iso(Math.round(now / DAY) * DAY);
  const frame = [...d.frames].reverse().find((f) => ms(f.date) <= now) ?? d.frames[0];
  const ctx = [...d.frames].reverse().find((f) => f.rgb && ms(f.date) <= now) ?? d.frames.find((f) => f.rgb);
  const stage = d.stages.find((s) => s.start <= nowIso && nowIso <= s.end);
  const x = (s: string) => ((ms(s) - t0) / (t1 - t0)) * 100;
  const inWin = (p: Pt) => ms(p.date) >= t0 && ms(p.date) <= t1;
  const ndvi = d.ndvi.filter(inWin);
  const ndmi = d.ndmi.filter(inWin);
  const precip = d.precip.filter(inWin);
  const tmin = d.tmin.filter(inWin);
  const tmax = d.tmax.filter(inWin);
  const pmax = Math.max(1, ...precip.map((p) => p.value ?? 0));
  const yN = (v: number) => 38 - v * 36;
  const yM = (v: number) => 38 - ((v + 0.2) / 0.6) * 36;
  const yT = (v: number) => 38 - ((v + 5) / 40) * 36;
  const panelIn = (i: number) => easeOut(ramp(t, 100 + i * 150, 700 + i * 150));
  const fill = easeInOut(ramp(t, 6500, 8200));
  const lastNdvi = [...ndvi].reverse().find((p) => p.value != null && ms(p.date) <= now);
  const lastNdmi = [...ndmi].reverse().find((p) => p.value != null && ms(p.date) <= now);
  // Lead-time beat: first persistent dip of NDMI below its usual p10, against the next installment due.
  const signal = firstPersistentBelow(d.ndmi.map((p) => ({ date: p.date, value: p.value, p10: p.p10 ?? null })));
  const due = d.nextInstallment;
  const lead = signal && due ? monthsBetween(signal, due.dueDate) : null;
  const signalIn = signal && ms(signal) >= t0 && ms(signal) <= t1 ? signal : null;
  const flagP = signalIn ? Math.min(1, Math.max(0, (now - ms(signalIn)) / (12 * DAY))) : 0;
  const leadP = ramp(t, 8500, 9100);
  return (
    <div className="st-scene st-season">
      <div className="st-kicker">04 · One season, every five days</div>
      <div className="st-season-left" style={{ opacity: panelIn(0) }}>
        <div className="st-ticker">
          <b>{fmtDate(nowIso)}</b>
          <span>{stage?.label ?? ''}</span>
        </div>
        <div className="st-season-field">
          <FieldFrame d={d} context={ctx?.rgb ?? null} inside={frame?.src ?? null} draw={1} markers={1} />
        </div>
        <div className="st-legend">
          <span>NDVI 0</span>
          <i />
          <span>1</span>
          <em>
            Sentinel-2 native 10 m · {frame?.date} · {frame?.kind === 'observed' ? 'observed' : 'interpolated (resampled, display only)'}
          </em>
        </div>
      </div>
      <div className="st-panels">
        <div className="st-panel st-panel-veg" style={{ opacity: panelIn(1) }}>
          <div className="st-panel-h">
            <span><i style={{ background: '#4CC072' }} />NDVI {lastNdvi?.value?.toFixed(2) ?? '—'}</span>
            <span><i style={{ background: '#9BDB8A' }} />NDMI {lastNdmi?.value?.toFixed(2) ?? '—'}</span>
            <em>band = usual p10–p90</em>
          </div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none">
            <Band pts={ndvi} x={x} y={yN} />
            <Band pts={ndmi} x={x} y={yM} />
            <Line pts={ndvi} x={x} y={yN} upTo={now} color="#4CC072" />
            <Line pts={ndmi} x={x} y={yM} upTo={now} color="#9BDB8A" />
            <line x1={x(nowIso)} x2={x(nowIso)} y1="0" y2="40" stroke="#EAF3EE" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
            {signalIn && flagP > 0 && (
              <line x1={x(signalIn)} x2={x(signalIn)} y1={40 - 40 * flagP} y2="40" stroke="#D0533A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {signalIn && flagP > 0 && (
            <div className={`st-signal${x(signalIn) > 70 ? ' st-signal-l' : ''}`} style={{ left: `calc(1.2cqw + (100% - 2.4cqw) * ${x(signalIn) / 100})`, opacity: flagP }}>
              <i />
              <span>signal · {dmy(signalIn)}</span>
            </div>
          )}
        </div>
        <div className="st-panel" style={{ opacity: panelIn(2) }}>
          <div className="st-panel-h">
            <span><i style={{ background: '#5B9BD5' }} />Rain mm/day</span>
            <span><i style={{ background: '#E8933A' }} />Tmax</span>
            <span><i style={{ background: '#8DA096' }} />Tmin °C</span>
            <em>CR2MET</em>
          </div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none">
            {precip
              .filter((p) => p.value != null && p.value > 0 && ms(p.date) <= now)
              .map((p) => (
                <rect key={p.date} x={x(p.date)} width="0.22" y={40 - ((p.value as number) / pmax) * 30} height={((p.value as number) / pmax) * 30} fill="#5B9BD5" opacity="0.85" />
              ))}
            <Line pts={tmax} x={x} y={yT} upTo={now} color="#E8933A" />
            <Line pts={tmin} x={x} y={yT} upTo={now} color="#8DA096" />
          </svg>
        </div>
        <div className="st-panel st-panel-risk" style={{ opacity: panelIn(3) }}>
          <RiskColumn fill={fill} score={d.score} label={`Risk · as of ${fmtDate(d.asOf)}`} />
          <div className="st-risk-side">
            <div className="st-driver" style={{ opacity: ramp(t, 7600, 8000) }}>
              <Typed text={d.driverText} p={ramp(t, 7600, 8900)} cursor={false} />
            </div>
            {lead != null && due && leadP > 0 && (
              <div className="st-lead" style={{ opacity: leadP, transform: `translateY(${(1 - easeOut(leadP)) * 0.6}cqw)` }}>
                Flagged <b>{lead}</b> months before the {fmtMoney(due.amount, d.currency)} payment due {dmy(due.dueDate)}.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
