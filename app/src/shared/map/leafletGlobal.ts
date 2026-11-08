/**
 * Ensures `window.L` is set before Leaflet plugins that rely on the global (e.g. geoman) evaluate,
 * and fixes the default marker icon URLs under Vite bundling.
 */
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

if (typeof window !== 'undefined') {
  (window as unknown as { L: typeof L }).L = L;
  L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
}

export default L;
