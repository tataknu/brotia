"""DGA Sep–Mar snowmelt volume forecast vs 1991–2020 (ADR-0006 D4, CONTRACT §E.11 rung 3).

- The bulletin index `dga.mop.gob.cl/servicios-de-informacion/boletines/` is scraped for the
  `Pronostico*Deshielo*` / `Pronostico_YYYY_YYYY*.pdf` links (URLs are unpredictable; seasons back to 2017–18).
- The PDF is read with `pdftotext -layout` (poppler) or pdfplumber, and Cuadro 4 is parsed: station,
  region, 7 monthly flows, forecast Sep–Mar volume, 1991–2020 mean volume, anomaly %. 19 gauges,
  Copiapó to Ñuble (no Biobío). pct of normal = 100 + anomaly (checked against the volume ratio).
- The forecast is a deterministic natural-regime value with ±20 % uncertainty (DGA's own wording).
- Fallback: `data/snowmelt_forecast_2026_2027_seed.csv`, the 2026–27 table transcribed from the PDF
  on 2026-11-07, used only when the PDF cannot be fetched/parsed and nothing is cached; labelled
  estimated with the PDF URL as provenance.
"""

from __future__ import annotations

import csv
import logging
import re
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from app import http, provenance as prov
from app.models import Provenance
from app.sources.water.admin import Basin, norm

log = logging.getLogger("clm.water.snowmelt")

SOURCE = "dga_snowmelt"
BOLETINES_URL = "https://dga.mop.gob.cl/servicios-de-informacion/boletines/"
KNOWN_PDFS = {2026: "https://dga.mop.gob.cl/uploads/sites/13/2026/10/Pronostico-DGA-Deshielos-2026-2027.pdf"}
SEED_PATH = Path(__file__).resolve().parent / "data" / "snowmelt_forecast_2026_2027_seed.csv"
SEED_SEASON = 2026
MIN_ROWS = 15

http.register_source(SOURCE, max_concurrency=1, min_interval_s=1.0, timeout_s=120, retries=1)

_REGIONS = r"(Atacama|Coquimbo|Valpara[ií]so|Metropolitana|O['’´]Higgins|Maule|[ÑN]uble|Biob[ií]o)"
_ROW = re.compile(
    r"^\s*(\S[\w .'’´-]+?)\s{2,}" + _REGIONS + r"\s+((?:-?[\d.,]+\s+){7})(\d[\d.]*)\s+(\d[\d.]*)\s+(-?\d+)\s*$",
    re.M,
)


@dataclass
class GaugeForecast:
    station: str
    region: str
    vol_forecast_hm3: float
    vol_mean_hm3: float
    anomaly_pct: int

    @property
    def pct_of_normal(self) -> float:
        return float(100 + self.anomaly_pct)


@dataclass
class Forecast:
    season: int  # start year: 2026 = Sep 2026 – Mar 2027
    rows: list[GaugeForecast]
    url: str
    provenance: Provenance


def _num(x: str) -> float:
    x = x.strip()
    if "," in x:
        return float(x.replace(".", "").replace(",", "."))
    return float(x.replace(".", "")) if re.fullmatch(r"\d{1,3}(\.\d{3})+", x) else float(x)


def parse_forecast(text: str) -> list[GaugeForecast]:
    """Parse Cuadro 4 rows from `pdftotext -layout` text."""
    out: list[GaugeForecast] = []
    seen: set[str] = set()
    for m in _ROW.finditer(text):
        station = " ".join(m.group(1).split())
        if norm(station) in seen:
            continue
        vol, mean, anom = _num(m.group(4)), _num(m.group(5)), int(m.group(6))
        if mean <= 0:
            continue
        # sanity: the stated anomaly must agree with the volume ratio (±3 points, rounding)
        if abs(vol / mean * 100 - (100 + anom)) > 3:
            log.warning("snowmelt row %s: anomaly %s disagrees with %s/%s; skipped", station, anom, vol, mean)
            continue
        seen.add(norm(station))
        out.append(GaugeForecast(station, m.group(2), vol, mean, anom))
    return out


def pdf_to_text(content: bytes) -> str:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "f.pdf"
        path.write_bytes(content)
        exe = shutil.which("pdftotext")
        if exe:
            r = subprocess.run([exe, "-layout", str(path), "-"], capture_output=True, text=True, timeout=120)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout
        import pdfplumber

        with pdfplumber.open(str(path)) as pdf:
            return "\n".join((pg.extract_text(layout=True) or "") for pg in pdf.pages)


def season_links(html: str) -> dict[int, str]:
    """{season start year: pdf url} from the bulletin index page."""
    out: dict[int, str] = {}
    for href in re.findall(r'href="([^"]+\.pdf)"', html, re.I):
        name = href.rsplit("/", 1)[-1]
        if not re.search(r"pron[oó]stico", name, re.I):
            continue
        m = re.search(r"(20\d\d)[-_](20\d\d)", name)
        if m and int(m.group(2)) == int(m.group(1)) + 1:
            out.setdefault(int(m.group(1)), href)
    return out


def season_for(as_of: date) -> int:
    """Forecast season relevant on as_of. Published early October; Sep–Mar season."""
    return as_of.year if as_of.month >= 10 else as_of.year - 1


def _seed() -> Forecast:
    rows: list[GaugeForecast] = []
    url = KNOWN_PDFS[SEED_SEASON]
    with SEED_PATH.open() as f:
        for r in csv.DictReader(f):
            rows.append(GaugeForecast(r["station"], r["region"], float(r["vol_forecast_hm3"]),
                                      float(r["vol_mean_1991_2020_hm3"]), int(r["anomaly_pct"])))
            url = r.get("pdf_url") or url
    p = prov.build(SOURCE, observed_at="2026-10-02", fetched_at="2026-11-07T17:00:00Z", estimated=True,
                   resolution="basin (forecast gauge)",
                   note=f"seed: Cuadro 4 transcribed from the DGA PDF on 2026-11-07 ({url}); used because the PDF "
                        "could not be fetched or parsed")
    return Forecast(SEED_SEASON, rows, url, p)


_lock = threading.Lock()
_memo: dict[str, Forecast] = {}


_RECHECK_S = 600.0
_recent: dict[int, tuple[float, Forecast | None, list[str]]] = {}


def get_forecast(as_of: date) -> tuple[Forecast | None, list[str]]:
    """The snowmelt forecast for the season relevant on as_of (or the latest earlier one), with notes.
    Memoised per season in process; the cache/upstream is re-checked at most every 10 minutes."""
    import time

    want = season_for(as_of)
    with _lock:
        hit = _recent.get(want)
    if hit and time.monotonic() - hit[0] < _RECHECK_S:
        return hit[1], list(hit[2])
    fc, notes = _get_forecast(as_of)
    with _lock:
        _recent[want] = (time.monotonic(), fc, list(notes))
    return fc, notes


def _get_forecast(as_of: date) -> tuple[Forecast | None, list[str]]:
    notes: list[str] = []
    want = season_for(as_of)
    links: dict[int, str] = {}
    try:
        idx = http.get_text(SOURCE, BOLETINES_URL, ttl=http.TTL_DAY)
        links = season_links(idx.body)
    except http.FetchError as exc:
        notes.append(f"bulletin index unavailable ({exc.reason})")
    links = {**KNOWN_PDFS, **links}
    seasons = sorted([s for s in links if s <= want], reverse=True)
    for season in seasons[:2]:
        url = links[season]
        try:
            r = http.get_bytes(SOURCE, url, ttl=None, timeout=120)
        except http.FetchError as exc:
            notes.append(f"forecast {season}-{season + 1} PDF unavailable ({exc.reason})")
            continue
        key = f"{url}|{r.fetched_at_iso}"
        with _lock:
            fc = _memo.get(key)
        if fc is None:
            try:
                rows = parse_forecast(pdf_to_text(r.body))
            except Exception as exc:  # parser must never break the farm
                rows = []
                notes.append(f"forecast {season}-{season + 1} PDF could not be read ({exc.__class__.__name__})")
            if len(rows) < MIN_ROWS:
                notes.append(f"forecast {season}-{season + 1}: table not parsed ({len(rows)} rows)")
                continue
            p = prov.from_fetch(SOURCE, r, observed_at=f"{season}-10-01", resolution="basin (forecast gauge)",
                                note=f"DGA Pronóstico de caudales de deshielo {season}-{season + 1} ({url}); "
                                     "deterministic natural-regime forecast, ±20 %")
            fc = Forecast(season, rows, url, p)
            with _lock:
                _memo[key] = fc
        if season != want:
            notes.append(f"no forecast for {want}-{want + 1} yet; using {season}-{season + 1}")
        return fc, notes
    if want >= SEED_SEASON and SEED_PATH.exists():
        fc = _seed()
        if fc.season != want:
            notes.append(f"no forecast for {want}-{want + 1}; seed is {fc.season}-{fc.season + 1}")
        return fc, notes
    return None, notes


@dataclass
class BasinSnowmelt:
    pct_of_normal: float | None
    basin: str | None
    gauges: list[GaugeForecast]
    provenance: Provenance
    text: str


def snowmelt_for_basin(basin: Basin | None, as_of: date) -> BasinSnowmelt:
    """% of 1991–2020 normal for the basin's forecast gauge(s) (volume-weighted when several)."""
    if basin is None:
        p = prov.unavailable(SOURCE, "no DGA snowmelt forecast gauge serves this area (forecast covers Copiapó to "
                                     "Ñuble; coastal dryland and the south are not snowmelt-fed)")
        return BasinSnowmelt(None, None, [], p, "No snowmelt forecast covers this basin.")
    fc, notes = get_forecast(as_of)
    if fc is None:
        p = prov.unavailable(SOURCE, "; ".join(notes) or "no snowmelt forecast available")
        return BasinSnowmelt(None, basin.label, [], p, "Snowmelt forecast unavailable.")
    gauges = [g for g in fc.rows if any(norm(g.station).startswith(want) for want in basin.gauges)]
    if not gauges:
        p = prov.unavailable(SOURCE, f"gauge(s) {', '.join(basin.gauges)} not found in the {fc.season}-{fc.season + 1} forecast")
        return BasinSnowmelt(None, basin.label, [], p, "Snowmelt forecast gauge not found.")
    pct = round(sum(g.vol_forecast_hm3 for g in gauges) / sum(g.vol_mean_hm3 for g in gauges) * 100, 1)
    if len(gauges) == 1:
        pct = gauges[0].pct_of_normal
    parts = ", ".join(f"{g.station} {g.pct_of_normal:.0f} %" for g in gauges)
    in_season = as_of.month >= 10 or as_of.month <= 3
    extra = [f"basin {basin.label} → {parts}" + (" (volume-weighted)" if len(gauges) > 1 else ""),
             "farm → basin from the farm's province (approximate table)"]
    if not in_season:
        extra.append(f"as-of date is outside the Sep–Mar season of this {fc.season}-{fc.season + 1} forecast")
    note = "; ".join([fc.provenance.note or ""] + extra + notes)
    p = fc.provenance.model_copy(update={"note": note, "estimated": True if not in_season else fc.provenance.estimated})
    text = f"Sep–Mar snowmelt forecast {pct:.0f} % of the 1991–2020 normal for the {basin.label} basin ({parts})"
    return BasinSnowmelt(pct, basin.label, gauges, p, text)


def reset_memo() -> None:
    with _lock:
        _memo.clear()
        _recent.clear()
