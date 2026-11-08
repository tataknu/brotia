/**
 * CIREN Catastro Frutícola orchards in the current map view (GET /ciren/orchards, live only).
 *
 * - Queries only when the view is ≤ MAX_BBOX_DEG per side (the service limit is 0.25°), debounced on move.
 * - Polygons are coloured by crop (species outside the six are grey). Clicking one calls onSelect.
 * - `onStatus` reports loading / count / truncated / why nothing is shown, for a legend or hint.
 *
 *   <BaseMap><CirenOrchardsLayer crop="cherry" onSelect={(f) => addFarmFromCiren(f)} /></BaseMap>
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import type L from 'leaflet';
import { CROP_META } from '@/domain/constants';
import type { CirenOrchardCollection, Crop } from '@/domain/types';
import { useCirenOrchards } from '@/data/hooks';
import type { BBox } from '@/data/api';

export const MAX_BBOX_DEG = 0.25;

export type CirenFeature = CirenOrchardCollection['features'][number];

export interface CirenLayerStatus {
  loading: boolean;
  count: number;
  truncated: boolean;
  /** Plain-language reason nothing is shown (zoom in, offline, error), or null. */
  hint: string | null;
}

function viewBBox(map: L.Map): BBox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** Clamps a view to the service limit, around its centre. */
export function clampBBox(b: BBox, max = MAX_BBOX_DEG): BBox {
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const hw = Math.min((b[2] - b[0]) / 2, max / 2 - 1e-6);
  const hh = Math.min((b[3] - b[1]) / 2, max / 2 - 1e-6);
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

export function CirenOrchardsLayer({
  crop,
  onSelect,
  onStatus,
  selectedObjectId,
  minZoom = 12,
}: {
  crop?: Crop | null;
  onSelect?: (feature: CirenFeature) => void;
  onStatus?: (s: CirenLayerStatus) => void;
  selectedObjectId?: number | null;
  /** Below this zoom nothing is fetched. */
  minZoom?: number;
}) {
  const map = useMap();
  const [view, setView] = useState<{ bbox: BBox; zoom: number }>(() => ({ bbox: viewBBox(map), zoom: map.getZoom() }));
  const [debounced, setDebounced] = useState(view);

  useMapEvents({ moveend: () => setView({ bbox: viewBBox(map), zoom: map.getZoom() }) });
  useEffect(() => {
    const t = setTimeout(() => setDebounced(view), 400);
    return () => clearTimeout(t);
  }, [view]);

  const tooWide = debounced.zoom < minZoom;
  const bbox = useMemo(() => (tooWide ? null : clampBBox(debounced.bbox)), [tooWide, debounced]);
  const { data, loading, error } = useCirenOrchards(bbox, crop);

  // Ref, so callers may pass an inline callback without re-firing the effect (render loop).
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.({
      loading,
      count: data?.features.length ?? 0,
      truncated: data?.truncated ?? false,
      hint: tooWide ? 'Zoom in to see CIREN orchards' : error ? error.message : data && data.features.length === 0 ? (data.provenance.note ?? 'No CIREN orchards here') : null,
    });
  }, [loading, data, error, tooWide]);

  if (!data || tooWide) return null;
  return (
    <GeoJSON
      key={`${bbox?.join(',')}:${crop ?? ''}:${data.features.length}:${selectedObjectId ?? ''}`}
      data={data as unknown as GeoJSON.FeatureCollection}
      style={(f) => {
        const c = (f?.properties as CirenFeature['properties'] | undefined)?.crop;
        const color = c ? CROP_META[c].color : '#8C9691';
        const sel = (f?.properties as CirenFeature['properties'] | undefined)?.objectId === selectedObjectId;
        return { color: sel ? '#FFFFFF' : color, weight: sel ? 3 : 1, fillColor: color, fillOpacity: sel ? 0.5 : 0.3 };
      }}
      onEachFeature={(f, layer) => {
        const p = f.properties as CirenFeature['properties'];
        layer.bindTooltip(`${p.especie}${p.comuna ? ` · ${p.comuna}` : ''}${p.areaHa ? ` · ${p.areaHa.toFixed(1)} ha` : ''} (CIREN ${p.objectId})`, { sticky: true });
        if (onSelect) layer.on('click', () => onSelect(f as unknown as CirenFeature));
      }}
    />
  );
}
