/**
 * Credit rules editor: portfolio level (template rules + the lender's own) and per-farm overrides.
 * Every edit is one audited RuleChange. Farm overrides merge per field (CONTRACT §E.2).
 */
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { effectiveCreditRules, effectiveCreditRulesForFarm, findTemplate, type EffectiveCreditRule } from '@/domain/rules';
import type { CreditAction, CreditMetric, CreditOp, CreditRule, CropTemplate, Portfolio } from '@/domain/types';
import { Badge, Button, Input, Select } from '@/shared/ui';
import { DRAFT, useStore } from '@/state/store';
import { CommitNumberInput, CustomMarker, Toggle } from '../common/inputs';
import {
  ACTION_OPTIONS,
  METRIC_META,
  OP_LABELS,
  VALUE_OPTIONS,
  coerceConditionValue,
  creditChange,
  describeCondition,
  isPortfolioRule,
  newPortfolioRule,
  opsFor,
  portfolioCreditRules,
  templateCreditRules,
  type CreditField,
} from './rulesModel';

const METRIC_OPTIONS = (Object.keys(METRIC_META) as CreditMetric[]).map((m) => ({ value: m, label: METRIC_META[m].label }));

function defaultValueFor(metric: CreditMetric): number | string | boolean {
  const kind = METRIC_META[metric].kind;
  if (kind === 'boolean') return true;
  if (kind === 'tier') return 'high';
  if (kind === 'stress') return 'moderate';
  return metric === 'water.snowmeltPct' ? 70 : 80;
}

const actionLabel = (a: CreditAction) => ACTION_OPTIONS.find((o) => o.value === a)?.label ?? a;

export function CreditRulesEditor({
  portfolio,
  templates,
  level,
  farmId,
  reason,
}: {
  portfolio: Portfolio;
  templates: CropTemplate[] | null;
  level: 'portfolio' | 'farm';
  farmId?: string | null;
  reason: string;
}) {
  const applyRuleChange = useStore((s) => s.applyRuleChange);
  const farm = level === 'farm' ? portfolio.farms.find((f) => f.id === farmId) : undefined;
  const template = farm ? findTemplate(templates, farm.crop) : undefined;
  const templateIds = useMemo(() => new Set(templateCreditRules(templates).map((r) => r.id)), [templates]);

  const rules: EffectiveCreditRule[] = useMemo(() => {
    if (level === 'portfolio') return portfolioCreditRules(portfolio, templates);
    if (!farm) return [];
    return effectiveCreditRulesForFarm(portfolio, template, farm);
  }, [level, portfolio, templates, farm, template]);

  // Farm level: what each rule would be without the farm's overrides.
  const inheritedById = useMemo(() => {
    if (level !== 'farm' || !farm) return new Map<string, CreditRule>();
    return new Map(effectiveCreditRules(template?.creditRules ?? [], portfolio.creditRules ?? []).map((r) => [r.id, r]));
  }, [level, farm, template, portfolio.creditRules]);

  const commit = (ruleId: string, field: CreditField | 'when' | 'name' | 'message' | null, newValue: unknown) => {
    const { scope, path } =
      field === 'when' || field === 'name' || field === 'message'
        ? (() => {
            const c = creditChange(portfolio, level, farm?.id ?? '', ruleId, null);
            return { scope: c.scope, path: `${c.path}.${field}` };
          })()
        : creditChange(portfolio, level, farm?.id ?? '', ruleId, field);
    applyRuleChange(DRAFT, { scope, path, newValue, reason: reason.trim() }, templates);
  };

  if (level === 'farm' && !farm) return <p className="text-sm text-muted">Pick a farm to see its credit rules.</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {level === 'portfolio'
          ? 'A rule turns a condition into an action on the loan. Rules here apply to every farm unless a farm overrides them.'
          : `Overrides for ${farm?.name}. Values set here apply to this farm only; reset to go back to the portfolio rule.`}
      </p>
      {rules.length === 0 && <p className="text-sm text-muted">No credit rules yet.</p>}
      {rules.map((r) => {
        const fromTemplate = templateIds.has(r.id);
        const own = level === 'portfolio' && isPortfolioRule(portfolio, r.id);
        const inherited = inheritedById.get(r.id);
        const farmCustom = (field: string) => level === 'farm' && r.farmOverridden.includes(field);
        const marker = (field: string, text: string) =>
          farmCustom(field) ? <CustomMarker onReset={() => commit(r.id, field as CreditField, null)} inheritedText={`Portfolio: ${text}`} /> : null;
        const kind = METRIC_META[r.when.metric].kind;
        const editableShape = level === 'portfolio' && own && !fromTemplate;
        return (
          <article key={r.id} className={clsx('rounded-card border bg-white', r.enabled ? 'border-line' : 'border-dashed border-line opacity-80')}>
            <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <Toggle checked={r.enabled} label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`} onChange={(v) => commit(r.id, 'enabled', v)} />
              {editableShape ? (
                <RuleTextInput ariaLabel="Rule name" value={r.name} onCommit={(v) => commit(r.id, 'name', v)} className="min-w-0 flex-1" />
              ) : (
                <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.name}</h4>
              )}
              {marker('enabled', inherited?.enabled ? 'on' : 'off')}
              {level === 'portfolio' &&
                (own && fromTemplate ? (
                  <CustomMarker onReset={() => commit(r.id, null, null)} inheritedText="edited crop template rule" resetLabel={`Reset ${r.name} to the crop template`} />
                ) : own ? (
                  <>
                    <Badge tone="info">Portfolio rule</Badge>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${r.name}`} title="Remove rule" onClick={() => commit(r.id, null, null)}>
                      <Trash2 size={16} />
                    </Button>
                  </>
                ) : (
                  <Badge>Crop template</Badge>
                ))}
            </header>
            <div className="flex flex-col gap-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span className="text-muted">When</span>
                {editableShape ? (
                  <Select
                    aria-label="Metric"
                    className="w-60"
                    options={METRIC_OPTIONS}
                    value={r.when.metric}
                    onChange={(e) => {
                      const metric = e.target.value as CreditMetric;
                      const op: CreditOp = METRIC_META[metric].kind === 'boolean' ? 'eq' : r.when.op;
                      commit(r.id, 'when', { ...r.when, metric, op, value: defaultValueFor(metric) });
                    }}
                  />
                ) : (
                  <span className="font-medium">{METRIC_META[r.when.metric].label}</span>
                )}
                <Select
                  aria-label="Comparison"
                  className="w-20"
                  options={opsFor(kind).map((o) => ({ value: o, label: OP_LABELS[o] }))}
                  value={r.when.op}
                  onChange={(e) => commit(r.id, 'when.op', e.target.value as CreditOp)}
                />
                {kind === 'number' ? (
                  <div className="w-24">
                    <CommitNumberInput
                      ariaLabel="Threshold"
                      value={typeof r.when.value === 'number' ? r.when.value : null}
                      step={1}
                      onCommit={(n) => n !== null && commit(r.id, 'when.value', n)}
                    />
                  </div>
                ) : (
                  <Select
                    aria-label="Value"
                    className="w-36"
                    options={VALUE_OPTIONS[kind]}
                    value={String(r.when.value)}
                    onChange={(e) => {
                      const v = coerceConditionValue(kind, e.target.value);
                      if (v !== null) commit(r.id, 'when.value', v);
                    }}
                  />
                )}
                {METRIC_META[r.when.metric].unit && <span className="text-muted">{METRIC_META[r.when.metric].unit}</span>}
                {marker('when.op', inherited ? OP_LABELS[inherited.when.op] : '')}
                {marker('when.value', inherited ? String(inherited.when.value) : '')}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span className="text-muted">Only within</span>
                <div className="w-20">
                  <CommitNumberInput
                    ariaLabel="Days before an installment"
                    value={r.when.withinDaysBeforeInstallment ?? null}
                    min={1}
                    max={730}
                    step={1}
                    allowEmpty
                    placeholder="any"
                    onCommit={(n) => commit(r.id, 'when.withinDaysBeforeInstallment', n === null ? null : Math.round(n))}
                  />
                </div>
                <span className="text-muted">days before an installment</span>
                {marker('when.withinDaysBeforeInstallment', inherited?.when.withinDaysBeforeInstallment ? `${inherited.when.withinDaysBeforeInstallment} days` : 'any time')}
              </div>
              {(r.when.and ?? []).map((c, i) => (
                <p key={i} className="text-sm text-muted">
                  and {describeCondition(c)}
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span className="text-muted">Then</span>
                <Select aria-label="Action" className="w-60" options={ACTION_OPTIONS} value={r.then} onChange={(e) => commit(r.id, 'then', e.target.value as CreditAction)} />
                {marker('then', inherited ? actionLabel(inherited.then) : '')}
              </div>
              {editableShape ? (
                <RuleTextInput ariaLabel="Message to the lender" value={r.message} onCommit={(v) => commit(r.id, 'message', v)} />
              ) : (
                <p className="text-xs text-muted">{r.message}</p>
              )}
            </div>
          </article>
        );
      })}
      {level === 'portfolio' && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => {
              const rule = newPortfolioRule(rules.map((x) => x.id));
              commit(rule.id, null, rule);
            }}
          >
            Add rule
          </Button>
        </div>
      )}
    </div>
  );
}

function RuleTextInput({ value, onCommit, ariaLabel, className }: { value: string; onCommit: (v: string) => void; ariaLabel: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      aria-label={ariaLabel}
      value={text}
      className={className}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text.trim() !== value) onCommit(text.trim());
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
