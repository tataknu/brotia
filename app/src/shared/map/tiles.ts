export const SATELLITE_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxZoom: 19,
} as const;

export const LABEL_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Labels &copy; Esri',
  maxZoom: 19,
} as const;

/**
 * Default map view: central Chile (contract [lng, lat] = [-71.3, -34.6], zoom 8).
 * Leaflet uses [lat, lng], so the order is flipped here. Use toLeaflet() for contract coordinates.
 */
export const DEFAULT_CENTER: [number, number] = [-34.6, -71.3];
export const DEFAULT_ZOOM = 8;

/** Contract [lng, lat] → Leaflet [lat, lng]. */
export const toLeaflet = ([lng, lat]: [number, number] | number[]): [number, number] => [lat, lng];
/** Leaflet {lat, lng} → contract [lng, lat]. */
export const fromLeaflet = (ll: { lat: number; lng: number }): [number, number] => [ll.lng, ll.lat];
