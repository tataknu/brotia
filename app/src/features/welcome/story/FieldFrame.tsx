/** The farm drawn in its own imagery bbox: real Sentinel-2 frame(s), polygon outline and pixel corner markers. */
import type { StoryData } from './useStoryData';

export function ringToBox(d: StoryData): [number, number][] {
  const [minX, minY, maxX, maxY] = d.bbox;
  return d.ring.map(([x, y]) => [((x - minX) / (maxX - minX)) * 100, ((maxY - y) / (maxY - minY)) * 100]);
}

export function FieldFrame({
  d,
  context,
  inside,
  draw,
  markers,
  insideOpacity = 1,
}: {
  d: StoryData;
  context: string | null; // full-bbox image behind (true colour)
  inside: string | null; // image clipped to the polygon (NDVI)
  draw: number; // 0..1 polygon stroke drawn
  markers: number; // 0..1 corner markers
  insideOpacity?: number;
}) {
  const pts = ringToBox(d);
  const clip = `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') + 'Z';
  return (
    <div className="st-field">
      {context && <img className="st-px" src={context} alt="" style={{ opacity: 0.55 }} />}
      {inside && <img className="st-px" src={inside} alt="" style={{ clipPath: clip, opacity: insideOpacity }} />}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={path} pathLength={1} fill="none" stroke="#EAF3EE" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeDasharray="1" strokeDashoffset={1 - draw} />
      </svg>
      {pts.slice(0, -1).map(([x, y], i) => (
        <i key={i} className="st-marker" style={{ left: `${x}%`, top: `${y}%`, opacity: markers > i / pts.length ? 1 : 0 }} />
      ))}
    </div>
  );
}
