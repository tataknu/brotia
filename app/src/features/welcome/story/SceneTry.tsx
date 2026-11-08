/**
 * S7 · Try it yourself: a product shot of the CLSO2 report (pixel-cell reveal, slow drift, the first row
 * circled in red) and a QR to the live demo whose modules assemble in a pixel sweep.
 */
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { DEMO_URL, DEMO_URL_LABEL } from './demoUrl';
import { hash } from './pixel';
import { clamp01, easeInOut, easeOut, ramp } from './timeline';

const SHOT = `${import.meta.env.BASE_URL}story/portfolio-clso2.png`;
// First table row (Los Ángeles south cherries · 83.5 High stress), in % of the image
const ROW = { left: 1.5, top: 25.6, width: 97.5, height: 7.8 };
const WIPE_COLS = 22;
const WIPE_ROWS = 20;
const QUIET = 4;

function useQr(text: string) {
  return useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, [text]);
}

export function SceneTry({ t }: { t: number }) {
  const { n, dark } = useQr(DEMO_URL);
  const size = n + QUIET * 2;
  const reveal = ramp(t, 100, 1500);
  const drift = easeInOut(ramp(t, 0, 5000));
  const ring = easeInOut(ramp(t, 1800, 2900));
  const qrP = ramp(t, 1100, 3300);

  const wipe: JSX.Element[] = [];
  if (reveal < 1)
    for (let r = 0; r < WIPE_ROWS; r++)
      for (let c = 0; c < WIPE_COLS; c++) {
        const d = (c / WIPE_COLS) * 0.55 + hash(r * 53 + c * 11) * 0.3;
        const v = easeOut(clamp01((reveal - d) / 0.15)); // 0 = covered, 1 = revealed
        if (v >= 0.99) continue;
        const accent = hash(r * 5 + c * 17) > 0.94 ? '#2E8A57' : '#13221B';
        wipe.push(
          <i key={r * WIPE_COLS + c} className="st-cell"
            style={{ left: `${(c / WIPE_COLS) * 100}%`, top: `${(r / WIPE_ROWS) * 100}%`, width: `${100 / WIPE_COLS + 0.15}%`, height: `${100 / WIPE_ROWS + 0.15}%`,
              background: accent, borderRadius: `${21 * v}%`, opacity: 1 - v, transform: `scale(${1 - 0.6 * v})` }} />,
        );
      }

  return (
    <div className="st-scene st-try">
      <div className="st-try-shot" style={{ transform: `translateY(${-2 * drift}%)`, opacity: reveal > 0 ? 1 : 0 }}>
        <div className="st-try-bar">
          <span><i /><i /><i /></span>
          <em>brotia · CLSO2 report</em>
        </div>
        <div className="st-try-img">
          <img src={SHOT} alt="BrotIA portfolio report for CLSO2: farms and loans table" />
          <div className="st-try-ring" style={{ left: `${ROW.left}%`, top: `${ROW.top}%`, width: `${ROW.width}%`, height: `${ROW.height}%`, background: `rgba(208, 83, 58, ${0.07 * ring})` }}>
            <svg aria-hidden="true">
              <rect x="0" y="0" width="100%" height="100%" rx="8" ry="8" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - ring}
                style={{ opacity: ring > 0 ? 1 : 0 }} />
            </svg>
          </div>
        </div>
        <div className="st-try-wipe">{wipe}</div>
      </div>

      <div className="st-try-side">
        <div className="st-try-h" style={{ opacity: ramp(t, 500, 1000), transform: `translateY(${(1 - easeOut(ramp(t, 500, 1000))) * 0.6}cqw)` }}>
          Try it yourself
        </div>
        <div className="st-try-qr" style={{ opacity: ramp(t, 900, 1300) }}>
          <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code: ${DEMO_URL}`}>
            {dark.map(([r, c]) => {
              const d = ((r + c) / (2 * n)) * 0.7 + hash(r * 97 + c * 31) * 0.3;
              const v = easeOut(clamp01((qrP - d * 0.8) / 0.2));
              if (v <= 0) return null;
              const s = 0.4 + 0.6 * v;
              return (
                <rect key={r * n + c} x={QUIET + c + (1 - s) / 2} y={QUIET + r + (1 - s) / 2} width={s} height={s} rx={0.12 * s} opacity={v} />
              );
            })}
          </svg>
        </div>
        <div className="st-try-url" style={{ opacity: ramp(t, 3000, 3500) }}>{DEMO_URL_LABEL}</div>
      </div>
    </div>
  );
}
