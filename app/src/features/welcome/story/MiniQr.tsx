/** Small QR to the live demo, pinned top right on the closing and Q&A slides. */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { DEMO_URL, DEMO_URL_LABEL } from './demoUrl';
import { ramp } from './timeline';

const QUIET = 4;

export function MiniQr({ t }: { t: number }) {
  const { n, dark } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(DEMO_URL);
    qr.make();
    const n = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, []);
  const size = n + QUIET * 2;
  return (
    <div className="st-miniqr" style={{ opacity: ramp(t, 600, 1100) }}>
      <div className="st-miniqr-code">
        <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code: ${DEMO_URL}`}>
          {dark.map(([r, c]) => (
            <rect key={r * n + c} x={QUIET + c} y={QUIET + r} width={1} height={1} />
          ))}
        </svg>
      </div>
      <span>{DEMO_URL_LABEL}</span>
    </div>
  );
}
