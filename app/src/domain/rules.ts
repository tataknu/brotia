/**
 * Rules engine mirror for the editors (CONTRACT §E.2–E.4). Pure functions, no React, no leaflet.
 *
 * - Layering: effective leaf = farm.overrides ?? zone.overrides[crop] ?? portfolio.cropOverrides[crop] ?? template.
 *   Merging is per leaf; null/undefined = not set.
 * - Credit rules: template (by id) → portfolio.creditRules (same id replaces, new id appends) →
 *   farm.creditRuleOverrides[id] merged per field (`when` per field).
 * - Stages: current stage per §E.3 (first match wins on overlap; latest start before d on a gap).
 * - Zones: 35 km² circles; a farm uses the nearest shared zone containing its centroid, else auto-<farmId>.
 * - Audit: RuleChange paths are dot paths from the scope root; null newValue deletes the leaf and prunes
 *   empty parents; in portfolio.creditRules the segment after 'creditRules' selects the rule by id.
 *
 * Templates come from GET /crops; they are always passed in, never fetched here.
 */
import { CROP_META, ZONE_RADIUS_M, autoZoneId } from './constants';
import { haversineM } from './geo';
import { monthDay } from './dates';
import type {
  AgentRecommendation,
  AgronomicRules,
  Crop,
  CreditRule,
  CreditRuleOverrides,
  CropTemplate,
  Farm,
  Portfolio,
  RiskWeights,
  RuleChange,
  RulesPatch,
  Stage,
  Zone,
} from './types';

/* ───────────────────────── generic path helpers ───────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSet = (v: unknown) => v !== undefined && v !== null;
/** null/undefined, or an object whose values are all deep-empty. */
export const isDeepEmpty = (v: unknown): boolean => !isSet(v) || (isObj(v) && Object.values(v).every(isDeepEmpty));
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function splitPath(path: string): string[] {
  return path.split('.').filter((s) => s.length > 0);
}

/** Reads a dot path. Arrays of objects with `id` (portfolio.creditRules) are indexed by id. */
export function getAtPath(root: unknown, path: string | string[]): unknown {
  const segs = Array.isArray(path) ? path : splitPath(path);
  let cur: unknown = root;
  for (const s of segs) {
    if (Array.isArray(cur)) cur = cur.find((x) => isObj(x) && x.id === s);
    else if (isObj(cur)) cur = cur[s];
    else return undefined;
  }
  return cur;
}

/**
 * Immutable set at a dot path: creates missing objects; `value` null/undefined deletes the leaf and prunes
 * empty parent objects (never the root's own top-level keys, which are required fields such as
 * Farm.overrides). In arrays (portfolio.creditRules) a segment selects the element by id: setting the whole
 * element upserts it, null removes it.
 */
export function setAtPath<T>(root: T, path: string | string[], value: unknown, opts?: { pruneTopLevel?: boolean }): T {
  const segs = Array.isArray(path) ? path : splitPath(path);
  if (segs.length === 0) return root;
  return setRec(root, segs, value, opts?.pruneTopLevel ? 1 : 0) as T;
}

function setRec(node: unknown, segs: string[], value: unknown, depth: number): unknown {
  const [head, ...rest] = segs;
  const del = !isSet(value);
  if (Array.isArray(node)) {
    const idx = node.findIndex((x) => isObj(x) && x.id === head);
    if (rest.length === 0) {
      if (del) return idx < 0 ? node : node.filter((_, i) => i !== idx);
      if (idx < 0) return [...node, clone(value)];
      return node.map((x, i) => (i === idx ? clone(value) : x));
    }
    if (idx < 0) return node; // cannot edit a leaf of a missing array element
    const child = setRec(node[idx], rest, value, depth + 1);
    return node.map((x, i) => (i === idx ? child : x));
  }
  const obj: Obj = isObj(node) ? { ...node } : {};
  if (rest.length === 0) {
    if (del) delete obj[head];
    else obj[head] = clone(value);
    return obj;
  }
  const child = setRec(obj[head], rest, value, depth + 1);
  // Prune empty objects created or left behind by a delete, below the root's top-level keys.
  if (del && depth >= 1 && isObj(child) && isDeepEmpty(child)) delete obj[head];
  else obj[head] = child;
  return obj;
}

/* ───────────────────────── templates and layering ───────────────────────── */

export type RuleLayer = 'template' | 'crop' | 'zone' | 'farm';

export interface EffectiveRules {
  crop: Crop;
  stages: Stage[];
  rules: AgronomicRules;
  weights: RiskWeights;
}

export function findTemplate(templates: readonly CropTemplate[] | null | undefined, crop: Crop): CropTemplate | undefined {
  return templates?.find((t) => t.crop === crop);
}

/** Value of a RulesPatch-shaped leaf path in a template ('stages.<k>.…' maps onto the stages array). */
export function templateLeaf(template: CropTemplate, path: string): unknown {
  const segs = splitPath(path);
  if (segs[0] === 'stages') {
    const st = template.stages.find((s) => s.key === segs[1]);
    return st ? getAtPath(st, segs.slice(2)) : undefined;
  }
  return getAtPath(template, segs);
}

function applyPatch(eff: EffectiveRules, patch: RulesPatch | null | undefined): void {
  if (!patch) return;
  for (const [key, sp] of Object.entries(patch.stages ?? {})) {
    const st = eff.stages.find((s) => s.key === key);
    if (!st || !sp) continue;
    if (isSet(sp.start)) st.start = sp.start!;
    if (isSet(sp.end)) st.end = sp.end!;
    for (const [p, v] of Object.entries(sp.sensitivity ?? {})) if (typeof v === 'number') (st.sensitivity as Obj)[p] = v;
  }
  const r = patch.rules;
  if (r) {
    for (const [key, th] of Object.entries(r.stages ?? {})) {
      const base = eff.rules.stages[key];
      if (!base || !th) continue;
      for (const [f, v] of Object.entries(th)) if (typeof v === 'number') (base as unknown as Obj)[f] = v;
    }
    if (typeof r.chillHoursMin === 'number') eff.rules.chillHoursMin = r.chillHoursMin;
    if (typeof r.baselineYears === 'number') eff.rules.baselineYears = r.baselineYears;
  }
  for (const [k, v] of Object.entries(patch.weights ?? {})) if (typeof v === 'number') (eff.weights as unknown as Obj)[k] = v;
}

/** Deep-merges patches (least specific first) onto the template, per leaf. */
export function resolveRules(template: CropTemplate, patchesLeastSpecificFirst: (RulesPatch | null | undefined)[]): EffectiveRules {
  const eff: EffectiveRules = {
    crop: template.crop,
    stages: clone(template.stages),
    rules: clone(template.rules),
    weights: clone(template.weights),
  };
  for (const p of patchesLeastSpecificFirst) applyPatch(eff, p);
  return eff;
}

/** The override chain for a farm, most specific first, with layer names. */
function farmChain(portfolio: Portfolio, farm: Farm): { layer: RuleLayer; patch: RulesPatch | null | undefined }[] {
  const zone = portfolio.zones.find((z) => z.id === effectiveZoneId(portfolio, farm));
  return [
    { layer: 'farm', patch: farm.overrides },
    { layer: 'zone', patch: zone?.overrides?.[farm.crop] },
    { layer: 'crop', patch: portfolio.cropOverrides?.[farm.crop] },
  ];
}

function zoneChain(portfolio: Portfolio, zone: Zone | undefined, crop: Crop) {
  return [
    { layer: 'zone' as RuleLayer, patch: zone?.overrides?.[crop] },
    { layer: 'crop' as RuleLayer, patch: portfolio.cropOverrides?.[crop] },
  ];
}

export function effectiveRulesForCrop(portfolio: Portfolio, template: CropTemplate): EffectiveRules {
  return resolveRules(template, [portfolio.cropOverrides?.[template.crop]]);
}

export function effectiveRulesForZone(portfolio: Portfolio, template: CropTemplate, zoneId: string): EffectiveRules {
  const zone = portfolio.zones.find((z) => z.id === zoneId);
  return resolveRules(template, zoneChain(portfolio, zone, template.crop).map((c) => c.patch).reverse());
}

export function effectiveRulesForFarm(portfolio: Portfolio, template: CropTemplate, farm: Farm): EffectiveRules {
  return resolveRules(template, farmChain(portfolio, farm).map((c) => c.patch).reverse());
}

export interface ResolvedLeaf {
  value: unknown;
  /** The layer that set it ('template' = inherited default). The UI marks non-template layers "Custom". */
  layer: RuleLayer;
}

function resolveChain(chain: { layer: RuleLayer; patch: RulesPatch | null | undefined }[], template: CropTemplate | undefined, path: string): ResolvedLeaf {
  for (const c of chain) {
    const v = getAtPath(c.patch, path);
    if (isSet(v)) return { value: v, layer: c.layer };
  }
  return { value: template ? templateLeaf(template, path) : undefined, layer: 'template' };
}

/** Effective value + source layer of an agronomic leaf (RulesPatch path) for a farm. */
export function resolveFarmLeaf(portfolio: Portfolio, template: CropTemplate | undefined, farm: Farm, path: string): ResolvedLeaf {
  return resolveChain(farmChain(portfolio, farm), template, path);
}

/** Effective value + source layer of an agronomic leaf for a zone and crop. */
export function resolveZoneLeaf(portfolio: Portfolio, template: CropTemplate | undefined, zoneId: string, crop: Crop, path: string): ResolvedLeaf {
  const zone = portfolio.zones.find((z) => z.id === zoneId);
  return resolveChain(zoneChain(portfolio, zone, crop), template, path);
}

/** Effective value + source layer of an agronomic leaf at the portfolio-crop level. */
export function resolveCropLeaf(portfolio: Portfolio, template: CropTemplate | undefined, crop: Crop, path: string): ResolvedLeaf {
  return resolveChain([{ layer: 'crop', patch: portfolio.cropOverrides?.[crop] }], template, path);
}

/* ───────────────────────── credit rules ───────────────────────── */

export type CreditRuleSource = 'template' | 'portfolio';

export interface EffectiveCreditRule extends CreditRule {
  /** Where the base rule came from. */
  source: CreditRuleSource;
  /** Fields changed by farm.creditRuleOverrides[id] (e.g. ['when.withinDaysBeforeInstallment']). */
  farmOverridden: string[];
}

/** Template rules → portfolio rules (replace by id / append) → farm overrides per field. Includes disabled rules. */
export function effectiveCreditRules(
  templateRules: readonly CreditRule[],
  portfolioRules: readonly CreditRule[],
  farmOverrides?: CreditRuleOverrides | null,
): EffectiveCreditRule[] {
  const out: EffectiveCreditRule[] = templateRules.map((r) => ({ ...clone(r), source: 'template', farmOverridden: [] }));
  for (const r of portfolioRules) {
    const i = out.findIndex((x) => x.id === r.id);
    const next: EffectiveCreditRule = { ...clone(r), source: 'portfolio', farmOverridden: [] };
    if (i >= 0) out[i] = next;
    else out.push(next);
  }
  for (const rule of out) {
    const ov = farmOverrides?.[rule.id];
    if (!ov) continue;
    if (isSet(ov.enabled)) {
      rule.enabled = ov.enabled!;
      rule.farmOverridden.push('enabled');
    }
    if (isSet(ov.then)) {
      rule.then = ov.then!;
      rule.farmOverridden.push('then');
    }
    if (isSet(ov.message)) {
      rule.message = ov.message!;
      rule.farmOverridden.push('message');
    }
    for (const [k, v] of Object.entries(ov.when ?? {})) {
      if (!isSet(v)) continue;
      (rule.when as unknown as Obj)[k] = clone(v);
      rule.farmOverridden.push(`when.${k}`);
    }
  }
  return out;
}

export function effectiveCreditRulesForFarm(portfolio: Portfolio, template: CropTemplate | undefined, farm: Farm): EffectiveCreditRule[] {
  return effectiveCreditRules(template?.creditRules ?? [], portfolio.creditRules ?? [], farm.creditRuleOverrides);
}

/* ───────────────────────── stages ───────────────────────── */

/** 'MM-DD' with 29 Feb folded to 28 Feb. */
function md(iso: string): string {
  const m = monthDay(iso);
  return m === '02-29' ? '02-28' : m;
}

export function inWindow(mmdd: string, start: string, end: string): boolean {
  return start <= end ? mmdd >= start && mmdd <= end : mmdd >= start || mmdd <= end;
}

export interface CurrentStage {
  stage: Stage;
  /** true when the date fell in no window (gap): the stage with the latest start before it was used. */
  gap: boolean;
  /** true when more than one window contains the date (the first in order was used). */
  overlap: boolean;
}

/** Current stage at an ISO date (CONTRACT §E.3). null only when `stages` is empty. */
export function currentStage(stages: readonly Stage[], dateISO: string): CurrentStage | null {
  if (stages.length === 0) return null;
  const d = md(dateISO);
  const hits = stages.filter((s) => inWindow(d, s.start, s.end));
  if (hits.length > 0) return { stage: hits[0], gap: false, overlap: hits.length > 1 };
  const before = stages.filter((s) => s.start <= d).sort((a, b) => b.start.localeCompare(a.start));
  const wrap = [...stages].sort((a, b) => b.start.localeCompare(a.start));
  return { stage: before[0] ?? wrap[0], gap: true, overlap: false };
}

const NON_LEAP_DAYS: string[] = (() => {
  const out: string[] = [];
  for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2026, 0, 1); t += 86_400_000) out.push(new Date(t).toISOString().slice(5, 10));
  return out;
})();

/** Checks that stage windows tile the year: lists uncovered and multiply covered 'MM-DD' days. */
export function checkStageTiling(stages: readonly Pick<Stage, 'start' | 'end'>[]): { gaps: string[]; overlaps: string[] } {
  const gaps: string[] = [];
  const overlaps: string[] = [];
  for (const d of NON_LEAP_DAYS) {
    const n = stages.filter((s) => inWindow(d, s.start, s.end)).length;
    if (n === 0) gaps.push(d);
    else if (n > 1) overlaps.push(d);
  }
  return { gaps, overlaps };
}

/* ───────────────────────── zones ───────────────────────── */

/** Effective zone id for a centroid (CONTRACT §E.4): nearest containing shared zone, tie → smallest id; else auto. */
export function assignZoneId(farmId: string, centroid: [number, number], zones: readonly Zone[]): string {
  let best: { id: string; d: number } | null = null;
  for (const z of zones) {
    if (z.auto) continue;
    const d = haversineM(centroid, z.center);
    if (d > z.radiusM) continue;
    if (!best || d < best.d || (d === best.d && z.id < best.id)) best = { id: z.id, d };
  }
  return best ? best.id : autoZoneId(farmId);
}

export function effectiveZoneId(portfolio: Pick<Portfolio, 'zones'>, farm: Pick<Farm, 'id' | 'centroid'>): string {
  return assignZoneId(farm.id, farm.centroid, portfolio.zones);
}

export function makeAutoZone(farm: Pick<Farm, 'id' | 'name' | 'centroid'>): Zone {
  return {
    id: autoZoneId(farm.id),
    name: `${farm.name} (own zone)`,
    center: [farm.centroid[0], farm.centroid[1]],
    radiusM: ZONE_RADIUS_M,
    auto: true,
    overrides: {},
    color: null,
  };
}

export function makeSharedZone(id: string, name: string, center: [number, number], color?: string | null): Zone {
  return { id, name, center: [center[0], center[1]], radiusM: ZONE_RADIUS_M, auto: false, overrides: {}, color: color ?? null };
}

/**
 * Re-applies the zone rule to a portfolio:
 * - every farm has an auto zone centred on its centroid (created if missing, re-centred if the farm moved;
 *   its overrides are kept even while a shared zone covers the farm);
 * - auto zones of deleted farms are removed;
 * - every Farm.zoneId is the effective zone (§E.4).
 * Returns the same object when nothing changed.
 */
export function syncZones(portfolio: Portfolio): Portfolio {
  const farmIds = new Set(portfolio.farms.map((f) => f.id));
  let changed = false;
  const zones: Zone[] = [];
  for (const z of portfolio.zones) {
    if (z.auto) {
      const farmId = z.id.startsWith('auto-') ? z.id.slice(5) : '';
      const farm = portfolio.farms.find((f) => f.id === farmId);
      if (!farm || !farmIds.has(farmId)) {
        changed = true;
        continue;
      }
      if (z.center[0] !== farm.centroid[0] || z.center[1] !== farm.centroid[1]) {
        zones.push({ ...z, center: [farm.centroid[0], farm.centroid[1]] });
        changed = true;
        continue;
      }
    }
    zones.push(z);
  }
  for (const f of portfolio.farms) {
    if (!zones.some((z) => z.id === autoZoneId(f.id))) {
      zones.push(makeAutoZone(f));
      changed = true;
    }
  }
  const farms = portfolio.farms.map((f) => {
    const zoneId = assignZoneId(f.id, f.centroid, zones);
    if (zoneId === f.zoneId) return f;
    changed = true;
    return { ...f, zoneId };
  });
  return changed ? { ...portfolio, zones, farms } : portfolio;
}

/** Zones worth drawing: every shared zone plus the auto zones that are some farm's effective zone. */
export function activeZones(portfolio: Portfolio): Zone[] {
  const used = new Set(portfolio.farms.map((f) => effectiveZoneId(portfolio, f)));
  return portfolio.zones.filter((z) => !z.auto || used.has(z.id));
}

export function farmsInZone(portfolio: Portfolio, zoneId: string): Farm[] {
  return portfolio.farms.filter((f) => effectiveZoneId(portfolio, f) === zoneId);
}

/** Zone colour: its own, else the colour of its single crop, else brand green. */
export function zoneColor(portfolio: Portfolio, zone: Zone): string {
  if (zone.color) return zone.color;
  const crops = new Set(farmsInZone(portfolio, zone.id).map((f) => f.crop));
  if (crops.size === 1) return CROP_META[[...crops][0]].color;
  return '#1F6B43';
}

/* ───────────────────────── audit trail ───────────────────────── */

export type ChangeScope = RuleChange['scope'];
export type Actor = RuleChange['actor'];

/** The object a change path is relative to (CONTRACT §E.2 table). */
export function scopeRoot(portfolio: Portfolio, scope: ChangeScope): unknown {
  switch (scope.level) {
    case 'crop':
      return portfolio.cropOverrides?.[scope.id as Crop] ?? {};
    case 'zone':
      return portfolio.zones.find((z) => z.id === scope.id);
    case 'farm':
      return portfolio.farms.find((f) => f.id === scope.id);
    case 'portfolio':
      return portfolio;
  }
}

/**
 * Effective value at a change path before the change (RuleChange.oldValue). May be inherited.
 * Agronomic leaves resolve through the layers; credit-rule paths through the credit-rule merge; anything
 * else is the raw value at the path.
 */
export function effectiveValueAt(portfolio: Portfolio, templates: readonly CropTemplate[] | null | undefined, scope: ChangeScope, path: string): unknown {
  const segs = splitPath(path);
  const rest = segs.slice(1).join('.');
  switch (scope.level) {
    case 'crop': {
      const crop = scope.id as Crop;
      return resolveCropLeaf(portfolio, findTemplate(templates, crop), crop, path).value;
    }
    case 'zone': {
      if (segs[0] === 'overrides' && segs.length >= 3) {
        const crop = segs[1] as Crop;
        return resolveZoneLeaf(portfolio, findTemplate(templates, crop), scope.id, crop, segs.slice(2).join('.')).value;
      }
      return getAtPath(scopeRoot(portfolio, scope), segs);
    }
    case 'farm': {
      const farm = portfolio.farms.find((f) => f.id === scope.id);
      if (!farm) return undefined;
      const template = findTemplate(templates, farm.crop);
      if (segs[0] === 'overrides' && segs.length >= 2) return resolveFarmLeaf(portfolio, template, farm, rest).value;
      if (segs[0] === 'creditRuleOverrides' && segs.length >= 2) {
        const rule = effectiveCreditRulesForFarm(portfolio, template, farm).find((r) => r.id === segs[1]);
        if (!rule) return undefined;
        const { source: _s, farmOverridden: _f, ...plain } = rule;
        return segs.length === 2 ? plain : getAtPath(plain, segs.slice(2));
      }
      if (segs[0] === 'covered' && !isSet(farm.covered)) return template?.coveredDefault ?? null;
      return getAtPath(farm, segs);
    }
    case 'portfolio': {
      if (segs[0] === 'creditRules' && segs.length >= 2) {
        const own = portfolio.creditRules.find((r) => r.id === segs[1]);
        const fromTemplate = templates?.flatMap((t) => t.creditRules).find((r) => r.id === segs[1]);
        const rule = own ?? fromTemplate;
        if (!rule) return undefined;
        return segs.length === 2 ? rule : getAtPath(rule, segs.slice(2));
      }
      return getAtPath(portfolio, segs);
    }
  }
}

/** Applies a change's newValue to its scope root. Does not touch the audit. Proposed/dismissed changes are no-ops. */
export function applyChange(portfolio: Portfolio, change: RuleChange, templates?: readonly CropTemplate[] | null): Portfolio {
  if (change.status !== 'applied') return portfolio;
  const { level, id } = change.scope;
  const segs = splitPath(change.path);
  switch (level) {
    case 'crop': {
      const crop = id as Crop;
      const next = setAtPath((portfolio.cropOverrides?.[crop] ?? {}) as RulesPatch, segs, change.newValue, { pruneTopLevel: true });
      const cropOverrides = { ...portfolio.cropOverrides };
      if (isDeepEmpty(next)) delete cropOverrides[crop];
      else cropOverrides[crop] = next;
      return { ...portfolio, cropOverrides };
    }
    case 'zone':
      if (!portfolio.zones.some((z) => z.id === id)) return portfolio;
      return { ...portfolio, zones: portfolio.zones.map((z) => (z.id === id ? setAtPath(z, segs, change.newValue) : z)) };
    case 'farm':
      if (!portfolio.farms.some((f) => f.id === id)) return portfolio;
      return { ...portfolio, farms: portfolio.farms.map((f) => (f.id === id ? setAtPath(f, segs, change.newValue) : f)) };
    case 'portfolio': {
      let p = portfolio;
      // Editing one field of an inherited template rule at portfolio level: seed the rule from the template first.
      if (segs[0] === 'creditRules' && segs.length > 2 && !p.creditRules.some((r) => r.id === segs[1])) {
        const seed = templates?.flatMap((t) => t.creditRules).find((r) => r.id === segs[1]);
        if (!seed) return portfolio;
        p = { ...p, creditRules: [...p.creditRules, clone(seed)] };
      }
      return setAtPath(p, segs, change.newValue);
    }
  }
}

let changeCounter = 0;
export function newChangeId(now: Date = new Date()): string {
  changeCounter += 1;
  return `chg-${now.getTime().toString(36)}-${changeCounter.toString(36)}`;
}

export interface ChangeInput {
  scope: ChangeScope;
  path: string;
  /** null = remove the override (reset to inherited). */
  newValue: unknown;
  reason: string;
  actor: Actor;
  status?: RuleChange['status'];
  recommendationId?: string | null;
}

/** Builds a RuleChange with oldValue = the effective value now. */
export function makeChange(
  portfolio: Portfolio,
  templates: readonly CropTemplate[] | null | undefined,
  input: ChangeInput,
  opts?: { now?: Date; id?: string },
): RuleChange {
  const now = opts?.now ?? new Date();
  const old = effectiveValueAt(portfolio, templates, input.scope, input.path);
  return {
    id: opts?.id ?? newChangeId(now),
    at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    actor: { ...input.actor },
    scope: { ...input.scope },
    path: input.path,
    oldValue: old === undefined ? null : clone(old),
    newValue: input.newValue === undefined ? null : clone(input.newValue),
    reason: input.reason,
    status: input.status ?? 'applied',
    recommendationId: input.recommendationId ?? null,
  };
}

/** Applies (when status is 'applied') and appends to portfolio.audit (append-only). */
export function commitChange(portfolio: Portfolio, change: RuleChange, templates?: readonly CropTemplate[] | null): Portfolio {
  const applied = applyChange(portfolio, change, templates);
  return { ...applied, audit: [...(applied.audit ?? []), change] };
}

const sameTarget = (a: RuleChange, b: Pick<RuleChange, 'scope' | 'path'>) =>
  a.scope.level === b.scope.level && a.scope.id === b.scope.id && a.path === b.path;

/** Value the layer itself held before `change` (null = it held nothing, i.e. the value was inherited). */
export function rawValueBefore(portfolio: Portfolio, templates: readonly CropTemplate[] | null | undefined, change: RuleChange): unknown {
  const idx = portfolio.audit.findIndex((c) => c.id === change.id);
  const earlier = (idx >= 0 ? portfolio.audit.slice(0, idx) : portfolio.audit).filter((c) => c.status === 'applied' && sameTarget(c, change));
  if (earlier.length > 0) return earlier[earlier.length - 1].newValue;
  // No recorded earlier edit: if the old value equals what this layer inherits now, the layer was unset.
  const without = applyChange(portfolio, { ...change, status: 'applied', newValue: null }, templates);
  const inherited = effectiveValueAt(without, templates, change.scope, change.path);
  return JSON.stringify(inherited ?? null) === JSON.stringify(change.oldValue ?? null) ? null : change.oldValue;
}

/**
 * Builds the change that reverts `changeId`: same scope/path, newValue = the layer's raw value before it
 * (null → reset to inherited). Commit it with commitChange.
 */
export function makeRevert(
  portfolio: Portfolio,
  templates: readonly CropTemplate[] | null | undefined,
  changeId: string,
  actor: Actor,
  opts?: { now?: Date; reason?: string },
): RuleChange | null {
  const target = portfolio.audit.find((c) => c.id === changeId);
  if (!target || target.status !== 'applied') return null;
  return makeChange(
    portfolio,
    templates,
    {
      scope: target.scope,
      path: target.path,
      newValue: rawValueBefore(portfolio, templates, target),
      reason: opts?.reason ?? `Revert ${target.id}: ${target.reason}`,
      actor,
    },
    { now: opts?.now },
  );
}

/* ───────────────────────── agent proposals ───────────────────────── */

export type ProposalState = 'proposed' | 'applied' | 'dismissed';

/** A proposal's state, read from the audit (an applied/dismissed copy carries recommendationId). */
export function proposalState(portfolio: Portfolio, rec: Pick<AgentRecommendation, 'id'>, proposal: RuleChange): ProposalState {
  const hit = [...portfolio.audit].reverse().find((c) => c.recommendationId === rec.id && sameTarget(c, proposal) && c.status !== 'proposed');
  return hit ? (hit.status as ProposalState) : 'proposed';
}

/** Applied copy of an agent proposal: actor = the user, same path/newValue, recommendationId set. */
export function makeProposalDecision(
  portfolio: Portfolio,
  templates: readonly CropTemplate[] | null | undefined,
  rec: Pick<AgentRecommendation, 'id'>,
  proposal: RuleChange,
  decision: 'applied' | 'dismissed',
  user: Actor,
  opts?: { now?: Date },
): RuleChange {
  return makeChange(
    portfolio,
    templates,
    {
      scope: proposal.scope,
      path: proposal.path,
      newValue: proposal.newValue,
      reason: proposal.reason,
      actor: user,
      status: decision,
      recommendationId: rec.id,
    },
    { now: opts?.now },
  );
}
