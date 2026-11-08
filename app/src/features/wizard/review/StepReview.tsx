/** Wizard step 5: read-only summary (farms, zones, overrides, credit, audit) before the portfolio is created. */
import clsx from 'clsx';
import { AlertCircle, AlertTriangle, Bot, CheckCircle2, Info, Pencil, User } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import { COUNTRIES_FALLBACK, CROP_META } from '@/domain/constants';
import { activeZones, effectiveZoneId, zoneColor } from '@/domain/rules';
import { todayUTC } from '@/domain/dates';
import { SCHEDULE_LABELS } from '@/domain/schedule';
import { useCountries } from '@/data/hooks';
import { useStore } from '@/state/store';
import { Badge, Button, Card, CropPill, DataTierPill, Stat } from '@/shared/ui';
import { BaseMap, ZoneCircle } from '@/shared/map';
import { date, hectares, money, number, timestampUTC } from '@/shared/format';
import { useTemplates } from '../common/templates';
import { FarmShape } from '../farms/FarmShape';
import { zonesFitGeo, zoneAreaKm2 } from '../zones/zoneLogic';
import { auditActorText, changeLabel, loanTotals, overrideEntries, reviewIssues, valueText, zoneSummary, type IssueLevel } from './reviewLogic';

const ISSUE_STYLE: Record<IssueLevel, { icon: typeof Info; cls: string }> = {
  error: { icon: AlertCircle, cls: 'bg-danger-soft text-danger' },
  warning: { icon: AlertTriangle, cls: 'bg-warn-soft text-warn' },
  info: { icon: Info, cls: 'bg-surface text-muted' },
};

const LEVEL_LABEL = { crop: 'Crop', zone: 'Zone', farm: 'Farm', portfolio: 'Portfolio' } as const;

/** Turns the preview map into a static picture (no pan or zoom gestures). */
function StaticMap() {
  const map = useMap();
  useEffect(() => {
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoom.disable();
    map.zoomControl?.remove();
  }, [map]);
  return null;
}

function EditLink({ step, label }: { step: number; label: string }) {
  const setWizardStep = useStore((s) => s.setWizardStep);
  return (
    <Button variant="ghost" size="sm" icon={<Pencil size={16} />} onClick={() => setWizardStep(step)} aria-label={`Edit ${label}`}>
      Edit
    </Button>
  );
}

export function StepReview() {
  const draft = useStore((s) => s.draft);
  const { byCrop } = useTemplates();
  const { data: countryList } = useCountries();
  const asOf = useMemo(() => todayUTC(), []);
  const country = useMemo(() => (countryList ?? COUNTRIES_FALLBACK).find((c) => c.code === draft?.country), [countryList, draft?.country]);
  const fit = useMemo(() => (draft ? zonesFitGeo(draft) : null), [draft]);
  const issues = useMemo(() => (draft ? reviewIssues(draft, byCrop, { country }) : []), [draft, byCrop, country]);
  const totals = useMemo(() => (draft ? loanTotals(draft, asOf) : null), [draft, asOf]);
  const overrides = useMemo(() => (draft ? overrideEntries(draft, byCrop) : []), [draft, byCrop]);
  const zones = useMemo(() => (draft ? zoneSummary(draft) : []), [draft]);
  if (!draft || !totals) return null;

  const { farms, currency } = draft;
  const zoneById = new Map(draft.zones.map((z) => [z.id, z]));
  const totalArea = farms.reduce((s, f) => s + f.areaHa, 0);
  const blocking = issues.filter((i) => i.level === 'error');
  const audit = [...draft.audit].reverse();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Review</h2>
        <p className="mt-1 text-sm text-muted">Check the portfolio before creating it. You can jump back to any step to make changes.</p>
      </div>

      {blocking.length === 0 && (
        <div className="flex items-start gap-2 rounded-card bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>Everything needed is in place. Create the portfolio to see which loans are under climate stress, why, and how much money is exposed.</span>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Things to check">
          {issues.map((i) => {
            const { icon: Icon, cls } = ISSUE_STYLE[i.level];
            return (
              <li key={i.text} className={clsx('flex items-start gap-2 rounded-card px-4 py-2.5 text-sm', cls)}>
                <Icon size={16} className="mt-0.5 shrink-0" />
                <span>{i.text}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Farms" value={`${farms.length}`} sub={hectares(totalArea)} />
        <Stat label="Lent" value={money(totals.lent, currency)} sub={`${totals.farmsWithLoan} of ${farms.length} farms`} />
        <Stat label="Outstanding today" value={money(totals.outstanding, currency)} sub={`as of ${date(asOf)}`} />
        <Stat label="Rule changes" value={`${draft.audit.length}`} sub={`${overrides.length} custom ${overrides.length === 1 ? 'value' : 'values'}`} />
      </div>

      <Card title="Portfolio" actions={<EditLink step={0} label="portfolio details" />}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Name</dt>
            <dd className="font-medium text-ink">{draft.name || '–'}</dd>
          </div>
          <div>
            <dt className="text-muted">Lender</dt>
            <dd className="font-medium text-ink">{draft.lender || '–'}</dd>
          </div>
          <div>
            <dt className="text-muted">Country</dt>
            <dd className="flex items-center gap-2 font-medium text-ink">
              {country?.name ?? draft.country} {country && <DataTierPill tier={country.dataTier} />}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Currency</dt>
            <dd className="font-medium text-ink">{currency}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Farms and loans" actions={<EditLink step={1} label="farms" />} flush>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-4 py-2 font-medium">Farm</th>
                  <th className="px-4 py-2 font-medium">Zone</th>
                  <th className="px-4 py-2 text-right font-medium">Loan</th>
                  <th className="px-4 py-2 font-medium">Next installment</th>
                </tr>
              </thead>
              <tbody>
                {farms.map((f) => {
                  const z = zoneById.get(effectiveZoneId(draft, f));
                  const next = totals.upcoming.find((u) => u.farm.id === f.id);
                  return (
                    <tr key={f.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <p className="font-medium text-ink">{f.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <CropPill crop={f.crop} /> {hectares(f.areaHa)}
                          {f.ciren && <span>· CIREN {f.ciren.objectId}</span>}
                          {f.covered === true && <span>· covered</span>}
                          {f.plantingYear && <span>· planted {f.plantingYear}</span>}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-muted">{z ? (z.auto ? 'Own zone' : z.name) : '–'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {f.loan ? (
                          <>
                            <p className="font-medium text-ink">{money(f.loan.amount, currency)}</p>
                            <p className="text-xs text-muted">{SCHEDULE_LABELS[f.loan.scheduleType]}</p>
                          </>
                        ) : (
                          <Badge tone="danger">No loan</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted">
                        {next ? `${date(next.installment.dueDate)} · ${money(next.installment.amount, currency, { compact: true })}` : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="h-64 border-t border-line lg:h-auto lg:min-h-[260px] lg:border-l lg:border-t-0">
            <BaseMap fitTo={fit} fitPadding={16} labels={false} scrollWheelZoom={false}>
              <StaticMap />
              {activeZones(draft).map((z) => (
                <ZoneCircle key={z.id} zone={z} color={zoneColor(draft, z)} interactive={false} label={null} />
              ))}
              {farms.map((f) => (
                <FarmShape key={f.id} farm={f} selected={false} interactive={false} />
              ))}
            </BaseMap>
          </div>
        </div>
      </Card>

      <Card title="Zones" subtitle="Each farm uses its own 35 km² zone unless it sits inside a shared zone." actions={<EditLink step={2} label="zones" />}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {zones.map((z) => (
            <li key={z.id} className="rounded-card border border-line px-3 py-2 text-sm">
              <p className="flex items-center gap-2 font-medium text-ink">
                {z.name}
                <Badge tone={z.shared ? 'info' : 'neutral'}>{z.shared ? 'Shared' : 'Own zone'}</Badge>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {number(zoneAreaKm2(z.radiusM), 1)} km² · {z.farms.length === 1 ? '1 farm' : `${z.farms.length} farms`}
                {z.overrides > 0 && ` · ${z.overrides} custom ${z.overrides === 1 ? 'value' : 'values'}`}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Custom rules" subtitle="Values set above the crop templates. Everything else uses the template defaults." actions={<EditLink step={2} label="rules" />}>
        {overrides.length === 0 ? (
          <p className="text-sm text-muted">None. Every farm uses its crop template.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-3 font-medium">Level</th>
                <th className="py-2 pr-3 font-medium">Applies to</th>
                <th className="py-2 pr-3 font-medium">Setting</th>
                <th className="py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={`${o.level}:${o.target}:${o.path}`} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-muted">{LEVEL_LABEL[o.level]}</td>
                  <td className="py-2 pr-3 text-ink">{o.target}</td>
                  <td className="py-2 pr-3 text-ink">{o.label}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{valueText(o.value, o.path)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Audit trail" subtitle="Every rule change, who made it and why. Kept with the portfolio." actions={<EditLink step={2} label="rules" />}>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">No changes recorded.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {audit.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2 text-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                  {c.actor.kind === 'agent' || c.recommendationId ? <Bot size={14} /> : <User size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    <span className="font-medium">{scopeName(draft, c.scope)}</span> · {changeLabel(draft, c, byCrop)}:{' '}
                    <span className="tabular-nums text-muted">{valueText(c.oldValue, c.path)}</span> → <span className="tabular-nums font-medium">{valueText(c.newValue, c.path)}</span>
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
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function scopeName(p: { zones: { id: string; name: string }[]; farms: { id: string; name: string }[]; name: string }, scope: { level: string; id: string }): string {
  switch (scope.level) {
    case 'crop':
      return `All ${CROP_META[scope.id as keyof typeof CROP_META]?.label.toLowerCase() ?? scope.id} farms`;
    case 'zone':
      return p.zones.find((z) => z.id === scope.id)?.name ?? scope.id;
    case 'farm':
      return p.farms.find((f) => f.id === scope.id)?.name ?? scope.id;
    default:
      return 'Portfolio';
  }
}

export default StepReview;
