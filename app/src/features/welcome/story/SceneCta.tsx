/** S6 · CTA: the BrotIA lockup, small, assembled from its pixel cells, plus the tagline. */
import { RAMP } from './pixel';
import { easeOut, ramp } from './timeline';
import { hash } from './pixel';

const GRID = ['.....AA', '.B..AAA', 'BBBSAA.', '.BBS...', '...S...', '...S...', '0123456'];
const COLORS: Record<string, string> = { A: '#4CC072', B: '#9BDB8A', S: '#2E8A57', '.': '#1c2c25' };

export function SceneCta({ t }: { t: number }) {
  return (
    <div className="st-scene st-cta">
      <div className="st-cta-lockup">
        <div className="st-cta-mark">
          {GRID.flatMap((row, r) =>
            [...row].map((ch, k) => {
              const v = easeOut(ramp(t, 100 + hash(r * 9 + k) * 700, 500 + hash(r * 9 + k) * 700));
              return (
                <i key={`${r}${k}`} className="st-cell"
                  style={{ left: `${k * 14.5833}%`, top: `${r * 14.5833}%`, width: '12.5%', height: '12.5%', background: /\d/.test(ch) ? RAMP[+ch] : COLORS[ch], opacity: v, transform: `scale(${0.5 + 0.5 * v})` }} />
              );
            }),
          )}
        </div>
        <div className="st-cta-word" style={{ opacity: ramp(t, 700, 1200) }}>
          Brot<span>IA</span>
        </div>
      </div>
      <div className="st-cta-tag" style={{ opacity: ramp(t, 1200, 1800) }}>
        Climate risk · Agricultural lending
      </div>
    </div>
  );
}
