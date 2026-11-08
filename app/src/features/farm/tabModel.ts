/** Farm page tabs (v1.1 spec "Farm detail"): ids, labels and the `?tab=` parsing. Pure; node-tested. */
import { parseTabParam, tabElementId, tabForKeyIn, tabPanelId } from '@/shared/ui/Tabs';

export const FARM_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'imagery', label: 'Imagery' },
  { id: 'water', label: 'Water' },
  { id: 'risk', label: 'Risk' },
  { id: 'rules', label: 'Rules' },
  { id: 'events', label: 'Events' },
] as const;

export type FarmTab = (typeof FARM_TABS)[number]['id'];

export const DEFAULT_TAB: FarmTab = 'overview';

/** Element id prefix of the farm tabs and panels (`farm-tab-<id>`, `farm-panel-<id>`). */
export const FARM_TAB_PREFIX = 'farm';

/** The tab named by a `?tab=` value; unknown or missing values fall back to Overview. */
export const parseTab = (value: string | null | undefined): FarmTab => parseTabParam(FARM_TABS, value, DEFAULT_TAB);

/** Tab reached from `current` by a key of the WAI-ARIA tabs pattern, or null for any other key. */
export const tabForKey = (current: FarmTab, key: string): FarmTab | null => tabForKeyIn(FARM_TABS, current, key);

export const tabId = (t: FarmTab) => tabElementId(FARM_TAB_PREFIX, t);
export const panelId = (t: FarmTab) => tabPanelId(FARM_TAB_PREFIX, t);
