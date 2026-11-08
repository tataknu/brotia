"""Farm relocation: keep-or-move each sample farm onto credible cropland, using keyless clips
fetched by fetch_rasters.py (MapBiomas Bolivia 2024, GLAD soy 2021-23, ESA WorldCover 2021, JRC GSW occurrence).

Usage: python select_fields.py <clip_dir> <out_json>
Field = 900 m x 900 m square in UTM 20S (EPSG:32720) = 81 ha.
Fractions are computed per polygon on each raster's NATIVE grid (pixel centre inside polygon).
"""
import sys, json, math
import numpy as np, rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from pyproj import Transformer

D = sys.argv[1]
FARMS = [("Estancia Los Tajibos","soy",-62.52,-16.86),("Agropecuaria Brecha 8","maize",-62.70,-16.97),
 ("Colonia Cuatro Canadas Lote 7","soy",-62.47,-17.30),("Hacienda El Cusi","sorghum",-62.55,-17.38),
 ("Agricola Pailon Norte","wheat",-62.68,-17.56),("Granja Las Londras","sunflower",-62.76,-17.74),
 ("Finca Okinawa Dos","maize",-62.85,-17.18),("Parcela Okinawa Uno","soy",-62.93,-17.27),
 ("Arrocera Mineros","rice",-63.29,-17.20),("Canaveral San Antonio","sugarcane",-63.21,-17.29),
 ("Agricola Warnes Sur","soy",-63.08,-17.56),("Estancia Mineros Norte","soy",-63.18,-17.03)]
SIDE = 900.0
MONTERO = (-63.25, -17.34)  # town centre, Guabira sugar mill zone (approx.)
fwd = Transformer.from_crs(4326, 32720, always_xy=True)
inv = Transformer.from_crs(32720, 4326, always_xy=True)

def load(name):
    with rasterio.open(f"{D}/{name}.tif") as ds:
        return ds.read(1), ds.transform, ds.crs
MB, MBT, _ = load("mapbiomas2024")
G = [load(f"gladsoy{y}") for y in (2021, 2022, 2023)]
GMAX, GT = np.maximum.reduce([g[0] for g in G]), G[0][1]
WC = [load("worldcover2021_0"), load("worldcover2021_1")]
JRC, JT, _ = load("jrcocc_0")

def square(lon, lat, side=SIDE):
    x, y = fwd.transform(lon, lat); h = side / 2
    ring = [(x-h, y-h), (x+h, y-h), (x+h, y+h), (x-h, y+h), (x-h, y-h)]
    ll = [tuple(round(c, 6) for c in inv.transform(*p)) for p in ring]
    return {"type": "Polygon", "coordinates": [ll]}

def inside(geom, arr, tr):
    m = ~geometry_mask([geom], out_shape=arr.shape, transform=tr, all_touched=False)
    return arr[m]

def fractions(geom):
    mb = inside(geom, MB, MBT)
    n = mb.size
    f = {"mb_n": int(n)}
    for k, lab in [(39, "mb39_soy"), (72, "mb72_othercrop"), (18, "mb18_agri"), (21, "mb21_mosaic"), (15, "mb15_pasture"),
                   (3, "mb3_forest"), (33, "mb33_water"), (23, "mb23_sand"), (12, "mb12_grass"), (24, "mb24_urban")]:
        f[lab] = round(float((mb == k).mean()), 3)
    f["mb_agri"] = round(f["mb39_soy"] + f["mb72_othercrop"] + f["mb18_agri"] + 0.5 * f["mb21_mosaic"], 3)
    g = inside(geom, GMAX, GT); f["glad_soy_max21_23"] = round(float((g == 1).mean()), 3)
    for y, (a, t, _) in zip((2021, 2022, 2023), G):
        f[f"glad_soy_{y}"] = round(float((inside(geom, a, t) == 1).mean()), 3)
    wc = np.concatenate([inside(geom, a, t) for a, t, _ in WC])
    wc = wc[wc > 0]
    f["wc40_cropland"] = round(float((wc == 40).mean()), 3); f["wc30_grass"] = round(float((wc == 30).mean()), 3)
    f["wc10_tree"] = round(float((wc == 10).mean()), 3); f["wc80_water"] = round(float((wc == 80).mean()), 3)
    j = inside(geom, JRC, JT)
    f["jrc_ever_water"] = round(float((j > 0).mean()), 3); f["jrc_occ_mean"] = round(float(j.mean()), 2)
    return f

def gate(crop, f, strict):
    """Suitability rule. strict=True for relocated fields, False for keeping an original point."""
    agri_min, wc_min = (0.95, 0.85) if strict else (0.90, 0.60)
    ok = f["mb_agri"] >= agri_min and f["wc40_cropland"] >= wc_min and f["mb33_water"] == 0 and f["mb3_forest"] <= 0.03
    if crop == "soy":  # max as requested, plus soy in >=2 of the 3 seasons (one-off soy years are rotations, not soy fields)
        ok = ok and f["glad_soy_max21_23"] >= 0.80 and sum(f[f"glad_soy_{y}"] >= 0.5 for y in (2021, 2022, 2023)) >= 2
    elif crop in ("maize", "sorghum", "wheat", "sunflower"):
        ok = ok and f["glad_soy_max21_23"] >= 0.50  # winter/rotation crops sit on soy-belt fields
    elif crop == "sugarcane":
        ok = ok and f["glad_soy_max21_23"] <= 0.10  # perennial cane: never mapped as soy
    elif crop == "rice":
        ok = ok and f["glad_soy_max21_23"] <= 0.20 and f["jrc_ever_water"] >= 0.05
    elif crop == "nonsoy":  # provisional tier for rice: non-soy cropland, no paddy evidence required
        ok = ok and f["glad_soy_max21_23"] <= 0.05
    return ok

def boxsum(a, h, w):
    c = np.pad(a.astype("float64"), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return c[h:, w:] - c[:-h, w:] - c[h:, :-w] + c[:-h, :-w]  # sum of a[i:i+h, j:j+w]

def hav(lon1, lat1, lon2, lat2):
    p = math.pi / 180
    a = math.sin((lat2-lat1)*p/2)**2 + math.cos(lat1*p)*math.cos(lat2*p)*math.sin((lon2-lon1)*p/2)**2
    return 12742 * math.asin(math.sqrt(a))

# candidate screen on the MapBiomas grid (approximate square in degrees), then exact check per polygon
agri = np.isin(MB, (39, 72, 18)).astype("float32") + 0.5 * (MB == 21)
res = MBT.a
hpx = int(round(SIDE / 110574 / res)); wpx = int(round(SIDE / (111320 * math.cos(math.radians(17.3))) / res))
S_AGRI = boxsum(agri, hpx, wpx) / (hpx * wpx)
S_BAD = boxsum(np.isin(MB, (3, 33, 23, 24, 6, 11)).astype("float32"), hpx, wpx)
# GLAD max nearest-resampled to MB grid for screening only
rows = np.arange(MB.shape[0]); cols = np.arange(MB.shape[1])
lat_c = MBT.f + (rows + 0.5) * MBT.e; lon_c = MBT.c + (cols + 0.5) * MBT.a
gr = np.clip(((lat_c - GT.f) / GT.e).astype(int), 0, GMAX.shape[0]-1); gc = np.clip(((lon_c - GT.c) / GT.a).astype(int), 0, GMAX.shape[1]-1)
G_ON_MB = GMAX[np.ix_(gr, gc)]
S_SOY = boxsum(G_ON_MB, hpx, wpx) / (hpx * wpx)
J_ON_MB = JRC[np.ix_(np.clip(((lat_c - JT.f) / JT.e).astype(int), 0, JRC.shape[0]-1), np.clip(((lon_c - JT.c) / JT.a).astype(int), 0, JRC.shape[1]-1))]
S_WET = boxsum((J_ON_MB > 0).astype("float32"), hpx, wpx) / (hpx * wpx)

def screen_ok(crop, i, j):
    if S_AGRI[i, j] < 0.95 or S_BAD[i, j] > 0: return False
    s = S_SOY[i, j]
    if crop == "soy": return s >= 0.85
    if crop in ("maize", "sorghum", "wheat", "sunflower"): return s >= 0.6
    if crop == "sugarcane": return s <= 0.05
    if crop == "rice": return s <= 0.15 and S_WET[i, j] >= 0.05
    if crop == "nonsoy": return s <= 0.02
    return True

out = []
for name, crop, lon, lat in FARMS:
    g0 = square(lon, lat); f0 = fractions(g0)
    rec = {"name": name, "crop": crop, "orig_lonlat": [lon, lat], "orig_fractions": f0}
    if gate(crop, f0, strict=False):
        rec.update(status="kept", lonlat=[lon, lat], polygon=g0, fractions=f0, moved_km=0.0)
    else:
        def search(ckey, km=10):
            r0 = int((lat - MBT.f) / MBT.e); c0 = int((lon - MBT.c) / MBT.a)
            rad = int(km * 1000 / 110574 / res) + 1
            cands = []
            for i in range(max(0, r0-rad), min(S_AGRI.shape[0], r0+rad), 3):
                for j in range(max(0, c0-rad), min(S_AGRI.shape[1], c0+rad), 3):
                    clat = MBT.f + (i + hpx/2) * MBT.e; clon = MBT.c + (j + wpx/2) * MBT.a
                    d = hav(lon, lat, clon, clat)
                    if d <= km and screen_ok(ckey, i, j): cands.append((d, clon, clat))
            cands.sort()
            for d, clon, clat in cands[:400]:
                g = square(clon, clat); f = fractions(g)
                if gate(ckey, f, strict=True): return len(cands), (d, clon, clat, g, f)
            return len(cands), None
        rec["n_screen_candidates"], chosen = search(crop)
        if chosen is None and crop == "soy":
            rec["n_screen_candidates_20km"], chosen = search("soy", km=20)
            if chosen: rec["provisional"] = "no multi-year soy field within 10 km; nearest one found within 20 km"
        if chosen is None and crop == "rice":
            rec["n_screen_candidates_nonsoy"], chosen = search("nonsoy")
            rec["provisional"] = "no field within 10 km shows paddy evidence (JRC ever-water >=5%) on cropland; placed on nearest non-soy cropland instead"
        if chosen:
            d, clon, clat, g, f = chosen
            rec.update(status="moved_provisional" if rec.get("provisional") else "moved", lonlat=[round(clon, 5), round(clat, 5)], polygon=g, fractions=f, moved_km=round(d, 2))
        else:
            rec.update(status="no_credible_site", lonlat=None, polygon=None, fractions=None, moved_km=None)
    if crop == "sugarcane" and rec.get("lonlat"):
        rec["km_to_montero"] = round(hav(*rec["lonlat"], *MONTERO), 1)
    print(name, crop, rec["status"], rec.get("lonlat"), rec.get("moved_km"), rec.get("n_screen_candidates"),
          {k: v for k, v in (rec["fractions"] or f0).items() if k in ("mb_agri", "wc40_cropland", "glad_soy_max21_23", "jrc_ever_water", "mb3_forest")}, flush=True)
    out.append(rec)
json.dump(out, open(sys.argv[2], "w"), indent=1)
