/** Risk breakdown: formula, C/D/G bars with weights, top drivers with provenance, credit actions (CONTRACT §E.1, §E.7). */
import { useState } from 'react';
import clsx from 'clsx';
import { BellRing, ChevronDown, ChevronRight } from 'lucide-react';
import type { Driver, Risk, RiskComponent } from '@/domain/types';
import { COMPONENT_COLORS, PERIL_COLORS } from '@/shared/chartColors';
import { COMPONENT_LABELS, CREDIT_ACTION_LABELS, PERIL_LABELS, TIER_LABELS, number } from '@/shared/format';
import { Badge, Card, ProvenanceBadge, TierBadge } from '@/shared/ui';
import { driverValue, tierRaised } from './farmData';

const COMPONENT_LETTER = { climate: 'C', disaster: 'D', geography: 'G' } as const;
const WEIGHT_OF = { climate: 'a', disaster: 'b', geography: 'c' } as const;
const COMPONENT_HINT = {
  climate: 'Frost, heat, harvest rain, water, chill, vigour, abandonment, weighted by the current stage.',
  disaster: 'Burned area, floods, official scarcity or emergency declarations.',
  geography: 'Frost pocket, fire recurrence, basin water security. Amplifies; never acts alone.',
} as const;

export function DriverRow({ d, showComponent }: { d: Driver; showComponent?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PERIL_COLORS[d.peril] }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-ink">{PERIL_LABELS[d.peril]}</span>
          {showComponent && <Badge>{COMPONENT_LABELS[d.component]}</Badge>}
          <ProvenanceBadge provenance={d.provenance} title={`${PERIL_LABELS[d.peril]}: ${d.metric}`} />
        </div>
        <p className="mt-0.5 text-sm text-ink">{d.text}</p>
        <p className="mt-0.5 text-xs tabular-nums text-muted">
          Value {driverValue(d.value, d.unit)} · compared with {driverValue(d.normal, d.unit)} · severity {number(d.severity, 2)}
          {d.sensitivity !== null ? ` × stage sensitivity ${number(d.sensitivity, 2)}` : ''} = impact {number(d.impact, 2)}
        </p>
      </div>
    </li>
  );
}

function ComponentBar({ comp, weight }: { comp: RiskComponent; weight: number }) {
  const [open, setOpen] = useState(false);
  const color = COMPONENT_COLORS[comp.key];
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full rounded-card text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            {open ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
            {COMPONENT_LABELS[comp.key]} ({COMPONENT_LETTER[comp.key]})
          </span>
          <span className="tabular-nums text-ink">
            {number(comp.value, 2)} <span className="text-muted">· weight {WEIGHT_OF[comp.key]} = {number(weight, 2)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={comp.value} aria-label={COMPONENT_LABELS[comp.key]}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, comp.value * 100)}%`, backgroundColor: color }} />
        </div>
        <p className="mt-1 text-xs text-muted">{COMPONENT_HINT[comp.key]}</p>
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-line rounded-card border border-line px-3">
          {comp.drivers.length === 0 && <li className="py-2.5 text-sm text-muted">No drivers evaluated.</li>}
          {comp.drivers.map((d) => (
            <DriverRow key={`${d.metric}-${d.peril}`} d={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function RiskCard({ risk }: { risk: Risk }) {
  const comps = [risk.components.climate, risk.components.disaster, risk.components.geography];
  const raised = tierRaised(risk);
  return (
    <Card
      title="Why this score"
      subtitle={`Stage now: ${risk.stage.label}. Weights and thresholds are approximate expert defaults.`}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold tabular-nums text-ink">{number(risk.score, 1)}</span>
          <TierBadge tier={risk.tier} />
        </div>
      }
    >
      <div className="space-y-5">
        {raised && (
          <p className="rounded-card bg-warn-soft px-3 py-2 text-sm text-warn">
            The score alone reads {TIER_LABELS[risk.scoreTier].toLowerCase()}; a credit rule raised this loan to {TIER_LABELS[risk.tier].toLowerCase()}.
          </p>
        )}
        <div className="space-y-4">
          {comps.map((c) => (
            <ComponentBar key={c.key} comp={c} weight={risk.weights[WEIGHT_OF[c.key]]} />
          ))}
        </div>

        <div>
          <p className="text-sm font-medium text-ink">Formula</p>
          <p className="mt-1 text-xs text-muted">base = 0.5·(a·C + b·D)/(a + b) + 0.5·max(C, D); risk = 100·min(1, base·(1 + c·G))</p>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-card bg-surface px-3 py-2 font-mono text-xs text-ink">{risk.formula}</pre>
        </div>

        <div>
          <p className="text-sm font-medium text-ink">Top drivers</p>
          {risk.drivers.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No driver has any impact at this stage.</p>
          ) : (
            <ul className="divide-y divide-line">
              {risk.drivers.map((d) => (
                <DriverRow key={`${d.component}-${d.metric}-${d.peril}`} d={d} showComponent />
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink">Credit actions triggered</p>
          {risk.creditActions.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No credit rule fired for this loan.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {risk.creditActions.map((a) => (
                <li key={a.ruleId} className={clsx('flex items-start gap-2.5 rounded-card border px-3 py-2', a.action === 'high' || a.action === 'restructure_review' ? 'border-danger/30 bg-danger-soft' : 'border-warn/30 bg-warn-soft')}>
                  <BellRing size={16} className={clsx('mt-0.5 shrink-0', a.action === 'high' || a.action === 'restructure_review' ? 'text-danger' : 'text-warn')} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {CREDIT_ACTION_LABELS[a.action]} <span className="font-mono text-xs font-normal text-muted">{a.ruleId}</span>
                    </p>
                    <p className="text-sm text-ink">{a.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
