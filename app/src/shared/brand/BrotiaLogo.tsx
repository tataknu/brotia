/**
 * BrotIA logo: the pixel mark plus the wordmark "Brot" + "IA" (IA in the accent colour), IBM Plex Mono 600.
 * `tagline` adds "Climate risk · Agricultural lending" under the name. `wordmark={false}` shows the mark only.
 */
import clsx from 'clsx';
import { BrotiaMark } from './BrotiaMark';

export const BROTIA_NAME = 'BrotIA';
export const BROTIA_TAGLINE = 'Climate risk · Agricultural lending';

export function BrotiaLogo({
  size = 28,
  animate = false,
  wordmark = true,
  tagline = false,
  className,
  wordmarkClassName,
}: {
  /** Mark size in px; the wordmark scales with it. */
  size?: number;
  animate?: boolean;
  wordmark?: boolean;
  tagline?: boolean;
  className?: string;
  /** Extra classes for the text block (e.g. 'hidden lg:flex' in the collapsed sidebar). */
  wordmarkClassName?: string;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <BrotiaMark size={size} animate={animate} title={wordmark ? undefined : BROTIA_NAME} />
      {wordmark && (
        <span className={clsx('flex min-w-0 flex-col', wordmarkClassName)}>
          <span className="font-mono font-semibold leading-none tracking-[-0.02em] text-ink" style={{ fontSize: Math.round(size * 0.68) }}>
            <span className="sr-only">{BROTIA_NAME}</span>
            <span aria-hidden>Brot</span>
            <span aria-hidden className="text-accent">
              IA
            </span>
          </span>
          {tagline && <span className="mt-1 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.14em] text-muted">{BROTIA_TAGLINE}</span>}
        </span>
      )}
    </span>
  );
}
