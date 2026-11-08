/**
 * Polygon drawing support (leaflet-geoman). Side-effect import: augments L.Map with `map.pm`.
 * Import this module (or call `enableGeoman`) from any component that draws/edits shapes.
 *
 * Usage inside a react-leaflet child component:
 *   const map = useMap();
 *   useEffect(() => {
 *     enablePolygonDrawing(map);                       // or map.pm.enableDraw('Polygon', {...})
 *     const onCreate = (e: { layer: L.Layer }) => {
 *       const gj = (e.layer as L.Polygon).toGeoJSON();  // Feature<Polygon>, coordinates [lng, lat]
 *       map.removeLayer(e.layer);                       // render farms from the store instead
 *       addFarm(gj.geometry as Polygon);
 *     };
 *     map.on('pm:create', onCreate);
 *     return () => { map.off('pm:create', onCreate); map.pm.disableDraw(); };
 *   }, [map]);
 */
import './leafletGlobal';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type L from 'leaflet';

export const DRAW_STYLE: L.PathOptions = { color: '#1F6B43', weight: 2, fillColor: '#1F6B43', fillOpacity: 0.2 };

/** Starts polygon drawing mode on the map (one polygon; call again to draw another). */
export function enablePolygonDrawing(map: L.Map): void {
  map.pm.enableDraw('Polygon', {
    snappable: true,
    allowSelfIntersection: false,
    templineStyle: { color: '#1F6B43' },
    hintlineStyle: { color: '#1F6B43', dashArray: '5,5' },
    pathOptions: DRAW_STYLE,
  });
}

export function disableDrawing(map: L.Map): void {
  map.pm.disableDraw();
}

/** Adds the default geoman toolbar limited to polygon tools (optional; most flows use a custom "Add farm" button). */
export function enableGeomanControls(map: L.Map): void {
  map.pm.addControls({
    position: 'topleft',
    drawMarker: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawRectangle: true,
    drawPolygon: true,
    drawCircle: false,
    drawText: false,
    cutPolygon: false,
    rotateMode: false,
  });
}

export function isGeomanReady(map: L.Map): boolean {
  return typeof map.pm !== 'undefined';
}
