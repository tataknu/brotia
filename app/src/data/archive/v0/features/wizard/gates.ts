/** Wizard step definitions and "can continue" gates (pure, foundation-owned). */
import type { Portfolio } from '@/domain/types';

export const WIZARD_STEPS = ['Portfolio', 'Farms', 'Zones & baselines', 'Credit', 'Review'] as const;
export const LAST_STEP = WIZARD_STEPS.length - 1;

/** Returns null when the user may leave step `step`, otherwise a plain-language reason. */
export function stepBlocker(step: number, d: Portfolio | null): string | null {
  if (!d) return 'Starting a new portfolio…';
  switch (step) {
    case 0:
      return d.name.trim() ? null : 'Give the portfolio a name to continue.';
    case 1:
      return d.farms.length > 0 ? null : 'Add at least one farm on the map to continue.';
    case 2:
      return d.zones.length > 0 ? null : 'Add at least one zone to continue.';
    case 3: {
      const missing = d.farms.filter((f) => !f.loan).length;
      if (missing === 0) return null;
      return missing === 1 ? '1 farm still needs a loan.' : `${missing} farms still need a loan.`;
    }
    default:
      return null;
  }
}

/** Highest step index reachable from step 0 given the current draft (all earlier gates pass). */
export function maxReachableStep(d: Portfolio | null): number {
  let i = 0;
  while (i < LAST_STEP && stepBlocker(i, d) === null) i++;
  return i;
}
