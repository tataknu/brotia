"""svc-weather tables in the service DuckDB (CONTRACT §D: own tables, prefixed `weather_`).

- weather_cells(cell PK, iy, ix, lng, lat, land, origin, added_at)
      CR2MET 0.05° cells we keep values for. `land` = inside CR2MET's cl_mask (continental Chile).
- weather_cr2met_daily(version, variable, cell, date, value)
      Decoded daily CR2MET values (the durable cache; raw range bodies are not kept).
      version 'r1' | 'nrt'; variable 'precip' | 'tmin' | 'tmax' | 'eto'.
- weather_cr2met_done(version, variable, cell, year, month, mtime, n_days, last_date, fetched_at)
      Which (version, variable, cell, month) were read, from which file version (sidecar mtime).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Iterable

import pandas as pd

from app import store

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS weather_cells (
        cell VARCHAR PRIMARY KEY, iy INTEGER, ix INTEGER, lng DOUBLE, lat DOUBLE,
        land BOOLEAN, origin VARCHAR, added_at TIMESTAMPTZ)""",
    """CREATE TABLE IF NOT EXISTS weather_cr2met_daily (
        version VARCHAR, variable VARCHAR, cell VARCHAR, date DATE, value DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS weather_cr2met_done (
        version VARCHAR, variable VARCHAR, cell VARCHAR, year INTEGER, month INTEGER,
        mtime VARCHAR, n_days INTEGER, last_date DATE, fetched_at TIMESTAMPTZ)""",
]

_ready: set[str] = set()


def _ensure(con) -> None:
    from app import config

    p = str(config.db_path())
    if p in _ready:
        return
    for s in SCHEMA:
        con.execute(s)
    _ready.add(p)


def run(sql: str, params: Iterable[Any] | None = None) -> list[tuple]:
    with store.connect() as con:
        _ensure(con)
        cur = con.execute(sql, list(params) if params is not None else [])
        try:
            return cur.fetchall()
        except Exception:
            return []


# ───────────────────────── cells ─────────────────────────


def upsert_cells(rows: list[dict]) -> None:
    """rows: dicts with cell, iy, ix, lng, lat, land (bool|None), origin. Keeps an existing land value
    when the new one is None."""
    if not rows:
        return
    now = datetime.now(timezone.utc)
    with store.connect() as con:
        _ensure(con)
        for r in rows:
            old = con.execute("SELECT land, origin FROM weather_cells WHERE cell = ?", [r["cell"]]).fetchone()
            land = r.get("land")
            if old is not None:
                if land is None:
                    land = old[0]
                origin = old[1] if r.get("origin") in (None, "") else ",".join(sorted({*(old[1] or "").split(","), r["origin"]} - {""}))
                con.execute("UPDATE weather_cells SET land = ?, origin = ? WHERE cell = ?", [land, origin, r["cell"]])
            else:
                con.execute(
                    "INSERT INTO weather_cells VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [r["cell"], r["iy"], r["ix"], r["lng"], r["lat"], land, r.get("origin") or "", now],
                )


def cells(land_only: bool = False) -> list[dict]:
    sql = "SELECT cell, iy, ix, lng, lat, land, origin FROM weather_cells"
    if land_only:
        sql += " WHERE land"
    rows = run(sql + " ORDER BY iy, ix")
    return [dict(zip(["cell", "iy", "ix", "lng", "lat", "land", "origin"], r)) for r in rows]


def cell(cell_key: str) -> dict | None:
    rows = run("SELECT cell, iy, ix, lng, lat, land, origin FROM weather_cells WHERE cell = ?", [cell_key])
    return dict(zip(["cell", "iy", "ix", "lng", "lat", "land", "origin"], rows[0])) if rows else None


# ───────────────────────── daily values ─────────────────────────


def put_daily(version: str, variable: str, rows: list[tuple[str, date, float | None]]) -> int:
    """rows: (cell, date, value). Replaces existing (version, variable, cell, date) rows."""
    if not rows:
        return 0
    df = pd.DataFrame(rows, columns=["cell", "date", "value"])
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["version"] = version
    df["variable"] = variable
    df = df[["version", "variable", "cell", "date", "value"]]
    with store.connect() as con:
        _ensure(con)
        con.register("wx_new", df)
        try:
            con.execute(
                """DELETE FROM weather_cr2met_daily d USING wx_new n
                   WHERE d.version = n.version AND d.variable = n.variable AND d.cell = n.cell AND d.date = n.date"""
            )
            con.execute("INSERT INTO weather_cr2met_daily SELECT * FROM wx_new")
        finally:
            con.unregister("wx_new")
    return len(df)


def get_daily(cell_key: str, variable: str, start: date | None = None, end: date | None = None,
              version: str | None = None) -> list[tuple[date, float | None, str]]:
    sql = "SELECT date, value, version FROM weather_cr2met_daily WHERE cell = ? AND variable = ?"
    p: list[Any] = [cell_key, variable]
    if version:
        sql += " AND version = ?"
        p.append(version)
    if start is not None:
        sql += " AND date >= ?"
        p.append(start)
    if end is not None:
        sql += " AND date <= ?"
        p.append(end)
    return [(r[0], r[1], r[2]) for r in run(sql + " ORDER BY date", p)]


# ───────────────────────── bookkeeping ─────────────────────────


def mark_done(version: str, variable: str, cells_: list[str], year: int, month: int, mtime: str | None,
              n_days: int, last_date: date | None) -> None:
    if not cells_:
        return
    now = datetime.now(timezone.utc)
    df = pd.DataFrame({"version": version, "variable": variable, "cell": list(cells_), "year": year,
                       "month": month, "mtime": mtime, "n_days": n_days, "last_date": last_date, "fetched_at": now})
    df["mtime"] = df["mtime"].astype("object")
    df["last_date"] = pd.to_datetime(df["last_date"]).dt.date
    with store.connect() as con:
        _ensure(con)
        con.register("wx_done", df)
        try:
            con.execute(
                """DELETE FROM weather_cr2met_done d USING wx_done n WHERE d.version = n.version
                   AND d.variable = n.variable AND d.cell = n.cell AND d.year = n.year AND d.month = n.month""")
            con.execute(
                "INSERT INTO weather_cr2met_done SELECT version, variable, cell, year, month, mtime, n_days, "
                "last_date, fetched_at FROM wx_done")
        finally:
            con.unregister("wx_done")


def done_map(version: str, variable: str, year: int, month: int) -> dict[str, dict]:
    rows = run(
        "SELECT cell, mtime, n_days, last_date, fetched_at FROM weather_cr2met_done "
        "WHERE version=? AND variable=? AND year=? AND month=?",
        [version, variable, year, month],
    )
    return {r[0]: {"mtime": r[1], "n_days": r[2], "last_date": r[3], "fetched_at": r[4]} for r in rows}


def done_for_cell(cell_key: str, variable: str) -> list[dict]:
    rows = run(
        "SELECT version, year, month, mtime, n_days, last_date, fetched_at FROM weather_cr2met_done "
        "WHERE cell=? AND variable=? ORDER BY year, month",
        [cell_key, variable],
    )
    return [dict(zip(["version", "year", "month", "mtime", "n_days", "last_date", "fetched_at"], r)) for r in rows]
