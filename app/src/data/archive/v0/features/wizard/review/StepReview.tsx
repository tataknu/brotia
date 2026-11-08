/** Wizard step 5: read-only summary before the portfolio is created. The finish button lives in WizardPage. */
import clsx from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, Droplets, Info, Pencil } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Polygon, Tooltip, useMap } from 'react-leaflet';
import type { Thresholds } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { THRESHOLD_META } from '@/domain/defaults';
import { SCHEDULE_LABELS } from '@/domain/schedule';
import { AS_OF } from '@/data/api';
import { useStore } from '@/state/store';
import { Badge, Button, Card, Stat } from '@/shared/ui';
import { BaseMap, farmsFeatureCollection, toLatLngs } from '@/shared/map';
import { date, hectares, money } from '@/shared/format';
import { monthDayLabel, overrideCount } from '../zones/zoneLogic';
import { loanTotals, reviewIssues, type IssueLevel } from './reviewLogic';

const KEY_THRESHOLDS: (keyof Thresholds)[] = ['ndviAnomalyZ', 'rainDeficitPct', 'dryDays', 'heatC', 'frostC', 'flood72hMm'];

const ISSUE_STYLE: Record<IssueLevel, { icon: typeof Info; cls: string }> = {
  error: { icon: AlertCircle, cls: 'bg-danger-soft text-danger' },
  warning: { icon: AlertTriangle, cls: 'bg-warn-soft text-warn' },
  info: { icon: Info, cls: 'bg-surface text-muted' },
};

/** Turns the preview map into a static picture (no pan or zoom gestures). */
function StaticMap() {
  const map = useMap();
  useEffect(() => {
    map.dragging.disable();
    map.doubleClickZoom.disable();
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
  const fit = useMemo(() => farmsFeatureCollection(draft?.farms ?? []), [draft?.farms]);
  const issues = useMemo(() => (draft ? reviewIssues(draft, AS_OF) : []), [draft]);
  const totals = useMemo(() => (draft ? loanTotals(draft, AS_OF) : null), [draft]);
  if (!draft || !totals) return null;

  const { farms, zones, currency } = draft;
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const totalArea = farms.reduce((s, f) => s + f.areaHa, 0);
  const blocking = issues.filter((i) => i.level !== 'info');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Review</h2>
        <p className="mt-1 text-sm text-muted">Check the portfolio before creating it. You can jump back to any step to make changes.</p>
      </div>

      {blocking.length === 0 ? (
        <div className="flex items-start gap-2 rounded-card bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>Everything needed is in place. Create the portfolio to see which loans are under climate stress.</span>
        </div>
      ) : null}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Farms" value={farms.length} sub={hectares(totalArea)} />
        <Stat label="Total lent" value={money(totals.total, currency, { compact: true })} sub={`${totals.count} ${totals.count === 1 ? 'loan' : 'loans'}`} />
        <Stat label="Outstanding today" value={money(totals.outstanding, currency, { compact: true })} sub={`As of ${date(AS_OF)}`} />
        <Stat label="Zones" value={zones.length} sub={`${totals.installments} installments scheduled`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Farms on the map" flush>
          <div className="h-72 overflow-hidden rounded-b-card">
            <BaseMap className="h-full w-full" scrollWheelZoom={false} fitTo={fit}>
              <StaticMap />
              {farms.map((f) => {
                const color = zoneById.get(f.zoneId)?.color ?? '#ffffff';
                return (
                  <Polygon key={f.id} positions={toLatLngs(f.polygon)} pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.3 }}>
                    <Tooltip sticky>{f.name}</Tooltip>
                  </Polygon>
                );
              })}
            </BaseMap>
          </div>
        </Card>

        <Card title="Portfolio" actions={<EditLink step={0} label="portfolio" />}>
          <dl className="space-y-3 text-sm">
            <Row label="Name" value={draft.name.trim() || '–'} />
            <Row label="Lender" value={draft.lender.trim() || '–'} />
            <Row label="Currency" value={currency} />
            <Row label="Loan dates" value={totals.earliestOrigination ? `${date(totals.earliestOrigination, 'month')} to ${date(totals.latestMaturity, 'month')}` : '–'} />
          </dl>
        </Card>
      </div>

      <Card title="Farms" subtitle="Crop, area, zone and loan for each farm." actions={<EditLink step={1} label="farms" />} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="px-5 py-2.5 font-medium">Farm</th>
                <th className="px-3 py-2.5 font-medium">Crop</th>
                <th className="px-3 py-2.5 text-right font-medium">Area</th>
                <th className="px-3 py-2.5 font-medium">Zone</th>
                <th className="px-3 py-2.5 text-right font-medium">Loan</th>
                <th className="px-5 py-2.5 font-medium">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {farms.map((f) => {
                const z = zoneById.get(f.zoneId);
                const n = overrideCount(f);
                return (
                  <tr key={f.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5 font-medium text-ink">{f.name}</td>
                    <td className="px-3 py-2.5 text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: CROPS[f.crop].color }} />
                        {CROPS[f.crop].label}
                      </span>
                      {f.sowingDate && <span className="block text-xs text-muted">Sown {date(f.sowingDate)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{hectares(f.areaHa)}</td>
                    <td className="px-3 py-2.5 text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: z?.color ?? '#999' }} />
                        {z?.name.trim() || 'No zone'}
                      </span>
                      {n > 0 && <span className="block text-xs text-muted">{n === 1 ? '1 custom threshold' : `${n} custom thresholds`}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{f.loan ? money(f.loan.amount, currency) : <Badge tone="danger">Missing</Badge>}</td>
                    <td className="px-5 py-2.5 text-ink">
                      {f.loan ? (
                        <>
                          {SCHEDULE_LABELS[f.loan.scheduleType].replace(/ \(.*\)$/, '')}
                          <span className="block text-xs text-muted">
                            {date(f.loan.originationDate, 'month')} to {date(f.loan.maturityDate, 'month')}
                          </span>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Zones and baselines" actions={<EditLink step={2} label="zones" />}>
          <ul className="flex flex-col gap-4">
            {zones.map((z) => {
              const count = farms.filter((f) => f.zoneId === z.id).length;
              return (
                <li key={z.id} className="rounded-card border border-line p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <span className="h-3 w-3 rounded-full" style={{ background: z.color }} />
                      {z.name.trim() || 'Unnamed zone'}
                    </span>
                    <span className="text-sm text-muted">{count === 1 ? '1 farm' : `${count} farms`}</span>
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{z.baselineYears}-year baseline</span>
                    <span>
                      Stress window {monthDayLabel(z.stressWindow.start)} to {monthDayLabel(z.stressWindow.end)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {z.irrigated && <Droplets size={16} className="text-[#3A6EA5]" />}
                      {z.irrigated ? 'Irrigated' : 'Rainfed'}
                    </span>
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                    {KEY_THRESHOLDS.map((k) => (
                      <div key={k}>
                        <dt className="text-xs text-muted">{THRESHOLD_META[k].label}</dt>
                        <dd className="tabular-nums text-ink">
                          {z.thresholds[k]} {THRESHOLD_META[k].unit}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Loans" actions={<EditLink step={3} label="loans" />}>
          <dl className="space-y-3 text-sm">
            <Row label="Loans entered" value={`${totals.count} of ${farms.length} farms`} />
            <Row label="Total lent" value={money(totals.total, currency)} />
            <Row label={`Outstanding on ${date(AS_OF)}`} value={money(totals.outstanding, currency)} />
          </dl>
          {totals.bySchedule.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">By payment schedule</p>
              <ul className="mt-2 flex flex-col gap-2">
                {totals.bySchedule.map((s) => (
                  <li key={s.type} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink">
                      {SCHEDULE_LABELS[s.type].replace(/ \(.*\)$/, '')} <span className="text-muted">· {s.count === 1 ? '1 loan' : `${s.count} loans`}</span>
                    </span>
                    <span className="tabular-nums text-ink">{money(s.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

export default StepReview;
