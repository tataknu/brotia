/**
 * Layered agronomic rules editor (crop template → portfolio crop → zone → farm), grouped by stage.
 * Every edit is one audited RuleChange (applyRuleChange); "Custom" marks values set at the edited level,
 * and reset records a change with newValue null (back to the inherited value).
 */
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { checkStageTiling, currentStage } from '@/domain/rules';
import { todayUTC } from '@/domain/dates';
import { PERILS, type CropTemplate, type Portfolio } from '@/domain/types';
import { PERIL_LABELS } from '@/shared/format';
import { Badge } from '@/shared/ui';
import { DRAFT, useStore } from '@/state/store';
import { CommitNumberInput, CustomMarker, MonthDayInput } from '../common/inputs';
import { monthDayLabel } from '../common/parse';
import {
  CROP_FIELDS,
  LAYER_LABELS,
  THRESHOLD_FIELDS,
  WEIGHT_FIELDS,
  leafChange,
  leafView,
  sensitivityPath,
  targetRules,
  thresholdPath,
  windowPath,
  type NumField,
  type RuleTarget,
} from './rulesModel';

function fmtValue(v: unknown, unit = ''): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number') return `${String(v).replace('-', '−')}${unit ? ` ${unit}` : ''}`;
  return String(v);
}

export function RulesEditor({
  portfolio,
  templates,
  template,
  target,
  reason,
}: {
  portfolio: Portfolio;
  templates: CropTemplate[] | null;
  template: CropTemplate;
  target: RuleTarget;
  reason: string;
}) {
  const applyRuleChange = useStore((s) => s.applyRuleChange);
  const eff = useMemo(() => targetRules(portfolio, template, target), [portfolio, template, target]);
  const today = useMemo(() => todayUTC(), []);
  const now = useMemo(() => currentStage(eff.stages, today), [eff.stages, today]);
  const tiling = useMemo(() => checkStageTiling(eff.stages), [eff.stages]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const commit = (leaf: string, newValue: unknown) => {
    const { scope, path } = leafChange(portfolio, target, leaf);
    applyRuleChange(DRAFT, { scope, path, newValue, reason: reason.trim() }, templates);
  };

  const row = (leaf: string, f: Pick<NumField, 'label' | 'unit' | 'step' | 'min' | 'max'>) => {
    const v = leafView(portfolio, template, target, leaf);
    return (
      <RuleRow
        key={leaf}
        label={f.label}
        unit={f.unit}
        status={
          v.custom ? (
            <CustomMarker
              onReset={() => commit(leaf, null)}
              inheritedText={`${LAYER_LABELS[v.inherited.layer]}: ${fmtValue(v.inherited.value, f.unit)}`}
              resetLabel={`Reset ${f.label.toLowerCase()} to ${fmtValue(v.inherited.value, f.unit)}`}
            />
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
          onCommit={(n) => n !== null && commit(leaf, n)}
          className={clsx(v.custom && 'border-[#2F5C8C]/50')}
        />
      </RuleRow>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {template.approximate && (
        <p className="flex items-start gap-2 rounded-card bg-surface px-3 py-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          Stage windows and thresholds are approximate expert defaults for central Chile. Adjust them to the variety and site.
        </p>
      )}

      <section className="rounded-card border border-line">
        <h4 className="border-b border-line px-3 py-2 text-sm font-semibold text-ink">Whole season</h4>
        <div className="divide-y divide-line">
          {CROP_FIELDS.map((f) => row(f.key, f))}
          {WEIGHT_FIELDS.map((f) => row(f.key, f))}
        </div>
      </section>

      {(tiling.gaps.length > 0 || tiling.overlaps.length > 0) && (
        <p className="rounded-card bg-warn-soft px-3 py-2 text-xs text-warn">
          The stage windows no longer cover the year exactly
          {tiling.gaps.length > 0 && `: ${tiling.gaps.length} days are in no stage (from ${monthDayLabel(tiling.gaps[0])})`}
          {tiling.overlaps.length > 0 && `${tiling.gaps.length ? ';' : ':'} ${tiling.overlaps.length} days are in two stages (from ${monthDayLabel(tiling.overlaps[0])})`}. The
          service uses the first matching stage on overlaps and the previous stage on gaps.
        </p>
      )}

      {eff.stages.map((st) => {
        const isNow = now?.stage.key === st.key;
        const expanded = !!open[st.key];
        const startV = leafView(portfolio, template, target, windowPath(st.key, 'start'));
        const endV = leafView(portfolio, template, target, windowPath(st.key, 'end'));
        const sensCustom = PERILS.filter((p) => leafView(portfolio, template, target, sensitivityPath(st.key, p)).custom).length;
        return (
          <section key={st.key} className={clsx('rounded-card border', isNow ? 'border-brand/40' : 'border-line')}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <h4 className="text-sm font-semibold text-ink">{st.label}</h4>
              <span className="text-xs tabular-nums text-muted">
                {monthDayLabel(st.start)} – {monthDayLabel(st.end)}
              </span>
              {isNow && <Badge tone="brand">Current stage</Badge>}
              {(startV.custom || endV.custom || sensCustom > 0) && <Badge tone="info">Custom window or sensitivity</Badge>}
            </div>
            <div className="divide-y divide-line">{THRESHOLD_FIELDS.map((f) => row(thresholdPath(st.key, f.key), f))}</div>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [st.key]: !o[st.key] }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-1.5 border-t border-line px-3 py-2 text-left text-xs font-medium text-muted hover:bg-surface hover:text-ink"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Stage window and sensitivity to each peril
            </button>
            {expanded && (
              <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {(['start', 'end'] as const).map((edge) => {
                    const v = edge === 'start' ? startV : endV;
                    const leaf = windowPath(st.key, edge);
                    return (
                      <div key={edge} className="flex items-center gap-2">
                        <span className="text-sm text-ink">{edge === 'start' ? 'Starts' : 'Ends'}</span>
                        <MonthDayInput ariaLabel={`${st.label} ${edge}`} value={String(v.value ?? '')} onCommit={(md) => commit(leaf, md)} />
                        {v.custom && (
                          <CustomMarker
                            onReset={() => commit(leaf, null)}
                            inheritedText={`${LAYER_LABELS[v.inherited.layer]}: ${monthDayLabel(String(v.inherited.value ?? ''))}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted">Sensitivity 0 to 1: how much a peril at full severity hurts this stage. 0 turns the peril off.</p>
                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  {PERILS.map((peril) => {
                    const leaf = sensitivityPath(st.key, peril);
                    const v = leafView(portfolio, template, target, leaf);
                    return (
                      <div key={peril} className="flex items-center justify-between gap-2 py-1">
                        <span className="min-w-0 truncate text-sm text-ink">{PERIL_LABELS[peril]}</span>
                        <span className="flex items-center gap-1">
                          {v.custom && <CustomMarker onReset={() => commit(leaf, null)} resetLabel={`Reset to ${fmtValue(v.inherited.value)}`} />}
                          <span className="inline-block w-20">
                          <CommitNumberInput
                            ariaLabel={`${st.label} sensitivity to ${PERIL_LABELS[peril]}`}
                            value={typeof v.value === 'number' ? v.value : null}
                            step={0.05}
                            min={0}
                            max={1}
                            onCommit={(n) => n !== null && commit(leaf, n)}
                          />
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
      {template.sources.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Sources of the crop template</summary>
          <ul className="mt-1 list-disc pl-5">
            {template.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RuleRow({ label, unit, status, children }: { label: string; unit: string; status: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
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
