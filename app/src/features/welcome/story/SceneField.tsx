/** S3 · Zoom to the field: a pixel zoom onto the first real Sentinel-2 frame, coordinate readout ticking, polygon drawing in. */
import { FieldFrame } from './FieldFrame';
import type { StoryData } from './useStoryData';
import { easeInOut, easeOut, ramp } from './timeline';

// Camera start: Chile scale (display only; the readout converges to the farm's real centroid).
const FROM: [number, number] = [-71.0, -35.7];

export function SceneField({ t, d }: { t: number; d: StoryData | null }) {
  if (!d) return <div className="st-scene" />;
  const z = easeInOut(ramp(t, 0, 2000));
  const [lng, lat] = [FROM[0] + (d.centroid[0] - FROM[0]) * z, FROM[1] + (d.centroid[1] - FROM[1]) * z];
  const first = d.frames.find((f) => f.rgb) ?? d.frames[0];
  // scale bar: bbox width in metres at this latitude, shown on a quarter of the frame
  const widthM = (d.bbox[2] - d.bbox[0]) * 111320 * Math.cos((d.centroid[1] * Math.PI) / 180);
  const barM = Math.round(widthM / 4 / 50) * 50;
  const scale = 0.18 + 0.82 * z;
  return (
    <div className="st-scene st-fieldscene">
      <div className="st-kicker">03 · The field</div>
      <div className="st-zoom" style={{ transform: `scale(${scale})`, opacity: easeOut(ramp(t, 0, 500)), filter: `blur(${(1 - z) * 6}px)` }}>
        <FieldFrame d={d} context={first?.rgb ?? null} inside={null} draw={easeInOut(ramp(t, 2000, 3000))} markers={ramp(t, 2700, 3200)} />
      </div>
      <div className="st-hud">
        <div>
          {Math.abs(lat).toFixed(4)}° S · {Math.abs(lng).toFixed(4)}° W
        </div>
        <div className="st-scale">
          <i style={{ width: `${30 * (barM / widthM) * scale}cqw` }} />
          {barM} m
        </div>
        <div className="st-src">Sentinel-2 L2A · {first?.date} · native 10 m</div>
      </div>
      <div className="st-fieldlabel" style={{ opacity: ramp(t, 2800, 3400) }}>
        <b>Los Ángeles · {d.crop} · {d.areaHa} ha</b>
        <span>Biobío, Chile · {d.portfolioCode} · {d.portfolioName}</span>
      </div>
    </div>
  );
}
