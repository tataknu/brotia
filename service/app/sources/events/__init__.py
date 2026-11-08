"""svc-water-events: event catalogues for the recent-disasters panel and the D/G risk inputs (ADR-0009).

Public API (routers, app.risk, app.agent):

    list_events(bbox, since, until=None) -> list[ClimateEvent]
        GET /events. Providers in parallel (GWIS burned area, FIRMS 7-day hotspots, Copernicus EMS,
        DGA scarcity decrees); one failing provider never empties the list. Newest start first,
        affectedFarmIds [] and affectedExposure 0.
    burned_area_intersections(farm, since, until=None) -> list[ClimateEvent]
        `observed_footprint` fire events (GWIS, processed CEMS) whose geometry intersects the farm
        polygon with start in [since, until]. Raises FireDataUnavailable when GWIS fails and nothing is cached.
    fire_recurrence(center, radius_m=3338, since_year=2012, as_of=None) -> (int | None, Provenance)
        §E.5 fire_recurrence input: calendar years since since_year with GWIS burned area intersecting
        the zone circle. None when GWIS is unavailable (reason in provenance.note).
    fire_signals(farm, zone, as_of) -> FireSignals
        Everything §E.5 'fire' needs in one call: severity (1.0 / 0.6 / 0.4 / 0), the three flags, the
        supporting events, a plain-language text and provenance.

Flood in Chile is not scored (ADR-0008); no flood provider is queried here.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from shapely.geometry import box

from app import config, http, provenance as prov
from app.models import ClimateEvent, Farm, Provenance
from app.sources.events import cems, dga, firms, geo, gwis

log = logging.getLogger("clm.events")

__all__ = ["list_events", "burned_area_intersections", "fire_recurrence", "fire_signals", "FireSignals",
           "FireDataUnavailable"]

#: Last list_events provider errors, for diagnostics/tests (not part of the contract).
last_errors: dict[str, str] = {}


class FireDataUnavailable(Exception):
    pass


def _today() -> date:
    return config.utcnow().date()


def _months_before(d: date, months: int) -> date:
    y, m = d.year, d.month - months
    while m <= 0:
        m += 12
        y -= 1
    import calendar

    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _in_chile(bbox: tuple[float, float, float, float]) -> bool:
    try:
        from app.sources.water import admin

        return bool(admin.communes().in_bbox(bbox))
    except Exception:
        return False


def list_events(bbox: tuple[float, float, float, float], since: date, until: date | None = None) -> list[ClimateEvent]:
    today = _today()
    until = until or today
    chile = _in_chile(bbox)
    tier = "enhanced" if chile else "standard"
    providers: dict[str, Callable[[], list[ClimateEvent]]] = {
        "gwis_ba": lambda: gwis.events(bbox, since, until, today, tier),
    }
    if firms.covers(since, until, today):
        providers["firms"] = lambda: firms.events(bbox, since, until, tier)
    if chile:
        providers["cems"] = lambda: cems.events(bbox, since, until)
        providers["dga_decrees"] = lambda: dga.events(bbox, since, until)

    results: dict[str, list[ClimateEvent]] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=len(providers)) as ex:
        futs = {name: ex.submit(fn) for name, fn in providers.items()}
        for name, f in futs.items():
            try:
                results[name] = f.result()
            except http.FetchError as exc:
                errors[name] = exc.reason
            except Exception as exc:  # one broken provider must not empty the panel
                log.exception("event provider %s failed", name)
                errors[name] = f"{exc.__class__.__name__}: {exc}"
    last_errors.clear()
    last_errors.update(errors)
    if errors:
        log.info("event providers failed: %s", errors)
    seen: dict[str, ClimateEvent] = {}
    for evs in results.values():
        for e in evs:
            seen.setdefault(e.id, e)
    return sorted(seen.values(), key=lambda e: (e.start, e.id), reverse=True)


# ───────────────────────── farm / zone fire signals ─────────────────────────


def _farm_shape(farm: Farm):
    from shapely.geometry import shape

    try:
        return shape(farm.polygon.model_dump(by_alias=True) if hasattr(farm.polygon, "model_dump") else farm.polygon)
    except Exception:
        from shapely.geometry import Point

        return Point(float(farm.centroid[0]), float(farm.centroid[1])).buffer(0.001)


def _footprints_in(region_geom, since: date, until: date, today: date) -> tuple[list[ClimateEvent], list[Provenance], list[str]]:
    """Observed-footprint fire events (GWIS + processed CEMS) intersecting region_geom, start in window."""
    notes: list[str] = []
    provs: list[Provenance] = []
    out: list[ClimateEvent] = []
    bbox = geo.bounds_with_margin(region_geom, 0.005)
    feats, r = gwis.fetch(bbox, since, until, today)  # raises http.FetchError
    for f in feats:
        g = gwis.feature_shape(f)
        if g is not None and g.intersects(region_geom):
            e = gwis.to_event(f, r, today)
            if e is not None:
                out.append(e)
    provs.append(prov.from_fetch(gwis.SOURCE, r, observed_at=until.isoformat(), resolution="polygon (≥ ~100 ha)"))
    for feat in cems.footprints():
        e = cems.footprint_event(feat)
        if e is None or not (since.isoformat() <= e.start <= until.isoformat()):
            continue
        g = geo.to_shape(e.geometry)
        if g is not None and g.intersects(region_geom):
            out.append(e)
            provs.append(e.provenance)
    return out, provs, notes


def burned_area_intersections(farm: Farm, since: date, until: date | None = None) -> list[ClimateEvent]:
    today = _today()
    until = until or today
    try:
        evs, _, _ = _footprints_in(_farm_shape(farm), since, until, today)
    except http.FetchError as exc:
        raise FireDataUnavailable(exc.reason) from exc
    return sorted(evs, key=lambda e: e.start, reverse=True)


def fire_recurrence_years(center: tuple[float, float] | list[float], radius_m: float = geo.ZONE_RADIUS_M,
                          since_year: int = 2012, as_of: date | None = None) -> tuple[list[int] | None, Provenance]:
    as_of = as_of or _today()
    circ = geo.circle(center, radius_m)
    try:
        feats, r = gwis.fetch(geo.bounds_with_margin(circ, 0.002), date(max(since_year, 2012), 1, 1), as_of)
    except http.FetchError as exc:
        return None, prov.unavailable(gwis.SOURCE, f"GWIS burned area unavailable ({exc.reason})")
    years: set[int] = set()
    for f in feats:
        g = gwis.feature_shape(f)
        if g is not None and g.intersects(circ):
            try:
                years.add(int(str((f.get("properties") or {}).get("initialdate"))[:4]))
            except ValueError:
                pass
    ys = sorted(years)
    note = (f"GWIS burned area intersecting the {radius_m / 1000:.1f} km zone circle in {len(ys)} calendar year(s) "
            f"since {max(since_year, 2012)}" + (f": {', '.join(map(str, ys))}" if ys else "")
            + "; burned area includes agricultural burning; fires under ~100 ha are not mapped")
    return ys, prov.from_fetch(gwis.SOURCE, r, observed_at=as_of.isoformat(), note=note, resolution="polygon (≥ ~100 ha)")


def fire_recurrence(center: tuple[float, float] | list[float], radius_m: float = geo.ZONE_RADIUS_M,
                    since_year: int = 2012, as_of: date | None = None) -> tuple[int | None, Provenance]:
    ys, p = fire_recurrence_years(center, radius_m, since_year, as_of)
    return (len(ys) if ys is not None else None), p


@dataclass
class FireSignals:
    #: CONTRACT §E.5 fire severity: 1.0 / 0.6 / 0.4 / 0.0 (None when no fire data could be read)
    severity: float | None
    footprint_intersects_farm: bool
    recent_fire_in_zone: bool
    footprint_intersects_zone: bool
    farm_events: list[ClimateEvent] = field(default_factory=list)
    recent_zone_events: list[ClimateEvent] = field(default_factory=list)
    zone_events: list[ClimateEvent] = field(default_factory=list)
    text: str = ""
    provenance: Provenance | None = None

    def as_dict(self) -> dict[str, Any]:
        from app.models import dump

        return {"severity": self.severity, "footprintIntersectsFarm": self.footprint_intersects_farm,
                "recentFireInZone": self.recent_fire_in_zone, "footprintIntersectsZone": self.footprint_intersects_zone,
                "farmEvents": dump(self.farm_events), "recentZoneEvents": dump(self.recent_zone_events),
                "zoneEvents": dump(self.zone_events), "text": self.text, "provenance": dump(self.provenance)}


def fire_signals(farm: Farm, zone: Any = None, as_of: date | None = None) -> FireSignals:
    """§E.5 fire: 1.0 if an observed footprint intersects the farm in the 13-month window; else 0.6 if any
    fire event (incl. FIRMS hotspots) inside the zone circle started in the last 7 days; else 0.4 if an
    observed footprint intersects the zone circle in the window; else 0. `zone` is a models.Zone (or None
    → the farm's auto zone: centroid, 3,338 m)."""
    today = _today()
    as_of = as_of or today
    w0 = _months_before(as_of, 13)
    center = tuple(zone.center) if zone is not None else (float(farm.centroid[0]), float(farm.centroid[1]))
    radius = float(getattr(zone, "radius_m", None) or geo.ZONE_RADIUS_M)
    circ = geo.circle(center, radius)
    farm_g = _farm_shape(farm)
    notes: list[str] = []
    inputs: list[Provenance] = []
    try:
        zone_evs, provs, _ = _footprints_in(circ.union(farm_g), w0, as_of, today)
        inputs += provs
    except http.FetchError as exc:
        p = prov.unavailable(gwis.SOURCE, f"GWIS burned area unavailable ({exc.reason})")
        return FireSignals(None, False, False, False, text="Fire data unavailable.", provenance=p)
    farm_evs = [e for e in zone_evs if geo.to_shape(e.geometry) is not None and geo.to_shape(e.geometry).intersects(farm_g)]
    zone_fp = [e for e in zone_evs if geo.to_shape(e.geometry) is not None and geo.to_shape(e.geometry).intersects(circ)]
    recent_from = as_of - timedelta(days=7)
    recent = [e for e in zone_fp if e.start >= recent_from.isoformat()]
    if firms.covers(recent_from, as_of, today):
        try:
            for e in firms.events(geo.bounds_with_margin(circ), recent_from, as_of):
                g = geo.to_shape(e.geometry)
                if g is not None and g.intersects(circ):
                    recent.append(e)
                    inputs.append(e.provenance)
        except http.FetchError as exc:
            notes.append(f"FIRMS hotspots unavailable ({exc.reason})")
    elif as_of < today - timedelta(days=8):
        notes.append("FIRMS 7-day hotspots do not cover this as-of date (no keyless history)")
    if farm_evs:
        sev, e = 1.0, farm_evs[0]
        text = f"Burned area mapped on the farm: {e.title}, {e.start} ({e.source})."
    elif recent:
        sev, e = 0.6, recent[0]
        text = f"Fire detected in the zone in the last 7 days: {e.title}, {e.start} ({e.source})."
    elif zone_fp:
        sev, e = 0.4, zone_fp[0]
        text = f"Burned area in the zone (not on the farm) in the last 13 months: {e.title}, {e.start}."
    else:
        sev = 0.0
        text = "No burned area mapped on the farm or in the zone in the last 13 months" + \
               (", and no fire detected in the last 7 days." if not notes else ".")
    p = prov.derived("; ".join([text] + notes), inputs=inputs, observed_at=as_of.isoformat())
    return FireSignals(sev, bool(farm_evs), bool(recent), bool(zone_fp), farm_evs, recent, zone_fp, text, p)


def reset_caches() -> None:
    firms.reset_memo()
    dga.reset_memo()
