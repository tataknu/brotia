/**
 * BrotIA mark: the 7×7 pixel logo (docs/design/brotia-slide-1.html, light background).
 * A seed's stem (S) with two leaves (B, A) above the soil row, which is the risk ramp (0–6). '.' cells are the faint grid.
 *
 * <BrotiaMark size={28} />            static
 * <BrotiaMark size={28} animate />    one-time load animation: soil row, then stem (bottom up), then leaves.
 *
 * The animation is pure CSS (index.css, .brotia-mark-animate) so it is safe in server render and is skipped
 * under prefers-reduced-motion. It plays once per page load, even if the mark is mounted again.
 */
import clsx from 'clsx';
import { useEffect, useState, type CSSProperties } from 'react';
import { RISK_RAMP } from '@/shared/chartColors';

export const BROTIA_GRID = ['.....AA', '.B..AAA', 'BBBSAA.', '.BBS...', '...S...', '...S...', '0123456'] as const;

export const BROTIA_CELL_COLORS = { A: '#2FA05A', B: '#6CC26F', S: '#1F6B43', '.': '#E4EBE6' } as const;

/** Geometry in viewBox units: 7 cells of 7.5 with a 1.25 gap = 60 (same ratios as the slide). */
const CELL = 7.5;
const PITCH = 8.75;
const RX = 1.575; // 21% of the cell
export const BROTIA_VIEWBOX = 60;

type Kind = 'soil' | 'stem' | 'leaf-b' | 'leaf-a' | 'faint';

export interface MarkCell {
  r: number;
  c: number;
  ch: string;
  fill: string;
  kind: Kind;
  /** Animation delay in ms. */
  delay: number;
}

const kindOf = (ch: string): Kind => (/\d/.test(ch) ? 'soil' : ch === 'S' ? 'stem' : ch === 'B' ? 'leaf-b' : ch === 'A' ? 'leaf-a' : 'faint');
const fillOf = (ch: string): string => (/\d/.test(ch) ? RISK_RAMP[Number(ch)] : BROTIA_CELL_COLORS[ch as keyof typeof BROTIA_CELL_COLORS]);

/** All 49 cells with colours and the animation schedule (soil → stem → leaves → faint grid). */
export function markCells(): MarkCell[] {
  const cells: MarkCell[] = [];
  BROTIA_GRID.forEach((row, r) => [...row].forEach((ch, c) => cells.push({ r, c, ch, fill: fillOf(ch), kind: kindOf(ch), delay: 0 })));
  const SOIL = 0;
  const STEM = 520;
  const LEAF_B = 900;
  const LEAF_A = 1080;
  const FAINT = 1300;
  const dist = (x: MarkCell, r: number, c: number) => Math.hypot(x.r - r, x.c - c);
  cells.filter((x) => x.kind === 'soil').forEach((x) => (x.delay = SOIL + x.c * 55));
  cells
    .filter((x) => x.kind === 'stem')
    .sort((a, b) => b.r - a.r)
    .forEach((x, i) => (x.delay = STEM + i * 90));
  cells
    .filter((x) => x.kind === 'leaf-b')
    .sort((a, b) => dist(a, 2.5, 3) - dist(b, 2.5, 3))
    .forEach((x, i) => (x.delay = LEAF_B + i * 45));
  cells
    .filter((x) => x.kind === 'leaf-a')
    .sort((a, b) => dist(a, 2, 3) - dist(b, 2, 3))
    .forEach((x, i) => (x.delay = LEAF_A + i * 40));
  cells.filter((x) => x.kind === 'faint').forEach((x) => (x.delay = FAINT + ((x.r * 7 + x.c * 3) % 9) * 40));
  return cells;
}

const CELLS = markCells();
const KIND_CLASS: Record<Kind, string> = { soil: 'bm-soil', stem: 'bm-stem', 'leaf-b': 'bm-leaf bm-leaf-b', 'leaf-a': 'bm-leaf bm-leaf-a', faint: 'bm-faint' };

/** Static SVG markup of the mark (used for public/brand/brotia-mark.svg). */
export function brotiaMarkSvg(): string {
  const rects = CELLS.map(
    (x) => `<rect x="${x.c * PITCH}" y="${x.r * PITCH}" width="${CELL}" height="${CELL}" rx="${RX}" fill="${x.fill}"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BROTIA_VIEWBOX} ${BROTIA_VIEWBOX}">${rects}</svg>`;
}

let played = false;

export function BrotiaMark({
  size = 28,
  animate = false,
  title,
  className,
}: {
  /** Width and height in px. */
  size?: number;
  /** Play the one-time load animation (once per page load). */
  animate?: boolean;
  /** Accessible name; omit when the mark sits next to the wordmark (decorative). */
  title?: string;
  className?: string;
}) {
  // Decided once per mount (pure, StrictMode-safe); the module flag, set after mount, keeps later mounts static.
  const [run] = useState(() => animate && !played);
  useEffect(() => {
    if (run) played = true;
  }, [run]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BROTIA_VIEWBOX} ${BROTIA_VIEWBOX}`}
      className={clsx('shrink-0', run && 'brotia-mark-animate', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {CELLS.map((x) => (
        <rect
          key={`${x.r}-${x.c}`}
          className={clsx('bm-cell', KIND_CLASS[x.kind])}
          style={run ? ({ '--bm-delay': `${x.delay}ms` } as CSSProperties) : undefined}
          x={x.c * PITCH}
          y={x.r * PITCH}
          width={CELL}
          height={CELL}
          rx={RX}
          fill={x.fill}
        />
      ))}
    </svg>
  );
}
