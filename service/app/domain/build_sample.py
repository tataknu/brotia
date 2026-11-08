"""Builds a sample portfolio's GeoJSON (service/data/sample_portfolio_cl*.geojson) from CIREN, live (cached in DuckDB
via app.http).

    cd service && .venv/bin/python -m app.domain.build_sample                       # sample-cl
    cd service && .venv/bin/python -m app.domain.build_sample --id sample-cl-sur    # ADR-0026

For every farm in the spec's FARMS: fetch the real Catastro Frutícola polygon by layer + objectid, check the
species matches the crop, compute geodesic area and centroid, run the CIREN irrigated-area check (500 m,
ADR-0010 D2), and write one GeoJSON Feature with the CIREN attributes. `rolpredi` is never fetched.
Prints a selection report. Exits non-zero if any farm could not be fetched or fails a check.
"""

from __future__ import annotations

import argparse
import json
import sys

from app import config
from app.domain.portfolio import SPECS, geojson_file
from app.domain.zones import ZONE_RADIUS_M, haversine_m
from app.sources import ciren

CROP_ESPECIE = {"cherry": "CEREZO", "blueberry": "ARANDANO AMERICANO", "avocado": "PALTO", "walnut": "NOGAL",
                "hazelnut": "AVELLANO", "table_grape": "VID DE MESA"}


def _raw_attrs(layer_id: int, object_id: int) -> dict:
    """Commune/province/region codes of one orchard (same cached query as get_orchard)."""
    layer = next(l for l in ciren.ORCHARD_LAYERS if l.id == layer_id)
    feats, _ = ciren._orchard_query(layer, {}, f"objectid = {int(object_id)}")
    return (feats[0].get("properties") or {}) if feats else {}


def build(sample_id: str = "sample-cl") -> int:
    sample_spec = SPECS[sample_id]
    OUT = geojson_file(sample_spec)
    features = []
    problems: list[str] = []
    for spec in sample_spec.FARMS:
        fid = spec["id"]
        try:
            feat = ciren.get_orchard(spec["layer"], spec["objectId"])
        except Exception as exc:  # report and continue
            problems.append(f"{fid}: fetch failed: {exc}")
            continue
        if feat is None:
            problems.append(f"{fid}: CIREN {spec['layer']}/{spec['objectId']} not found")
            continue
        if feat.properties.crop != spec["crop"]:
            problems.append(f"{fid}: especie {feat.properties.especie} is not {spec['crop']}")
        rings = feat.geometry.coordinates
        area = round(ciren.polygon_area_ha(rings), 2)
        cx, cy = ciren.polygon_centroid(rings)
        attrs = _raw_attrs(spec["layer"], spec["objectId"])
        layer = next(l for l in ciren.ORCHARD_LAYERS if l.id == spec["layer"])
        # Irrigation check needs a Farm-like object: build a minimal one.
        from app.models import Farm, Polygon

        farm = Farm(id=fid, name=spec["name"], crop=spec["crop"], polygon=Polygon(coordinates=rings), area_ha=area,
                    centroid=(round(cx, 6), round(cy, 6)), zone_id=f"auto-{fid}")
        irr = ciren.irrigation_check(farm)
        props = {
            "farmId": fid,
            "name": spec["name"],
            "crop": spec["crop"],
            "especie": feat.properties.especie,
            "variedad": None,
            "plantingYear": None,
            "sourceLayer": feat.properties.source_layer,
            "objectId": feat.id,
            "region": layer.region,
            "surveyVintage": layer.vintage,
            "comuna": (attrs.get("desccomu") or "").strip() or None,
            "comunaCode": attrs.get("comudere"),
            "provinciaCode": attrs.get("provdere"),
            "regionCode": attrs.get("regidere"),
            "areaHa": area,
            "centroid": [round(cx, 6), round(cy, 6)],
            "irrigated": {"value": irr.value, "covered": irr.covered, "nPolygons": irr.n_polygons,
                          "estimated": irr.estimated, "evidence": irr.evidence},
            "fetchedAt": irr.provenance.fetched_at if irr.covered else config.iso_utc(),
            "source": "CIREN Catastro Frutícola (IDE Minagri), esri.ciren.cl, keyless ArcGIS REST",
        }
        if not 2 <= area <= 30:
            problems.append(f"{fid}: area {area} ha outside 2–30 ha")
        features.append({"type": "Feature", "id": fid, "geometry": {"type": "Polygon", "coordinates": rings},
                         "properties": props})
        print(f"{fid:28s} {props['sourceLayer']}/{feat.id:<6d} {feat.properties.especie:20s} {props['comuna'] or '?':16s} "
              f"{area:6.2f} ha  ({cx:.5f}, {cy:.5f})  irrigated={irr.value}{' (est.)' if irr.estimated else ''} n={irr.n_polygons}")

    # cluster check for shared zones
    cents = {f["properties"]["farmId"]: f["properties"]["centroid"] for f in features}
    for z in sample_spec.SHARED_ZONES:
        pts = [cents[i] for i in z["farms"] if i in cents]
        if len(pts) != len(z["farms"]):
            continue
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        for i in z["farms"]:
            d = haversine_m(c, cents[i])
            print(f"  zone {z['id']}: {i} is {d:.0f} m from the centre (radius {ZONE_RADIUS_M} m)")
            if d > ZONE_RADIUS_M:
                problems.append(f"zone {z['id']}: {i} outside the circle")

    fc = {
        "type": "FeatureCollection",
        "name": OUT.stem,
        "description": ("Real CIREN Catastro Frutícola orchard polygons used by the sample portfolio "
                        f"'{sample_spec.PORTFOLIO_NAME}'. Geometry and CIREN attributes are real; farm names are "
                        "illustrative. CIREN has no variety or planting year on these polygons (null)."),
        "generatedAt": config.iso_utc(),
        "features": features,
    }
    if len(features) == len(sample_spec.FARMS):
        OUT.write_text(json.dumps(fc, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {OUT} ({len(features)} farms)")
    else:
        print(f"NOT written: only {len(features)} of {len(sample_spec.FARMS)} farms fetched")
    for p in problems:
        print("PROBLEM:", p)
    return 1 if problems or len(features) != len(sample_spec.FARMS) else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build a sample portfolio's GeoJSON from CIREN (live, cached).")
    ap.add_argument("--id", default="sample-cl", choices=sorted(SPECS))
    sys.exit(build(ap.parse_args().id))
