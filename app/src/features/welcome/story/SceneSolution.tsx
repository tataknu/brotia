/**
 * S2 · Solution: the satellite and weather measures BrotIA computes (service/app/risk/drivers.py) light up one by
 * one and flow as pixel lanes into a living risk thermometer; when the level crosses high (60) the insurance
 * indicator checks itself. Everything is a pure function of the slide time `t` (fixed keyframes, no randomness).
 */
import { PixelGlyph, RAMP, TIER_COLOR, Typed } from './pixel';
import { clamp01, easeOut, ramp } from './timeline';

const GROUPS = [
  {
    name: 'Satellite',
    detail: 'Sentinel-2 · 10 m · every 5 days',
    color: '#4CC072',
    measures: [
      ['Vigour', 'NDVI vs its own history'],
      ['Canopy moisture', 'NDMI'],
      ['Abandonment', 'vs neighbouring fields'],
      ['Burned area', 'fire detections'],
    ],
  },
  {
    name: 'Weather',
    detail: 'Stations + gridded climate',
    color: '#9BDB8A',
    measures: [
      ['Frost', 'Tmin vs stage threshold'],
      ['Heat', 'Tmax'],
      ['Harvest rain', '72 h'],
      ['Water supply', 'snowmelt and drought'],
    ],
  },
];

// Geometry, in cqw inside the 86 × 27 cqw flow box (the merge SVG uses the same units, 1:1).
const FLOW_H = 27;
const HEADER_Y = [0.8, 15.2];
const ROW_Y = [3.6, 6.2, 8.8, 11.4, 18.0, 20.6, 23.2, 25.8];
const CELLS_X = 25.5;
const CELL = 0.95;
const CELL_GAP = 0.27;
const LANE_CELLS = 16;
const LANE_END = CELLS_X + LANE_CELLS * (CELL + CELL_GAP) + 0.3;
const COL_X = 60;
const COL_W = 2.6;
const COL_GAP = 0.35;
const COL_TOP = 3.35;
const COL_H = 7 * COL_W + 6 * COL_GAP;
const COL_MID = COL_TOP + COL_H / 2;
const levelY = (lv: number) => COL_TOP + COL_H * (1 - lv / 100);

const WATCH_AT = 35;
const HIGH_AT = 60;

// Measure k lights at LIGHT(k); its lane fills, then its line reaches the gauge.
const LIGHT = (k: number) => 1500 + k * 400;

// The risk level as a live signal: wobbles low, rises through watch, crosses high, dips back once, settles high.
const KEYS: [number, number][] = [
  [0, 10], [1500, 10], [2300, 18], [2700, 14], [3100, 24], [3500, 20], [3900, 40], [4300, 37],
  [4700, 52], [5400, 64], [6000, 57], [6800, 70], [7600, 66], [8400, 78], [9200, 74], [10000, 82], [10500, 84],
];

function levelAt(t: number): number {
  let v = KEYS[KEYS.length - 1][1];
  for (let i = 1; i < KEYS.length; i++) {
    const [t1, v1] = KEYS[i];
    if (t <= t1) {
      const [t0, v0] = KEYS[i - 1];
      const u = clamp01((t - t0) / (t1 - t0));
      v = v0 + (v1 - v0) * u * u * (3 - 2 * u);
      break;
    }
  }
  // a small deterministic shimmer while the signal is live; gone by the hold
  const live = ramp(t, 1200, 1800) * (1 - ramp(t, 9900, 10500));
  return v + live * 0.7 * Math.sin(t / 95) * Math.sin(t / 233);
}

/** ms since the level last rose to ≥ HIGH_AT (−1 when currently below). Sampled, so it stays deterministic. */
function sinceHigh(t: number): number {
  if (levelAt(t) < HIGH_AT) return -1;
  for (let d = 0; d <= 800; d += 10) if (levelAt(t - d) < HIGH_AT) return d;
  return 800;
}

/** Point at fraction f (0..1) along a polyline, for the pixel packets riding each line. */
function alongPath(pts: [number, number][], f: number): [number, number] {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let s = f * segs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < segs.length; i++) {
    if (s <= segs[i] || i === segs.length - 1) {
      const u = segs[i] ? clamp01(s / segs[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
    }
    s -= segs[i];
  }
  return pts[pts.length - 1];
}

const tierOf = (lv: number) => (lv >= HIGH_AT ? 'high' : lv >= WATCH_AT ? 'watch' : 'normal');

const BOX = ['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'];
const CHECK = ['.........', '.........', '.......#.', '......#..', '.#...#...', '..#.#....', '...#.....', '.........', '.........'];
const POINTER = ['..#', '.##', '..#'];

const INS_GREEN = '#4CC072';
const INS_GREY = '#4a5a52';

export function SceneSolution({ t }: { t: number }) {
  const head = ramp(t, 200, 1500);
  const colIn = easeOut(ramp(t, 900, 1500));
  const lv = levelAt(t);
  const tier = tierOf(lv);
  const since = sinceHigh(t);
  const checked = since >= 0;
  const pop = checked ? ramp(since, 0, 280) : 0;
  const popScale = checked ? 1 + 0.18 * Math.sin(Math.PI * ramp(since, 0, 320)) : 1;
  const ly = levelY(lv);

  return (
    <div className="st-scene st-solution">
      <div className="st-kicker">02 · BrotIA</div>
      <div className="st-title">
        <Typed text="BrotIA watches every financed field from space." p={head} />
      </div>
      <div className="st-flow2">
        {GROUPS.map((g, gi) => {
          const appear = ramp(t, 600 + gi * 200, 1100 + gi * 200);
          return (
            <div key={g.name} style={{ opacity: appear }}>
              <div className="st-src-h" style={{ top: `${HEADER_Y[gi]}cqw` }}>
                <b style={{ color: g.color }}>{g.name}</b>
                <span>{g.detail}</span>
              </div>
              {g.measures.map(([m, d], mi) => {
                const k = gi * 4 + mi;
                const lit = ramp(t, LIGHT(k), LIGHT(k) + 250);
                const fill = easeOut(ramp(t, LIGHT(k), LIGHT(k) + 550));
                return (
                  <div key={m} className="st-measure" style={{ top: `${ROW_Y[k]}cqw` }}>
                    <i className="st-measure-chip" style={{ background: g.color, opacity: 0.18 + 0.82 * lit, transform: `scale(${0.7 + 0.3 * lit})` }} />
                    <span className="st-measure-text" style={{ opacity: 0.38 + 0.62 * lit }}>
                      <b>{m}</b> · {d}
                    </span>
                    {Array.from({ length: LANE_CELLS }, (_, c) => {
                      const on = c / LANE_CELLS < fill;
                      const pulse = 0.35 + 0.65 * Math.max(0, Math.cos((c / LANE_CELLS) * 6 - t / 260 + k * 0.7));
                      return (
                        <i
                          key={c}
                          className="st-measure-cell"
                          style={{ left: `${CELLS_X + c * (CELL + CELL_GAP)}cqw`, background: g.color, opacity: on ? pulse : 0.06 }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}

        <svg className="st-merge2" viewBox={`0 0 86 ${FLOW_H}`} preserveAspectRatio="none">
          {ROW_Y.map((y, k) => {
            const color = GROUPS[k < 4 ? 0 : 1].color;
            const inner = k < 4 ? 3 - k : k - 4; // rows nearer the centre turn first, so lines never cross
            const bx = 48 + inner * 1.2;
            const ey = COL_MID + (k - 3.5) * 0.35;
            const pts: [number, number][] = [[LANE_END, y], [bx, y], [bx, ey], [COL_X - 0.4, ey]];
            const d = `M${pts[0][0]} ${pts[0][1]} H${bx} V${ey} H${pts[3][0]}`;
            const draw = ramp(t, LIGHT(k) + 300, LIGHT(k) + 800);
            const packets = draw >= 1 ? [0, 0.5].map((o) => alongPath(pts, ((t - LIGHT(k)) / 1600 + o + k * 0.13) % 1)) : [];
            return (
              <g key={k}>
                <path d={d} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth="0.11" pathLength={1}
                  strokeDasharray="1 1" strokeDashoffset={1 - draw} />
                {packets.map(([px, py], j) => (
                  <rect key={j} x={px - 0.28} y={py - 0.28} width="0.56" height="0.56" rx="0.12" fill={color} />
                ))}
              </g>
            );
          })}
          {/* high threshold tick */}
          <path d={`M${COL_X - 0.7} ${levelY(HIGH_AT)} H${COL_X + COL_W + 0.4}`} stroke="#eaf3ee" strokeOpacity={0.6 * colIn}
            strokeWidth="0.08" strokeDasharray="0.25 0.2" />
        </svg>

        <div className="st-thermo-label" style={{ left: `${COL_X + COL_W / 2}cqw`, opacity: colIn }}>Risk score</div>
        {RAMP.map((c, i) => {
          const lo = (i * 100) / 7;
          // crisp on/off with a short fade, so no cell sits half-lit in a muddy mid-tone
          const v = clamp01(((lv - lo) / (100 / 7) - 0.35) / 0.3);
          return (
            <i
              key={c}
              className="st-thermo-cell"
              style={{
                left: `${COL_X}cqw`,
                top: `${COL_TOP + (6 - i) * (COL_W + COL_GAP)}cqw`,
                background: c,
                opacity: colIn * (0.1 + 0.9 * v),
                transform: `scale(${0.85 + 0.15 * v})`,
              }}
            />
          );
        })}
        <div className="st-thermo-ptr" style={{ left: `${COL_X + COL_W + 0.5}cqw`, top: `${ly}cqw`, opacity: ramp(t, 1200, 1600) }}>
          <PixelGlyph rows={POINTER} color={TIER_COLOR[tier]} size="1.2cqw" p={1} />
          <div className="st-thermo-read">
            <b>{Math.round(Math.max(0, lv))}</b>
            <span style={{ color: TIER_COLOR[tier] }}>{tier}</span>
          </div>
        </div>

        <div className={`st-ins${checked ? ' st-ins-on' : ''}`} style={{ left: '74cqw', top: `${COL_MID}cqw`, opacity: ramp(t, 1300, 1800) }}>
          <div className="st-ins-box" style={{ transform: `scale(${popScale})` }}>
            <PixelGlyph rows={BOX} color={checked ? INS_GREEN : INS_GREY} size="2.4cqw" p={1} />
            {checked && <PixelGlyph rows={CHECK} color={INS_GREEN} size="2.4cqw" p={pop} style={{ position: 'absolute', inset: 0 }} />}
          </div>
          <div className="st-ins-text">
            <b style={{ color: checked ? INS_GREEN : '#6f8279' }}>Insurance</b>
            <span style={{ opacity: checked ? ramp(since, 150, 550) : 0 }}>cover suggested</span>
          </div>
        </div>
      </div>
      <div className="st-caption" style={{ opacity: ramp(t, 10000, 10700) }}>
        One risk score per crop, stage and zone.
      </div>
    </div>
  );
}
