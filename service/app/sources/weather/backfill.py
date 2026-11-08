"""Offline builder for the weather cache (never runs inside a request).

    .venv/bin/python -m app.sources.weather.backfill cells            # register cells (sites + portfolios)
    .venv/bin/python -m app.sources.weather.backfill window           # 13-month CR2MET window, all cells
    .venv/bin/python -m app.sources.weather.backfill baseline --minutes 40
    .venv/bin/python -m app.sources.weather.backfill ran-warm         # RAN station-months for known farms
    .venv/bin/python -m app.sources.weather.backfill all --minutes 40
    .venv/bin/python -m app.sources.weather.backfill status
    .venv/bin/python -m app.sources.weather.backfill cells --point -71.2,-30.6 --origin user

Cells kept: the 3×3 neighbourhood (±0.05°) of every known site, inside CR2MET's cl_mask. Known sites =
the farms of the contract sample portfolio, every service sample portfolio (when app.domain provides them)
and the 11 Chilean discovery test sites. Re-running is incremental: only missing (cell, month) pairs are
read, so new cells can be added at any time.

Baseline years run in bisection order (1991, 2020, 2005, 1998, 2012, …) with all four variables per year,
so a time-boxed run still gives an evenly spread baseline with the same n_years for every variable.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from datetime import date, datetime, timedelta, timezone

from app import config
from app.sources.weather import cr2met, db

#: The 11 Chilean discovery test sites (families/chile-agromet/probe_agromet_ran.py), lng/lat.
TEST_SITES = {
    "quillota": (-71.25, -32.88), "ovalle": (-71.20, -30.60), "requinoa": (-70.80, -34.28),
    "santa-cruz": (-71.37, -34.64), "curico": (-71.24, -34.98), "talca": (-71.66, -35.43),
    "parral": (-71.83, -36.14), "chillan": (-72.10, -36.60), "los-angeles": (-72.35, -37.47),
    "temuco": (-72.60, -38.74), "osorno": (-73.13, -40.57),
}


def _log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc):%H:%M:%S} {msg}", flush=True)


def known_points() -> dict[str, tuple[float, float]]:
    pts: dict[str, tuple[float, float]] = {f"site:{k}": v for k, v in TEST_SITES.items()}
    try:
        p = json.loads((config.FIXTURES_DIR / "portfolio-sample.json").read_text())
        for f in p.get("farms", []):
            pts[f"fixture:{f['id']}"] = tuple(f["centroid"])  # type: ignore[assignment]
    except Exception as exc:
        _log(f"fixture portfolio unreadable: {exc}")
    try:
        from app import domain

        for sp in domain.get_sample_portfolios():
            for f in sp.farms:
                pts[f"sample:{f.id}"] = tuple(f.centroid)  # type: ignore[assignment]
    except Exception as exc:
        _log(f"service sample portfolio not available ({exc.__class__.__name__}); using fixture + sites")
    return pts


def register_points(points: dict[str, tuple[float, float]], radius: int = 1) -> list[cr2met.Cell]:
    cells: dict[str, tuple[cr2met.Cell, str]] = {}
    for origin, (lng, lat) in points.items():
        c = cr2met.cell_of(lng, lat)
        if c is None:
            _log(f"{origin}: outside the CR2MET grid, skipped")
            continue
        for n in cr2met.neighbourhood(c, radius):
            cells.setdefault(n.key, (n, origin))
    existing = {r["cell"]: r for r in db.cells()}
    need_mask = [c for k, (c, _) in cells.items() if k not in existing or existing[k]["land"] is None]
    mask: dict[str, bool] = {}
    if need_mask:
        # one band read per ~200 rows keeps the request small
        need_mask.sort(key=lambda c: c.iy)
        for i in range(0, len(need_mask), 400):
            mask.update(cr2met.land_mask(need_mask[i:i + 400]))
    db.upsert_cells([
        {"cell": k, "iy": c.iy, "ix": c.ix, "lng": c.lng, "lat": c.lat, "land": mask.get(k), "origin": o}
        for k, (c, o) in cells.items()
    ])
    land = [c for k, (c, _) in cells.items() if (mask.get(k) if k in mask else existing.get(k, {}).get("land"))]
    _log(f"registered {len(cells)} cells, {len(land)} on land")
    return land


def land_cells() -> list[cr2met.Cell]:
    return [cr2met.Cell(r["iy"], r["ix"]) for r in db.cells(land_only=True)]


def window_range(today: date | None = None) -> tuple[date, date]:
    today = today or datetime.now(timezone.utc).date()
    start = (today.replace(day=1) - timedelta(days=400)).replace(day=1)
    return start, today


def cmd_window(args) -> None:
    cells = land_cells()
    start, end = window_range()
    _log(f"window {start}..{end} for {len(cells)} cells")
    t0 = time.monotonic()
    stats = cr2met.ensure_window(cells, start, end, log_fn=_log)
    _log(f"window done: {stats} in {time.monotonic() - t0:.0f}s")


def cmd_baseline(args) -> None:
    cells = land_cells()
    deadline = time.monotonic() + args.minutes * 60
    years = cr2met.spread_years()
    _log(f"baseline {args.variables} for {len(cells)} cells, order {years[:8]}…, budget {args.minutes} min")
    for y in years:
        if time.monotonic() > deadline:
            _log(f"time box reached before {y}")
            break
        t0 = time.monotonic()
        reads = cr2met.ensure_baseline_year(cells, y, variables=args.variables.split(","), log_fn=_log)
        if reads:
            _log(f"year {y}: {reads} reads in {time.monotonic() - t0:.0f}s")
    cmd_status(args)


def cmd_status(args) -> None:
    cells = db.cells(land_only=True)
    _log(f"{len(cells)} land cells registered")
    for v in cr2met.VARIABLES:
        rows = db.run(
            "SELECT cell, count(DISTINCT year) FROM (SELECT cell, year FROM weather_cr2met_done "
            "WHERE version='r1' AND variable=? AND year BETWEEN 1991 AND 2020 GROUP BY cell, year "
            "HAVING count(*) = 12) GROUP BY cell", [v])
        ny = sorted({r[1] for r in rows})
        last = db.run("SELECT max(date) FROM weather_cr2met_daily WHERE variable=? AND value IS NOT NULL", [v])
        _log(f"{v}: baseline years per cell {ny or [0]} over {len(rows)} cells; latest value {last[0][0] if last else None}")


def cmd_cells(args) -> None:
    pts = known_points()
    if args.point:
        for i, p in enumerate(args.point):
            lng, lat = (float(x) for x in p.split(","))
            pts[f"{args.origin}:{i}"] = (lng, lat)
    register_points(pts, radius=args.radius)


def cmd_ran_warm(args) -> None:
    from app.sources.weather import ran

    pts = known_points()
    start, end = window_range()
    for origin, (lng, lat) in pts.items():
        if not origin.startswith(("fixture:", "sample:")) and not args.sites:
            continue
        st = ran.nearest_stations(lng, lat)
        if not st:
            _log(f"{origin}: no RAN station within {ran.MAX_KM} km")
            continue
        s, km = st[0]
        _log(f"{origin}: warming RAN {s['id']} {s['name']} ({km:.1f} km)")
        ran.warm(s["id"], start, end, log_fn=_log)


def _attach(con, src: str, budget_s: float = 15.0) -> None:
    """ATTACH another DuckDB file read-only, retrying while a server process holds its lock."""
    import duckdb

    deadline, delay = time.monotonic() + budget_s, 0.05
    while True:
        try:
            con.execute(f"ATTACH '{src}' AS wsrc (READ_ONLY)")
            return
        except duckdb.IOException as exc:
            if time.monotonic() > deadline or "lock" not in str(exc).lower():
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.5)


def merge(src: str) -> dict:
    """Copy weather_* rows from another DuckDB file into the current store (config.db_path()): cells not
    yet present, and every (version, variable, cell, month) the source has read and the target has not
    (or has from an older NRT file). Lets a bulk pass run in a private file (no lock contention with the
    running server) and land in the service cache in one short transaction. Also used to seed that file."""
    from app import store

    src = str(Path(src).expanduser().resolve())
    with store.connect(timeout_s=60) as con:
        db._ensure(con)
        _attach(con, src)
        try:
            have = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_catalog='wsrc'").fetchall()}
            if not {"weather_cells", "weather_cr2met_daily", "weather_cr2met_done"} <= have:
                return {"cells": 0, "months": 0, "rows": 0}
            n_cells = con.execute(
                "INSERT INTO weather_cells SELECT * FROM wsrc.weather_cells s "
                "WHERE NOT EXISTS (SELECT 1 FROM weather_cells t WHERE t.cell = s.cell)").fetchone()
            con.execute("""CREATE TEMP TABLE wnew AS
                SELECT s.* FROM wsrc.weather_cr2met_done s
                LEFT JOIN weather_cr2met_done t USING (version, variable, cell, year, month)
                WHERE t.cell IS NULL OR (s.version = 'nrt' AND coalesce(t.mtime, '') <> coalesce(s.mtime, '')
                                         AND s.last_date > coalesce(t.last_date, DATE '1900-01-01'))""")
            months = con.execute("SELECT count(*) FROM wnew").fetchone()[0]
            con.execute("""DELETE FROM weather_cr2met_daily d USING wnew n
                WHERE d.version = n.version AND d.variable = n.variable AND d.cell = n.cell
                  AND year(d.date) = n.year AND month(d.date) = n.month""")
            rows = con.execute("""INSERT INTO weather_cr2met_daily SELECT d.* FROM wsrc.weather_cr2met_daily d
                JOIN wnew n ON d.version = n.version AND d.variable = n.variable AND d.cell = n.cell
                  AND year(d.date) = n.year AND month(d.date) = n.month""").fetchone()
            con.execute("""DELETE FROM weather_cr2met_done d USING wnew n
                WHERE d.version = n.version AND d.variable = n.variable AND d.cell = n.cell
                  AND d.year = n.year AND d.month = n.month""")
            con.execute("INSERT INTO weather_cr2met_done SELECT * FROM wnew")
            con.execute("DROP TABLE wnew")
        finally:
            con.execute("DETACH wsrc")
    out = {"cells": n_cells[0] if n_cells else 0, "months": months, "rows": rows[0] if rows else 0}
    _log(f"merged from {src}: {out}")
    return out


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.WARNING)
    ap = argparse.ArgumentParser(prog="weather-backfill")
    ap.add_argument("cmd", choices=["cells", "window", "baseline", "status", "ran-warm", "all", "merge"])
    ap.add_argument("--db", help="use this DuckDB file instead of the service cache (private bulk pass); "
                                 "it is seeded from the service cache first")
    ap.add_argument("--src", help="merge: the DuckDB file to merge into the service cache")
    ap.add_argument("--minutes", type=float, default=40)
    ap.add_argument("--radius", type=int, default=1)
    ap.add_argument("--variables", default="precip,tmin,tmax,eto", help="baseline variables, comma separated")
    ap.add_argument("--point", action="append", help="extra lng,lat to register")
    ap.add_argument("--origin", default="cli")
    ap.add_argument("--sites", action="store_true", help="ran-warm: also warm the 11 test sites")
    args = ap.parse_args(argv)
    if args.cmd == "merge":
        merge(args.src)
        return
    if args.db:
        main_db = str(config.db_path())
        os.environ["CLM_DB_PATH"] = str(Path(args.db).expanduser().resolve())
        if Path(main_db).exists() and Path(main_db) != config.db_path():
            merge(main_db)  # seed: skip months the service cache already has
        _log(f"working in {config.db_path()} (merge it back with: backfill merge --src {config.db_path()})")
    if args.cmd in ("cells", "all"):
        cmd_cells(args)
    if args.cmd in ("window", "all"):
        cmd_window(args)
    if args.cmd in ("baseline", "all"):
        cmd_baseline(args)
    if args.cmd == "ran-warm":
        cmd_ran_warm(args)
    if args.cmd == "status":
        cmd_status(args)


if __name__ == "__main__":
    main(sys.argv[1:])
