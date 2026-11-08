/** Map click handler for placing or moving a shared zone centre (crosshair cursor while active, Esc cancels). */
import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import { fromLeaflet } from '@/shared/map';

export function ZoneMapBridge({ active, onPick, onCancel }: { active: boolean; onPick: (lngLat: [number, number]) => void; onCancel: () => void }) {
  const map = useMap();
  const cb = useRef({ onPick, onCancel, active });
  cb.current = { onPick, onCancel, active };

  useMapEvents({
    click: (e) => {
      if (cb.current.active) cb.current.onPick(fromLeaflet(e.latlng));
    },
  });

  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = active ? 'crosshair' : '';
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb.current.onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      el.style.cursor = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [map, active]);

  return null;
}
