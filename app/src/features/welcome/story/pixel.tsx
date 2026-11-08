/** Pixel-cell primitives shared by the story scenes (the 7×7 mark's rounded cells). */
import type { CSSProperties } from 'react';
import { clamp01 } from './timeline';

export const RAMP = ['#1F6B43', '#2FA05A', '#8CC63F', '#E3C93B', '#E8933A', '#D0533A', '#9E2F3A'];
export const TIER_COLOR: Record<string, string> = { normal: '#2FA05A', watch: '#E3C93B', high: '#D0533A' };

/** Deterministic 0..1 hash so "random" cell orders are identical on every run. */
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A glyph from strings ('#' = on); cells assemble in a deterministic scatter as p goes 0→1. */
export function PixelGlyph({ rows, color, size, p, style }: { rows: string[]; color: string; size: string; p: number; style?: CSSProperties }) {
  const n = rows.length;
  const cells: JSX.Element[] = [];
  rows.forEach((row, r) =>
    [...row].forEach((ch, k) => {
      if (ch !== '#') return;
      const d = hash(r * 13 + k * 7) * 0.6;
      const v = clamp01((p - d) / 0.4);
      cells.push(
        <i
          key={`${r}-${k}`}
          className="st-cell"
          style={{ left: `${(k / n) * 100}%`, top: `${(r / n) * 100}%`, width: `${88 / n}%`, height: `${88 / n}%`, background: color, opacity: v, transform: `scale(${0.4 + 0.6 * v})` }}
        />,
      );
    }),
  );
  return (
    <div className="st-glyph" style={{ width: size, height: size, ...style }}>
      {cells}
    </div>
  );
}

/** Text that types in, with a pixel cursor while typing. */
export function Typed({ text, p, cursor = true }: { text: string; p: number; cursor?: boolean }) {
  const n = Math.round(clamp01(p) * text.length);
  return (
    <>
      {text.slice(0, n)}
      <span className="st-ghost">{text.slice(n)}</span>
      {cursor && p > 0 && p < 1 && <span className="st-caret" />}
    </>
  );
}

/** Full-frame pixel dissolve: cells cover in a left→right sweep (p 0→0.5) and uncover (0.5→1). */
export function Dissolve({ p, cols = 32, rows = 18 }: { p: number; cols?: number; rows?: number }) {
  if (p <= 0 || p >= 1) return null;
  const cells: JSX.Element[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const d = (c / cols) * 0.6 + hash(r * 101 + c) * 0.4; // sweep + jitter, 0..1
      const cover = clamp01((p * 2 - d * 0.8) / 0.2);
      const uncover = clamp01(((p - 0.5) * 2 - d * 0.8) / 0.2);
      const v = cover - uncover;
      if (v <= 0.01) continue;
      const accent = hash(r * 7 + c * 3) > 0.93 ? RAMP[Math.floor(hash(c + r) * 3)] : '#13221B';
      cells.push(
        <i
          key={r * cols + c}
          className="st-cell"
          style={{ left: `${(c / cols) * 100}%`, top: `${(r / rows) * 100}%`, width: `${94 / cols}%`, height: `${94 / rows}%`, background: accent, opacity: v, transform: `scale(${0.3 + 0.7 * v})` }}
        />,
      );
    }
  return <div className="st-dissolve">{cells}</div>;
}

export const fmtMoney = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
