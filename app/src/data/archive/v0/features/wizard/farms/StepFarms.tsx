/**
 * Wizard step 2: draw farms on a satellite map.
 * "Add farm" turns on polygon drawing (leaflet-geoman, driven from our own buttons, no geoman toolbar).
 * Each finished polygon becomes a farm in the draft and its editor opens in the list on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection, GeoJsonObject, Polygon } from 'geojson';
import type L from 'leaflet';
import { Maximize2, MousePointerClick, Plus, X } from 'lucide-react';
import { useStore } from '@/state/store';
import type { Farm } from '@/domain/types';
import { BaseMap, farmsFeatureCollection, toLatLngs } from '@/shared/map';
import { disableDrawing, enablePolygonDrawing } from '@/shared/map/geoman';
import { Button, EmptyState, Modal } from '@/shared/ui';
import { money } from '@/shared/format';
import { MapBridge } from './MapBridge';
import { FarmShape } from './FarmShape';
import { FarmRow } from './FarmList';
import { areaLabel, normalizeDrawnPolygon, totalAreaHa, uniqueFarmName } from './farmHelpers';

const EMPTY: Farm[] = [];

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
  const farms = draft?.farms ?? EMPTY;

  const [map, setMap] = useState<L.Map | null>(null);
  const [drawing, setDrawing] = useState(false);
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

  // ---- shape editing -------------------------------------------------------------------------
  const finishShapeEdit = useCallback(() => {
    const id = shapeEditId;
    if (!id) return;
    const layer = layers.current.get(id);
    if (layer) {
      const polygon = normalizeDrawnPolygon(layer.toGeoJSON().geometry);
      if (layer.pm?.enabled()) layer.pm.disable();
      if (polygon) updateFarm(id, { polygon });
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
      setSelectedId(id);
      setShapeEditId(id);
    },
    [map, shapeEditId, finishShapeEdit],
  );

  // Leaving the step (Next, Back, Stepper, Review "Edit" link, header link) while a shape is being edited
  // keeps the edit, the same as "Save shape". This cleanup runs before FarmShape's, so the layer is still registered.
  const shapeEditIdRef = useRef<string | null>(null);
  shapeEditIdRef.current = shapeEditId;
  useEffect(
    () => () => {
      const id = shapeEditIdRef.current;
      if (!id) return;
      const layer = layers.current.get(id);
      if (!layer) return;
      const polygon = normalizeDrawnPolygon(layer.toGeoJSON().geometry);
      if (polygon) updateFarm(id, { polygon });
    },
    [updateFarm],
  );

  // Escape cancels vertex editing (drawing is cancelled by MapBridge).
  useEffect(() => {
    if (!shapeEditId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelShapeEdit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shapeEditId, cancelShapeEdit]);

  // ---- drawing -------------------------------------------------------------------------------
  const toggleDrawing = useCallback(() => {
    if (!map?.pm) return;
    if (map.pm.globalDrawModeEnabled()) {
      disableDrawing(map);
      return;
    }
    if (shapeEditId) finishShapeEdit();
    enablePolygonDrawing(map);
  }, [map, shapeEditId, finishShapeEdit]);

  const onPolygonDrawn = useCallback(
    (polygon: Polygon) => {
      const name = uniqueFarmName(farmsRef.current);
      const id = addFarm(polygon);
      updateFarm(id, { name });
      setSelectedId(id);
      setExpandedId(id);
      setFocusNameId(id);
    },
    [addFarm, updateFarm],
  );

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

  const deleteFarm = useCallback(
    (id: string) => {
      if (shapeEditId === id) {
        const layer = layers.current.get(id);
        if (layer?.pm?.enabled()) layer.pm.disable();
        setShapeEditId(null);
      }
      removeFarm(id);
      setSelectedId((cur) => (cur === id ? null : cur));
      setExpandedId((cur) => (cur === id ? null : cur));
      setConfirmDeleteId(null);
    },
    [removeFarm, shapeEditId],
  );

  const requestDelete = useCallback(
    (id: string) => {
      const farm = farmsRef.current.find((f) => f.id === id);
      // Only ask when there is more than a drawn shape to lose (a loan entered in the Credit step).
      if (farm?.loan) setConfirmDeleteId(id);
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

  return (
    <div className="flex flex-col lg:grid lg:h-full lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
      {/* Map */}
      <div className="relative h-[60vh] min-h-[360px] lg:h-full lg:min-h-0">
        <BaseMap fitTo={fitTarget} fitPadding={48}>
          <MapBridge onReady={setMap} onPolygonDrawn={onPolygonDrawn} onDrawingChange={setDrawing} />
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
          <div className="pointer-events-auto flex gap-2">
            {farms.length > 0 && !drawing && (
              <Button variant="secondary" icon={<Maximize2 size={16} />} onClick={fitToFarms} title="Zoom to all farms">
                <span className="hidden sm:inline">Fit to farms</span>
              </Button>
            )}
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
              title="Draw your first farm"
              description={
                <>
                  Zoom into the field on the satellite map, click <span className="font-medium text-ink">Add farm</span>, then click each corner of the
                  field. Click the first corner again to close the shape. You can draw as many farms as you need.
                </>
              }
              action={
                <Button icon={<Plus size={16} />} onClick={toggleDrawing} disabled={!map || drawing}>
                  Add farm
                </Button>
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
                    selected={f.id === selectedId}
                    expanded={f.id === expandedId}
                    shapeEditing={f.id === shapeEditId}
                    autoFocusName={f.id === focusNameId}
                    onSelect={selectFromList}
                    onToggleEdit={toggleEdit}
                    onUpdate={updateFarm}
                    onDelete={requestDelete}
                    onStartShapeEdit={startShapeEdit}
                    onFinishShapeEdit={finishShapeEdit}
                    onCancelShapeEdit={cancelShapeEdit}
                  />
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">
                Click a farm on the map or in this list to select it. Zones, baselines and loans come in the next steps.
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
            This removes the field boundary and its loan
            {confirmFarm.loan ? ` of ${money(confirmFarm.loan.amount, confirmFarm.loan.currency)}` : ''}. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

export default StepFarms;
