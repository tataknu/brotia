"""Shared request helpers: as-of resolution, 13-month window, bbox parsing and limits."""

from __future__ import annotations

import math
from datetime import date, datetime, timezone

from app.models import Portfolio
from app.routers.errors import bbox_too_large, invalid_request, not_found

KM_PER_DEG_LAT = 111.32


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def resolve_as_of(as_of: str | None) -> date:
    """Request asOf ('YYYY-MM-DD') or today (UTC) (CONTRACT §E.13)."""
    if not as_of:
        return today_utc()
    try:
        return date.fromisoformat(as_of[:10])
    except ValueError:
        raise invalid_request(f"asOf '{as_of}' is not a YYYY-MM-DD date")


def months_before(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + (d.month - 1) - months, 12)
    m += 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, min(d.day, day))
        except ValueError:
            continue
    return date(y, m, 28)


def window_start(as_of: date) -> date:
    """Start of the 13-month display window ending as_of."""
    return months_before(as_of, 13)


def parse_bbox(raw: str | None, max_side_deg: float) -> tuple[float, float, float, float]:
    if not raw:
        raise invalid_request("bbox is required: minLng,minLat,maxLng,maxLat")
    try:
        parts = [float(x) for x in raw.split(",")]
    except ValueError:
        raise invalid_request(f"bbox '{raw}' is not four numbers")
    if len(parts) != 4 or not all(math.isfinite(x) for x in parts):
        raise invalid_request(f"bbox '{raw}' must be minLng,minLat,maxLng,maxLat")
    a, b, c, d = parts
    if not (-180 <= a < c <= 180 and -90 <= b < d <= 90):
        raise invalid_request(f"bbox '{raw}' is not a valid WGS84 box (min < max, lng ±180, lat ±90)")
    w, h = c - a, d - b
    if w > max_side_deg or h > max_side_deg:
        raise bbox_too_large(f"bbox spans {w:.2f}° × {h:.2f}°; maximum is {max_side_deg:g}° per side")
    return (a, b, c, d)


def require_farm(portfolio: Portfolio, farm_id: str):
    farm = portfolio.farm(farm_id)
    if farm is None:
        raise not_found(f"farmId '{farm_id}' is not in portfolio '{portfolio.id}'")
    return farm


def require_zone(portfolio: Portfolio, zone_id: str) -> None:
    """A zone id is valid when listed in portfolio.zones or when it is the auto zone of a farm
    (auto zones may be synthesised, CONTRACT §E.4)."""
    if portfolio.zone(zone_id) is not None:
        return
    if zone_id.startswith("auto-") and portfolio.farm(zone_id[len("auto-"):]) is not None:
        return
    raise not_found(f"zoneId '{zone_id}' is not in portfolio '{portfolio.id}'")


def portfolio_bbox(portfolio: Portfolio, pad_km: float = 25.0) -> tuple[float, float, float, float] | None:
    """Bounding box of all farm polygons plus pad_km (events use +25 km, CONTRACT §A)."""
    xs: list[float] = []
    ys: list[float] = []
    for f in portfolio.farms:
        for ring in f.polygon.coordinates:
            for pt in ring:
                xs.append(pt[0])
                ys.append(pt[1])
    if not xs:
        return None
    mid_lat = (min(ys) + max(ys)) / 2
    dlat = pad_km / KM_PER_DEG_LAT
    dlng = pad_km / (KM_PER_DEG_LAT * max(0.1, math.cos(math.radians(mid_lat))))
    return (
        max(-180.0, min(xs) - dlng),
        max(-90.0, min(ys) - dlat),
        min(180.0, max(xs) + dlng),
        min(90.0, max(ys) + dlat),
    )
