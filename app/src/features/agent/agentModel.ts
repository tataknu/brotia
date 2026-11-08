/**
 * Pure logic for the farming agent panel (no React): proposal labels, backtest tables, error kinds and
 * the question context. Unit-tested in node.
 */
import { CROP_META } from '@/domain/constants';
import { effectiveZoneId, splitPath } from '@/domain/rules';
import type { AgentRecommendation, Crop, CropTemplate, Peril, Portfolio, RankedFarm, RuleChange, Tier } from '@/domain/types';
import { CREDIT_ACTION_LABELS, PERIL_LABELS, signed } from '@/shared/format';
import { ApiRequestError, NetworkError, UnavailableError } from '@/data/http';

/* ───────────────────────── suggested prompts ───────────────────────── */

export type PromptKind = 'zone' | 'farm' | 'portfolio';

export interface SuggestedPrompt {
  kind: PromptKind;
  text: string;
}

/** The demo prompts (ADR-0013 D9 / D11): zone frost + harvest-rain tuning with a backtest, and "why at <tier>". */
export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { kind: 'zone', text: 'Suggest frost and harvest-rain settings for this zone, with a backtest.' },
  { kind: 'farm', text: 'Why is this farm at watch?' },
  { kind: 'portfolio', text: 'Which farms need a field visit before their next installment?' },
];

const TIER_WORD: Record<Tier, string> = { normal: 'normal', watch: 'watch', high: 'high stress' };

/**
 * The two chips the panel shows (RT-7): the zone tuning prompt always; the farm prompt only in farm context,
 * worded for the farm's tier; otherwise the portfolio prompt.
 */
export function promptsFor(ctx: AgentContext, farmTier: Tier | null): SuggestedPrompt[] {
  const zone = SUGGESTED_PROMPTS[0];
  if (ctx.farmId) {
    const text = farmTier === 'normal' ? 'Why is this farm normal, and what would raise its risk?' : `Why is this farm at ${TIER_WORD[farmTier ?? 'watch']}?`;
    return [zone, { kind: 'farm', text }];
  }
  return [zone, SUGGESTED_PROMPTS[2]];
}

/* ───────────────────────── context ───────────────────────── */

export interface AgentContext {
  zoneId: string | null;
  farmId: string | null;
}

/** The contract allows exactly one of zoneId / farmId (both null = portfolio question). Farm wins. */
export function normaliseContext(ctx: AgentContext): AgentContext {
  if (ctx.farmId) return { zoneId: null, farmId: ctx.farmId };
  return { zoneId: ctx.zoneId ?? null, farmId: null };
}

/**
 * Context a suggested prompt needs, starting from the current one:
 * - zone prompt: the current zone; else the current farm's effective zone; else the top-ranked farm's zone;
 *   else the first farm's zone.
 * - farm prompt: the current farm; else the top-ranked watch/high farm; else the top-ranked farm; else the first farm.
 * - portfolio prompt: no zone or farm.
 */
export function contextForPrompt(portfolio: Portfolio, current: AgentContext, kind: PromptKind, ranked?: readonly RankedFarm[] | null): AgentContext {
  if (kind === 'portfolio') return { zoneId: null, farmId: null };
  const farmById = (id: string | null | undefined) => (id ? portfolio.farms.find((f) => f.id === id) : undefined);
  const top = ranked?.find((r) => farmById(r.farmId)) ?? null;
  const topStressed = ranked?.find((r) => r.tier !== 'normal' && farmById(r.farmId)) ?? null;
  if (kind === 'farm') {
    const farm = farmById(current.farmId) ?? farmById(topStressed?.farmId) ?? farmById(top?.farmId) ?? portfolio.farms[0];
    return { zoneId: null, farmId: farm?.id ?? null };
  }
  if (current.zoneId && portfolio.zones.some((z) => z.id === current.zoneId)) return { zoneId: current.zoneId, farmId: null };
  const farm = farmById(current.farmId) ?? farmById(topStressed?.farmId) ?? farmById(top?.farmId) ?? portfolio.farms[0];
  return { zoneId: farm ? effectiveZoneId(portfolio, farm) : null, farmId: null };
}

/** "Zone: Requínoa cherries (own zone)" / "Farm: Ovalle table grapes" / "Whole portfolio". */
export function contextLabel(portfolio: Portfolio | undefined, ctx: AgentContext): string {
  if (ctx.farmId) return `Farm: ${portfolio?.farms.find((f) => f.id === ctx.farmId)?.name ?? ctx.farmId}`;
  if (ctx.zoneId) return `Zone: ${zoneName(portfolio, ctx.zoneId)}`;
  return 'Whole portfolio';
}

export function zoneName(portfolio: Portfolio | undefined, zoneId: string): string {
  const z = portfolio?.zones.find((x) => x.id === zoneId);
  if (z) return z.name;
  if (zoneId.startsWith('auto-')) {
    const farm = portfolio?.farms.find((f) => `auto-${f.id}` === zoneId);
    if (farm) return `${farm.name} (own zone)`;
  }
  return zoneId;
}

/* ───────────────────────── proposals ───────────────────────── */

const LEAF: Record<string, { label: string; unit: string; digits: number }> = {
  frostCriticalC: { label: 'Frost damage starts at', unit: '°C', digits: 1 },
  frostSevereC: { label: 'Severe frost at', unit: '°C', digits: 1 },
  heatC: { label: 'Heat stress from', unit: '°C', digits: 1 },
  harvestRainMm72h: { label: 'Damaging rain in 72 h', unit: 'mm', digits: 0 },
  kc: { label: 'Crop coefficient (Kc)', unit: '', digits: 2 },
  chillHoursMin: { label: 'Winter chill needed', unit: 'h', digits: 0 },
  baselineYears: { label: 'NDVI baseline length', unit: 'years', digits: 0 },
  start: { label: 'Stage window starts', unit: '', digits: 0 },
  end: { label: 'Stage window ends', unit: '', digits: 0 },
  a: { label: 'Weight a (climate)', unit: '', digits: 2 },
  b: { label: 'Weight b (disasters)', unit: '', digits: 2 },
  c: { label: 'Weight c (geography)', unit: '', digits: 2 },
};

export interface PathDescription {
  /** e.g. 'Cherry · Bloom · Frost damage starts at'. */
  label: string;
  unit: string;
  digits: number;
  crop: Crop | null;
}

function stageLabel(templates: readonly CropTemplate[] | null | undefined, crop: Crop | null, key: string): string {
  const t = crop ? templates?.find((x) => x.crop === crop) : undefined;
  const s = t?.stages.find((x) => x.key === key);
  if (s) return s.label;
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Describes a RulesPatch-relative path ('rules.stages.bloom.frostCriticalC', 'weights.c', …). */
function describePatchPath(segs: string[], crop: Crop | null, templates: readonly CropTemplate[] | null | undefined): Omit<PathDescription, 'crop'> {
  const leaf = segs[segs.length - 1] ?? '';
  const meta = LEAF[leaf];
  const parts: string[] = [];
  if (segs[0] === 'rules' && segs[1] === 'stages' && segs[2]) parts.push(stageLabel(templates, crop, segs[2]));
  if (segs[0] === 'stages' && segs[1]) {
    parts.push(stageLabel(templates, crop, segs[1]));
    if (segs[2] === 'sensitivity' && segs[3]) {
      parts.push(`Sensitivity to ${(PERIL_LABELS[segs[3] as Peril] ?? segs[3]).toLowerCase()}`);
      return { label: parts.join(' · '), unit: '', digits: 2 };
    }
  }
  parts.push(meta?.label ?? leaf);
  return { label: parts.join(' · '), unit: meta?.unit ?? '', digits: meta?.digits ?? 2 };
}

/** Human label of a change path at its scope (CONTRACT §E.2 path table). */
export function describeChange(change: Pick<RuleChange, 'scope' | 'path'>, portfolio: Portfolio | undefined, templates?: readonly CropTemplate[] | null): PathDescription {
  const segs = splitPath(change.path);
  const { level, id } = change.scope;
  const withCrop = (crop: Crop | null, d: Omit<PathDescription, 'crop'>): PathDescription => ({
    ...d,
    crop,
    label: crop && CROP_META[crop] ? `${CROP_META[crop].label} · ${d.label}` : d.label,
  });
  if (level === 'crop') return withCrop(id as Crop, describePatchPath(segs, id as Crop, templates));
  if (level === 'zone' && segs[0] === 'overrides' && segs[1]) return withCrop(segs[1] as Crop, describePatchPath(segs.slice(2), segs[1] as Crop, templates));
  if (level === 'farm') {
    const crop = portfolio?.farms.find((f) => f.id === id)?.crop ?? null;
    if (segs[0] === 'overrides') return withCrop(crop, describePatchPath(segs.slice(1), crop, templates));
    if (segs[0] === 'creditRuleOverrides') return { label: `Credit rule ${segs[1]}${segs.length > 2 ? ` · ${segs.slice(2).join('.')}` : ''}`, unit: '', digits: 2, crop };
    if (segs[0] === 'covered') return { label: 'Under covers or nets', unit: '', digits: 0, crop };
    if (segs[0] === 'irrigatedDeclared') return { label: 'Declared irrigated', unit: '', digits: 0, crop };
  }
  if (level === 'portfolio' && segs[0] === 'creditRules') return { label: `Portfolio credit rule ${segs[1] ?? ''}${segs.length > 2 ? ` · ${segs.slice(2).join('.')}` : ''}`, unit: '', digits: 2, crop: null };
  return { label: change.path, unit: '', digits: 2, crop: null };
}

/** Where a change applies: 'Zone · Requínoa cherries (own zone)'. */
export function scopeLabel(scope: RuleChange['scope'], portfolio: Portfolio | undefined): string {
  switch (scope.level) {
    case 'crop':
      return `All ${(CROP_META[scope.id as Crop]?.label ?? scope.id).toLowerCase()} farms`;
    case 'zone':
      return `Zone · ${zoneName(portfolio, scope.id)}`;
    case 'farm':
      return `Farm · ${portfolio?.farms.find((f) => f.id === scope.id)?.name ?? scope.id}`;
    case 'portfolio':
      return 'Whole portfolio';
  }
}

/** Whether the change's target still exists in the portfolio (a removed farm/zone cannot take a proposal). */
export function targetExists(scope: RuleChange['scope'], portfolio: Portfolio | undefined): boolean {
  if (!portfolio) return false;
  switch (scope.level) {
    case 'crop':
      return scope.id in CROP_META;
    case 'zone':
      return portfolio.zones.some((z) => z.id === scope.id);
    case 'farm':
      return portfolio.farms.some((f) => f.id === scope.id);
    case 'portfolio':
      return portfolio.id === scope.id;
  }
}

/** Formats a proposal value for the diff card. null = "inherited". */
export function formatValue(v: unknown, d: Pick<PathDescription, 'unit' | 'digits'>): string {
  if (v === null || v === undefined) return 'Inherited';
  if (typeof v === 'number') return `${signed(v, d.digits)}${d.unit ? ` ${d.unit}` : ''}`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return (CREDIT_ACTION_LABELS as Record<string, string>)[v] ?? v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ───────────────────────── evidence ───────────────────────── */

export interface EvidenceTable {
  param: string | null;
  seasons: number | null;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
}

const COLUMN_LABELS: Record<string, string> = {
  value: 'Value',
  hits: 'Hits',
  falseAlarms: 'False alarms',
  missed: 'Missed',
  precision: 'Precision',
  recall: 'Recall',
};

const isScalar = (v: unknown): v is string | number | boolean | null => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * Turns evidence `data` into a table when it has the backtest shape
 * ({ param?, seasons?, candidates: [{ value, hits, falseAlarms, missed, … }] }) or is an array of flat rows.
 * Returns null for anything else (the panel then shows the raw JSON, collapsed).
 */
export function evidenceTable(data: unknown): EvidenceTable | null {
  let rowsRaw: unknown = null;
  let param: string | null = null;
  let seasons: number | null = null;
  if (Array.isArray(data)) rowsRaw = data;
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    rowsRaw = o.candidates ?? o.rows ?? o.results ?? null;
    param = typeof o.param === 'string' ? o.param : null;
    seasons = typeof o.seasons === 'number' ? o.seasons : null;
  }
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) return null;
  if (!rowsRaw.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  const keys: string[] = [];
  for (const r of rowsRaw as Record<string, unknown>[]) for (const [k, v] of Object.entries(r)) if (isScalar(v) && !keys.includes(k)) keys.push(k);
  if (keys.length === 0) return null;
  const order = Object.keys(COLUMN_LABELS);
  keys.sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  const rows = (rowsRaw as Record<string, unknown>[]).map((r) => Object.fromEntries(keys.map((k) => [k, isScalar(r[k]) ? (r[k] as string | number | boolean | null) : null])));
  const columns = keys.map((k) => ({ key: k, label: COLUMN_LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));
  return { param, seasons, columns, rows };
}

/** The best row of a backtest table: most hits, then fewest false alarms (for highlighting only). */
export function bestRowIndex(t: EvidenceTable): number {
  if (!t.columns.some((c) => c.key === 'hits')) return -1;
  let best = -1;
  t.rows.forEach((r, i) => {
    const h = typeof r.hits === 'number' ? r.hits : -Infinity;
    const fa = typeof r.falseAlarms === 'number' ? r.falseAlarms : Infinity;
    if (best === -1) return void (best = i);
    const bh = typeof t.rows[best].hits === 'number' ? (t.rows[best].hits as number) : -Infinity;
    const bfa = typeof t.rows[best].falseAlarms === 'number' ? (t.rows[best].falseAlarms as number) : Infinity;
    if (h > bh || (h === bh && fa < bfa)) best = i;
  });
  return best;
}

/* ───────────────────────── errors ───────────────────────── */

export type AgentErrorKind = 'no_api_key' | 'offline' | 'timeout' | 'invalid' | 'other';

export interface AgentErrorInfo {
  kind: AgentErrorKind;
  title: string;
  message: string;
}

export function agentErrorInfo(e: unknown): AgentErrorInfo {
  if (e instanceof ApiRequestError) {
    if (e.code === 'no_api_key' || e.status === 503)
      return {
        kind: 'no_api_key',
        title: 'The farming agent is not set up yet',
        message:
          'The service has no Anthropic API key. Set ANTHROPIC_API_KEY in the service environment (or in the gitignored service/.env), restart the service and ask again. The key stays on the service; the app never sees it.',
      };
    if (e.code === 'not_found') return { kind: 'invalid', title: 'That zone or farm is not in this portfolio', message: e.detail };
    if (e.code === 'invalid_request') return { kind: 'invalid', title: 'The service could not read the question', message: e.detail };
    return { kind: 'other', title: 'The agent could not answer', message: e.detail || e.message };
  }
  if (e instanceof UnavailableError) return { kind: 'offline', title: 'The farming agent is unavailable offline', message: 'It needs the live service. Start the service and ask again.' };
  if (e instanceof NetworkError)
    return e.timedOut
      ? { kind: 'timeout', title: 'The agent took too long', message: 'No answer within 90 seconds. Try again or ask a narrower question.' }
      : { kind: 'offline', title: 'The service is unreachable', message: 'The farming agent needs the live service.' };
  return { kind: 'other', title: 'The agent could not answer', message: e instanceof Error ? e.message : String(e) };
}

/* ───────────────────────── conversation ───────────────────────── */

/** Recommendations relevant to a context, oldest first (the panel shows the whole portfolio thread). */
export function proposalCounts(portfolio: Portfolio | undefined, rec: AgentRecommendation, stateOf: (p: RuleChange) => 'proposed' | 'applied' | 'dismissed') {
  const counts = { proposed: 0, applied: 0, dismissed: 0 };
  if (!portfolio) return counts;
  for (const p of rec.proposals) counts[stateOf(p)] += 1;
  return counts;
}
