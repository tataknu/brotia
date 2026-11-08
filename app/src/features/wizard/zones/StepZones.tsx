/**
 * Wizard step 3: zones and rules.
 * - Map: every farm's own 35 km² zone (dashed) and shared zones (solid). "Add shared zone" then click a centre;
 *   farms whose centroid falls inside move to it (nearest centre wins when shared zones overlap).
 * - Panel tabs: Zones (name, radius, farms), Agronomic rules (crop → zone → farm, grouped by stage),
 *   Credit rules (portfolio level and per-farm overrides). Rule edits are audited.
 */
import clsx from 'clsx';
import { Crosshair, Layers, Loader2, Move, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJsonObject } from 'geojson';
import { activeZones, zoneColor } from '@/domain/rules';
import { CROP_META, ZONE_RADIUS_M } from '@/domain/constants';
import type { Crop, Zone } from '@/domain/types';
import { DRAFT, useStore } from '@/state/store';
import { BaseMap, ZoneCircle } from '@/shared/map';
import { Badge, Button, CropPill, Input, Select } from '@/shared/ui';
import { number } from '@/shared/format';
import { CommitNumberInput, Segmented } from '../common/inputs';
import { useTemplates } from '../common/templates';
import { FarmShape } from '../farms/FarmShape';
import { CreditRulesEditor } from './CreditRulesEditor';
import { RulesEditor } from './RulesEditor';
import { ZoneMapBridge } from './ZoneMapBridge';
import { cropsByPresence, targetCrop, targetLabel, zoneCrops, type RuleTarget } from './rulesModel';
import { RADIUS_LIMITS, zoneAreaKm2, zoneFitGeo, zoneRows, zonesFitGeo } from './zoneLogic';

type Tab = 'zones' | 'rules' | 'credit';
type MapMode = { kind: 'select' } | { kind: 'add' } | { kind: 'move'; zoneId: string };

export function StepZones() {
  const draft = useStore((s) => s.draft);
  const addSharedZone = useStore((s) => s.addSharedZone);
  const updateZone = useStore((s) => s.updateZone);
  const removeZone = useStore((s) => s.removeZone);
  const { templates, byCrop, loading: templatesLoading, error: templatesError } = useTemplates();

  const [tab, setTab] = useState<Tab>('zones');
  const [mode, setMode] = useState<MapMode>({ kind: 'select' });
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const fitCounter = useRef(0);
  const [fitTarget, setFitTarget] = useState<GeoJsonObject | null>(() => (draft ? zonesFitGeo(draft) : null));

  // Rules target
  const [level, setLevel] = useState<RuleTarget['level']>('crop');
  const [ruleCrop, setRuleCrop] = useState<Crop | null>(null);
  const [zoneCrop, setZoneCrop] = useState<Crop | null>(null);
  const [creditLevel, setCreditLevel] = useState<'portfolio' | 'farm'>('portfolio');

  const zones = useMemo(() => (draft ? activeZones(draft) : []), [draft]);
  const rows = useMemo(() => (draft ? zoneRows(draft) : []), [draft]);

  const onPick = useCallback(
    (lngLat: [number, number]) => {
      if (mode.kind === 'add') {
        const id = addSharedZone(DRAFT, lngLat);
        if (id) {
          setSelectedZoneId(id);
          setTab('zones');
        }
      } else if (mode.kind === 'move') {
        updateZone(DRAFT, mode.zoneId, { center: lngLat });
      }
      setMode({ kind: 'select' });
    },
    [mode, addSharedZone, updateZone],
  );

  const selectZone = useCallback((z: Zone) => {
    setSelectedZoneId(z.id);
    setSelectedFarmId(null);
  }, []);
  const selectFarm = useCallback((id: string) => {
    setSelectedFarmId(id);
  }, []);

  // Keep the selection valid when zones/farms disappear.
  useEffect(() => {
    if (selectedZoneId && draft && !draft.zones.some((z) => z.id === selectedZoneId)) setSelectedZoneId(null);
    if (selectedFarmId && draft && !draft.farms.some((f) => f.id === selectedFarmId)) setSelectedFarmId(null);
  }, [draft, selectedZoneId, selectedFarmId]);

  if (!draft) return null;

  // ---- rules target (derived with fallbacks) ----
  const presentCrops = cropsByPresence(draft);
  const crop: Crop = ruleCrop ?? presentCrops[0];
  const zoneId = (selectedZoneId && zones.some((z) => z.id === selectedZoneId) ? selectedZoneId : zones[0]?.id) ?? null;
  const zCrops = zoneId ? zoneCrops(draft, zoneId) : [];
  const zCrop: Crop | null = zoneCrop && zCrops.includes(zoneCrop) ? zoneCrop : (zCrops[0] ?? null);
  const farmId = selectedFarmId ?? draft.farms[0]?.id ?? null;
  const target: RuleTarget | null =
    level === 'crop' ? { level: 'crop', crop } : level === 'zone' ? (zoneId && zCrop ? { level: 'zone', zoneId, crop: zCrop } : null) : farmId ? { level: 'farm', farmId } : null;
  const tCrop = target ? targetCrop(draft, target) : null;
  const template = tCrop ? byCrop[tCrop] : undefined;

  const placing = mode.kind !== 'select';
  const auditCount = draft.audit.filter((c) => c.status === 'applied').length;

  const zoneOptions = zones.map((z) => ({ value: z.id, label: `${z.name}${z.auto ? '' : ' (shared)'}` }));
  const farmOptions = draft.farms.map((f) => ({ value: f.id, label: `${f.name} · ${CROP_META[f.crop].label}` }));

  return (
    <div className="flex flex-col lg:grid lg:h-full lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_480px] lg:grid-rows-[minmax(0,1fr)]">
      {/* Map */}
      <div className="relative h-[55vh] min-h-[340px] lg:h-full lg:min-h-0" data-testid="zones-map">
        <BaseMap fitTo={fitTarget} fitPadding={24}>
          <ZoneMapBridge active={placing} onPick={onPick} onCancel={() => setMode({ kind: 'select' })} />
          {zones.map((z) => (
            <ZoneCircle
              key={`${z.id}:${placing}`}
              zone={z}
              color={zoneColor(draft, z)}
              selected={z.id === selectedZoneId}
              interactive={!placing}
              onClick={placing ? undefined : selectZone}
              label={`${z.name} · ${number(zoneAreaKm2(z.radiusM), 1)} km²`}
            />
          ))}
          {draft.farms.map((f) => (
            <FarmShape key={`${f.id}:${placing}`} farm={f} selected={f.id === selectedFarmId} onSelect={placing ? undefined : selectFarm} interactive={!placing} />
          ))}
        </BaseMap>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-end gap-2 p-3 sm:flex-row sm:items-start sm:justify-end">
          {placing && (
            <div className="pointer-events-auto order-last mr-auto max-w-sm rounded-card border border-line bg-white/95 px-3 py-2 text-sm text-ink shadow-panel sm:order-first sm:ml-12">
              <p className="font-medium">{mode.kind === 'add' ? 'Place a shared zone' : 'Move the zone centre'}</p>
              <p className="text-muted">
                Click the map where the centre should be. Farms whose centre falls inside the {number(zoneAreaKm2(ZONE_RADIUS_M), 0)} km² circle use its settings. Press Esc to
                cancel.
              </p>
            </div>
          )}
          <div className="pointer-events-auto flex gap-2">
            <Button
              variant="secondary"
              icon={<Layers size={16} />}
              className="shadow-panel"
              onClick={() => setFitTarget(zonesFitGeo(draft, ++fitCounter.current))}
              title="Zoom to all zones"
            >
              <span className="hidden sm:inline">Fit to zones</span>
            </Button>
            <Button
              variant={placing ? 'secondary' : 'primary'}
              icon={placing ? <X size={16} /> : <Crosshair size={16} />}
              className="shadow-panel"
              onClick={() => setMode(placing ? { kind: 'select' } : { kind: 'add' })}
            >
              {placing ? 'Cancel' : 'Add shared zone'}
            </Button>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-6 left-3 z-10 rounded-card border border-line bg-white/95 px-3 py-2 text-xs text-muted shadow-panel">
          <p className="flex items-center gap-2">
            <span className="inline-block h-0 w-6 border-t-2 border-dashed border-brand" /> Farm's own zone (35 km²)
          </p>
          <p className="mt-1 flex items-center gap-2">
            <span className="inline-block h-0 w-6 border-t-2 border-brand" /> Shared zone
          </p>
        </div>
      </div>

      {/* Panel */}
      <aside className="flex min-h-0 flex-col border-t border-line bg-white lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Zones and rules</h2>
            {auditCount > 0 && <Badge tone="info">{auditCount === 1 ? '1 change recorded' : `${auditCount} changes recorded`}</Badge>}
          </div>
          <Segmented<Tab>
            ariaLabel="Section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'zones', label: `Zones (${zones.length})` },
              { value: 'rules', label: 'Agronomic rules' },
              { value: 'credit', label: 'Credit rules' },
            ]}
          />
          {tab !== 'zones' && (
            <Input
              aria-label="Reason for your changes"
              placeholder="Reason for your changes (optional, saved in the audit trail)"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'zones' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                Every farm has its own 35 km² zone around its centre. Add a shared zone to give several nearby farms the same settings; where shared zones overlap, the
                nearest centre wins.
              </p>
              <ul className="flex flex-col gap-2">
                {rows.map(({ zone: z, farms, overrides, unused, capturedBy }) => (
                  <li
                    key={z.id}
                    className={clsx(
                      'rounded-card border bg-white',
                      z.id === selectedZoneId ? 'border-brand ring-2 ring-brand/15' : 'border-line',
                      unused && 'opacity-70',
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-2 text-left"
                      onClick={() => {
                        setSelectedZoneId(z.id);
                        setFitTarget(zoneFitGeo(z, ++fitCounter.current));
                      }}
                    >
                      <span
                        className={clsx('mt-1 h-3 w-3 shrink-0 rounded-full border-2', z.auto && 'border-dashed')}
                        style={{ borderColor: zoneColor(draft, z) }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{z.name}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {z.auto ? 'Own zone' : 'Shared zone'} · {number(zoneAreaKm2(z.radiusM), 1)} km² · {farms.length === 1 ? '1 farm' : `${farms.length} farms`}
                          {overrides > 0 && ` · ${overrides} custom ${overrides === 1 ? 'value' : 'values'}`}
                        </span>
                        {unused && capturedBy && <span className="mt-0.5 block text-xs text-muted">Not used: the farm is inside {capturedBy.name}.</span>}
                        {farms.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {[...new Set(farms.map((f) => f.crop))].map((c) => (
                              <CropPill key={c} crop={c} />
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                    {z.id === selectedZoneId && (
                      <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                          Name
                          <ZoneNameInput value={z.name} onCommit={(name) => updateZone(DRAFT, z.id, { name })} />
                        </label>
                        {z.auto ? (
                          <p className="text-xs text-muted">This zone follows its farm: centred on the farm, radius {number(z.radiusM, 0)} m. Add a shared zone to change the area.</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                                Radius (m)
                                <span className="block w-28">
                                  <CommitNumberInput
                                    ariaLabel="Radius in metres"
                                    value={z.radiusM}
                                    min={RADIUS_LIMITS.min}
                                    max={RADIUS_LIMITS.max}
                                    step={RADIUS_LIMITS.step}
                                    onCommit={(v) => v !== null && updateZone(DRAFT, z.id, { radiusM: Math.round(v) })}
                                  />
                                </span>
                              </label>
                              <span className="pb-2 text-sm tabular-nums text-muted">{number(zoneAreaKm2(z.radiusM), 1)} km²</span>
                              {z.radiusM !== ZONE_RADIUS_M && (
                                <Button variant="ghost" size="sm" onClick={() => updateZone(DRAFT, z.id, { radiusM: ZONE_RADIUS_M })}>
                                  Reset to 3,338 m
                                </Button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" icon={<Move size={16} />} onClick={() => setMode({ kind: 'move', zoneId: z.id })}>
                                Move centre
                              </Button>
                              <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} onClick={() => removeZone(DRAFT, z.id)}>
                                Remove zone
                              </Button>
                            </div>
                          </>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={farms.length === 0 && z.auto}
                            onClick={() => {
                              setLevel('zone');
                              setTab('rules');
                            }}
                          >
                            Edit rules for this zone
                          </Button>
                        </div>
                        {farms.length > 0 && (
                          <ul className="text-xs text-muted">
                            {farms.map((f) => (
                              <li key={f.id}>
                                {f.name} · {CROP_META[f.crop].label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setMode({ kind: 'add' })} disabled={placing}>
                Add shared zone
              </Button>
            </div>
          )}

          {tab !== 'zones' && !templates && (
            <div className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              {templatesLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading crop templates…
                </span>
              ) : (
                <>
                  <p className="font-medium text-ink">Crop templates are unavailable</p>
                  <p className="mt-1">{templatesError ?? 'The service did not answer.'} Rules can be edited once the service or an offline snapshot is available. You can continue without changes.</p>
                </>
              )}
            </div>
          )}

          {tab === 'rules' && templates && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Segmented<RuleTarget['level']>
                  ariaLabel="Apply changes to"
                  size="sm"
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: 'crop', label: 'A crop (all farms)' },
                    { value: 'zone', label: 'A zone' },
                    { value: 'farm', label: 'A farm' },
                  ]}
                />
                {level === 'crop' && (
                  <Select
                    aria-label="Crop"
                    options={presentCrops.map((c) => ({ value: c, label: `${CROP_META[c].label}${draft.farms.some((f) => f.crop === c) ? '' : ' (no farms yet)'}` }))}
                    value={crop}
                    onChange={(e) => setRuleCrop(e.target.value as Crop)}
                  />
                )}
                {level === 'zone' && (
                  <div className="flex gap-2">
                    <Select aria-label="Zone" className="flex-1" options={zoneOptions} value={zoneId ?? ''} onChange={(e) => setSelectedZoneId(e.target.value)} />
                    <Select
                      aria-label="Crop in this zone"
                      className="w-40"
                      options={zCrops.map((c) => ({ value: c, label: CROP_META[c].label }))}
                      value={zCrop ?? ''}
                      onChange={(e) => setZoneCrop(e.target.value as Crop)}
                    />
                  </div>
                )}
                {level === 'farm' && <Select aria-label="Farm" options={farmOptions} value={farmId ?? ''} onChange={(e) => setSelectedFarmId(e.target.value)} />}
                {target && (
                  <p className="text-xs text-muted">
                    Editing: <span className="font-medium text-ink">{targetLabel(draft, target)}</span>.{' '}
                    {level === 'crop'
                      ? 'Overrides the crop template for every farm of this crop.'
                      : level === 'zone'
                        ? 'Overrides the crop setting for farms of this crop in the zone.'
                        : 'Overrides the zone and crop settings for this farm only.'}{' '}
                    Values set here are marked Custom.
                  </p>
                )}
              </div>
              {target && template ? (
                <RulesEditor portfolio={draft} templates={templates} template={template} target={target} reason={reason} />
              ) : (
                <p className="text-sm text-muted">{level === 'farm' ? 'Add a farm first.' : 'Pick what to edit.'}</p>
              )}
            </div>
          )}

          {tab === 'credit' && templates && (
            <div className="flex flex-col gap-3">
              <Segmented<'portfolio' | 'farm'>
                ariaLabel="Credit rules for"
                size="sm"
                value={creditLevel}
                onChange={setCreditLevel}
                options={[
                  { value: 'portfolio', label: 'Whole portfolio' },
                  { value: 'farm', label: 'One farm' },
                ]}
              />
              {creditLevel === 'farm' && <Select aria-label="Farm" options={farmOptions} value={farmId ?? ''} onChange={(e) => setSelectedFarmId(e.target.value)} />}
              <CreditRulesEditor portfolio={draft} templates={templates} level={creditLevel} farmId={farmId} reason={reason} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ZoneNameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      value={text}
      maxLength={80}
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

export default StepZones;
