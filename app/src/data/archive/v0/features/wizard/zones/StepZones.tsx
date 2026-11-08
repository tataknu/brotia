/** Wizard step 3: zones (named groups of baseline settings and thresholds) and farm assignment. */
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Droplets, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { Farm, Thresholds, Zone } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { THRESHOLD_META, ZONE_COLORS, effectiveThresholds } from '@/domain/defaults';
import { useStore } from '@/state/store';
import { Badge, Button, Card, Field, Input, Select } from '@/shared/ui';
import { hectares } from '@/shared/format';
import { MonthDayInput, NumberInput, Toggle } from './inputs';
import { dominantCrop, farmsPerZone, isOverridden, monthDayLabel, overrideCount, suggestStressWindow, withOverride } from './zoneLogic';

const THRESHOLD_KEYS = Object.keys(THRESHOLD_META) as (keyof Thresholds)[];

function formatThreshold(k: keyof Thresholds, v: number): string {
  const unit = THRESHOLD_META[k].unit;
  if (unit === 'z') return `${v} z`;
  if (unit === '%') return `${v}%`;
  if (unit === 'pctile') return `${v}th pctile`;
  return `${v} ${unit}`;
}

export function StepZones() {
  const draft = useStore((s) => s.draft);
  const addZone = useStore((s) => s.addZone);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const counts = useMemo(() => (draft ? farmsPerZone(draft.farms, draft.zones) : {}), [draft]);
  if (!draft) return null;
  const { zones, farms } = draft;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Zones and baselines</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each farm is compared with its own history for the same time of year. A zone groups farms that share the same settings: how many past seasons
          define normal, when the crop is most vulnerable, and how far from normal counts as stress. Individual farms can override any threshold below.
        </p>
      </div>

      {zones.map((z) => (
        <ZoneCard key={z.id} zone={z} farmsCount={counts[z.id] ?? 0} canDelete={zones.length > 1} farms={farms} autoFocus={z.id === lastAdded} />
      ))}

      <div>
        <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setLastAdded(addZone(`Zone ${zones.length + 1}`))}>
          Add zone
        </Button>
      </div>

      <FarmAssignment farms={farms} zones={zones} />
    </div>
  );
}

function ZoneCard({ zone, farmsCount, canDelete, farms, autoFocus }: { zone: Zone; farmsCount: number; canDelete: boolean; farms: Farm[]; autoFocus: boolean }) {
  const updateZone = useStore((s) => s.updateZone);
  const removeZone = useStore((s) => s.removeZone);
  const crop = dominantCrop(farms, zone.id) ?? 'soy';
  const suggestion = suggestStressWindow(crop);
  const matchesSuggestion = suggestion.start === zone.stressWindow.start && suggestion.end === zone.stressWindow.end;
  const setThreshold = (k: keyof Thresholds, v: number) => updateZone(zone.id, { thresholds: { ...zone.thresholds, [k]: v } });

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: zone.color }} />
          {zone.name.trim() || 'Unnamed zone'}
        </span>
      }
      subtitle={farmsCount === 1 ? '1 farm in this zone' : `${farmsCount} farms in this zone`}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={16} />}
          disabled={!canDelete}
          title={canDelete ? (farmsCount ? 'Its farms move to the first zone' : undefined) : 'A portfolio needs at least one zone'}
          onClick={() => removeZone(zone.id)}
        >
          Delete
        </Button>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Zone name">
          {(id) => <Input id={id} autoFocus={autoFocus} value={zone.name} placeholder="e.g. North lowlands, rainfed" onChange={(e) => updateZone(zone.id, { name: e.target.value })} />}
        </Field>
        <Field label="Color" hint="Used for this zone on maps and charts.">
          <div className="flex flex-wrap gap-2">
            {ZONE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use color ${c}`}
                aria-pressed={zone.color === c}
                onClick={() => updateZone(zone.id, { color: c })}
                className={clsx('h-8 w-8 rounded-full border-2 transition-shadow', zone.color === c ? 'border-ink ring-2 ring-white ring-offset-0' : 'border-transparent hover:border-line')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Baseline length" hint="How many past seasons of this field's own history define normal.">
          {(id) => (
            <div className="flex items-center gap-3">
              <input
                id={id}
                type="range"
                min={3}
                max={10}
                step={1}
                value={zone.baselineYears}
                onChange={(e) => updateZone(zone.id, { baselineYears: Number(e.target.value) })}
                className="h-2 flex-1 cursor-pointer accent-brand"
              />
              <span className="w-20 text-right text-sm font-medium tabular-nums text-ink">{zone.baselineYears} years</span>
            </div>
          )}
        </Field>

        <Field label="Irrigated" hint="Irrigated farms are less exposed to rain shortfalls and dry spells.">
          <div className="flex items-center gap-3">
            <Toggle checked={zone.irrigated} onChange={(v) => updateZone(zone.id, { irrigated: v })} label="Irrigated" />
            <span className="flex items-center gap-1.5 text-sm text-ink">
              {zone.irrigated && <Droplets size={16} className="text-[#3A6EA5]" />}
              {zone.irrigated ? 'Irrigated' : 'Rainfed'}
            </span>
          </div>
        </Field>

        <div className="md:col-span-2">
          <p className="text-sm font-medium text-ink">Stress window</p>
          <p className="mt-0.5 text-xs text-muted">When the crop is most vulnerable, for example flowering and grain fill. Stress inside this window weighs more. It can cross the new year.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <p className="mb-1 text-xs text-muted">From</p>
              <MonthDayInput label="Window start" value={zone.stressWindow.start} onChange={(start) => updateZone(zone.id, { stressWindow: { ...zone.stressWindow, start } })} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">To</p>
              <MonthDayInput label="Window end" value={zone.stressWindow.end} onChange={(end) => updateZone(zone.id, { stressWindow: { ...zone.stressWindow, end } })} />
            </div>
            <Button
              variant="secondary"
              icon={<Sparkles size={16} />}
              disabled={matchesSuggestion}
              onClick={() => updateZone(zone.id, { stressWindow: suggestion })}
              title={`Flowering to grain fill for ${CROPS[crop].label.toLowerCase()} sown around ${monthDayLabel(CROPS[crop].typicalSowMonthDay)}`}
            >
              Use {CROPS[crop].label.toLowerCase()} calendar ({monthDayLabel(suggestion.start)} to {monthDayLabel(suggestion.end)})
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-medium text-ink">Stress thresholds</p>
        <p className="mt-0.5 text-xs text-muted">A farm is flagged when it crosses any of these, measured against its own normal for the date.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {THRESHOLD_KEYS.map((k) => {
            const meta = THRESHOLD_META[k];
            return (
              <Field key={k} label={`${meta.label} (${meta.unit})`} hint={meta.hint}>
                {(id) => <NumberInput id={id} value={zone.thresholds[k]} min={meta.min} max={meta.max} step={meta.step} onCommit={(v) => setThreshold(k, v)} />}
              </Field>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function FarmAssignment({ farms, zones }: { farms: Farm[]; zones: Zone[] }) {
  const updateFarm = useStore((s) => s.updateFarm);
  const [open, setOpen] = useState<string | null>(null);
  const zoneOptions = zones.map((z) => ({ value: z.id, label: z.name.trim() || 'Unnamed zone' }));

  return (
    <Card title="Farm assignment" subtitle="Pick a zone for each farm. Open a farm to override a threshold for that field only." flush>
      {farms.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No farms yet. Go back to Farms to draw them on the map.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="w-10 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Farm</th>
                <th className="px-3 py-2.5 font-medium">Crop</th>
                <th className="px-3 py-2.5 text-right font-medium">Area</th>
                <th className="px-3 py-2.5 font-medium">Zone</th>
                <th className="px-3 py-2.5 font-medium">Thresholds</th>
              </tr>
            </thead>
            <tbody>
              {farms.map((f) => {
                const zone = zones.find((z) => z.id === f.zoneId) ?? zones[0];
                const n = overrideCount(f);
                const isOpen = open === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr className={clsx('border-b border-line last:border-0', isOpen && 'bg-surface/60')}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Close overrides for ${f.name}` : `Open overrides for ${f.name}`}
                          onClick={() => setOpen(isOpen ? null : f.id)}
                          className="rounded-card p-1 text-muted hover:bg-surface hover:text-ink"
                        >
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-ink">{f.name}</td>
                      <td className="px-3 py-2 text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: CROPS[f.crop].color }} />
                          {CROPS[f.crop].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{hectares(f.areaHa)}</td>
                      <td className="min-w-[180px] px-3 py-2">
                        <Select aria-label={`Zone for ${f.name}`} options={zoneOptions} value={zone?.id ?? ''} onChange={(e) => updateFarm(f.id, { zoneId: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpen(isOpen ? null : f.id)} className="hover:opacity-80">
                          {n > 0 ? <Badge tone="info">{n === 1 ? '1 override' : `${n} overrides`}</Badge> : <Badge>Zone defaults</Badge>}
                        </button>
                      </td>
                    </tr>
                    {isOpen && zone && (
                      <tr className="border-b border-line bg-surface/60 last:border-0">
                        <td colSpan={6} className="px-5 pb-5 pt-1">
                          <OverrideEditor farm={f} zone={zone} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OverrideEditor({ farm, zone }: { farm: Farm; zone: Zone }) {
  const updateFarm = useStore((s) => s.updateFarm);
  const eff = effectiveThresholds(farm, zone);
  const setOverride = (k: keyof Thresholds, v: number | undefined) => {
    // Typing the zone's own value back clears the override.
    const value = v !== undefined && v === zone.thresholds[k] ? undefined : v;
    updateFarm(farm.id, { overrides: withOverride(farm.overrides, k, value) });
  };
  const n = overrideCount(farm);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2">
        <p className="text-sm text-muted">
          Thresholds for <span className="font-medium text-ink">{farm.name}</span>. Changed values apply to this farm only; the rest follow {zone.name.trim() || 'its zone'}.
        </p>
        <Button variant="ghost" size="sm" icon={<RotateCcw size={16} />} disabled={n === 0} onClick={() => updateFarm(farm.id, { overrides: undefined })}>
          Reset all
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THRESHOLD_KEYS.map((k) => {
          const meta = THRESHOLD_META[k];
          const over = isOverridden(farm, k);
          return (
            <div key={k} className={clsx('rounded-card border bg-white p-3', over ? 'border-[#3A6EA5]' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {meta.label} <span className="font-normal text-muted">({meta.unit})</span>
                </span>
                {over && <Badge tone="info">Custom</Badge>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <NumberInput
                  ariaLabel={`${meta.label} for ${farm.name}`}
                  value={eff[k]}
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  onCommit={(v) => setOverride(k, v)}
                  className={over ? 'font-semibold' : undefined}
                />
                {over && (
                  <Button variant="ghost" size="sm" aria-label={`Reset ${meta.label} to the zone value`} title="Reset to the zone value" onClick={() => setOverride(k, undefined)}>
                    <RotateCcw size={16} />
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted">Zone value: {formatThreshold(k, zone.thresholds[k])}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default StepZones;
