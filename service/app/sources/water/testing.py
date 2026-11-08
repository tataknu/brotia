"""Test helpers for svc-water-events: respx routes that serve the saved upstream samples.

    with respx.mock(assert_all_called=False) as m:
        testing.install(m)                      # every upstream of water + events, from samples/
        testing.install(m, gwis=503)            # one upstream failing

Samples were saved from live calls on 2026-11-07 (see each package's samples/ folder).
No test may touch the network.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

WATER = Path(__file__).resolve().parent
EVENTS = WATER.parent / "events"
S_W = WATER / "samples"
S_E = EVENTS / "samples"

MY_SOURCES = ("conaf_comunas", "dga_decrees", "dga_arcgis", "dga_snowmelt", "gwis_ba", "firms", "cems")

FORECAST_PDF = "https://dga.mop.gob.cl/uploads/sites/13/2026/10/Pronostico-DGA-Deshielos-2026-2027.pdf"


def sample_text(name: str) -> str:
    return (S_W / name).read_text() if (S_W / name).exists() else (S_E / name).read_text()


def forecast_text() -> str:
    return (S_W / "pronostico_deshielo_2026_2027.txt").read_text()


def clear() -> None:
    """Forget cached upstream responses of these sources and in-process parse caches."""
    from app import http, store
    from app.sources import events, water

    store.init()
    store.execute("DELETE FROM http_cache WHERE source IN (" + ",".join("?" * len(MY_SOURCES)) + ")", list(MY_SOURCES))
    http.reset_state()
    water.reset_caches()
    events.reset_caches()


def _resp(spec: Any, ok: httpx.Response) -> httpx.Response:
    if isinstance(spec, int):
        return httpx.Response(spec)
    if isinstance(spec, httpx.Response):
        return spec
    return ok


def install(m: Any, *, communes: Any = None, page: Any = None, xls: Any = None, arcgis: Any = None,
            boletines: Any = None, pdf: Any = None, gwis: Any = None, gwis_body: dict | None = None,
            firms_n20: Any = None, firms_n21: Any = None, firms_csv: str | None = None,
            cems: Any = None) -> None:
    """Register routes. Pass an int status (e.g. 503) to make one upstream fail, or an httpx.Response."""
    from app.sources.events import cems as cems_mod, firms as firms_mod, gwis as gwis_mod
    from app.sources.water import admin, decrees, snowmelt

    m.get(url__startswith=admin.COMMUNES_URL).mock(
        return_value=_resp(communes, httpx.Response(200, content=admin.SEED_PATH.read_bytes(),
                                                    headers={"content-type": "application/geo+json"})))
    m.get(decrees.PAGE_URL).mock(return_value=_resp(page, httpx.Response(200, text=sample_text("decretos_page_2026-11-07.html"))))
    m.get(url__regex=r"Decretos_zonas_escasez_historico_.*\.xls").mock(
        return_value=_resp(xls, httpx.Response(200, content=(S_W / "Decretos_zonas_escasez_historico_04-09-2026.xls").read_bytes())))

    def arc(request: httpx.Request) -> httpx.Response:
        if isinstance(arcgis, (int, httpx.Response)):
            return _resp(arcgis, httpx.Response(200))
        g = request.url.params.get("geometry", "")
        lng = float(g.split(",")[0]) if g else 0.0
        if abs(lng + 71.2417) < 0.01:
            return httpx.Response(200, text=(S_W / "arcgis_decretos_ovalle.json").read_text())
        if abs(lng + 70.8029) < 0.01:
            return httpx.Response(200, text=(S_W / "arcgis_decretos_requinoa.json").read_text())
        return httpx.Response(200, json={"features": []})

    m.get(url__startswith=decrees.ARCGIS_URL).mock(side_effect=arc)
    m.get(snowmelt.BOLETINES_URL).mock(return_value=_resp(boletines, httpx.Response(200, text=sample_text("boletines_anchors_2026-11-07.html"))))
    m.get(url__regex=r"\.pdf$").mock(return_value=_resp(pdf, httpx.Response(200, content=b"%PDF-1.4 test placeholder")))

    gw = json.dumps(gwis_body) if gwis_body is not None else (S_E / "gwis_chillan_2012_2026.geojson").read_text()
    m.get(url__startswith=gwis_mod.URL).mock(return_value=_resp(gwis, httpx.Response(200, text=gw)))
    csv_text = firms_csv if firms_csv is not None else (S_E / "firms_j1_7d_chile.csv").read_text()
    m.get(firms_mod.URLS["N20"]).mock(return_value=_resp(firms_n20, httpx.Response(200, text=csv_text)))
    m.get(firms_mod.URLS["N21"]).mock(return_value=_resp(firms_n21, httpx.Response(200, text=csv_text)))

    acts = json.loads((S_E / "cems_chile_activations.json").read_text())

    def cems_detail(request: httpx.Request) -> httpx.Response:
        if isinstance(cems, (int, httpx.Response)):
            return _resp(cems, httpx.Response(200))
        code = request.url.params.get("code", "")
        p = S_E / f"cems_{code}.json"
        return httpx.Response(200, json={"count": 1, "results": [json.loads(p.read_text())]}) if p.exists() else \
            httpx.Response(200, json={"count": 0, "results": []})

    m.get(url__startswith=f"{cems_mod.API}/public-activations-info/").mock(
        return_value=_resp(cems, httpx.Response(200, json={"count": len(acts), "results": acts})))
    m.get(url__startswith=f"{cems_mod.API}/public-activations/").mock(side_effect=cems_detail)
