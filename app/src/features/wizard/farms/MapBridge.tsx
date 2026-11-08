/**
 * Invisible react-leaflet child that connects the Farms step to the Leaflet map:
 * hands the map instance to the parent, turns finished geoman polygons into store farms,
 * reports drawing mode on/off and cancels drawing with Escape.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type L from 'leaflet';
import type { Polygon } from 'geojson';
import { isGeomanReady } from '@/shared/map/geoman';
import { normalizeDrawnPolygon } from './farmHelpers';

export interface MapBridgeProps {
  onReady: (map: L.Map) => void;
  /** Called with the drawn polygon ([lng, lat]); the temporary geoman layer is already removed. */
  onPolygonDrawn: (polygon: Polygon) => void;
  onDrawingChange: (drawing: boolean) => void;
}

export function MapBridge({ onReady, onPolygonDrawn, onDrawingChange }: MapBridgeProps) {
  const map = useMap();
  // Keep the latest callbacks in refs so map listeners are registered exactly once.
  const cb = useRef({ onReady, onPolygonDrawn, onDrawingChange });
  cb.current = { onReady, onPolygonDrawn, onDrawingChange };

  useEffect(() => {
    cb.current.onReady(map);
    if (!isGeomanReady(map)) return;

    const onCreate = (e: { layer: L.Layer }) => {
      const geometry = (e.layer as L.Polygon).toGeoJSON().geometry;
      map.removeLayer(e.layer);
      const polygon = normalizeDrawnPolygon(geometry);
      if (polygon) cb.current.onPolygonDrawn(polygon);
    };
    const onDrawStart = () => cb.current.onDrawingChange(true);
    const onDrawEnd = () => cb.current.onDrawingChange(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && map.pm.globalDrawModeEnabled()) {
        e.preventDefault();
        map.pm.disableDraw();
      }
    };

    map.on('pm:create', onCreate);
    map.on('pm:drawstart', onDrawStart);
    map.on('pm:drawend', onDrawEnd);
    document.addEventListener('keydown', onKey);
    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:drawstart', onDrawStart);
      map.off('pm:drawend', onDrawEnd);
      document.removeEventListener('keydown', onKey);
      if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    };
  }, [map]);

  return null;
}
