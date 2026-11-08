/**
 * Pure model for the rules editors (node-tested). Paths and layering follow CONTRACT §E.2 exactly:
 *   crop scope  {level:'crop', id: crop}      path = <leaf>                      e.g. rules.stages.bloom.frostCriticalC
 *   zone scope  {level:'zone', id: zoneId}    path = overrides.<crop>.<leaf>
 *   farm scope  {level:'farm', id: farmId}    path = overrides.<leaf>
 *   portfolio   {level:'portfolio', id: pid}  path = creditRules.<ruleId>.<field>
 *   farm credit {level:'farm', id: farmId}    path = creditRuleOverrides.<ruleId>.<field>
 */
import {
  effectiveCreditRules,
  effectiveRulesForCrop,
  effectiveRulesForFarm,
  effectiveRulesForZone,
  effectiveZoneId,
  farmsInZone,
  resolveCropLeaf,
  resolveFarmLeaf,
  resolveZoneLeaf,
  templateLeaf,
  type EffectiveCreditRule,
  type EffectiveRules,
  type ResolvedLeaf,
  type RuleLayer,
} from '@/domain/rules';
import { CROP_META } from '@/domain/constants';
import type {
  CreditAction,
  CreditCondition,
  CreditMetric,
  CreditOp,
  CreditRule,
  Crop,
  CropTemplate,
  Peril,
  Portfolio,
  RuleChange,
  StageThresholds,
} from '@/domain/types';
import { CROPS } from '@/domain/types';

/* ───────────────────────── agronomic fields ───────────────────────── */

export interface NumField {
  key: string;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  help?: string;
}

export const THRESHOLD_FIELDS: (NumField & { key: keyof StageThresholds })[] = [
  { key: 'frostCriticalC', label: 'Frost damage starts (about 10 % loss)', unit: '°C', step: 0.1, min: -20, max: 10 },
  { key: 'frostSevereC', label: 'Severe frost (about 90 % loss)', unit: '°C', step: 0.1, min: -25, max: 10 },
  { key: 'heatC', label: 'Heat or sunburn above', unit: '°C', step: 0.5, min: 20, max: 50 },
  { key: 'harvestRainMm72h', label: 'Damaging rain in 72 hours', unit: 'mm', step: 1, min: 0, max: 500 },
  { key: 'kc', label: 'Crop water use coefficient (Kc)', unit: '', step: 0.05, min: 0, max: 2 },
];

export const CROP_FIELDS: NumField[] = [
  { key: 'rules.chillHoursMin', label: 'Winter chill needed (hours below 7.2 °C, May–Aug)', unit: 'h', step: 10, min: 0, max: 3000 },
  { key: 'rules.baselineYears', label: 'Vegetation baseline length (NDVI only)', unit: 'years', step: 1, min: 1, max: 10 },
];

export const WEIGHT_FIELDS: NumField[] = [
  { key: 'weights.a', label: 'Weight of climate stress (a)', unit: '', step: 0.05, min: 0, max: 1 },
  { key: 'weights.b', label: 'Weight of disasters (b)', unit: '', step: 0.05, min: 0, max: 1 },
  { key: 'weights.c', label: 'Geography amplifier (c)', unit: '', step: 0.05, min: 0, max: 1 },
];

export const thresholdPath = (stageKey: string, field: keyof StageThresholds) => `rules.stages.${stageKey}.${field}`;
export const sensitivityPath = (stageKey: string, peril: Peril) => `stages.${stageKey}.sensitivity.${peril}`;
export const windowPath = (stageKey: string, edge: 'start' | 'end') => `stages.${stageKey}.${edge}`;

/* ───────────────────────── edit targets ───────────────────────── */

export type RuleTarget = { level: 'crop'; crop: Crop } | { level: 'zone'; zoneId: string; crop: Crop } | { level: 'farm'; farmId: string };

export const LAYER_LABELS: Record<RuleLayer, string> = {
  template: 'Crop template',
  crop: 'Portfolio crop setting',
  zone: 'Zone',
  farm: 'Farm',
};

/** Crop the target edits. */
export function targetCrop(p: Portfolio, t: RuleTarget): Crop | null {
  if (t.level === 'farm') return p.farms.find((f) => f.id === t.farmId)?.crop ?? null;
  return t.crop;
}

/** Scope + path of an agronomic leaf edit at a target (CONTRACT §E.2). */
export function leafChange(p: Portfolio, t: RuleTarget, leaf: string): Pick<RuleChange, 'scope' | 'path'> {
  switch (t.level) {
    case 'crop':
      return { scope: { level: 'crop', id: t.crop }, path: leaf };
    case 'zone':
      return { scope: { level: 'zone', id: t.zoneId }, path: `overrides.${t.crop}.${leaf}` };
    case 'farm':
      return { scope: { level: 'farm', id: t.farmId }, path: `overrides.${leaf}` };
  }
}

export interface LeafView {
  /** Effective value seen at this target. */
  value: unknown;
  /** Layer that set it. */
  layer: RuleLayer;
  /** true when this target's own layer set it ("Custom"). */
  custom: boolean;
  /** Value and layer this target would inherit without its own setting. */
  inherited: ResolvedLeaf;
}

/** Effective value of a leaf at a target, whether it is set here, and what it would inherit otherwise. */
export function leafView(p: Portfolio, template: CropTemplate | undefined, t: RuleTarget, leaf: string): LeafView {
  switch (t.level) {
    case 'crop': {
      const r = resolveCropLeaf(p, template, t.crop, leaf);
      return { ...r, custom: r.layer === 'crop', inherited: { value: template ? templateLeaf(template, leaf) : undefined, layer: 'template' } };
    }
    case 'zone': {
      const r = resolveZoneLeaf(p, template, t.zoneId, t.crop, leaf);
      return { ...r, custom: r.layer === 'zone', inherited: resolveCropLeaf(p, template, t.crop, leaf) };
    }
    case 'farm': {
      const farm = p.farms.find((f) => f.id === t.farmId);
      if (!farm) return { value: undefined, layer: 'template', custom: false, inherited: { value: undefined, layer: 'template' } };
      const r = resolveFarmLeaf(p, template, farm, leaf);
      return { ...r, custom: r.layer === 'farm', inherited: resolveZoneLeaf(p, template, effectiveZoneId(p, farm), farm.crop, leaf) };
    }
  }
}

/** Effective stages / rules / weights seen at a target. */
export function targetRules(p: Portfolio, template: CropTemplate, t: RuleTarget): EffectiveRules {
  if (t.level === 'crop') return effectiveRulesForCrop(p, template);
  if (t.level === 'zone') return effectiveRulesForZone(p, template, t.zoneId);
  const farm = p.farms.find((f) => f.id === t.farmId);
  return farm ? effectiveRulesForFarm(p, template, farm) : effectiveRulesForCrop(p, template);
}

/** Crops worth editing in a zone: the crops of its farms, else all six. */
export function zoneCrops(p: Portfolio, zoneId: string): Crop[] {
  const present = new Set(farmsInZone(p, zoneId).map((f) => f.crop));
  return present.size ? CROPS.filter((c) => present.has(c)) : [...CROPS];
}

/** Crops of the portfolio's farms first (in CROPS order), then the rest. */
export function cropsByPresence(p: Portfolio): Crop[] {
  const present = new Set(p.farms.map((f) => f.crop));
  return [...CROPS.filter((c) => present.has(c)), ...CROPS.filter((c) => !present.has(c))];
}

/** Human description of a target. */
export function targetLabel(p: Portfolio, t: RuleTarget): string {
  if (t.level === 'crop') return `All ${CROP_META[t.crop].label.toLowerCase()} farms in this portfolio`;
  if (t.level === 'zone') {
    const z = p.zones.find((x) => x.id === t.zoneId);
    return `${CROP_META[t.crop].label} farms in ${z?.name ?? t.zoneId}`;
  }
  return p.farms.find((f) => f.id === t.farmId)?.name ?? t.farmId;
}

/** Number of leaves set in a patch-like object (counts overrides). */
export function countLeaves(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'object' || Array.isArray(v)) return 1;
  return Object.values(v as Record<string, unknown>).reduce<number>((s, x) => s + countLeaves(x), 0);
}

/* ───────────────────────── credit rules ───────────────────────── */

/** Union of the templates' credit rules, deduped by id (first occurrence wins; the six templates share them). */
export function templateCreditRules(templates: readonly CropTemplate[] | null | undefined): CreditRule[] {
  const seen = new Map<string, CreditRule>();
  for (const t of templates ?? []) for (const r of t.creditRules) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

/** Portfolio-level effective credit rules: template union → portfolio.creditRules (replace by id / append). */
export function portfolioCreditRules(p: Portfolio, templates: readonly CropTemplate[] | null | undefined): EffectiveCreditRule[] {
  return effectiveCreditRules(templateCreditRules(templates), p.creditRules ?? []);
}

export type CreditField = 'enabled' | 'then' | 'when.op' | 'when.value' | 'when.withinDaysBeforeInstallment';

export function creditChange(p: Portfolio, level: 'portfolio' | 'farm', targetId: string, ruleId: string, field: CreditField | null): Pick<RuleChange, 'scope' | 'path'> {
  const tail = field ? `.${field}` : '';
  if (level === 'portfolio') return { scope: { level: 'portfolio', id: p.id }, path: `creditRules.${ruleId}${tail}` };
  return { scope: { level: 'farm', id: targetId }, path: `creditRuleOverrides.${ruleId}${tail}` };
}

export type ValueKind = 'tier' | 'number' | 'boolean' | 'stress';

export const METRIC_META: Record<CreditMetric, { label: string; kind: ValueKind; unit?: string }> = {
  'risk.tier': { label: 'Risk tier', kind: 'tier' },
  'risk.score': { label: 'Risk score', kind: 'number' },
  'water.decreeActive': { label: 'Water-scarcity decree active', kind: 'boolean' },
  'water.snowmeltPct': { label: 'Snowmelt forecast', kind: 'number', unit: '% of normal' },
  'water.stressLevel': { label: 'Water stress', kind: 'stress' },
  'imagery.abandonment': { label: 'Abandonment signal', kind: 'boolean' },
  'events.burnedAreaIntersects': { label: 'Burned area on the orchard', kind: 'boolean' },
};

export const OP_LABELS: Record<CreditOp, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
export const ALL_OPS: CreditOp[] = ['gte', 'gt', 'eq', 'neq', 'lt', 'lte'];
export const opsFor = (kind: ValueKind): CreditOp[] => (kind === 'boolean' ? ['eq', 'neq'] : ALL_OPS);

export const VALUE_OPTIONS: Record<'tier' | 'stress' | 'boolean', { value: string; label: string }[]> = {
  tier: [
    { value: 'normal', label: 'Normal' },
    { value: 'watch', label: 'Watch' },
    { value: 'high', label: 'High stress' },
  ],
  stress: [
    { value: 'none', label: 'None' },
    { value: 'mild', label: 'Mild' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'severe', label: 'Severe' },
  ],
  boolean: [
    { value: 'true', label: 'Yes' },
    { value: 'false', label: 'No' },
  ],
};

export const ACTION_OPTIONS: { value: CreditAction; label: string }[] = [
  { value: 'watch', label: 'Put on watch' },
  { value: 'high', label: 'Mark high stress' },
  { value: 'field_visit', label: 'Schedule a field visit' },
  { value: 'restructure_review', label: 'Open a restructuring review' },
];

/** Converts the select/input text for a condition value to the typed contract value. null when invalid. */
export function coerceConditionValue(kind: ValueKind, raw: string): number | string | boolean | null {
  if (kind === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : null;
  if (kind === 'number') {
    const n = Number(raw.replace(/[,\s]/g, ''));
    return raw.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  const opts = VALUE_OPTIONS[kind].map((o) => o.value);
  return opts.includes(raw) ? raw : null;
}

function valueText(c: Pick<CreditCondition, 'metric' | 'value'>): string {
  const meta = METRIC_META[c.metric];
  if (meta.kind === 'boolean') return c.value === true ? 'yes' : 'no';
  if (meta.kind === 'tier' || meta.kind === 'stress') return VALUE_OPTIONS[meta.kind].find((o) => o.value === c.value)?.label.toLowerCase() ?? String(c.value);
  return `${c.value}${meta.unit ? ` ${meta.unit}` : ''}`;
}

/** 'Risk tier ≥ high stress within 60 days before an installment'. */
export function describeCondition(c: CreditCondition): string {
  const meta = METRIC_META[c.metric];
  const base =
    meta.kind === 'boolean' && c.op === 'eq'
      ? c.value === true
        ? meta.label
        : `No ${meta.label.charAt(0).toLowerCase()}${meta.label.slice(1)}`
      : `${meta.label} ${OP_LABELS[c.op]} ${valueText(c)}`;
  const within = c.withinDaysBeforeInstallment ? ` within ${c.withinDaysBeforeInstallment} days before an installment` : '';
  return `${base}${within}`;
}

/** Full rule condition including `and` conditions. */
export function describeRule(r: Pick<CreditRule, 'when'>): string {
  const parts = [describeCondition(r.when), ...(r.when.and ?? []).map(describeCondition)];
  return parts.join(' and ');
}

/** A new portfolio-level rule (risk score threshold → restructuring review), with an id unused by `taken`. */
export function newPortfolioRule(taken: readonly string[]): CreditRule {
  let n = 1;
  while (taken.includes(`pf-rule-${n}`)) n++;
  return {
    id: `pf-rule-${n}`,
    name: `Portfolio rule ${n}`,
    enabled: true,
    when: { metric: 'risk.score', op: 'gte', value: 80, withinDaysBeforeInstallment: null, and: null },
    then: 'restructure_review',
    message: 'Risk score 80 or more: open a restructuring review.',
  };
}

/** True when the portfolio has its own copy of the rule (edited template rule or portfolio-only rule). */
export function isPortfolioRule(p: Portfolio, ruleId: string): boolean {
  return (p.creditRules ?? []).some((r) => r.id === ruleId);
}
