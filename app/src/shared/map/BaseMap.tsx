/**
 * Satellite base map (Esri World Imagery + reference labels).
 * Builders compose layers as children (Polygon, GeoJSON, custom useMap() hooks, ...).
 *
 * - The wrapper is `relative isolate z-0` so Leaflet's internal z-indexes (400..1000) stay inside it
 *   and app overlays (Modal = z-[1100]) render above the map.
 * - The parent MUST give the map a height (default className is 'h-full w-full').
 * - `center`/`zoom` are initial only (react-leaflet v4). Use `fitTo` to fit to geometry whenever it changes.
 * - Leaflet CSS is imported here, once, for the whole app.
 */
import 'leaflet/dist/leaflet.css';
import './leafletGlobal';
import clsx from 'clsx';
import L from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import { useEffect, useMemo, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { DEFAULT_CENTER, DEFAULT_ZOOM, LABEL_TILES, SATELLITE_TILES } from './tiles';

export interface BaseMapProps {
  /** [lat, lng] (Leaflet order). Default: central Chile. Initial only. Use toLeaflet() for contract [lng, lat]. */
  center?: [number, number];
  zoom?: number;
  children?: ReactNode;
  className?: string;
  /** Fit the view to this geometry whenever it changes (by value). */
  fitTo?: GeoJsonObject | null;
  /** Padding in px used when fitting. */
  fitPadding?: number;
  /** Show the place-name/boundary overlay (default true). */
  labels?: boolean;
  scrollWheelZoom?: boolean;
}

function FitTo({ geo, padding }: { geo: GeoJsonObject; padding: number }) {
  const map = useMap();
  const key = useMemo(() => JSON.stringify(geo), [geo]);
  useEffect(() => {
    try {
      const b = L.geoJSON(geo).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [padding, padding], maxZoom: 16 });
    } catch {
      // Ignore invalid geometry.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, padding]);
  return null;
}

/** Invalidates the map size when its container resizes (e.g. inside flex/grid layouts or after a step change). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function BaseMap({ center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, children, className, fitTo, fitPadding = 32, labels = true, scrollWheelZoom = true }: BaseMapProps) {
  return (
    <div className={clsx('relative isolate z-0 overflow-hidden', className ?? 'h-full w-full')}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={scrollWheelZoom} className="h-full w-full" style={{ background: '#1d2421' }}>
        <TileLayer url={SATELLITE_TILES.url} attribution={SATELLITE_TILES.attribution} maxZoom={SATELLITE_TILES.maxZoom} />
        {labels && <TileLayer url={LABEL_TILES.url} attribution={LABEL_TILES.attribution} maxZoom={LABEL_TILES.maxZoom} />}
        <AutoResize />
        {fitTo && <FitTo geo={fitTo} padding={fitPadding} />}
        {children}
      </MapContainer>
    </div>
  );
}

export default BaseMap;
