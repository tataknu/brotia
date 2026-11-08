/** Pure review helpers (node-tested): loan totals, issues, overrides and audit rows. */
import { outstandingAt, nextInstallment } from '@/domain/schedule';
import { CROP_META } from '@/domain/constants';
import { effectiveZoneId } from '@/domain/rules';
import { daysBetween } from '@/domain/dates';
import type { CreditMetric, Crop, CropTemplate, Farm, Installment, Peril, Portfolio, RuleChange } from '@/domain/types';
import { PERIL_LABELS } from '@/shared/format';
import { CROP_FIELDS, METRIC_META, THRESHOLD_FIELDS, WEIGHT_FIELDS } from '../zones/rulesModel';

export function loanTotals(p: Portfolio, asOf: string) {
  const withLoan = p.farms.filter((f) => f.loan);
  const lent = round2(withLoan.reduce((s, f) => s + (f.loan?.amount ?? 0), 0));
  const outstanding = round2(withLoan.reduce((s, f) => s + (f.loan ? outstandingAt(f.loan, asOf) : 0), 0));
  const upcoming: { farm: Farm; installment: Installment; days: number }[] = [];
  for (const f of withLoan) {
    const next = f.loan ? nextInstallment(f.loan, asOf) : null;
    if (next) upcoming.push({ farm: f, installment: next, days: daysBetween(asOf, next.dueDate) });
  }
  upcoming.sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate));
  return { farmsWithLoan: withLoan.length, lent, outstanding, upcoming };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  text: string;
}

/** Things to check before creating the portfolio. Errors block (they mirror the step gates). */
export function reviewIssues(p: Portfolio, byCrop: Partial<Record<Crop, CropTemplate>>, opts?: { country?: { name: string; dataTier: string } }): Issue[] {
  const out: Issue[] = [];
  if (!p.name.trim()) out.push({ level: 'error', text: 'The portfolio has no name.' });
  if (p.farms.length === 0) out.push({ level: 'error', text: 'Add at least one farm.' });
  const noLoan = p.farms.filter((f) => !f.loan);
  if (noLoan.length) out.push({ level: 'error', text: `${noLoan.length === 1 ? '1 farm has' : `${noLoan.length} farms have`} no loan: ${noLoan.map((f) => f.name).join(', ')}.` });
  const coverUnknown = p.farms.filter((f) => (f.covered === null || f.covered === undefined) && byCrop[f.crop]?.coverLikelihood === 'often');
  if (coverUnknown.length)
    out.push({
      level: 'warning',
      text: `${coverUnknown.map((f) => f.name).join(', ')}: ${coverUnknown.length === 1 ? 'this crop is' : 'these crops are'} often under covers or nets. Say whether ${coverUnknown.length === 1 ? 'it is' : 'they are'} in the Farms step, or vegetation readings may be misread.`,
    });
  const drawn = p.farms.filter((f) => !f.ciren);
  if (p.country === 'CL' && drawn.length)
    out.push({
      level: 'info',
      text: `${drawn.length === 1 ? '1 farm was' : `${drawn.length} farms were`} drawn by hand. Peer comparison still uses nearby CIREN orchards of the same crop.`,
    });
  if (opts?.country && opts.country.dataTier === 'standard')
    out.push({ level: 'info', text: `${opts.country.name} uses the standard data tier: global sources only; Chile-only signals will show as not available.` });
  if (!p.audit.length) out.push({ level: 'info', text: 'No rule changes: every farm uses its crop template defaults.' });
  return out;
}

/* ───────────────────────── overrides ───────────────────────── */

export interface OverrideEntry {
  level: 'crop' | 'zone' | 'farm' | 'portfolio';
  /** Display name of what was overridden (crop, zone or farm name). */
  target: string;
  /** Leaf path from the scope root. */
  path: string;
  label: string;
  value: unknown;
}

/** Leaf paths of an object (arrays are leaves). */
export function flattenLeaves(v: unknown, prefix = ''): { path: string; value: unknown }[] {
  if (v === null || v === undefined) return [];
  if (typeof v !== 'object' || Array.isArray(v)) return prefix ? [{ path: prefix, value: v }] : [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flattenLeaves(x, prefix ? `${prefix}.${k}` : k));
}

function stageLabel(template: CropTemplate | undefined, key: string): string {
  return template?.stages.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ');
}

/** Plain-language label of a RulesPatch leaf path ('rules.stages.bloom.frostCriticalC' → 'Bloom: frost damage starts …'). */
export function leafLabel(path: string, template?: CropTemplate): string {
  const s = path.split('.');
  if (s[0] === 'rules' && s[1] === 'stages' && s.length === 4) {
    const f = THRESHOLD_FIELDS.find((x) => x.key === s[3]);
    return `${stageLabel(template, s[2])}: ${f ? f.label.charAt(0).toLowerCase() + f.label.slice(1) : s[3]}`;
  }
  if (s[0] === 'stages' && s.length === 3) return `${stageLabel(template, s[1])}: stage ${s[2] === 'start' ? 'starts' : 'ends'}`;
  if (s[0] === 'stages' && s[2] === 'sensitivity' && s.length === 4)
    return `${stageLabel(template, s[1])}: sensitivity to ${(PERIL_LABELS[s[3] as Peril] ?? s[3]).toLowerCase()}`;
  const f = [...CROP_FIELDS, ...WEIGHT_FIELDS].find((x) => x.key === path);
  if (f) return f.label;
  return path;
}

/** Plain-language label of any RuleChange path at its scope. */
export function changeLabel(p: Portfolio, c: Pick<RuleChange, 'scope' | 'path'>, byCrop: Partial<Record<Crop, CropTemplate>>): string {
  const s = c.path.split('.');
  switch (c.scope.level) {
    case 'crop':
      return leafLabel(c.path, byCrop[c.scope.id as Crop]);
    case 'zone':
      if (s[0] === 'overrides' && s.length > 2) return `${CROP_META[s[1] as Crop]?.label ?? s[1]}, ${leafLabel(s.slice(2).join('.'), byCrop[s[1] as Crop])}`;
      return c.path;
    case 'farm': {
      const farm = p.farms.find((f) => f.id === c.scope.id);
      if (s[0] === 'overrides') return leafLabel(s.slice(1).join('.'), farm ? byCrop[farm.crop] : undefined);
      if (s[0] === 'creditRuleOverrides') return `Credit rule ${s[1]}: ${creditFieldLabel(s.slice(2).join('.'))}`;
      if (c.path === 'covered') return 'Covers or nets';
      if (c.path === 'irrigatedDeclared') return 'Irrigation declared';
      return c.path;
    }
    case 'portfolio':
      if (s[0] === 'creditRules') return s.length === 2 ? `Credit rule ${s[1]}` : `Credit rule ${s[1]}: ${creditFieldLabel(s.slice(2).join('.'))}`;
      return c.path;
  }
}

function creditFieldLabel(field: string): string {
  switch (field) {
    case 'enabled':
      return 'on/off';
    case 'then':
      return 'action';
    case 'when.op':
      return 'comparison';
    case 'when.value':
      return 'threshold';
    case 'when.withinDaysBeforeInstallment':
      return 'days before an installment';
    case 'when':
      return 'condition';
    case '':
      return 'whole rule';
    default:
      return field;
  }
}

/** Display text for an audit value (null = inherited / removed). */
export function valueText(v: unknown, path = ''): string {
  if (v === null || v === undefined) return 'inherited';
  if (typeof v === 'boolean') {
    if (path.endsWith('covered')) return v ? 'covered' : 'open';
    if (path.endsWith('irrigatedDeclared')) return v ? 'irrigated' : 'rain-fed';
    if (path.endsWith('enabled')) return v ? 'on' : 'off';
    return v ? 'yes' : 'no';
  }
  if (typeof v === 'number') return String(v).replace('-', '−');
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'when' in (v as object) && 'name' in (v as object)) {
    const r = v as { name: string; when: { metric: CreditMetric } };
    return `rule “${r.name}” (${METRIC_META[r.when.metric]?.label ?? r.when.metric})`;
  }
  return JSON.stringify(v);
}

/** Every value set above the crop template: portfolio crop, zone and farm overrides, credit-rule edits. */
export function overrideEntries(p: Portfolio, byCrop: Partial<Record<Crop, CropTemplate>>): OverrideEntry[] {
  const out: OverrideEntry[] = [];
  for (const [crop, patch] of Object.entries(p.cropOverrides ?? {})) {
    for (const l of flattenLeaves(patch))
      out.push({ level: 'crop', target: `All ${CROP_META[crop as Crop].label.toLowerCase()} farms`, path: l.path, label: leafLabel(l.path, byCrop[crop as Crop]), value: l.value });
  }
  for (const z of p.zones) {
    for (const [crop, patch] of Object.entries(z.overrides ?? {})) {
      for (const l of flattenLeaves(patch))
        out.push({
          level: 'zone',
          target: z.name,
          path: `overrides.${crop}.${l.path}`,
          label: `${CROP_META[crop as Crop].label}, ${leafLabel(l.path, byCrop[crop as Crop])}`,
          value: l.value,
        });
    }
  }
  for (const f of p.farms) {
    for (const l of flattenLeaves(f.overrides)) out.push({ level: 'farm', target: f.name, path: `overrides.${l.path}`, label: leafLabel(l.path, byCrop[f.crop]), value: l.value });
    for (const l of flattenLeaves(f.creditRuleOverrides)) {
      const path = `creditRuleOverrides.${l.path}`;
      out.push({ level: 'farm', target: f.name, path, label: changeLabel(p, { scope: { level: 'farm', id: f.id }, path }, byCrop), value: l.value });
    }
  }
  for (const r of p.creditRules ?? []) {
    out.push({ level: 'portfolio', target: 'Whole portfolio', path: `creditRules.${r.id}`, label: `Credit rule “${r.name}”`, value: r.enabled ? 'on' : 'off' });
  }
  return out;
}

/** Zone summary rows for the review: zone, kind, farms (effective). Unused auto zones are skipped. */
export function zoneSummary(p: Portfolio): { id: string; name: string; shared: boolean; radiusM: number; farms: Farm[]; overrides: number }[] {
  return p.zones
    .map((z) => ({
      id: z.id,
      name: z.name,
      shared: !z.auto,
      radiusM: z.radiusM,
      farms: p.farms.filter((f) => effectiveZoneId(p, f) === z.id),
      overrides: flattenLeaves(z.overrides).length,
    }))
    .filter((z) => z.shared || z.farms.length > 0);
}


/** Who made an audit entry. An applied agent proposal reads "Proposed by Farming agent · applied by <user>" (ADR-0013 D9). */
export function auditActorText(c: Pick<RuleChange, 'actor' | 'recommendationId' | 'status'>): string {
  if (c.recommendationId && c.actor.kind === 'user') {
    const verb = c.status === 'dismissed' ? 'dismissed' : 'applied';
    return `Proposed by Farming agent · ${verb} by ${c.actor.name}`;
  }
  return c.actor.name;
}
