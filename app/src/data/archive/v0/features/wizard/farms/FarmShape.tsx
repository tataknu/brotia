/** One draft farm drawn on the map: colored by crop, name tooltip, click to select, optional vertex editing. */
import { memo, useEffect, useMemo, useRef } from 'react';
import { Polygon as LeafletPolygon, Tooltip, useMap } from 'react-leaflet';
import type L from 'leaflet';
import { CROPS, type Farm } from '@/domain/types';
import { toLatLngs } from '@/shared/map';

export interface FarmShapeProps {
  farm: Farm;
  selected: boolean;
  /** Vertex editing (geoman) is on for this farm. */
  editing: boolean;
  onSelect: (id: string) => void;
  /** Registers / unregisters the Leaflet layer so the parent can read edited vertices. */
  registerLayer: (id: string, layer: L.Polygon | null) => void;
}

export const FarmShape = memo(function FarmShape({ farm, selected, editing, onSelect, registerLayer }: FarmShapeProps) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  // react-leaflet resets vertices whenever `positions` changes by reference, so keep it stable per polygon.
  const positions = useMemo(() => toLatLngs(farm.polygon), [farm.polygon]);
  const color = CROPS[farm.crop]?.color ?? '#2E7A55';

  useEffect(() => {
    registerLayer(farm.id, layerRef.current);
    return () => registerLayer(farm.id, null);
  }, [farm.id, registerLayer]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!editing || !layer?.pm) return;
    layer.pm.enable({ allowSelfIntersection: false, snappable: true });
    layer.bringToFront();
    return () => {
      if (layer.pm.enabled()) layer.pm.disable();
    };
  }, [editing]);

  useEffect(() => {
    if (selected) layerRef.current?.bringToFront();
  }, [selected]);

  const handlers = useMemo(
    () => ({
      click: (e: L.LeafletMouseEvent) => {
        // While drawing, clicks place vertices; do not change the selection.
        if (map.pm?.globalDrawModeEnabled()) return;
        if (e.originalEvent) e.originalEvent.stopPropagation();
        onSelect(farm.id);
      },
    }),
    [map, onSelect, farm.id],
  );

  return (
    <LeafletPolygon
      ref={layerRef}
      positions={positions}
      eventHandlers={handlers}
      pathOptions={{
        color: selected ? '#FFFFFF' : color,
        weight: selected ? 4 : 2,
        fillColor: color,
        fillOpacity: selected ? 0.4 : 0.25,
        dashArray: editing ? '6 4' : undefined,
      }}
    >
      <Tooltip sticky direction="top" opacity={0.95}>
        <span className="font-medium">{farm.name || 'Unnamed farm'}</span>
        <span className="text-muted"> · {CROPS[farm.crop]?.label}</span>
      </Tooltip>
    </LeafletPolygon>
  );
});
