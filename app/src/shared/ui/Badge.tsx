import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { Tier } from '@/domain/types';
import { TIER_LABELS } from '@/shared/format';

export type BadgeTone = 'neutral' | 'brand' | 'warn' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-muted',
  brand: 'bg-brand-soft text-brand-ink',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-[#E8EFF7] text-[#2F5C8C]',
};

/** Dot colour per tone: tier colours from the risk ramp (normal #2FA05A, watch #E8933A, high #D0533A). */
const DOTS: Record<BadgeTone, string> = {
  neutral: 'bg-muted',
  brand: 'bg-accent',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-[#2F5C8C]',
};

export const TIER_TONE: Record<Tier, BadgeTone> = { normal: 'brand', watch: 'warn', high: 'danger' };

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

/** Alias: Pill. */
export const Pill = Badge;

/** Tier pill: normal = green, watch = amber, high = red (dot in the tier colour, text in the matching ink). */
export function TierBadge({ tier, label, className }: { tier: Tier; label?: ReactNode; className?: string }) {
  return (
    <Badge tone={TIER_TONE[tier]} dot className={className}>
      {label ?? TIER_LABELS[tier]}
    </Badge>
  );
}
