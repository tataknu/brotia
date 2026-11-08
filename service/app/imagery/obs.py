"""Per-polygon, per-scene observations from native pixels, cached in DuckDB (imagery_obs).

An observation = (date, clear fraction inside the polygon, mean NDVI and NDMI over the clear
polygon pixels). NDVI = (B08 - B04) / (B08 + B04) on native 10 m bands; NDMI = (B8A - B11) /
(B8A + B11) on native 20 m bands (the ADR-0007 D1 pair). Reflectance = (DN - offset) / 10000 with
the ADR-0007 D3 offset. Clear = SCL in {4, 5, 6} and data mask valid.

Usable for the series and the baseline: clear fraction >= 0.5 (ADR-0007 D2) and not rejected by the
haze spike check. Observed imagery frames need >= 0.8 (CONTRACT §E.12).
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

import numpy as np

from app import config, http, store

from . import s2
from .geo import Grid

log = logging.getLogger("clm.imagery")

USABLE_CLEAR = 0.5
OBSERVED_CLEAR = 0.8
SPIKE_DROP = 0.15  # ADR-0007 D2 (proposed, untested): reject a sharp drop that recovers
SPIKE_NEIGHBOUR_DAYS = 30
MIN_DATA_SHARE = 0.5  # a scene must cover >= half the polygon with data

_TABLE = """CREATE TABLE IF NOT EXISTS imagery_obs (
    poly_key VARCHAR NOT NULL,
    item_id VARCHAR NOT NULL,
    date DATE NOT NULL,
    clear_frac DOUBLE,
    ndvi DOUBLE,
    ndmi DOUBLE,
    data_px INTEGER,
    poly_px INTEGER,
    fetched_at TIMESTAMPTZ,
    stale BOOLEAN,
    PRIMARY KEY (poly_key, item_id)
)"""
_table_ready: set[str] = set()
_table_lock = threading.Lock()


def _ensure_table() -> None:
    key = str(config.db_path())
    with _table_lock:
        if key not in _table_ready:
            store.execute(_TABLE)
            _table_ready.add(key)


@dataclass
class Obs:
    date: date
    item_id: str
    clear_frac: float
    ndvi: float | None
    ndmi: float | None
    data_px: int = 0
    poly_px: int = 0
    stale: bool = False
    fetched_at: datetime | None = None
    spike: bool = False

    @property
    def has_data(self) -> bool:
        return self.ndvi is not None and self.poly_px > 0 and self.data_px >= MIN_DATA_SHARE * self.poly_px

    @property
    def usable(self) -> bool:
        return self.has_data and self.clear_frac >= USABLE_CLEAR and not self.spike

    @property
    def observed(self) -> bool:
        return self.usable and self.clear_frac >= OBSERVED_CLEAR


# ───────────────────────── pixel maths ─────────────────────────


def reflectance(dn: np.ndarray, offset: int) -> np.ndarray:
    return (dn.astype(np.float32) - float(offset)) / 10000.0


def indices(bands: dict[str, np.ndarray], offset: int) -> tuple[np.ndarray, np.ndarray]:
    """(ndvi, ndmi) float32 arrays; NaN where the denominator is not positive."""
    r = reflectance(bands["B04"], offset)
    n8 = reflectance(bands["B08"], offset)
    n8a = reflectance(bands["B8A"], offset)
    s11 = reflectance(bands["B11"], offset)
    with np.errstate(divide="ignore", invalid="ignore"):
        den1 = n8 + r
        den2 = n8a + s11
        ndvi = np.where(den1 > 0, (n8 - r) / den1, np.nan).astype(np.float32)
        ndmi = np.where(den2 > 0, (n8a - s11) / den2, np.nan).astype(np.float32)
    return np.clip(ndvi, -1, 1), np.clip(ndmi, -1, 1)


def masks(bands: dict[str, np.ndarray], valid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(data, clear) boolean arrays. data = mask valid and SCL > 0 and B04/B08 > 0."""
    scl = bands["SCL"]
    data = valid & (scl > 0) & (bands["B04"] > 0) & (bands["B08"] > 0)
    clear = data & np.isin(scl, s2.SCL_CLEAR)
    return data, clear


def split_bands(arr: np.ndarray, names: tuple[str, ...]) -> tuple[dict[str, np.ndarray], np.ndarray]:
    return {n: arr[i] for i, n in enumerate(names)}, arr[len(names)] > 0


def polygon_stats(bands: dict[str, np.ndarray], valid: np.ndarray, offset: int, poly_mask: np.ndarray) -> dict:
    data, clear = masks(bands, valid)
    ndvi, ndmi = indices(bands, offset)
    pm = poly_mask
    c = clear & pm & np.isfinite(ndvi)
    n_poly = int(pm.sum())
    n_data = int((data & pm).sum())
    n_clear = int(c.sum())
    out = {"poly_px": n_poly, "data_px": n_data, "clear_frac": (n_clear / n_data) if n_data else 0.0,
           "ndvi": None, "ndmi": None}
    if n_clear:
        out["ndvi"] = float(np.mean(ndvi[c]))
        cm = c & np.isfinite(ndmi)
        out["ndmi"] = float(np.mean(ndmi[cm])) if cm.any() else None
    return out


# ───────────────────────── cache table ─────────────────────────


def load(poly_key: str, item_ids: list[str] | None = None) -> dict[str, Obs]:
    _ensure_table()
    rows = store.query(
        "SELECT item_id, date, clear_frac, ndvi, ndmi, data_px, poly_px, fetched_at, stale FROM imagery_obs WHERE poly_key = ?",
        [poly_key])
    out = {}
    want = set(item_ids) if item_ids is not None else None
    for iid, d, cf, nv, nm, dp, pp, fa, st in rows:
        if want is not None and iid not in want:
            continue
        out[iid] = Obs(date=d if isinstance(d, date) else date.fromisoformat(str(d)), item_id=iid,
                       clear_frac=float(cf or 0), ndvi=nv, ndmi=nm, data_px=int(dp or 0), poly_px=int(pp or 0),
                       fetched_at=fa, stale=bool(st))
    return out


def save(poly_key: str, obs: list[Obs]) -> None:
    if not obs:
        return
    _ensure_table()
    with store.connect() as con:
        con.executemany(
            "INSERT OR REPLACE INTO imagery_obs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [[poly_key, o.item_id, o.date, o.clear_frac, o.ndvi, o.ndmi, o.data_px, o.poly_px, o.fetched_at, o.stale]
             for o in obs])


# ───────────────────────── fetching ─────────────────────────


@dataclass
class Target:
    """One polygon on a fetch grid (several targets can share a grid = one call per scene)."""

    key: str  # poly_key: polygon hash + grid key
    mask: np.ndarray


@dataclass
class FetchReport:
    fetched: int = 0
    cached: int = 0
    failed: int = 0
    skipped_budget: int = 0
    stale: bool = False
    latest_fetch: datetime | None = None
    errors: list[str] = field(default_factory=list)

    def merge(self, o: "FetchReport") -> None:
        self.fetched += o.fetched
        self.cached += o.cached
        self.failed += o.failed
        self.skipped_budget += o.skipped_budget
        self.stale = self.stale or o.stale
        if o.latest_fetch and (not self.latest_fetch or o.latest_fetch > self.latest_fetch):
            self.latest_fetch = o.latest_fetch
        self.errors.extend(o.errors[:5])


def collect(items: list[s2.Item], grid: Grid, targets: list[Target], bands: tuple[str, ...] = s2.HISTORY_BANDS,
            deadline: float | None = None, on_array: Callable[[s2.Item, np.ndarray, http.FetchResult], None] | None = None,
            ) -> tuple[dict[str, dict[str, Obs]], FetchReport]:
    """Observations for every target on every item. Cached rows are reused; missing items are fetched
    (up to the s2 source limit, 8, via app.http; ADR-0023) until `deadline` (time.monotonic()); later items are skipped and
    counted in skipped_budget. Returns ({target_key: {item_id: Obs}}, report)."""
    rep = FetchReport()
    have = {t.key: load(t.key, [i.id for i in items]) for t in targets}
    missing = [i for i in items if any(i.id not in have[t.key] for t in targets)]
    rep.cached = len(items) - len(missing)
    for t in targets:
        for o in have[t.key].values():
            rep.stale = rep.stale or o.stale
            if o.fetched_at and (not rep.latest_fetch or o.fetched_at > rep.latest_fetch):
                rep.latest_fetch = o.fetched_at

    lock = threading.Lock()
    new_rows: dict[str, list[Obs]] = {t.key: [] for t in targets}

    def work(item: s2.Item) -> None:
        if deadline is not None and time.monotonic() > deadline:
            with lock:
                rep.skipped_budget += 1
            return
        try:
            arr, r = s2.fetch_bands(item, grid, bands)
        except http.FetchError as e:
            with lock:
                rep.failed += 1
                rep.errors.append(f"{item.id}: {e.reason}")
            return
        except Exception as e:  # malformed payload etc.: skip the scene, never invent
            with lock:
                rep.failed += 1
                rep.errors.append(f"{item.id}: {e.__class__.__name__}")
            return
        bd, valid = split_bands(arr, bands)
        rows = []
        for t in targets:
            st = polygon_stats(bd, valid, item.offset, t.mask)
            rows.append((t.key, Obs(date=item.date, item_id=item.id, clear_frac=round(st["clear_frac"], 4),
                                    ndvi=st["ndvi"], ndmi=st["ndmi"], data_px=st["data_px"], poly_px=st["poly_px"],
                                    stale=r.stale, fetched_at=r.fetched_at)))
        if on_array:
            on_array(item, arr, r)
        with lock:
            rep.fetched += 1
            rep.stale = rep.stale or r.stale
            if not rep.latest_fetch or r.fetched_at > rep.latest_fetch:
                rep.latest_fetch = r.fetched_at
            for k, o in rows:
                new_rows[k].append(o)
                have[k][o.item_id] = o

    if missing:
        with ThreadPoolExecutor(max_workers=http.source_limit(s2.SOURCE), thread_name_prefix="s2") as ex:
            list(ex.map(work, missing))
        for k, rows in new_rows.items():
            try:
                save(k, rows)
            except Exception as e:  # cache write failure is not fatal
                log.warning("imagery_obs save failed: %s", e)
    return have, rep


def mark_spikes(obs: list[Obs], variable: str = "ndvi") -> None:
    """ADR-0007 D2 haze check on the usable series: flag an observation that drops more than
    SPIKE_DROP below BOTH neighbours (within SPIKE_NEIGHBOUR_DAYS) and recovers."""
    us = sorted([o for o in obs if o.has_data and o.clear_frac >= USABLE_CLEAR and getattr(o, variable) is not None],
                key=lambda o: o.date)
    for i in range(1, len(us) - 1):
        a, b, c = us[i - 1], us[i], us[i + 1]
        if (b.date - a.date).days > SPIKE_NEIGHBOUR_DAYS or (c.date - b.date).days > SPIKE_NEIGHBOUR_DAYS:
            continue
        va, vb, vc = a.ndvi, b.ndvi, c.ndvi
        if vb < va - SPIKE_DROP and vb < vc - SPIKE_DROP:
            b.spike = True
