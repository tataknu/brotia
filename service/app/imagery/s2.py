"""Sentinel-2 L2A on Microsoft Planetary Computer (ADR-0007 D1-D4, ADR-0012). Keyless.

- STAC search: POST /api/stac/v1/search with the `fields` extension (no assets), split by calendar
  year so closed years are cached forever. Anonymous; no SAS token is needed because pixels are
  read through the PC data API, which reads the COGs server side.
- Pixels: GET /api/data/v1/item/bbox/{minx},{miny},{maxx},{maxy}/{W}x{H}.npy?assets=...
  returns uint16 (len(assets)+1, H, W) on an EPSG:4326 grid exactly covering the bbox, nearest
  neighbour from the native UTM pixels; the last band is the data mask (255 = valid). One call per
  scene, ~0.4-0.8 s (probed 2026-11-07). Band order follows the `assets` order.
- Zone reference: POST /api/data/v1/item/statistics with a histogram (one Feature per call; a
  FeatureCollection with more than one feature returns HTTP 500 on PC, probed 2026-11-07).
- DN offset (ADR-0007 D3): subtract 1000 from every band only when the ITEM's
  s2:processing_baseline >= 04.00.
- Dedup (ADR-0007 D4): one item per acquisition date: prefer an item whose footprint contains the
  target, then the dominant MGRS tile, then the highest processing baseline, then the latest
  generation time.
All calls go through app.http (cache in DuckDB, <= 8 concurrent per ADR-0023, honest User-Agent, timeouts).
"""

from __future__ import annotations

import io
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
from shapely.geometry import shape

from app import config, http

from .geo import Grid

log = logging.getLogger("clm.imagery")

SOURCE = "s2_l2a_pc"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1"
COLLECTION = "sentinel-2-l2a"

WINDOW_BANDS = ("B02", "B03", "B04", "B08", "B8A", "B11", "SCL")
HISTORY_BANDS = ("B04", "B08", "B8A", "B11", "SCL")
SCL_CLEAR = (4, 5, 6)  # vegetation, bare soil, water (ADR-0007; 3 = cloud shadow is NOT clear)

#: Tile-level cloud prefilters (eo:cloud_cover, %). The polygon's own SCL decides usability; these
#: only skip scenes that are almost certainly cloudy over the farm, to save calls.
WINDOW_MAX_CLOUD = 95.0
RECENT_PEER_MAX_CLOUD = 80.0
HISTORY_MAX_CLOUD = 50.0

#: ADR-0023 (amends ADR-0012 D3): Planetary Computer (STAC + data API reading Azure blob COGs) is a cloud
#: service built for parallel reads; 8 concurrent calls, 429/5xx back off through app.http.
MAX_CONCURRENCY = 8
http.register_source(SOURCE, max_concurrency=MAX_CONCURRENCY, min_interval_s=0.0, timeout_s=60.0, retries=2)

_FIELDS = {
    "include": [
        "id", "geometry", "properties.datetime", "properties.eo:cloud_cover",
        "properties.s2:processing_baseline", "properties.s2:mgrs_tile", "properties.s2:generation_time",
        "properties.s2:datatake_id",
    ],
    "exclude": ["assets", "links"],
}


@dataclass(frozen=True)
class Item:
    id: str
    date: date
    cloud: float
    baseline: str
    tile: str
    generation: str
    geometry: Any = field(default=None, compare=False, hash=False)

    @property
    def offset(self) -> int:
        return dn_offset(self.baseline)


def dn_offset(baseline: str | None) -> int:
    """ADR-0007 D3 (PC): 1000 when the item's processing baseline >= 04.00, else 0."""
    try:
        return 1000 if float(baseline or 0) >= 4.0 else 0
    except ValueError:
        return 0


@dataclass
class SearchResult:
    items: list[Item]
    fetched_at: datetime | None = None
    stale: bool = False
    errors: list[str] = field(default_factory=list)


def _parse_item(f: dict) -> Item | None:
    p = f.get("properties") or {}
    dt = p.get("datetime")
    if not dt:
        return None
    try:
        geom = shape(f["geometry"]) if f.get("geometry") else None
    except Exception:  # pragma: no cover - malformed footprint
        geom = None
    return Item(
        id=f["id"],
        date=date.fromisoformat(dt[:10]),
        cloud=float(p.get("eo:cloud_cover") if p.get("eo:cloud_cover") is not None else 100.0),
        baseline=str(p.get("s2:processing_baseline") or "00.00"),
        tile=str(p.get("s2:mgrs_tile") or ""),
        generation=str(p.get("s2:generation_time") or ""),
        geometry=geom,
    )


def _search_chunk(bbox: tuple[float, float, float, float], start: date, end: date, ttl: float | None) -> tuple[list[Item], http.FetchResult]:
    body: dict = {
        "collections": [COLLECTION],
        "bbox": [round(v, 5) for v in bbox],
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "limit": 1000,
        "fields": _FIELDS,
    }
    url = STAC_URL
    items: list[Item] = []
    first: http.FetchResult | None = None
    for _ in range(10):  # pagination guard
        r = http.post_json(SOURCE, url, json_body=body, ttl=ttl, timeout=60, allow_empty=False,
                           validate=lambda js: isinstance(js, dict) and "features" in js)
        first = first or r
        for f in r.body.get("features", []):
            it = _parse_item(f)
            if it:
                items.append(it)
        nxt = [lk for lk in r.body.get("links", []) if lk.get("rel") == "next"]
        if not nxt:
            break
        url = nxt[0]["href"]
        body = nxt[0].get("body") or body
    assert first is not None
    return items, first


def search(bbox: tuple[float, float, float, float], start: date, end: date, today: date | None = None) -> SearchResult:
    """All items intersecting bbox in [start, end], one STAC call per calendar year (closed years,
    ending > 45 days before today, are cached forever; recent chunks 6 h)."""
    today = today or config.utcnow().date()
    res = SearchResult(items=[])
    seen: set[str] = set()
    for year in range(start.year, end.year + 1):
        y0, y1 = date(year, 1, 1), date(year, 12, 31)
        closed = y1 < today - timedelta(days=45)
        # Every chunk is the whole calendar year (a future end date is fine for STAC), so the cache
        # key is stable across days: an open year refreshes every 6 h and, if the refresh fails (or
        # CLM_OFFLINE=1), app.http serves the last good copy marked stale instead of nothing.
        c_end = y1
        ttl = None if closed else http.TTL_6H
        try:
            items, r = _search_chunk(bbox, y0, c_end, ttl)
        except http.FetchError as e:
            res.errors.append(f"STAC search {year}: {e.reason}")
            continue
        res.stale = res.stale or r.stale
        if r.stale and r.error:
            res.errors.append(f"STAC search {year} served stale: {r.error}")
        res.fetched_at = max(res.fetched_at, r.fetched_at) if res.fetched_at else r.fetched_at
        for it in items:
            if start <= it.date <= end and it.id not in seen:
                seen.add(it.id)
                res.items.append(it)
    res.items.sort(key=lambda i: (i.date, i.id))
    return res


def select_per_date(items: list[Item], target: Any, max_cloud: float = 100.0,
                    dates: set[date] | None = None) -> list[Item]:
    """One item per date for `target` (a shapely geometry). Items whose footprint misses the target
    are dropped; ties resolved per ADR-0007 D4."""
    cand = [i for i in items if i.cloud < max_cloud and (dates is None or i.date in dates)
            and (i.geometry is None or i.geometry.intersects(target))]
    tiles = Counter(i.tile for i in cand)
    by_date: dict[date, list[Item]] = {}
    for i in cand:
        by_date.setdefault(i.date, []).append(i)
    out = []
    for d, its in by_date.items():
        its.sort(key=lambda i: (
            1 if (i.geometry is None or i.geometry.contains(target)) else 0,
            tiles[i.tile],
            float(i.baseline) if i.baseline.replace(".", "").isdigit() else 0.0,
            i.generation,
        ), reverse=True)
        out.append(its[0])
    out.sort(key=lambda i: i.date)
    return out


def fetch_bands(item: Item, grid: Grid, bands: tuple[str, ...]) -> tuple[np.ndarray, http.FetchResult]:
    """uint16 array (len(bands)+1, H, W); last band = data mask (255 valid). Cached forever (an
    item id never changes content). Raises http.FetchError when it fails and nothing is cached."""
    b = grid.bbox
    url = f"{DATA_API}/item/bbox/{b[0]:.6f},{b[1]:.6f},{b[2]:.6f},{b[3]:.6f}/{grid.width}x{grid.height}.npy"
    params = [("collection", COLLECTION), ("item", item.id)] + [("assets", a) for a in bands] + [("resampling", "nearest")]

    def _ok(raw: bytes) -> bool:
        try:
            a = np.load(io.BytesIO(raw))
            return a.shape == (len(bands) + 1, grid.height, grid.width)
        except Exception:
            return False

    r = http.get_bytes(SOURCE, url, params=params, ttl=None, timeout=60, validate=_ok)
    arr = np.load(io.BytesIO(r.body))
    return arr, r


def zone_ndvi_histogram(item: Item, geom: dict, bins: int = 40) -> tuple[np.ndarray, np.ndarray, http.FetchResult]:
    """Histogram of clear-pixel NDVI (B08/B04, offset-corrected) over a polygon (the zone circle),
    10 m native (max_size 1024 covers a 6.7 km circle at native resolution). Non-clear pixels are set
    to -2 and fall outside the histogram range."""
    o = 2 * item.offset
    c = "((SCL==4)|(SCL==5)|(SCL==6))"
    expr = f"where({c},(B08-B04)/(B08+B04-{o}),-2)"
    params = {"collection": COLLECTION, "item": item.id, "expression": expr, "asset_as_band": "true",
              "max_size": 1024, "histogram_bins": bins, "histogram_range": "-1,1"}
    r = http.post_json(SOURCE, f"{DATA_API}/item/statistics", json_body={"type": "Feature", "properties": {}, "geometry": geom},
                       params=params, ttl=None, timeout=90,
                       validate=lambda js: isinstance(js, dict) and "properties" in js)
    st = list(r.body["properties"]["statistics"].values())[0]
    counts, edges = st["histogram"]
    return np.asarray(counts, float), np.asarray(edges, float), r
