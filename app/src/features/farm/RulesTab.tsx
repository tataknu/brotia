/**
 * Rules tab: the effective agronomic and credit rules for this farm, where each value comes from
 * (crop template → portfolio crop setting → zone → farm), farm-level edit and reset, and the audit trail.
 *
 * Reuses the wizard's rule model (leafView / leafChange / creditChange, field definitions, input controls) and the
 * store's audited actions on the SAVED portfolio (applyRuleChange / revertChange with the portfolio id). The wizard
 * editors themselves are not reused: they always write to the wizard draft.
 */
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Bot, Info, Undo2, User } from 'lucide-react';
import { currentStage, effectiveCreditRulesForFarm, effectiveZoneId, findTemplate } from '@/domain/rules';
import { CROP_META } from '@/domain/constants';
import { todayUTC } from '@/domain/dates';
import type { Crop, CropTemplate, Farm, FarmAssessment, Portfolio, RuleChange } from '@/domain/types';
import { useConnection, useCrops } from '@/data/hooks';
import { useStore } from '@/state/store';
import { CREDIT_ACTION_LABELS, timestampUTC } from '@/shared/format';
import { Badge, Card, Input } from '@/shared/ui';
import { CommitNumberInput, CustomMarker, Toggle } from '@/features/wizard/common/inputs';
import { monthDayLabel } from '@/features/wizard/common/parse';
import { CROP_FIELDS, LAYER_LABELS, THRESHOLD_FIELDS, WEIGHT_FIELDS, creditChange, describeRule, leafChange, leafView, targetRules, thresholdPath, type NumField, type RuleTarget } from '@/features/wizard/zones/rulesModel';
import { auditActorText, changeLabel, valueText } from '@/features/wizard/review/reviewLogic';
import { ErrorPanel, Skeleton } from './parts';

function fmtValue(v: unknown, unit = ''): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number') return `${String(v).replace('-', '−')}${unit ? ` ${unit}` : ''}`;
  return String(v);
}

/** Audit entries that change this farm's effective rules: its own, its zone's for its crop, its crop's, and portfolio credit rules. Newest first. */
export function farmAudit(p: Portfolio, farm: Farm): RuleChange[] {
  const zoneId = effectiveZoneId(p, farm);
  return p.audit
    .filter((c) => {
      switch (c.scope.level) {
        case 'farm':
          return c.scope.id === farm.id;
        case 'zone':
          return c.scope.id === zoneId && c.path.startsWith(`overrides.${farm.crop}.`);
        case 'crop':
          return c.scope.id === farm.crop;
        case 'portfolio':
          return c.path.startsWith('creditRules');
      }
    })
    .reverse();
}

function scopeName(p: Portfolio, scope: RuleChange['scope']): string {
  switch (scope.level) {
    case 'crop':
      return `All ${CROP_META[scope.id as Crop]?.label.toLowerCase() ?? scope.id} farms`;
    case 'zone': {
      const z = p.zones.find((x) => x.id === scope.id);
      return z ? (z.auto ? 'This farm’s zone' : `Zone ${z.name}`) : scope.id;
    }
    case 'farm':
      return 'This farm';
    case 'portfolio':
      return 'Whole portfolio';
  }
}

function RuleRow({ label, unit, status, children }: { label: string; unit: string; status: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          {label}
          {unit && <span className="text-muted"> ({unit})</span>}
        </p>
        <div className="mt-0.5">{status}</div>
      </div>
      <div className="w-28 shrink-0">{children}</div>
    </div>
  );
}

function AgronomicRules({
  portfolio,
  farm,
  template,
  asOf,
  canEdit,
  commit,
}: {
  portfolio: Portfolio;
  farm: Farm;
  template: CropTemplate;
  asOf: string;
  canEdit: boolean;
  commit: (leaf: string, value: unknown) => void;
}) {
  const target: RuleTarget = useMemo(() => ({ level: 'farm', farmId: farm.id }), [farm.id]);
  const eff = useMemo(() => targetRules(portfolio, template, target), [portfolio, template, target]);
  const now = useMemo(() => currentStage(eff.stages, asOf), [eff.stages, asOf]);

  const row = (leaf: string, f: Pick<NumField, 'label' | 'unit' | 'step' | 'min' | 'max'>) => {
    const v = leafView(portfolio, template, target, leaf);
    return (
      <RuleRow
        key={leaf}
        label={f.label}
        unit={f.unit}
        status={
          v.custom ? (
            canEdit ? (
              <CustomMarker
                onReset={() => commit(leaf, null)}
                inheritedText={`${LAYER_LABELS[v.inherited.layer]}: ${fmtValue(v.inherited.value, f.unit)}`}
                resetLabel={`Reset ${f.label.toLowerCase()} to ${fmtValue(v.inherited.value, f.unit)}`}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Badge tone="info">Custom</Badge>
                <span className="text-xs text-muted">{`${LAYER_LABELS[v.inherited.layer]}: ${fmtValue(v.inherited.value, f.unit)}`}</span>
              </span>
            )
          ) : (
            <span className="text-xs text-muted">From {LAYER_LABELS[v.layer].toLowerCase()}</span>
          )
        }
      >
        <CommitNumberInput
          ariaLabel={f.label}
          value={typeof v.value === 'number' ? v.value : null}
          step={f.step}
          min={f.min}
          max={f.max}
          disabled={!canEdit}
          onCommit={(n) => n !== null && commit(leaf, n)}
          className={clsx('font-mono tabular-nums', v.custom && 'border-[#2F5C8C]/50')}
        />
      </RuleRow>
    );
  };

  return (
    <div className="space-y-4">
      {template.approximate && (
        <p className="flex items-start gap-2 rounded-card bg-surface px-3 py-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          Stage windows and thresholds are approximate expert defaults. Adjust them to the variety and site.
        </p>
      )}
      <section className="rounded-card border border-line">
        <h4 className="border-b border-line px-4 py-2 text-sm font-semibold text-ink">Whole season</h4>
        <div className="divide-y divide-line">
          {CROP_FIELDS.map((f) => row(f.key, f))}
          {WEIGHT_FIELDS.map((f) => row(f.key, f))}
        </div>
      </section>
      {eff.stages.map((st) => {
        const isNow = now?.stage.key === st.key;
        return (
          <details key={st.key} open={isNow} className={clsx('group rounded-card border', isNow ? 'border-brand/40' : 'border-line')}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 group-open:border-b group-open:border-line">
              <h4 className="text-sm font-semibold text-ink">{st.label}</h4>
              <span className="font-mono text-xs tabular-nums text-muted">
                {monthDayLabel(st.start)} – {monthDayLabel(st.end)}
              </span>
              {isNow && <Badge tone="brand">Current stage</Badge>}
            </summary>
            <div className="divide-y divide-line">{THRESHOLD_FIELDS.map((f) => row(thresholdPath(st.key, f.key), f))}</div>
          </details>
        );
      })}
    </div>
  );
}

function CreditRules({
  portfolio,
  farm,
  template,
  canEdit,
  commit,
}: {
  portfolio: Portfolio;
  farm: Farm;
  template: CropTemplate | undefined;
  canEdit: boolean;
  commit: (scope: Pick<RuleChange, 'scope' | 'path'>, value: unknown) => void;
}) {
  // Same resolution as the service: template → portfolio → farm overrides.
  const rules = useMemo(() => effectiveCreditRulesForFarm(portfolio, template, farm), [portfolio, template, farm]);
  if (rules.length === 0) return <p className="text-sm text-muted">No credit rules apply to this farm.</p>;
  return (
    <div className="relative overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line bg-surface text-left text-xs text-muted">
          <th scope="col" className="px-4 py-2 font-medium">
            Rule
          </th>
          <th scope="col" className="px-4 py-2 font-medium">
            Then
          </th>
          <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
            Source
          </th>
          <th scope="col" className="px-4 py-2 text-right font-medium">
            <span className="sm:hidden">On</span>
            <span className="hidden sm:inline">On for this farm</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rules.map((r) => {
          const enabledOverridden = r.farmOverridden.includes('enabled');
          const set = (v: unknown) => commit(creditChange(portfolio, 'farm', farm.id, r.id, 'enabled'), v);
          return (
            <tr key={r.id} className={clsx(!r.enabled && 'text-muted')}>
              <td className="px-4 py-2 align-top">
                <p className={clsx('font-medium', r.enabled ? 'text-ink' : 'text-muted')}>{r.name}</p>
                <p className="text-xs text-muted">When {describeRule(r)}</p>
                <p className="break-all font-mono text-[11px] text-muted">{r.id}</p>
              </td>
              <td className="px-4 py-2 align-top">{CREDIT_ACTION_LABELS[r.then]}</td>
              <td className="hidden px-4 py-2 align-top text-muted sm:table-cell">
                {r.source === 'template' ? 'Crop template' : 'Portfolio'}
                {r.farmOverridden.length > 0 && (
                  <Badge tone="info" className="ml-1.5">
                    Farm override
                  </Badge>
                )}
              </td>
              <td className="px-4 py-2 align-top">
                <div className="flex items-center justify-end gap-1.5">
                  {enabledOverridden && canEdit && <CustomMarker onReset={() => set(null)} resetLabel={`Reset “${r.name}” to the portfolio setting`} />}
                  <Toggle checked={r.enabled} onChange={(v) => set(v)} label={`${r.name} on for this farm`} disabled={!canEdit} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function AuditTrail({ portfolio, farm, templates, canEdit }: { portfolio: Portfolio; farm: Farm; templates: CropTemplate[] | null; canEdit: boolean }) {
  const revertChange = useStore((s) => s.revertChange);
  const entries = useMemo(() => farmAudit(portfolio, farm), [portfolio, farm]);
  const byCrop = useMemo(() => Object.fromEntries((templates ?? []).map((t) => [t.crop, t])) as Partial<Record<Crop, CropTemplate>>, [templates]);
  // Latest applied change per scope+path: only that one can be reverted (an older one was changed again later).
  const latest = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of portfolio.audit) if (c.status === 'applied') m.set(`${c.scope.level}:${c.scope.id}:${c.path}`, c.id);
    return m;
  }, [portfolio.audit]);

  if (entries.length === 0) return <p className="text-sm text-muted">No rule changes recorded for this farm, its zone or its crop.</p>;
  return (
    <ol className="-my-2 divide-y divide-line">
      {entries.map((c) => {
        const isLatest = latest.get(`${c.scope.level}:${c.scope.id}:${c.path}`) === c.id;
        const canRevert = canEdit && c.status === 'applied' && c.scope.level === 'farm' && isLatest && !!templates;
        return (
          <li key={c.id} className="flex items-start gap-3 py-2 text-sm">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
              {c.actor.kind === 'agent' || c.recommendationId ? <Bot size={14} /> : <User size={14} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink">
                <span className="font-medium">{scopeName(portfolio, c.scope)}</span> · {changeLabel(portfolio, c, byCrop)}:{' '}
                <span className="font-mono tabular-nums text-muted">{valueText(c.oldValue, c.path)}</span> → <span className="font-mono font-medium tabular-nums">{valueText(c.newValue, c.path)}</span>
                {c.status !== 'applied' && (
                  <Badge tone={c.status === 'dismissed' ? 'neutral' : 'warn'} className="ml-2">
                    {c.status === 'dismissed' ? 'Dismissed' : 'Proposed'}
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted">
                {auditActorText(c)} · {timestampUTC(c.at)}
                {c.reason ? ` · “${c.reason}”` : ''}
              </p>
            </div>
            {canRevert && (
              <button
                type="button"
                onClick={() => revertChange(portfolio.id, c.id, templates)}
                className="inline-flex shrink-0 items-center gap-1 rounded-card px-2 py-1 text-xs font-medium text-ink hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <Undo2 size={14} />
                Revert
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RulesTab({ portfolio, farm, assessment }: { portfolio: Portfolio; farm: Farm; assessment: FarmAssessment | undefined }) {
  const crops = useCrops();
  const templates = crops.data ?? null;
  const template = findTemplate(templates, farm.crop);
  const applyRuleChange = useStore((s) => s.applyRuleChange);
  const { mode } = useConnection();
  const [reason, setReason] = useState('');
  // Offline, the snapshot only holds assessments for the saved rules: an edit could not be re-assessed.
  const canEdit = mode !== 'snapshot' && !!templates;
  const asOf = assessment?.asOf ?? todayUTC();

  const commitChange = ({ scope, path }: Pick<RuleChange, 'scope' | 'path'>, newValue: unknown) =>
    applyRuleChange(portfolio.id, { scope, path, newValue, reason: reason.trim() }, templates);
  const commitLeaf = (leaf: string, newValue: unknown) => commitChange(leafChange(portfolio, { level: 'farm', farmId: farm.id }, leaf), newValue);

  return (
    <div className="space-y-6">
      <Card title="Credit rules" subtitle="What this loan triggers. Turning a rule off here applies to this farm only." flush>
        <CreditRules portfolio={portfolio} farm={farm} template={template} canEdit={canEdit} commit={commitChange} />
      </Card>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
        <Card
          title="Agronomic rules for this farm"
          subtitle="Each value comes from the crop template, the portfolio's crop setting, the zone or this farm. Edits here apply to this farm only and re-run its assessment."
        >
          <div className="mb-4">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for your changes (optional, saved in the audit trail)"
              aria-label="Reason for your changes"
              disabled={!canEdit}
            />
            {mode === 'snapshot' && <p className="mt-2 text-xs text-warn">Offline snapshot: rules are read-only until the service is back.</p>}
          </div>
          {template ? (
            <AgronomicRules portfolio={portfolio} farm={farm} template={template} asOf={asOf} canEdit={canEdit} commit={commitLeaf} />
          ) : crops.error ? (
            <ErrorPanel error={crops.error} onRetry={crops.refetch} what="Crop templates" />
          ) : (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          )}
        </Card>
        <Card title="Audit trail" subtitle="Changes that affect this farm, newest first. Changes made on this farm can be reverted here.">
          <AuditTrail portfolio={portfolio} farm={farm} templates={templates} canEdit={canEdit} />
        </Card>
      </div>
    </div>
  );
}
