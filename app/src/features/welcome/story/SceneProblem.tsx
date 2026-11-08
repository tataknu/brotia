/**
 * S1 · Problem (global pitch): three typed beats, two sourced numbers that count up, and the three perils with what
 * each one does to a season. Source for both numbers: FAO (2023), The Impact of Disasters on Agriculture and Food
 * Security — USD 3.8 trillion of crop and livestock losses 1991–2021, about USD 123 billion a year, about 5 % of
 * global agricultural GDP.
 */
import { PixelGlyph, Typed } from './pixel';
import { ramp } from './timeline';

const FROST = ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...'];
const DROUGHT = ['#..#..#', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '#..#..#'];
const FIRE = ['...#...', '..##...', '..###.#', '.#####.', '##.####', '#######', '.#####.'];

const LINES = ['Orchards are financed for years.', 'Climate risk changes every week.', 'Lenders find out at the missed payment.'];

const STATS = [
  { value: 123, fmt: (v: number) => `$${v}B`, color: '#EAF3EE', text: 'of crops and livestock lost to disasters every year', src: 'FAO 2023' },
  { value: 5, fmt: (v: number) => `≈${v}%`, color: '#FFB21F', text: 'of global agricultural GDP, lost the same way', src: 'FAO 2023' },
];

const PERILS = [
  { label: 'Frost', rows: FROST, color: '#7FDBFF', event: 'One night at bloom can take the season' },
  { label: 'Drought', rows: DROUGHT, color: '#FFB21F', event: 'Dry years stack up, field by field' },
  { label: 'Fire', rows: FIRE, color: '#FF4E2B', event: 'One afternoon can take the orchard' },
];

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export function SceneProblem({ t }: { t: number }) {
  const beat = (i: number) => ramp(t, 200 + i * 1100, 200 + i * 1100 + 900);
  return (
    <div className="st-scene st-problem">
      <div className="st-kicker">01 · The problem</div>
      <div className="st-lines st-lines-tight">
        {LINES.map((l, i) => {
          const p = beat(i);
          const dim = i < 2 && t > 200 + (i + 1) * 1100 ? 0.42 : 1;
          return (
            <div key={i} className={`st-line${i === 2 ? ' st-line-alert' : ''}`} style={{ opacity: p > 0 ? dim : 0 }}>
              <Typed text={l} p={p} />
            </div>
          );
        })}
      </div>

      <div className="st-evidence">
        {STATS.map((s, i) => {
          const p = ramp(t, 3200 + i * 350, 4600 + i * 350);
          return (
            <div key={s.src} className="st-stat" style={{ opacity: p > 0 ? 1 : 0, transform: `translateY(${(1 - easeOut(p)) * 0.8}cqw)` }}>
              <div className="st-stat-value" style={{ color: s.color }}>
                {s.fmt(Math.round(s.value * easeOut(p)))}
              </div>
              <div className="st-stat-text">{s.text}</div>
              <div className="st-stat-src" style={{ opacity: ramp(t, 4300 + i * 350, 4800 + i * 350) }}>
                {s.src}
              </div>
            </div>
          );
        })}
        <div className="st-evidence-rule" style={{ transform: `scaleY(${ramp(t, 3600, 4200)})` }} />
        {PERILS.map((x, i) => {
          const p = ramp(t, 3800 + i * 260, 4800 + i * 260);
          return (
            <div key={x.label} className="st-peril" style={{ opacity: p > 0 ? 1 : 0 }}>
              <PixelGlyph rows={x.rows} color={x.color} size="4.2cqw" p={p} style={{ filter: `drop-shadow(0 0 0.9cqw ${x.color}66)` }} />
              <b style={{ color: x.color, opacity: ramp(t, 4300 + i * 260, 4800 + i * 260) }}>{x.label}</b>
              <span style={{ opacity: ramp(t, 4500 + i * 260, 5100 + i * 260) }}>{x.event}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
