/**
 * Wizard step 2: farms on a satellite map.
 * - "Add farm" turns on polygon drawing (leaflet-geoman, driven from our own buttons).
 * - "Add from cadastre" shows CIREN Catastro Frutícola orchards in view (Chile only, live service);
 *   clicking one adds it with its crop and CIREN reference prefilled.
 * Each new farm opens its editor in the list on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection, GeoJsonObject, Polygon } from 'geojson';
import type L from 'leaflet';
import { Database, Info, Loader2, Maximize2, MousePointerClick, Plus, X } from 'lucide-react';
import { COUNTRIES_FALLBACK, CROP_META, DEFAULT_COUNTRY } from '@/domain/constants';
import { CROPS, type Crop, type Farm } from '@/domain/types';
import { useCountries } from '@/data/hooks';
import { DRAFT, useStore } from '@/state/store';
import { BaseMap, CirenOrchardsLayer, DEFAULT_CENTER, DEFAULT_ZOOM, farmsFeatureCollection, toLatLngs, toLeaflet, type CirenFeature, type CirenLayerStatus } from '@/shared/map';
import { disableDrawing, enablePolygonDrawing } from '@/shared/map/geoman';
import { Button, EmptyState, Modal, Select } from '@/shared/ui';
import { money } from '@/shared/format';
import { useTemplates } from '../common/templates';
import { MapBridge } from './MapBridge';
import { FarmShape } from './FarmShape';
import { FarmRow, type AuditedFlag } from './FarmList';
import { areaLabel, cirenPick, normalizeDrawnPolygon, totalAreaHa, uniqueFarmName } from './farmHelpers';

const EMPTY: Farm[] = [];
const CROP_FILTER_OPTIONS = [{ value: '', label: 'All species (six monitored)' }, ...CROPS.map((c) => ({ value: c, label: CROP_META[c].label }))];

/** Wraps geometry with a counter so BaseMap refits even when the same farm is picked twice. */
function fitFeature(polygon: Polygon, n: number): Feature<Polygon> {
  return { type: 'Feature', properties: { n }, geometry: polygon };
}
function fitAll(farms: Farm[], n: number): FeatureCollection<Polygon> | null {
  const fc = farmsFeatureCollection(farms);
  if (!fc) return null;
  return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, n } })) };
}

export function StepFarms() {
  const draft = useStore((s) => s.draft);
  const addFarm = useStore((s) => s.addFarm);
  const updateFarm = useStore((s) => s.updateFarm);
  const removeFarm = useStore((s) => s.removeFarm);
  const applyRuleChange = useStore((s) => s.applyRuleChange);
  const farms = draft?.farms ?? EMPTY;
  const { templates, byCrop } = useTemplates();
  const { data: countryList } = useCountries();
  const country = useMemo(() => (countryList ?? COUNTRIES_FALLBACK).find((c) => c.code === (draft?.country ?? DEFAULT_COUNTRY)), [countryList, draft?.country]);
  const isChile = (draft?.country ?? DEFAULT_COUNTRY) === 'CL';
  // Initial view only (BaseMap ignores later changes): central Chile for CL, else the country's own view.
  const [initialView] = useState(() =>
    isChile || !country ? { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM } : { center: toLeaflet(country.center), zoom: country.zoom },
  );

  const [map, setMap] = useState<L.Map | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [cadastre, setCadastre] = useState(false);
  const [cadastreCrop, setCadastreCrop] = useState<Crop | ''>('');
  const [cirenStatus, setCirenStatus] = useState<CirenLayerStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusNameId, setFocusNameId] = useState<string | null>(null);
  const [shapeEditId, setShapeEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Fit to the existing farms once when the step opens; afterwards only on explicit list selection / "Fit to farms".
  const fitCounter = useRef(0);
  const [fitTarget, setFitTarget] = useState<GeoJsonObject | null>(() => farmsFeatureCollection(draft?.farms ?? []));

  const layers = useRef(new Map<string, L.Polygon>());
  const registerLayer = useCallback((id: string, layer: L.Polygon | null) => {
    if (layer) layers.current.set(id, layer);
    else layers.current.delete(id);
  }, []);

  const farmsRef = useRef(farms);
  farmsRef.current = farms;

  const stats = useMemo(() => ({ count: farms.length, area: totalAreaHa(farms) }), [farms]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- shape editing -------------------------------------------------------------------------
  const finishShapeEdit = useCallback(() => {
    const id = shapeEditId;
    if (!id) return;
    const layer = layers.current.get(id);
    if (layer) {
      const polygon = normalizeDrawnPolygon(layer.toGeoJSON().geometry);
      if (layer.pm?.enabled()) layer.pm.disable();
      if (polygon) updateFarm(DRAFT, id, { polygon });
    }
    setShapeEditId(null);
  }, [shapeEditId, updateFarm]);

  const cancelShapeEdit = useCallback(() => {
    const id = shapeEditId;
    if (!id) return;
    const layer = layers.current.get(id);
    const farm = farmsRef.current.find((f) => f.id === id);
    if (layer) {
      if (layer.pm?.enabled()) layer.pm.disable();
      if (farm) layer.setLatLngs(toLatLngs(farm.polygon));
    }
    setShapeEditId(null);
  }, [shapeEditId]);

  const startShapeEdit = useCallback(
    (id: string) => {
      if (map?.pm?.globalDrawModeEnabled()) disableDrawing(map);
      if (shapeEditId && shapeEditId !== id) finishShapeEdit();
      setCadastre(false);
      setSelectedId(id);
      setShapeEditId(id);
    },
    [map, shapeEditId, finishShapeEdit],
  );

  // Leaving the step while a shape is being edited keeps the edit, the same as "Save shape".
  const shapeEditIdRef = useRef<string | null>(null);
  shapeEditIdRef.current = shapeEditId;
  useEffect(
    () => () => {
      const id = shapeEditIdRef.current;
      if (!id) return;
      const layer = layers.current.get(id);
      if (!layer) return;
      const polygon = normalizeDrawnPolygon(layer.toGeoJSON().geometry);
      if (polygon) updateFarm(DRAFT, id, { polygon });
    },
    [updateFarm],
  );

  // Escape cancels vertex editing (drawing is cancelled by MapBridge) and closes the cadastre layer.
  useEffect(() => {
    if (!shapeEditId && !cadastre) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (shapeEditId) cancelShapeEdit();
      else setCadastre(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shapeEditId, cadastre, cancelShapeEdit]);

  // ---- drawing -------------------------------------------------------------------------------
  const toggleDrawing = useCallback(() => {
    if (!map?.pm) return;
    if (map.pm.globalDrawModeEnabled()) {
      disableDrawing(map);
      return;
    }
    if (shapeEditId) finishShapeEdit();
    setCadastre(false);
    enablePolygonDrawing(map);
  }, [map, shapeEditId, finishShapeEdit]);

  const onPolygonDrawn = useCallback(
    (polygon: Polygon) => {
      const name = uniqueFarmName(farmsRef.current);
      const id = addFarm(DRAFT, { polygon, name, crop: 'cherry' });
      if (!id) return;
      setSelectedId(id);
      setExpandedId(id);
      setFocusNameId(id);
    },
    [addFarm],
  );

  // ---- cadastre ------------------------------------------------------------------------------
  const toggleCadastre = useCallback(() => {
    if (map?.pm?.globalDrawModeEnabled()) disableDrawing(map);
    if (shapeEditId) finishShapeEdit();
    setCadastre((v) => !v);
    setCirenStatus(null);
  }, [map, shapeEditId, finishShapeEdit]);

  const onCirenSelect = useCallback(
    (feature: CirenFeature) => {
      const pick = cirenPick(feature, farmsRef.current);
      if (pick.kind === 'unsupported') {
        setNotice(pick.message);
        return;
      }
      if (pick.kind === 'exists') {
        setSelectedId(pick.farmId);
        setExpandedId(pick.farmId);
        setNotice('This orchard is already in the portfolio.');
        return;
      }
      const id = addFarm(DRAFT, pick.input);
      if (!id) return;
      setSelectedId(id);
      setExpandedId(id);
      setFocusNameId(null);
      setNotice(null);
    },
    [addFarm],
  );

  const selectedCiren = useMemo(() => farms.find((f) => f.id === selectedId)?.ciren?.objectId ?? null, [farms, selectedId]);

  // ---- selection / list ----------------------------------------------------------------------
  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id);
    setFocusNameId(null);
  }, []);

  const selectFromList = useCallback((id: string) => {
    setSelectedId(id);
    setFocusNameId(null);
    const farm = farmsRef.current.find((f) => f.id === id);
    if (farm) setFitTarget(fitFeature(farm.polygon, ++fitCounter.current));
  }, []);

  const toggleEdit = useCallback(
    (id: string) => {
      setFocusNameId(null);
      setSelectedId(id);
      if (expandedId === id) {
        if (shapeEditId === id) finishShapeEdit();
        setExpandedId(null);
      } else {
        setExpandedId(id);
      }
    },
    [expandedId, shapeEditId, finishShapeEdit],
  );

  const onUpdate = useCallback((id: string, patch: Parameters<typeof updateFarm>[2]) => updateFarm(DRAFT, id, patch), [updateFarm]);

  const onSetFlag = useCallback(
    (id: string, flag: AuditedFlag, value: boolean | null) => {
      const farm = farmsRef.current.find((f) => f.id === id);
      if (!farm || (farm[flag] ?? null) === value) return;
      applyRuleChange(DRAFT, { scope: { level: 'farm', id }, path: flag, newValue: value, reason: '' }, templates);
    },
    [applyRuleChange, templates],
  );

  const deleteFarm = useCallback(
    (id: string) => {
      if (shapeEditId === id) {
        const layer = layers.current.get(id);
        if (layer?.pm?.enabled()) layer.pm.disable();
        setShapeEditId(null);
      }
      removeFarm(DRAFT, id);
      setSelectedId((cur) => (cur === id ? null : cur));
      setExpandedId((cur) => (cur === id ? null : cur));
      setConfirmDeleteId(null);
    },
    [removeFarm, shapeEditId],
  );

  const requestDelete = useCallback(
    (id: string) => {
      const farm = farmsRef.current.find((f) => f.id === id);
      // Only ask when there is more than a shape to lose (a loan or rule overrides).
      const hasWork = !!farm?.loan || Object.keys(farm?.overrides ?? {}).length > 0 || Object.keys(farm?.creditRuleOverrides ?? {}).length > 0;
      if (hasWork) setConfirmDeleteId(id);
      else deleteFarm(id);
    },
    [deleteFarm],
  );

  const fitToFarms = () => {
    const fc = fitAll(farms, ++fitCounter.current);
    if (fc) setFitTarget(fc);
  };

  const shapeEditFarm = shapeEditId ? farms.find((f) => f.id === shapeEditId) : undefined;
  const confirmFarm = confirmDeleteId ? farms.find((f) => f.id === confirmDeleteId) : undefined;

  if (!draft) return null;

  const cadastreButton = isChile ? (
    <Button
      variant={cadastre ? 'primary' : 'secondary'}
      icon={cadastre ? <X size={16} /> : <Database size={16} />}
      onClick={toggleCadastre}
      disabled={!map}
      className="shadow-panel"
      aria-pressed={cadastre}
    >
      {cadastre ? 'Close cadastre' : 'Add from cadastre'}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col lg:grid lg:h-full lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
      {/* Map */}
      <div className="relative h-[60vh] min-h-[360px] lg:h-full lg:min-h-0" data-testid="farms-map">
        <BaseMap fitTo={fitTarget} fitPadding={48} center={initialView.center} zoom={initialView.zoom}>
          <MapBridge onReady={setMap} onPolygonDrawn={onPolygonDrawn} onDrawingChange={setDrawing} />
          {cadastre && (
            <CirenOrchardsLayer crop={cadastreCrop || null} onSelect={onCirenSelect} onStatus={setCirenStatus} selectedObjectId={selectedCiren} />
          )}
          {farms.map((f) => (
            <FarmShape
              key={f.id}
              farm={f}
              selected={f.id === selectedId}
              editing={f.id === shapeEditId}
              onSelect={selectFromMap}
              registerLayer={registerLayer}
            />
          ))}
        </BaseMap>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-end gap-2 p-3 sm:flex-row sm:items-start sm:justify-end">
          {drawing && (
            <div className="pointer-events-auto order-last mr-auto max-w-sm rounded-card border border-line bg-white/95 px-3 py-2 text-sm text-ink shadow-panel sm:order-first sm:ml-12">
              <p className="font-medium">Drawing a farm boundary</p>
              <p className="text-muted">Click the map to place each corner. Click the first corner to finish. Press Esc to cancel.</p>
            </div>
          )}
          {cadastre && !drawing && (
            <div className="pointer-events-auto order-last mr-auto w-full max-w-sm rounded-card border border-line bg-white/95 px-3 py-2 text-sm text-ink shadow-panel sm:order-first sm:ml-12">
              <p className="font-medium">CIREN fruit cadastre</p>
              <p className="text-muted">Click an orchard to add it as a farm. Its crop and CIREN reference are filled in for you.</p>
              <div className="mt-2 flex items-center gap-2">
                <Select
                  aria-label="Show orchards of"
                  className="flex-1"
                  options={CROP_FILTER_OPTIONS}
                  value={cadastreCrop}
                  onChange={(e) => setCadastreCrop(e.target.value as Crop | '')}
                />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
                {cirenStatus?.loading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Loading orchards…
                  </>
                ) : cirenStatus?.hint ? (
                  <>
                    <Info size={12} /> {cirenStatus.hint}
                  </>
                ) : cirenStatus ? (
                  `${cirenStatus.count} ${cirenStatus.count === 1 ? 'orchard' : 'orchards'} in view${cirenStatus.truncated ? ' (nearest 300 shown, zoom in for more)' : ''}`
                ) : (
                  'Zoom in to see CIREN orchards.'
                )}
              </p>
            </div>
          )}
          {shapeEditFarm && !drawing && (
            <div className="pointer-events-auto order-last mr-auto max-w-sm rounded-card border border-line bg-white/95 px-3 py-2 text-sm text-ink shadow-panel sm:order-first sm:ml-12">
              <p className="font-medium">Editing the shape of {shapeEditFarm.name || 'this farm'}</p>
              <p className="text-muted">Drag the corners, then save. Press Esc to cancel.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={finishShapeEdit}>
                  Save shape
                </Button>
                <Button size="sm" variant="secondary" onClick={cancelShapeEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
            {farms.length > 0 && !drawing && (
              <Button variant="secondary" icon={<Maximize2 size={16} />} onClick={fitToFarms} title="Zoom to all farms" className="shadow-panel">
                <span className="hidden sm:inline">Fit to farms</span>
              </Button>
            )}
            {!drawing && cadastreButton}
            <Button
              variant={drawing ? 'secondary' : 'primary'}
              icon={drawing ? <X size={16} /> : <Plus size={16} />}
              onClick={toggleDrawing}
              disabled={!map}
              className="shadow-panel"
            >
              {drawing ? 'Cancel drawing' : 'Add farm'}
            </Button>
          </div>
        </div>
        {notice && (
          <div role="status" className="pointer-events-auto absolute bottom-6 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-card border border-line bg-white px-3 py-2 text-sm text-ink shadow-panel">
            {notice}
          </div>
        )}
      </div>

      {/* Farm list */}
      <aside className="flex min-h-0 flex-col border-t border-line bg-white lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">Farms</h2>
            <p className="text-sm tabular-nums text-muted">
              {stats.count === 0 ? 'No farms yet' : `${stats.count} ${stats.count === 1 ? 'farm' : 'farms'} · ${areaLabel(stats.area)}`}
            </p>
          </div>
          <Button size="sm" variant={drawing ? 'secondary' : 'primary'} icon={drawing ? <X size={16} /> : <Plus size={16} />} onClick={toggleDrawing} disabled={!map}>
            {drawing ? 'Cancel' : 'Add farm'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {farms.length === 0 ? (
            <EmptyState
              icon={<MousePointerClick size={18} />}
              title="Add your first orchard"
              description={
                isChile ? (
                  <>
                    Click <span className="font-medium text-ink">Add from cadastre</span> and pick an orchard mapped by CIREN, or zoom into the field and click{' '}
                    <span className="font-medium text-ink">Add farm</span> to draw its boundary corner by corner.
                  </>
                ) : (
                  <>
                    Zoom into the field on the satellite map, click <span className="font-medium text-ink">Add farm</span>, then click each corner of the field.
                    The CIREN orchard cadastre is available for Chile only.
                  </>
                )
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {isChile && (
                    <Button variant="secondary" icon={<Database size={16} />} onClick={toggleCadastre} disabled={!map || cadastre}>
                      Add from cadastre
                    </Button>
                  )}
                  <Button icon={<Plus size={16} />} onClick={toggleDrawing} disabled={!map || drawing}>
                    Add farm
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {farms.map((f) => (
                  <FarmRow
                    key={f.id}
                    farm={f}
                    farms={farms}
                    template={byCrop[f.crop]}
                    selected={f.id === selectedId}
                    expanded={f.id === expandedId}
                    shapeEditing={f.id === shapeEditId}
                    autoFocusName={f.id === focusNameId}
                    onSelect={selectFromList}
                    onToggleEdit={toggleEdit}
                    onUpdate={onUpdate}
                    onSetFlag={onSetFlag}
                    onDelete={requestDelete}
                    onStartShapeEdit={startShapeEdit}
                    onFinishShapeEdit={finishShapeEdit}
                    onCancelShapeEdit={cancelShapeEdit}
                  />
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">
                Click a farm on the map or in this list to select it. Every farm gets its own 35 km² zone; shared zones, rules and loans come next.
              </p>
            </>
          )}
        </div>
      </aside>

      {confirmFarm && (
        <Modal
          title={`Delete ${confirmFarm.name || 'this farm'}?`}
          onClose={() => setConfirmDeleteId(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                Keep farm
              </Button>
              <Button variant="danger" onClick={() => deleteFarm(confirmFarm.id)}>
                Delete farm
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            This removes the field boundary
            {confirmFarm.loan ? `, its loan of ${money(confirmFarm.loan.amount, confirmFarm.loan.currency)}` : ''} and its farm-level rule changes. The audit trail
            keeps their history. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default StepFarms;
