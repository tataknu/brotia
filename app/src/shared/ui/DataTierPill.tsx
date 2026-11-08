import type { DataTier, Tier } from '@/domain/types';
import { Badge, TierBadge } from './Badge';

/** Data tier pill: 'Enhanced data' (Chilean national sources) or 'Standard data' (global sources only). */
export function DataTierPill({ tier, className }: { tier: DataTier; className?: string }) {
  return (
    <Badge tone={tier === 'enhanced' ? 'brand' : 'neutral'} className={className}>
      {tier === 'enhanced' ? 'Enhanced data' : 'Standard data'}
    </Badge>
  );
}

const DATA_TIERS: readonly string[] = ['enhanced', 'standard'];

/**
 * One pill for both tier kinds (their values are disjoint):
 * risk tier ('normal' | 'watch' | 'high') → TierBadge colours; data tier ('enhanced' | 'standard') → DataTierPill.
 */
export function TierPill({ tier, className }: { tier: Tier | DataTier; className?: string }) {
  if (DATA_TIERS.includes(tier)) return <DataTierPill tier={tier as DataTier} className={className} />;
  return <TierBadge tier={tier as Tier} className={className} />;
}
