"""Chilean administrative geography for joining text-based official acts (decrees) to farms.

- Communes: CONAF's public ArcGIS Online `Comunas` layer (343 communes, DPA code, commune, province,
  region), fetched once as generalised GeoJSON (~1 MB, maxAllowableOffset 0.002° ≈ 200 m) and cached
  forever. A copy saved on 2026-11-07 ships in `data/comunas_cl_conaf.geojson` and is used, labelled,
  when the layer cannot be fetched and nothing is cached (administrative boundaries are static).
- Point → (commune, province, region) is a local point-in-polygon test (STRtree). Farms within ~200 m
  of a commune border can be assigned to the neighbour; the provenance note says so.
- Province → snowmelt-forecast basin table (Copiapó to Ñuble, ADR-0006). South of Ñuble → None.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from app import http, provenance as prov
from app.models import Provenance

log = logging.getLogger("clm.water.admin")

SOURCE = "conaf_comunas"
COMMUNES_URL = "https://services5.arcgis.com/A1ELWse9bRAi2JiV/arcgis/rest/services/Comunas/FeatureServer/0/query"
COMMUNES_PARAMS = {
    "where": "1=1",
    "outFields": "dpachile_i,name,reg_saff,pro_saff",
    "returnGeometry": "true",
    "outSR": 4326,
    "maxAllowableOffset": 0.002,
    "geometryPrecision": 5,
    "f": "geojson",
}
SEED_PATH = Path(__file__).resolve().parent / "data" / "comunas_cl_conaf.geojson"
N_COMMUNES = 343

prov.register(SOURCE, "CONAF commune boundaries (ArcGIS Online, Comunas layer)", "unresolved", "commune")
http.register_source(SOURCE, max_concurrency=1, min_interval_s=1.0, timeout_s=60, retries=1)


# ───────────────────────── text normalisation ─────────────────────────


def norm(s: Any) -> str:
    """Lower-case ASCII, punctuation → space, single spaces. 'Región de O’Higgins' → 'region de o higgins'."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def word_in(needle: str, hay: str) -> bool:
    """Whole-word (token sequence) match on normalised strings."""
    if not needle:
        return False
    return re.search(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])", hay) is not None


# ───────────────────────── regions ─────────────────────────

#: canonical key → (pretty label, aliases matched in normalised decree text)
REGIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "arica": ("Arica y Parinacota", ("arica",)),
    "tarapaca": ("Tarapacá", ("tarapaca",)),
    "antofagasta": ("Antofagasta", ("antofagasta",)),
    "atacama": ("Atacama", ("atacama",)),
    "coquimbo": ("Coquimbo", ("coquimbo",)),
    "valparaiso": ("Valparaíso", ("valparaiso",)),
    "metropolitana": ("Metropolitana", ("metropolitana", "santiago", "rm")),
    "ohiggins": ("O'Higgins", ("o higgins", "ohiggins")),
    "maule": ("Maule", ("maule",)),
    "nuble": ("Ñuble", ("nuble",)),
    "biobio": ("Biobío", ("biobio", "bio bio")),
    "araucania": ("Araucanía", ("araucania",)),
    "los_rios": ("Los Ríos", ("los rios",)),
    "los_lagos": ("Los Lagos", ("los lagos",)),
    "aysen": ("Aysén", ("aysen", "aisen")),
    "magallanes": ("Magallanes", ("magallanes",)),
}


def region_key_from_conaf(reg_saff: str) -> str | None:
    n = norm(reg_saff)
    for key, (_, aliases) in REGIONS.items():
        if key == "metropolitana":
            if "metropolitana" in n:
                return key
            continue
        if any(word_in(a, n) for a in aliases):
            return key
    return None


def regions_in_text(text: str) -> set[str]:
    """Canonical region keys named in a decree's region column (e.g. "Coquimbo, Valparaíso y Biobío")."""
    n = norm(text)
    out: set[str] = set()
    for key, (_, aliases) in REGIONS.items():
        if any(word_in(a, n) for a in aliases):
            out.add(key)
    return out


def region_label(key: str | None) -> str:
    return REGIONS[key][0] if key in REGIONS else ""


# ───────────────────────── provinces and basins ─────────────────────────

#: CONAF province names lose accents; restore the common ones for labels.
_PROVINCE_LABELS = {
    "limari": "Limarí", "copiapo": "Copiapó", "chanaral": "Chañaral", "diguillin": "Diguillín",
    "bio bio": "Biobío", "concepcion": "Concepción", "curico": "Curicó", "valparaiso": "Valparaíso",
    "chiloe": "Chiloé", "cautin": "Cautín", "aisen": "Aysén", "capitan prat": "Capitán Prat",
    "antartica chilena": "Antártica Chilena", "ultima esperanza": "Última Esperanza",
    "san felipe de aconcagua": "San Felipe de Aconcagua", "marga marga": "Marga Marga",
}


def province_label(pro_saff: str) -> str:
    n = norm(pro_saff)
    return _PROVINCE_LABELS.get(n) or " ".join(w.capitalize() if w not in ("de", "del", "y") else w for w in n.split())


@dataclass(frozen=True)
class Basin:
    label: str
    #: forecast gauges (DGA "Pronóstico de caudales de deshielo" station names, normalised prefix match)
    gauges: tuple[str, ...]
    #: river / basin words that identify this basin in decree text ("cuenca del río Limarí")
    tokens: tuple[str, ...]


#: Province (normalised CONAF name) → snowmelt-forecast basin. Expert table (approximate, ADR-0006):
#: the main-stem forecast gauge that feeds irrigation in the province. Coastal dryland provinces with
#: no snowmelt-fed river (Petorca, Valparaíso, San Antonio, Cardenal Caro, Cauquenes, Itata) → None.
PROVINCE_BASIN: dict[str, Basin] = {
    "copiapo": Basin("Copiapó", ("copiapo en pastillo",), ("copiapo",)),
    "huasco": Basin("Huasco", ("huasco en el maiten",), ("huasco",)),
    "elqui": Basin("Elqui", ("elqui en algarrobal",), ("elqui",)),
    "limari": Basin("Limarí", ("grande en las ramadas", "hurtado en san agustin"), ("limari",)),
    "choapa": Basin("Choapa", ("choapa en cuncumen",), ("choapa",)),
    "los andes": Basin("Aconcagua", ("aconcagua en chacabuquito",), ("aconcagua",)),
    "san felipe de aconcagua": Basin("Aconcagua", ("aconcagua en chacabuquito",), ("aconcagua",)),
    "quillota": Basin("Aconcagua", ("aconcagua en chacabuquito",), ("aconcagua",)),
    "marga marga": Basin("Aconcagua", ("aconcagua en chacabuquito",), ("aconcagua",)),
    "santiago": Basin("Maipo", ("maipo en el manzano",), ("maipo", "mapocho")),
    "cordillera": Basin("Maipo", ("maipo en el manzano",), ("maipo",)),
    "maipo": Basin("Maipo", ("maipo en el manzano",), ("maipo",)),
    "talagante": Basin("Maipo", ("maipo en el manzano",), ("maipo", "mapocho")),
    "melipilla": Basin("Maipo", ("maipo en el manzano",), ("maipo",)),
    "chacabuco": Basin("Maipo", ("maipo en el manzano",), ("maipo", "mapocho")),
    "cachapoal": Basin("Rapel (Cachapoal)", ("cachapoal en puente termas",), ("cachapoal", "rapel")),
    "colchagua": Basin("Rapel (Tinguiririca)", ("tinguiririca en bajo briones",), ("tinguiririca", "rapel")),
    "curico": Basin("Mataquito (Teno)", ("teno despues de junta con claro",), ("mataquito", "teno")),
    "talca": Basin("Maule", ("maule en armerillo",), ("maule",)),
    "linares": Basin("Maule", ("maule en armerillo",), ("maule",)),
    "diguillin": Basin("Itata (Ñuble)", ("nuble en san fabian",), ("nuble", "itata")),
    "punilla": Basin("Itata (Ñuble)", ("nuble en san fabian",), ("nuble", "itata")),
}


def basin_for_province(pro_saff: str | None) -> Basin | None:
    return PROVINCE_BASIN.get(norm(pro_saff)) if pro_saff else None


# ───────────────────────── communes ─────────────────────────


@dataclass
class Commune:
    code: str
    name: str
    province: str  # CONAF uppercase name
    region_key: str | None
    geom: BaseGeometry
    n_name: str = ""
    n_province: str = ""

    def __post_init__(self) -> None:
        self.n_name = norm(re.sub(r"(?i)^comuna de\s+", "", self.name))
        self.n_province = norm(self.province)

    @property
    def province_label(self) -> str:
        return province_label(self.province)

    @property
    def region_label(self) -> str:
        return region_label(self.region_key)

    @property
    def display_name(self) -> str:
        return re.sub(r"(?i)^comuna de\s+", "", self.name).replace("’", "'")

    @property
    def basin(self) -> Basin | None:
        return basin_for_province(self.province)


@dataclass
class CommuneIndex:
    communes: list[Commune]
    provenance: Provenance
    tree: STRtree = field(init=False)

    def __post_init__(self) -> None:
        self.tree = STRtree([c.geom for c in self.communes])

    def at(self, lng: float, lat: float) -> Commune | None:
        p = Point(lng, lat)
        idx = self.tree.query(p, predicate="intersects")
        if len(idx):
            return self.communes[int(idx[0])]
        # small gaps from generalisation / coastline: nearest within ~1 km
        j = self.tree.nearest(p)
        if j is not None and self.communes[int(j)].geom.distance(p) < 0.01:
            return self.communes[int(j)]
        return None

    def in_bbox(self, bbox: tuple[float, float, float, float]) -> list[Commune]:
        from shapely.geometry import box

        b = box(*bbox)
        return [self.communes[int(i)] for i in self.tree.query(b, predicate="intersects")]


_lock = threading.Lock()
_memo: dict[str, CommuneIndex] = {}


def _build(fc: dict, p: Provenance) -> CommuneIndex:
    out: list[Commune] = []
    for f in fc.get("features", []):
        pr = f.get("properties") or {}
        g = f.get("geometry")
        if not g:
            continue
        geom = shape(g)
        if not geom.is_valid:
            geom = geom.buffer(0)
        out.append(Commune(str(pr.get("dpachile_i") or ""), str(pr.get("name") or ""), str(pr.get("pro_saff") or ""),
                           region_key_from_conaf(str(pr.get("reg_saff") or "")), geom))
    return CommuneIndex(out, p)


def _valid(fc: Any) -> bool:
    return isinstance(fc, dict) and len(fc.get("features") or []) >= N_COMMUNES - 5


_RECHECK_S = 600.0
_last: dict[str, Any] = {}


def communes() -> CommuneIndex:
    """The commune index (live layer cached forever; shipped copy as a labelled fallback). Memoised in
    process; the cache/upstream is re-checked at most every 10 minutes."""
    import time

    with _lock:
        if _last.get("idx") is not None and time.monotonic() - _last.get("at", 0.0) < _RECHECK_S:
            return _last["idx"]
    idx = _communes_uncached()
    with _lock:
        _last["idx"], _last["at"] = idx, time.monotonic()
    return idx


def _communes_uncached() -> CommuneIndex:
    note = ("CONAF Comunas layer, generalised to ~200 m (maxAllowableOffset 0.002°): a farm within ~200 m of a "
            "commune border may be assigned to the neighbouring commune")
    try:
        r = http.get_json(SOURCE, COMMUNES_URL, params=COMMUNES_PARAMS, ttl=None, validate=_valid)
        key = f"live:{r.fetched_at_iso}:{r.stale}"
        with _lock:
            if key not in _memo:
                _memo.clear()
                _memo[key] = _build(r.body, prov.from_fetch(SOURCE, r, note=note, resolution="commune"))
            return _memo[key]
    except http.FetchError as exc:
        key = "seed"
        with _lock:
            if key not in _memo:
                fc = json.loads(SEED_PATH.read_text())
                p = prov.build(SOURCE, observed_at="2026-11-07", fetched_at="2026-11-07T07:00:00Z", estimated=True,
                               note=f"{note}; live layer unavailable ({exc.reason}): using the copy saved on 2026-11-07")
                _memo[key] = _build(fc, p)
            return _memo[key]


def locate(lng: float, lat: float) -> Commune | None:
    return communes().at(lng, lat)


def reset_memo() -> None:
    """Testing aid."""
    with _lock:
        _memo.clear()
        _last.clear()
