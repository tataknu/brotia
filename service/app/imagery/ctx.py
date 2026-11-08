"""Cross-builder lookups with honest fallbacks, so imagery works while other packages are placeholders.

- effective zone: app.domain.effective_zone (svc-portfolio); fallback = §E.4 computed here
  (shared zone containing the centroid, nearest centre, tie -> smallest id; else auto-<farmId>).
- template: app.domain.effective_template; fallback app.domain.get_crop_template; fallback the
  contract fixture crops.json.
- peers: app.sources.ciren.find_peers (svc-portfolio); unavailable -> [] with the reason.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app import config
from app.models import CropTemplate, Farm, Portfolio, Zone

from .geo import haversine_m

log = logging.getLogger("clm.imagery")

ZONE_RADIUS_M = 3338.0


def effective_zone(portfolio: Portfolio | None, farm: Farm) -> Zone:
    if portfolio is not None:
        try:
            from app import domain

            z, _w = domain.effective_zone(portfolio, farm)
            if z is not None:
                return z
        except NotImplementedError:
            pass
        except Exception as e:  # never let another package's bug break imagery
            log.warning("domain.effective_zone failed (%r); using the local §E.4 rule", e)
        shared = [z for z in portfolio.zones if not z.auto
                  and haversine_m(tuple(z.center), tuple(farm.centroid)) <= (z.radius_m or ZONE_RADIUS_M)]
        if shared:
            shared.sort(key=lambda z: (haversine_m(tuple(z.center), tuple(farm.centroid)), z.id))
            return shared[0]
        own = portfolio.zone(f"auto-{farm.id}")
        if own is not None:
            return own
    return Zone(id=f"auto-{farm.id}", name=f"{farm.name} (own zone)", center=tuple(farm.centroid),
                radius_m=ZONE_RADIUS_M, auto=True, overrides={})


def _fixture_template(crop: str) -> CropTemplate:
    data = json.loads((config.FIXTURES_DIR / "crops.json").read_text())
    return CropTemplate.model_validate(next(t for t in data if t["crop"] == crop))


def template(portfolio: Portfolio | None, farm: Farm) -> CropTemplate:
    if portfolio is not None:
        try:
            from app import domain

            t, _w = domain.effective_template(portfolio, farm)
            if t is not None:
                return t
        except NotImplementedError:
            pass
        except Exception as e:
            log.warning("domain.effective_template failed (%r); using the crop template", e)
    try:
        from app import domain

        return domain.get_crop_template(farm.crop)
    except Exception:
        return _fixture_template(farm.crop)


def baseline_years(portfolio: Portfolio | None, farm: Farm) -> int:
    try:
        v = template(portfolio, farm).rules.baseline_years
        return int(v) if v else 5
    except Exception:
        return 5


def evergreen(portfolio: Portfolio | None, farm: Farm) -> bool:
    try:
        return bool(template(portfolio, farm).evergreen)
    except Exception:
        return farm.crop == "avocado"


def find_peers(farm: Farm, zone: Zone, max_peers: int = 20) -> tuple[list[dict], str | None]:
    """[(id, geometry geojson, centroid)] nearest first, and a reason when the lookup failed."""
    try:
        from app.sources import ciren

        coll = ciren.find_peers(farm, zone, max_peers=max_peers)
    except NotImplementedError:
        return [], "CIREN peer lookup is not available yet (svc-portfolio placeholder)"
    except Exception as e:
        log.warning("ciren.find_peers failed: %r", e)
        return [], f"CIREN peer lookup failed ({e.__class__.__name__})"
    note = None
    try:
        note = coll.provenance.note
    except Exception:
        pass
    out = []
    own = farm.ciren.object_id if farm.ciren else None
    for f in coll.features:
        oid = f.properties.object_id
        if own is not None and oid == own:
            continue
        out.append({"id": str(oid), "geometry": f.geometry.model_dump(by_alias=True, mode="json"),
                    "especie": f.properties.especie})
    return out, (note if not out else None)
