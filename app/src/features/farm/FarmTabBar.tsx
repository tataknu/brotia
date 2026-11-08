/**
 * Farm page tab bar: the shared `Tabs` (shared/ui/Tabs.tsx) bound to the farm's six tabs and `?tab=`.
 * WAI-ARIA tabs pattern, automatic activation; see the shared component. FarmPage renders `Tabs` directly with
 * the same props; `FarmTabs` is the bound shorthand.
 */
import type { ReactNode } from 'react';
import { Tabs, useTabParam } from '@/shared/ui';
import { DEFAULT_TAB, FARM_TABS, FARM_TAB_PREFIX, type FarmTab } from './tabModel';

/** The selected tab from `?tab=` and a setter that keeps the other search params (replaces the history entry). */
export const useFarmTab = (): [FarmTab, (t: FarmTab) => void] => useTabParam(FARM_TABS, DEFAULT_TAB);

export function FarmTabs({ tab, onSelect, badges }: { tab: FarmTab; onSelect: (t: FarmTab) => void; badges?: Partial<Record<FarmTab, ReactNode>> }) {
  return <Tabs tabs={FARM_TABS} tab={tab} onSelect={onSelect} idPrefix={FARM_TAB_PREFIX} label="Farm sections" badges={badges} />;
}

