/** Wizard step definitions and "can continue" gates (pure, node-tested). */
import type { Portfolio } from '@/domain/types';

export const WIZARD_STEPS = ['Portfolio', 'Farms', 'Zones & rules', 'Credit', 'Review'] as const;
export const LAST_STEP = WIZARD_STEPS.length - 1;

/** Returns null when the user may leave step `step`, otherwise a plain-language reason. */
export function stepBlocker(step: number, d: Portfolio | null): string | null {
  if (!d) return 'Starting a new portfolio…';
  switch (step) {
    case 0:
      return d.name.trim() ? null : 'Give the portfolio a name to continue.';
    case 1: {
      if (d.farms.length === 0) return 'Add at least one farm to continue.';
      const unnamed = d.farms.filter((f) => !f.name.trim()).length;
      if (unnamed > 0) return unnamed === 1 ? '1 farm needs a name.' : `${unnamed} farms need a name.`;
      return null;
    }
    case 2:
      // Every farm always has its own 35 km² zone, so this step never blocks.
      return null;
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
