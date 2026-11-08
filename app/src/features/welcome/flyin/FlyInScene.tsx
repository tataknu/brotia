import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SATELLITE_TILES } from '@/shared/map/tiles';
import './flyin.css';

/**
 * Google Earth-style fly-in, two beats, both fully driven by progress values (no internal timers):
 *   beat (a) `progress` 0..1  Chile scale → portfolio view framing every CLSO2 orchard; tier pins pop in one by one.
 *   beat (b) `dive` 0..1      portfolio view → one orchard; other pins fade, the polygon draws in, fill fades in.
 * Every overlay is projected by Leaflet itself (L.polygon in the overlay pane, map.latLngToContainerPoint for the
 * pixel pins and vertex markers) after each setView, so it is pixel-locked to the tiles at every progress value.
 */

const FARM_ID = 'sur-los-angeles-cherry';
const PORTFOLIO_ID = 'sample-cl-sur';
const FALLBACK_PORTFOLIO_FILE = 'portfolio-sample-cl-sur.json';
const FALLBACK_ASSESSMENT_FILE = 'assessment-portfolio-sample-cl-sur.json';
const SNAPSHOT = '/snapshot/';

const START = { lat: -35, lng: -71, zoom: 5 };
/** Used until the snapshot arrives so the camera path is valid from frame one. */
const FALLBACK_TARGET = { lat: -37.545823, lng: -72.361886 };
const FALLBACK_PORTFOLIO_VIEW = { lat: -36.5, lng: -72.0, zoom: 8.3 };
const END_ZOOM_DEFAULT = 16.4;
/** Beat (a): camera glides until A_CAMERA_END, pins pop in after A_PINS_START. */
const A_CAMERA_END = 0.62;
const A_PINS_START = 0.5;
const A_DRIFT = 0.12;
/** Beat (b): camera until B_CAMERA_END, then outline + fill. */
const B_CAMERA_END = 0.72;
const B_DRIFT = 0.25;

export const TIER_COLOR: Record<string, string> = { normal: '#2FA05A', watch: '#E8933A', high: '#D0533A' };

type LngLat = [number, number];
type Tier = 'normal' | 'watch' | 'high';
interface Farm {
  id: string;
  ring: LngLat[]; // [lng, lat], outer ring
  areaHa: number;
  centroid: LngLat;
  score: number | null;
  tier: Tier;
}
interface Portfolio {
  code: string;
  farms: Farm[];
  outstanding: number;
  currency: string;
  high: number;
  watch: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/** Web Mercator world coords in [0,1] (x right, y down). */
function merc(lat: number, lng: number): [number, number] {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
function unmerc(x: number, y: number): { lat: number; lng: number } {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return { lat, lng };
}

/** Zoom at which the farm's bbox fills ~40% of the shorter viewport side. */
function fitZoom(ring: LngLat[], w: number, h: number): number {
  const pts = ring.map(([lng, lat]) => merc(lat, lng));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
  const z = Math.log2((0.4 * Math.min(w, h)) / (span * 256));
  return Math.max(15.5, Math.min(17.2, z));
}

/** View framing every farm centroid with generous padding (room for the labels and the HUD). */
function portfolioView(farms: Farm[], w: number, h: number): View {
  const pts = farms.map((f) => merc(f.centroid[1], f.centroid[0]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const zx = Math.log2((0.4 * w) / (Math.max(x1 - x0, 1e-9) * 256));
  const zy = Math.log2((0.62 * h) / (Math.max(y1 - y0, 1e-9) * 256));
  const c = unmerc((x0 + x1) / 2, (y0 + y1) / 2 + (0.02 * h) / (256 * Math.pow(2, Math.min(zx, zy))));
  return { lat: c.lat, lng: c.lng, zoom: Math.min(zx, zy, 10) };
}

interface View {
  lat: number;
  lng: number;
  zoom: number;
}

/**
 * Camera glide from `a` to `b` at eased fraction e. Zoom eases; the center is interpolated so the target's screen
 * offset shrinks smoothly ((1-s)·2^z ∝ 1-e), so the target never whips off-screen on a deep zoom.
 */
function glide(a: View, b: View, e: number): View {
  const zoom = a.zoom + (b.zoom - a.zoom) * e;
  const s = 1 - (Math.pow(2, a.zoom) / Math.pow(2, zoom)) * (1 - e);
  const [x0, y0] = merc(a.lat, a.lng);
  const [x1, y1] = merc(b.lat, b.lng);
  const c = unmerc(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s);
  return { lat: c.lat, lng: c.lng, zoom };
}

/** Beat (a) camera: Chile scale → portfolio view, then a slow push-in so the held frame is never dead. */
function cameraA(p: number, pv: View): View {
  const v = glide(START, pv, easeInOutCubic(clamp01(p / A_CAMERA_END)));
  v.zoom += A_DRIFT * easeOutCubic(clamp01((p - A_CAMERA_END) / (1 - A_CAMERA_END)));
  return v;
}

/** Beat (b) camera: from where beat (a) held → the orchard, then the push-in drift. */
function cameraB(d: number, pv: View, target: { lat: number; lng: number }, endZoom: number): View {
  const from = cameraA(1, pv);
  const v = glide(from, { ...target, zoom: endZoom }, easeInOutCubic(clamp01(d / B_CAMERA_END)));
  v.zoom += B_DRIFT * clamp01((d - B_CAMERA_END) / (1 - B_CAMERA_END));
  return v;
}

const metersPerPixel = (lat: number, zoom: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

function niceScale(mpp: number, maxPx: number): { px: number; label: string } {
  const maxM = mpp * maxPx;
  const pow = Math.pow(10, Math.floor(Math.log10(maxM)));
  const m = [5, 2, 1].map((k) => k * pow).find((v) => v <= maxM) ?? pow;
  return { px: m / mpp, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

function fmtCoord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(4).padStart(8, '0')}°${v < 0 ? neg : pos}`;
}

function fmtAlt(m: number) {
  return m >= 10000 ? `${Math.round(m / 1000).toLocaleString('en-US')} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

const ATTRIBUTION = SATELLITE_TILES.attribution.replace(/&copy;/g, '©');

function outerRing(polygon: { type?: string; coordinates?: unknown } | undefined): LngLat[] | null {
  const c = polygon?.coordinates as LngLat[][] | LngLat[][][] | undefined;
  if (!Array.isArray(c) || !c.length) return null;
  // Polygon → outer ring; MultiPolygon → first polygon's outer ring.
  return polygon?.type === 'MultiPolygon' ? (c as LngLat[][][])[0][0] : (c as LngLat[][])[0];
}

async function loadPortfolio(): Promise<Portfolio | null> {
  let file = FALLBACK_PORTFOLIO_FILE;
  let assessFile = FALLBACK_ASSESSMENT_FILE;
  try {
    const m = await fetch(`${SNAPSHOT}manifest.json`).then((r) => r.json());
    const entry = (m?.portfolios ?? []).find((p: { portfolioId?: string }) => p.portfolioId === PORTFOLIO_ID);
    if (entry?.portfolioFile) file = entry.portfolioFile;
    if (entry?.assessmentFile) assessFile = entry.assessmentFile;
  } catch {
    /* fall back to the known file names */
  }
  const [portfolio, assessment] = await Promise.all([
    fetch(`${SNAPSHOT}${file}`).then((r) => r.json()),
    fetch(`${SNAPSHOT}${assessFile}`)
      .then((r) => r.json())
      .catch(() => null),
  ]);
  const ranked = new Map<string, { score?: number; tier?: string }>(
    (assessment?.ranked ?? []).map((r: { farmId: string; score?: number; tier?: string }) => [r.farmId, r]),
  );
  const farms: Farm[] = [];
  for (const f of portfolio?.farms ?? []) {
    const ring = outerRing(f.polygon);
    if (!ring) continue;
    const centroid: LngLat =
      Array.isArray(f.centroid) && f.centroid.length === 2
        ? f.centroid
        : [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    const r = ranked.get(f.id);
    const tier = (r?.tier && r.tier in TIER_COLOR ? r.tier : 'normal') as Tier;
    farms.push({ id: f.id, ring, areaHa: Number(f.areaHa) || 0, centroid, score: typeof r?.score === 'number' ? r.score : null, tier });
  }
  if (!farms.length) return null;
  // Pins pop in north → south, so the sequence ends on the southern orchard the dive goes to.
  farms.sort((a, b) => b.centroid[1] - a.centroid[1]);
  const byTier = assessment?.farmsByTier ?? {};
  return {
    code: portfolio?.code ?? PORTFOLIO_ID,
    farms,
    outstanding: Number(assessment?.totalExposure) || 0,
    currency: assessment?.currency ?? portfolio?.currency ?? 'USD',
    high: Number(byTier.high) || farms.filter((f) => f.tier === 'high').length,
    watch: Number(byTier.watch) || farms.filter((f) => f.tier === 'watch').length,
  };
}

/** Warm the browser cache with the tiles a camera path will request (Leaflet loads tiles at round(zoom)). */
function preloadPath(camera: (p: number) => View, w: number, h: number, seen: Set<string>, imgs: HTMLImageElement[]) {
  const SAMPLES = 48;
  for (let i = 0; i <= SAMPLES; i++) {
    const v = camera(i / SAMPLES);
    const z = Math.min(SATELLITE_TILES.maxZoom, Math.round(v.zoom));
    const n = Math.pow(2, z);
    const [cx, cy] = merc(v.lat, v.lng);
    const halfX = (w / 2 / 256) * Math.pow(2, z - v.zoom) + 1;
    const halfY = (h / 2 / 256) * Math.pow(2, z - v.zoom) + 1;
    for (let tx = Math.floor(cx * n - halfX); tx <= Math.floor(cx * n + halfX); tx++) {
      for (let ty = Math.max(0, Math.floor(cy * n - halfY)); ty <= Math.min(n - 1, Math.floor(cy * n + halfY)); ty++) {
        const x = ((tx % n) + n) % n;
        const url = SATELLITE_TILES.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(ty));
        if (seen.has(url)) continue;
        seen.add(url);
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        imgs.push(img);
      }
    }
  }
}

interface Pt {
  x: number;
  y: number;
}
interface Placed {
  pin: Pt;
  label: Pt; // left-middle anchor of the label
  leader: boolean;
}

/**
 * Score labels that never overlap: pins closer than ~44 px form a cluster whose labels stack in one column to the
 * right of the cluster (with leader lines); lone pins get their label right beside them.
 */
function layoutLabels(pts: Pt[]): Placed[] {
  const R = 44;
  const ROW = 22;
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < R) parent[find(i)] = find(j);
  const out: Placed[] = pts.map((p) => ({ pin: p, label: { x: p.x + 11, y: p.y }, leader: false }));
  const groups = new Map<number, number[]>();
  pts.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    idx.sort((a, b) => pts[a].y - pts[b].y);
    const x = Math.max(...idx.map((i) => pts[i].x)) + 26;
    const my = idx.reduce((s, i) => s + pts[i].y, 0) / idx.length;
    idx.forEach((i, k) => {
      out[i] = { pin: pts[i], label: { x, y: my + (k - (idx.length - 1) / 2) * ROW }, leader: true };
    });
  }
  return out;
}

const fmtMoney = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function FlyInScene(props: { progress: number; dive?: number; width?: number; height?: number }): JSX.Element {
  const { progress, width, height } = props;
  const dive = clamp01(props.dive ?? 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ farms: L.Polygon[]; hero: L.Polygon | null }>({ farms: [], hero: null });
  const lastSize = useRef('');
  const [size, setSize] = useState<{ w: number; h: number }>({ w: width ?? 0, h: height ?? 0 });
  const [data, setData] = useState<Portfolio | null>(null);
  const [ready, setReady] = useState(0); // bumps when the map / layers exist, so a frozen progress still renders
  const [pts, setPts] = useState<{ pins: Pt[]; verts: Pt[] }>({ pins: [], verts: [] });

  // Measure (fixed props win; otherwise fill the parent).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: width ?? el.clientWidth, h: height ?? el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // Portfolio, polygons and tiers from the snapshot.
  useEffect(() => {
    let alive = true;
    loadPortfolio()
      .then((p) => alive && setData(p))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, []);

  const hero = data?.farms.find((f) => f.id === FARM_ID) ?? null;
  const pv = data && size.w && size.h ? portfolioView(data.farms, size.w, size.h) : FALLBACK_PORTFOLIO_VIEW;
  const target = hero ? { lat: hero.centroid[1], lng: hero.centroid[0] } : FALLBACK_TARGET;
  const endZoom = hero && size.w && size.h ? fitZoom(hero.ring, size.w, size.h) : END_ZOOM_DEFAULT;
  const view = dive > 0 ? cameraB(dive, pv, target, endZoom) : cameraA(clamp01(progress), pv);

  // Leaflet map, interactions off, fractional zoom.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomSnap: 0,
      zoomDelta: 0.25,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    }).setView([START.lat, START.lng], START.zoom, { animate: false });
    L.tileLayer(SATELLITE_TILES.url, {
      maxZoom: SATELLITE_TILES.maxZoom,
      maxNativeZoom: SATELLITE_TILES.maxZoom,
      updateWhenZooming: true,
      updateWhenIdle: false,
      updateInterval: 60,
      keepBuffer: 4,
      crossOrigin: true,
    }).addTo(map);
    mapRef.current = map;
    setReady((n) => n + 1);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Real polygons as Leaflet SVG paths in the map's own overlay pane: re-projected by Leaflet on every setView.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const renderer = L.svg({ padding: 0.5 });
    const ll = (f: Farm) => f.ring.map(([lng, lat]) => L.latLng(lat, lng));
    const farms = data.farms.map((f) =>
      L.polygon(ll(f), {
        renderer,
        interactive: false,
        className: 'flyin__farm',
        color: TIER_COLOR[f.tier],
        weight: 1.5,
        fillColor: TIER_COLOR[f.tier],
        fillOpacity: 0.35,
      }).addTo(map),
    );
    const heroFarm = data.farms.find((f) => f.id === FARM_ID);
    const heroPoly = heroFarm
      ? L.polygon(ll(heroFarm), {
          renderer,
          interactive: false,
          className: 'flyin__outline',
          color: TIER_COLOR[heroFarm.tier],
          weight: 2,
          lineJoin: 'miter',
          lineCap: 'square',
          fillColor: TIER_COLOR[heroFarm.tier],
          fillOpacity: 0.18,
          smoothFactor: 0, // keep every vertex so the outline meets the vertex markers exactly
          noClip: true, // unclipped path, so the normalised dash length is the true perimeter
        }).addTo(map)
      : null;
    heroPoly?.getElement()?.setAttribute('pathLength', '1');
    layersRef.current = { farms, hero: heroPoly };
    setReady((n) => n + 1);
    return () => {
      farms.forEach((p) => p.remove());
      heroPoly?.remove();
      renderer.remove();
      layersRef.current = { farms: [], hero: null };
    };
  }, [data, ready > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- choreography (pure functions of progress / dive) ----
  const n = data?.farms.length ?? 0;
  const pinSlot = n > 1 ? (0.93 - A_PINS_START - 0.07) / (n - 1) : 0;
  const pinPop = (i: number) => clamp01((progress - A_PINS_START - i * pinSlot) / 0.07);
  const othersFade = 1 - easeOutCubic(clamp01(dive / 0.3));
  const heroPinFade = 1 - clamp01((dive - 0.55) / 0.15);
  const heroShapeFade = 1 - clamp01((dive - 0.3) / 0.25);
  const chipA = easeOutCubic(clamp01((progress - 0.9) / 0.1)) * othersFade;
  const overlayT = clamp01((dive - B_CAMERA_END) / (1 - B_CAMERA_END));
  const drawT = easeInOutCubic(clamp01(overlayT / 0.6));
  const fillT = easeOutCubic(clamp01((overlayT - 0.6) / 0.25));
  const labelT = easeOutCubic(clamp01((overlayT - 0.55) / 0.3));

  // Move the camera, restyle the Leaflet paths, then read every pixel position back from Leaflet.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${size.w}x${size.h}`;
    if (key !== lastSize.current) {
      lastSize.current = key;
      map.invalidateSize({ animate: false, pan: false });
    }
    map.setView([view.lat, view.lng], view.zoom, { animate: false });
    const { farms, hero: heroPoly } = layersRef.current;
    data?.farms.forEach((f, i) => {
      const el = farms[i]?.getElement() as SVGElement | undefined;
      if (!el) return;
      const o = pinPop(i) * (f.id === FARM_ID ? heroShapeFade : othersFade);
      el.style.opacity = String(o);
    });
    const hel = heroPoly?.getElement() as SVGElement | undefined;
    if (hel) {
      hel.style.opacity = overlayT > 0 ? '1' : '0';
      hel.style.strokeDasharray = '1';
      hel.style.strokeDashoffset = String(1 - drawT);
      hel.style.fillOpacity = String(0.18 * fillT);
    }
    const cp = (lng: number, lat: number) => {
      const p = map.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    };
    const ring = hero?.ring ?? [];
    const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    setPts({
      pins: (data?.farms ?? []).map((f) => cp(f.centroid[0], f.centroid[1])),
      verts: (closed ? ring.slice(0, -1) : ring).map(([lng, lat]) => cp(lng, lat)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.lat, view.lng, view.zoom, size.w, size.h, data, ready, progress, dive]);

  // Preload both beats' tiles once the real targets and the viewport are known.
  const preloadKey = data && size.w && size.h ? `${size.w}x${size.h}` : '';
  useEffect(() => {
    if (!preloadKey) return;
    const seen = new Set<string>();
    const imgs: HTMLImageElement[] = [];
    preloadPath((p) => cameraA(p, pv), size.w, size.h, seen, imgs);
    preloadPath((d) => cameraB(d, pv, target, endZoom), size.w, size.h, seen, imgs);
    return () => {
      imgs.forEach((i) => (i.src = ''));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadKey]);

  // Vertex markers: where each vertex sits along the perimeter (screen-space, from Leaflet's projection).
  const geo = useMemo(() => {
    const v = pts.verts;
    if (v.length < 3) return null;
    const lens = [0];
    for (let i = 1; i <= v.length; i++) {
      const a = v[i - 1];
      const b = v[i % v.length];
      lens.push(lens[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = lens[lens.length - 1] || 1;
    return {
      verts: v.map((p, i) => ({ ...p, at: lens[i] / total })),
      top: Math.min(...v.map((p) => p.y)),
      cx: v.reduce((a, p) => a + p.x, 0) / v.length,
    };
  }, [pts.verts]);

  const labels = useMemo(() => layoutLabels(pts.pins), [pts.pins]);

  const mpp = metersPerPixel(view.lat, view.zoom);
  const scale = niceScale(mpp, 120);
  const altitude = mpp * (size.h || 800) * 0.866; // ~60° vertical FOV

  const rootStyle: React.CSSProperties = {
    width: width != null ? `${width}px` : '100%',
    height: height != null ? `${height}px` : '100%',
  };

  return (
    <div ref={rootRef} className="flyin" style={rootStyle}>
      <div ref={mapEl} className="flyin__map" />

      {data && labels.length === data.farms.length && (
        <svg className="flyin__overlay" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
          {data.farms.map((f, i) => {
            const k = pinPop(i);
            const o = f.id === FARM_ID ? heroPinFade : othersFade;
            if (k <= 0 || o <= 0) return null;
            const { pin, label, leader } = labels[i];
            const s = 9 * easeOutBack(k);
            const lt = clamp01((k - 0.5) / 0.5);
            const text = f.score != null ? f.score.toFixed(1) : '–';
            return (
              <g key={f.id} opacity={o}>
                {leader && lt > 0 && (
                  <polyline
                    className="flyin__leader"
                    points={`${pin.x},${pin.y} ${label.x - 8},${label.y} ${label.x - 2},${label.y}`}
                    opacity={lt}
                  />
                )}
                <rect className="flyin__pin" x={pin.x - s / 2} y={pin.y - s / 2} width={s} height={s} rx={1} fill={TIER_COLOR[f.tier]} />
                {lt > 0 && (
                  <g opacity={lt} transform={`translate(${label.x + (1 - lt) * -4},${label.y})`}>
                    <rect className="flyin__tag" x={0} y={-9} width={8 + text.length * 7.2} height={18} rx={2} stroke={TIER_COLOR[f.tier]} />
                    <text className="flyin__tag-text" x={4} y={4}>
                      {text}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {geo &&
            overlayT > 0 &&
            geo.verts.map((v, i) => {
              const k = clamp01((drawT - v.at) / 0.06);
              if (k <= 0) return null;
              const s = 7 * easeOutCubic(k);
              return <rect key={i} className="flyin__vertex" x={Math.round(v.x - s / 2)} y={Math.round(v.y - s / 2)} width={s} height={s} rx={1.5} />;
            })}
        </svg>
      )}

      {geo && hero && labelT > 0 && (
        <div
          className="flyin__chip"
          style={{
            left: geo.cx,
            top: geo.top - 14,
            opacity: labelT,
            transform: `translate(-50%, calc(-100% + ${(1 - labelT) * 8}px))`,
            borderColor: TIER_COLOR[hero.tier],
          }}
        >
          <span className="flyin__chip-dot" style={{ background: TIER_COLOR[hero.tier] }} />
          Los Ángeles · Biobío · cherry · {hero.areaHa.toFixed(1)} ha
          {hero.score != null && <span className="flyin__chip-score">risk {hero.score.toFixed(1)}</span>}
        </div>
      )}

      <div className="flyin__grid" aria-hidden />
      <div className="flyin__vignette" aria-hidden />

      {data && chipA > 0 && (
        <div className="flyin__hud flyin__hud--tc" style={{ opacity: chipA }}>
          <span className="flyin__hud-k">{data.code}</span>
          <span>{data.farms.length} orchards</span>
          <span>
            {data.currency} {fmtMoney(data.outstanding)}
          </span>
          <span>
            <i className="flyin__sw" style={{ background: TIER_COLOR.high }} />
            {data.high} high
          </span>
          <span>
            <i className="flyin__sw" style={{ background: TIER_COLOR.watch }} />
            {data.watch} watch
          </span>
        </div>
      )}

      <div className="flyin__hud flyin__hud--tl">
        <div className="flyin__hud-k">CAM</div>
        <div>{fmtCoord(view.lat, 'N', 'S')}</div>
        <div>{fmtCoord(view.lng, 'E', 'W')}</div>
      </div>
      <div className="flyin__hud flyin__hud--tr">
        <div className="flyin__hud-k">ALT</div>
        <div>{fmtAlt(altitude)}</div>
        <div className="flyin__hud-dim">z {view.zoom.toFixed(2)}</div>
      </div>
      <div className="flyin__hud flyin__hud--bl">
        <div className="flyin__scale" style={{ width: Math.round(scale.px) }} />
        <div>{scale.label}</div>
      </div>
      <div className="flyin__hud flyin__hud--br flyin__attr">{ATTRIBUTION}</div>
    </div>
  );
}

export default FlyInScene;
