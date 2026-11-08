"""DGA water-scarcity decrees (ADR-0006 D4, ADR-0009 D1).

Sources (all keyless, verified 2026-11-07):
- Decree page `dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/decretos-de-escasez-2/`:
  scraped for the current history-XLS link (the filename embeds a date) and for the "vigentes"
  anchors, whose text carries number, date, territory, region and `caducidad dd-mm-yyyy`. The page is
  fresher than the XLS, so it wins for the same decree.
- History XLS `Decretos_zonas_escasez_historico_<dd-mm-yyyy>.xls` (2008→, ~251 decrees): header
  rows repeat inside the sheet, the year cell is only on the first row of each year, the expiry mixes
  Spanish text dates (with typos such as "octubrede") and Excel serials.
- DGA ArcGIS `Decretos_Escasez_Hidrica` polygons (2008 → 2023-04-21): point-in-polygon history per
  farm, precise. Its `VIGENTE` flag is stale and is never used.

Farm join: the farm centroid → commune/province/region (CONAF communes, app.sources.water.admin),
then the decree's free-text territory is matched against those names (commune > province > basin >
region-wide), restricted to the regions named in the decree's region column. ArcGIS polygons are
authoritative up to 2023-04-21; text matching covers later decrees (or everything, labelled
estimated, when ArcGIS is unavailable).
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Literal

import xlrd
from bs4 import BeautifulSoup

from app import http, provenance as prov
from app.models import Provenance
from app.sources.water import admin
from app.sources.water.admin import Commune, norm, word_in

log = logging.getLogger("clm.water.decrees")

SOURCE = "dga_decrees"
ARCGIS_SOURCE = "dga_arcgis"
PAGE_URL = "https://dga.mop.gob.cl/derechos-de-agua/proteccion-de-las-fuentes/decretos-de-escasez-2/"
XLS_FALLBACK_URL = "https://dga.mop.gob.cl/uploads/sites/13/2024/07/Decretos_zonas_escasez_historico_04-09-2026.xls"
ARCGIS_URL = "https://rest-sit.mop.gob.cl/arcgis/rest/services/DGA/Decretos_Escasez_Hidrica/MapServer/0/query"
#: Latest decree date in the ArcGIS layer (verified 2026-11-07, ADR-0006): the layer stops here.
ARCGIS_END = date(2023, 4, 21)
MIN_XLS_DECREES = 240
#: Assumed duration when a decree has no parseable expiry (DGA decrees run 6 months, extendable).
DEFAULT_DURATION = timedelta(days=183)

http.register_source(SOURCE, max_concurrency=1, min_interval_s=1.0, timeout_s=30, retries=1)
http.register_source(ARCGIS_SOURCE, max_concurrency=2, min_interval_s=0.5, timeout_s=30, retries=1)

Level = Literal["commune", "province", "basin", "region"]

# ───────────────────────── date parsing ─────────────────────────

_MONTHS = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "set": 9,
           "oct": 10, "nov": 11, "dic": 12}
_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def parse_es_date(text: Any) -> date | None:
    """'29 de julio de 2008', '24  nov de 2010', '18 de nov 2011', '13 de octubrede 2019', '13-07-2027',
    '2027-07-10 00:00:00' → date. None when nothing parseable."""
    if text is None:
        return None
    s = str(text).strip()
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    n = norm(s)
    m = re.search(r"(\d{1,2})\s*(?:de\s*)?([a-z]{3,})\s*(?:(?:de|del)\s*)?(\d{4})", n)
    if m:
        mon = _MONTHS.get(m.group(2)[:3])
        if mon:
            try:
                return date(int(m.group(3)), mon, int(m.group(1)))
            except ValueError:
                return None
    return None


def _decree_number(text: str) -> int | None:
    m = re.search(r"\bn\s*o?\s*(\d{1,4})\b", norm(text))
    return int(m.group(1)) if m else None


def _decree_date(text: str) -> date | None:
    n = norm(text)
    m = re.search(r"\bn\s*o?\s*\d{1,4}\b(.*)", n)
    return parse_es_date(m.group(1) if m else n)


def fmt_date(d: date) -> str:
    return f"{d.day} {_MONTHS_EN[d.month - 1]} {d.year}"


# ───────────────────────── model ─────────────────────────


@dataclass
class Decree:
    number: int
    year: int
    decree_date: date | None
    expiry: date | None
    region_text: str
    territory: str
    source: str  # 'xls' | 'page' | 'arcgis'
    url: str | None = None
    #: ArcGIS only: territory kind from the layer ('Comuna', 'Provincia', 'Region', 'Cuenca', ...)
    arcgis_level: str | None = None
    region_keys: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if not self.region_keys:
            self.region_keys = admin.regions_in_text(self.region_text)

    @property
    def key(self) -> str:
        return f"{self.number}-{self.year}"

    @property
    def start(self) -> date:
        return self.decree_date or date(self.year, 1, 1)

    @property
    def end(self) -> date:
        return self.expiry or (self.start + DEFAULT_DURATION)

    def active_on(self, d: date) -> bool:
        return self.start <= d <= self.end

    def label(self) -> str:
        return f"DGA decree No. {self.number} of {fmt_date(self.decree_date)}" if self.decree_date else \
            f"DGA decree No. {self.number}/{self.year}"


# ───────────────────────── parsers ─────────────────────────


def parse_xls(content: bytes) -> list[Decree]:
    """Parse the history XLS. Repeated header rows and blank rows are skipped; the year carries forward."""
    wb = xlrd.open_workbook(file_contents=content)
    sh = wb.sheet_by_index(0)
    out: list[Decree] = []
    year: int | None = None
    for i in range(sh.nrows):
        row = [sh.cell(i, j) for j in range(min(sh.ncols, 5))]
        if len(row) < 5:
            continue
        c_year, c_reg, c_dec, c_exp, c_area = row
        if c_year.ctype == xlrd.XL_CELL_TEXT and norm(c_year.value).startswith("ano"):
            continue  # embedded header row
        if c_year.ctype == xlrd.XL_CELL_NUMBER:
            year = int(c_year.value)
        elif c_year.ctype == xlrd.XL_CELL_TEXT and re.fullmatch(r"\s*\d{4}\s*", c_year.value):
            year = int(c_year.value)
        dec_txt = str(c_dec.value or "").strip()
        if not dec_txt:
            continue
        number = _decree_number(dec_txt)
        if number is None:
            continue
        ddate = _decree_date(dec_txt)
        if c_exp.ctype in (xlrd.XL_CELL_DATE, xlrd.XL_CELL_NUMBER) and isinstance(c_exp.value, float) and c_exp.value > 20000:
            expiry = xlrd.xldate_as_datetime(c_exp.value, wb.datemode).date()
        else:
            expiry = parse_es_date(c_exp.value)
        yr = ddate.year if ddate else year
        if yr is None:
            continue
        out.append(Decree(number=number, year=yr, decree_date=ddate, expiry=expiry, region_text=str(c_reg.value or ""),
                          territory=str(c_area.value or "").strip(), source="xls"))
    return out


_VIG_RE_TERR = re.compile(r"escasez\s+h[ií]drica\s+(?:a\s+|en\s+)?(.*?)(?:,\s*en\s+la\s+regi[oó]n|\.\s*caducidad|$)", re.I | re.S)
_VIG_RE_REG = re.compile(r"en\s+la\s+regi[oó]n\s+(?:de\s+|del\s+)?([^.]*)", re.I)
_VIG_RE_EXP = re.compile(r"caducidad\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})", re.I)


def parse_page(html: str) -> tuple[str | None, list[Decree]]:
    """(current XLS url or None, decrees in the 'vigentes' anchors)."""
    soup = BeautifulSoup(html, "lxml")
    xls_url: str | None = None
    vig: list[Decree] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        text = " ".join(a.get_text(" ", strip=True).split())
        if re.search(r"Decretos_zonas_escasez_historico.*\.xlsx?$", href, re.I):
            xls_url = xls_url or href
            continue
        if not href.lower().endswith(".pdf") or not re.search(r"decreto\s+mop", text, re.I) or "caducidad" not in text.lower():
            continue
        number = _decree_number(text)
        ddate = _decree_date(text)
        m_exp = _VIG_RE_EXP.search(text)
        expiry = parse_es_date(m_exp.group(1)) if m_exp else None
        m_ter = _VIG_RE_TERR.search(text)
        territory = (m_ter.group(1).strip(" ,.") if m_ter else text)
        territory = re.sub(r"^(la|el|los|las)\s+", "", territory, flags=re.I)
        territory = territory[:1].upper() + territory[1:]
        m_reg = _VIG_RE_REG.search(text)
        region_text = m_reg.group(1).strip() if m_reg else ""
        if number is None or ddate is None:
            continue
        vig.append(Decree(number=number, year=ddate.year, decree_date=ddate, expiry=expiry, region_text=region_text,
                          territory=territory, source="page", url=href))
    return xls_url, vig


def parse_arcgis(body: dict) -> list[Decree]:
    out: list[Decree] = []

    def ms(v: Any) -> date | None:
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).date() if v else None

    for f in body.get("features") or []:
        a = f.get("attributes") or {}
        n = a.get("NUM_DECRETO")
        ddate = ms(a.get("FECHA_DECRETO"))
        yr = a.get("ANO_DECRETO") or (ddate.year if ddate else None)
        if n is None or yr is None:
            continue
        out.append(Decree(number=int(n), year=int(ddate.year if ddate else yr), decree_date=ddate,
                          expiry=ms(a.get("FECHA_CADUCIDAD")), region_text=str(a.get("REGION") or ""),
                          territory=f"{a.get('TERRITORIO') or ''} {a.get('NOM_TERRITORIO') or ''}".strip(),
                          source="arcgis", arcgis_level=str(a.get("TERRITORIO") or "") or None))
    # dedupe (one decree can have several polygons)
    seen: dict[str, Decree] = {}
    for d in out:
        seen.setdefault(d.key, d)
    return sorted(seen.values(), key=lambda d: d.start)


# ───────────────────────── text matching ─────────────────────────

_REGION_ALIASES = sorted({a for _, (_, al) in admin.REGIONS.items() for a in al} | {"o higgins"}, key=len, reverse=True)
_REGION_PHRASE = re.compile(
    r"\b(?:de |en |y )?(?:la |las )?regi?on(?:es)? (?:de |del )?(?:la |los )?(?:libertador (?:general )?(?:bernardo )?)?"
    r"(?:" + "|".join(re.escape(a) for a in _REGION_ALIASES) + r")\b(?: y parinacota| antartica chilena| de santiago)?"
)
_WHOLE_REGION = re.compile(r"\b(?:totalidad de la|toda la) region\b")
_KEYWORDS = ("provincia", "comuna", "cuenca", "region", "sector", "rio", "rios", "estero", "esteros")


def _segments(text: str) -> list[str]:
    return [norm(s) for s in re.split(r"[;]", text or "") if norm(s)]


def _captures(seg: str, kw: str) -> list[tuple[str, bool]]:
    """Text following each '<kw>(s) de' in a segment, with a flag telling whether it is a locational
    qualifier ('... en la provincia de X', '... ubicados en la comuna de X') rather than the territory."""
    out = []
    for m in re.finditer(r"\b" + kw + r"s?\b (?:de |del )?", seg):
        before = seg[max(0, m.start() - 20):m.start()]
        qualifier = re.search(r"\ben (?:la|las|el|los) $", before) is not None or "ubicad" in before
        rest = seg[m.end():]
        stop = re.search(r"\b(?:provincia|comuna|cuenca|region|sector)s?\b", rest)
        out.append((rest[: stop.start()] if stop else rest, qualifier))
    return out


def match_level(decree: Decree, c: Commune, all_province_names: Iterable[str] = ()) -> Level | None:
    """How the decree's territory text covers this commune (None = it does not)."""
    if decree.region_keys and c.region_key not in decree.region_keys:
        # Ñuble was a province of the Biobío region until Sept 2018
        if not (c.region_key == "nuble" and "biobio" in decree.region_keys):
            return None
    best: Level | None = None
    rank = {"commune": 4, "province": 3, "basin": 2, "region": 1}

    def take(level: Level) -> None:
        nonlocal best
        if best is None or rank[level] > rank[best]:
            best = level

    basin_tokens = c.basin.tokens if c.basin else ()
    for seg in _segments(decree.territory):
        if _WHOLE_REGION.search(seg):
            take("region")
        stripped = _REGION_PHRASE.sub(" ", seg)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        if not stripped or stripped in ("la", "a la", "de la", "en la"):
            take("region")  # the territory is the region itself
            continue
        has_kw = any(word_in(k, stripped) for k in _KEYWORDS)
        if not has_kw:
            # bare names: 'Melipilla', 'Illapel y Salamanca', 'Aconcagua', 'Rio Claro'
            if word_in(c.n_name, stripped):
                take("commune")
            if word_in(c.n_province, stripped):
                take("province")
            if any(word_in(t, stripped) for t in basin_tokens):
                take("basin")
            continue
        for cap, qual in _captures(stripped, "comuna"):
            if not qual and word_in(c.n_name, cap):
                take("commune")
        for cap, qual in _captures(stripped, "provincia"):
            if not qual and word_in(c.n_province, cap):
                take("province")
        if basin_tokens and re.search(r"\b(?:cuencas?|rios?)\b", stripped):
            no_admin = stripped
            for p in all_province_names:
                no_admin = re.sub(r"\bprovincias? (?:de |del )?" + re.escape(p) + r"\b", " ", no_admin)
            no_admin = re.sub(r"\bcomunas? (?:de |del )?[a-z ]+?(?= y | provincia| cuenca|$)", " ", no_admin)
            if any(word_in(t, no_admin) for t in basin_tokens):
                take("basin")
    return best


# ───────────────────────── loading ─────────────────────────


@dataclass
class DecreeSet:
    decrees: list[Decree]
    provenance: Provenance
    xls_ok: bool
    page_ok: bool
    xls_url: str | None
    notes: list[str]


_lock = threading.Lock()
_memo: dict[str, DecreeSet] = {}


def _xls_valid(b: Any) -> bool:
    try:
        return len(parse_xls(b)) >= MIN_XLS_DECREES
    except Exception:
        return False


def _xls_date(url: str | None) -> str | None:
    m = re.search(r"(\d{2})-(\d{2})-(\d{4})\.xlsx?$", url or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


_RECHECK_S = 120.0
_recent: dict[str, Any] = {}


def load_decrees() -> DecreeSet:
    """All decrees: XLS history merged with the page's current decrees (page wins on the same key).
    Memoised in process; the cache/upstream is re-checked at most every 2 minutes."""
    import time

    with _lock:
        if _recent.get("ds") is not None and time.monotonic() - _recent.get("at", 0.0) < _RECHECK_S:
            return _recent["ds"]
    ds = _load_decrees()
    with _lock:
        _recent["ds"], _recent["at"] = ds, time.monotonic()
    return ds


def _load_decrees() -> DecreeSet:
    notes: list[str] = []
    page_res = xls_res = None
    xls_url: str | None = None
    vig: list[Decree] = []
    try:
        page_res = http.get_text(SOURCE, PAGE_URL, ttl=http.TTL_DAY)
        xls_url, vig = parse_page(page_res.body)
        if page_res.stale:
            notes.append(f"decree page served from cache (stale: {page_res.error})")
    except http.FetchError as exc:
        notes.append(f"decree page unavailable ({exc.reason}); newest decrees may be missing")
    url = xls_url or XLS_FALLBACK_URL
    try:
        xls_res = http.get_bytes(SOURCE, url, ttl=http.TTL_WEEK, validate=_xls_valid)
    except http.FetchError as exc:
        notes.append(f"decree history XLS unavailable ({exc.reason})")
        if url != XLS_FALLBACK_URL:
            try:
                xls_res = http.get_bytes(SOURCE, XLS_FALLBACK_URL, ttl=http.TTL_WEEK, validate=_xls_valid)
                url = XLS_FALLBACK_URL
                notes.append("used the previously known XLS file instead")
            except http.FetchError:
                pass

    memo_key = f"{page_res.fetched_at_iso if page_res else '-'}|{xls_res.fetched_at_iso if xls_res else '-'}|{url}"
    with _lock:
        if memo_key in _memo:
            return _memo[memo_key]

    by_key: dict[str, Decree] = {}
    if xls_res is not None:
        for d in parse_xls(xls_res.body):
            d.url = url
            by_key.setdefault(d.key, d)
    for d in vig:
        old = by_key.get(d.key)
        by_key[d.key] = replace(d, territory=d.territory or (old.territory if old else ""),
                                region_text=d.region_text or (old.region_text if old else ""), region_keys=set())

    stale = bool((page_res and page_res.stale) or (xls_res and xls_res.stale))
    fetched = max([r.fetched_at for r in (page_res, xls_res) if r is not None], default=None)
    observed = _xls_date(url) if xls_res is not None else None
    if vig:
        observed = max([observed or "0000"] + [d.start.isoformat() for d in vig])
    base = f"DGA scarcity decrees: history XLS ({url.rsplit('/', 1)[-1]})" if xls_res is not None else "DGA scarcity decrees"
    base += " merged with the decree page's current decrees (the page wins; the XLS lags by weeks)" if page_res else ""
    note = "; ".join([base] + notes)
    if xls_res is None and page_res is None:
        p = prov.unavailable(SOURCE, "; ".join(notes))
    else:
        p = prov.build(SOURCE, observed_at=observed, fetched_at=fetched, stale=stale,
                       estimated=xls_res is None, note=note, resolution="commune / province / basin (text)")
    ds = DecreeSet(sorted(by_key.values(), key=lambda d: d.start), p, xls_res is not None, page_res is not None, url, notes)
    with _lock:
        _memo.clear()
        _memo[memo_key] = ds
    return ds


def arcgis_history(lng: float, lat: float) -> tuple[list[Decree], Provenance]:
    """Decree polygons containing the point (2008 → 2023-04-21). Raises http.FetchError."""
    params = {"f": "json", "geometry": f"{lng:.5f},{lat:.5f}", "geometryType": "esriGeometryPoint", "inSR": "4326",
              "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "false",
              "outFields": "NOM_TERRITORIO,TERRITORIO,REGION,NUM_DECRETO,ANO_DECRETO,FECHA_DECRETO,FECHA_CADUCIDAD"}
    r = http.get_json(ARCGIS_SOURCE, ARCGIS_URL, params=params, ttl=http.TTL_WEEK, allow_empty=True,
                      validate=lambda j: isinstance(j, dict) and "features" in j and "error" not in j)
    p = prov.from_fetch(ARCGIS_SOURCE, r, observed_at=ARCGIS_END.isoformat(), resolution="polygon",
                        note="DGA ArcGIS decree polygons (history 2008 to 2023-04-21; VIGENTE flag ignored, it is stale)")
    return parse_arcgis(r.body), p


# ───────────────────────── per farm ─────────────────────────


@dataclass
class FarmDecrees:
    commune: Commune | None
    #: (decree, match level) — ArcGIS hits up to 2023-04-21, text matches after (or all if ArcGIS failed)
    decrees: list[tuple[Decree, str]]
    provenance: Provenance
    arcgis_ok: bool
    notes: list[str]
    #: True when the XLS or the decree page answered (current decree status is known)
    text_ok: bool = True


#: Province names that no longer exist but appear in old decrees (Ñuble was a Biobío province until 2018).
HISTORIC_PROVINCES = ("nuble",)


def _province_names() -> list[str]:
    names = {c.n_province for c in admin.communes().communes} | set(HISTORIC_PROVINCES)
    return sorted(names, key=len, reverse=True)


def decrees_for_commune(c: Commune, ds: DecreeSet | None = None) -> list[tuple[Decree, Level]]:
    ds = ds or load_decrees()
    provs = _province_names()
    out = []
    for d in ds.decrees:
        lvl = match_level(d, c, provs)
        if lvl:
            out.append((d, lvl))
    return out


def farm_decrees(lng: float, lat: float) -> FarmDecrees:
    idx = admin.communes()
    c = idx.at(lng, lat)
    ds = load_decrees()
    notes: list[str] = list(ds.notes)
    if c is None:
        p = prov.unavailable(SOURCE, "farm is outside the Chilean commune layer; decrees cannot be joined")
        return FarmDecrees(None, [], p, False, ["outside Chile communes"], False)
    text_hits = decrees_for_commune(c, ds)
    arc: list[Decree] = []
    arc_ok = False
    arc_p: Provenance | None = None
    try:
        arc, arc_p = arcgis_history(lng, lat)
        arc_ok = True
    except http.FetchError as exc:
        notes.append(f"ArcGIS decree polygons unavailable ({exc.reason}): history from XLS text matching only")
    merged: dict[str, tuple[Decree, str]] = {}
    if arc_ok:
        for d in arc:
            lvl = {"comuna": "commune", "provincia": "province", "region": "region"}.get(norm(d.arcgis_level), "basin")
            merged[d.key] = (d, lvl)
        for d, lvl in text_hits:
            if d.start > ARCGIS_END and d.key not in merged:
                merged[d.key] = (d, lvl)
            elif d.key in merged and d.source == "page":
                merged[d.key] = (replace(merged[d.key][0], expiry=d.expiry or merged[d.key][0].expiry), merged[d.key][1])
    else:
        for d, lvl in text_hits:
            merged[d.key] = (d, lvl)
    items = sorted(merged.values(), key=lambda t: t[0].start)
    inputs = [ds.provenance, idx.provenance] + ([arc_p] if arc_p else [])
    how = ("ArcGIS decree polygons to 2023-04-21, then the decree text matched to the farm's commune "
           f"({c.display_name}), province ({c.province_label}) or basin") if arc_ok else \
        f"decree text matched to the farm's commune ({c.display_name}), province ({c.province_label}) or basin"
    p = prov.derived(how + ("; " + "; ".join(notes) if notes else ""), inputs=inputs)
    p = p.model_copy(update={"source": SOURCE, "source_label": prov.info(SOURCE).label,
                             "resolution": "commune / province / basin",
                             "estimated": p.estimated or not arc_ok or not ds.xls_ok})
    return FarmDecrees(c, items, p, arc_ok, notes, ds.xls_ok or ds.page_ok)


def years_in_force(decrees: Iterable[Decree], since_year: int, as_of: date) -> list[int]:
    years: set[int] = set()
    for d in decrees:
        if d.start > as_of:
            continue
        end = min(d.end, as_of)
        for y in range(max(d.start.year, since_year), end.year + 1):
            years.add(y)
    return sorted(years)


def reset_memo() -> None:
    with _lock:
        _memo.clear()
        _recent.clear()
