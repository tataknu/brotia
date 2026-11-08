"""Offline snapshot export (CONTRACT §C, multi-portfolio since v1.1 / ADR-0026).

    POST /snapshot/export            (routers/snapshot.py)
    python -m app.snapshot [--as-of YYYY-MM-DD] [--no-sr] [--portfolio path/to/portfolio.json ...] [--out DIR]

Writes into config.snapshot_dir() (default app/public/snapshot/), replacing the previous snapshot
atomically (build in a temp sibling dir, then swap). Calls exactly the same dispatch functions as the
routers, so the snapshot equals what the live service would answer. A farm that fails becomes a
manifest warning, not a failed export. Fixture-served parts are listed in manifest.warnings.

Which portfolios: request `portfolios` (first = primary), else `portfolio` alone, else every sample portfolio
(sample-cl first). Layout, back-compatible with single-portfolio readers:

- the primary portfolio keeps the v1 names: portfolio.json, assessment-portfolio.json, events.json, and the
  manifest's top-level portfolioId / portfolioName / farmIds describe it;
- every other portfolio gets portfolio-<id>.json, assessment-portfolio-<id>.json, events-<id>.json;
- farm files stay assessment-farm-<farmId>.json, imagery-<farmId>.json, imagery/<farmId>/... (farm ids must be
  unique across the exported portfolios; a duplicate is skipped with a warning);
- manifest.portfolios lists every portfolio with its farm ids and file names.

`source` (default: app.routers.dispatch) supplies the answers; it must provide crops(), countries(),
assess_portfolio(p, as_of), assess_farm(p, farm_id, as_of), imagery(p, farm_id, sr, as_of), events(bbox, since)
and all_sample_portfolios(), each returning dispatch.Served (the last a list of Portfolio).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from app import config
from app.models import Portfolio, SnapshotManifest, SnapshotPortfolio
from app.routers import dispatch
from app.routers.common import portfolio_bbox, resolve_as_of, window_start
from app.routers.errors import ApiException

log = logging.getLogger("clm.snapshot")


def _write(root: Path, rel: str, data: Any, files: list[str]) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    files.append(rel)


def _note_fixture(served: dispatch.Served, rel: str, warnings: list[str]) -> None:
    if served.fixture:
        warnings.append(f"{rel}: {served.notes[0] if served.notes else 'illustrative fixture'}")


def portfolio_files(portfolio_id: str, primary: bool) -> tuple[str, str, str]:
    """(portfolio file, portfolio assessment file, events file) of one exported portfolio."""
    if primary:
        return "portfolio.json", "assessment-portfolio.json", "events.json"
    return f"portfolio-{portfolio_id}.json", f"assessment-portfolio-{portfolio_id}.json", f"events-{portfolio_id}.json"


def _export_one(tmp: Path, portfolio: Portfolio, primary: bool, as_of_d, sr: bool, source: Any,
                files: list[str], warnings: list[str], seen_farms: set[str]) -> tuple[SnapshotPortfolio, int, int]:
    pf_file, assess_file, events_file = portfolio_files(portfolio.id, primary)
    _write(tmp, pf_file, portfolio.model_dump(by_alias=True, mode="json"), files)

    try:
        s = source.assess_portfolio(portfolio, as_of_d)
        _note_fixture(s, assess_file, warnings)
        _write(tmp, assess_file, s.data, files)
    except Exception as exc:
        warnings.append(f"{assess_file} not written: {_reason(exc)}")

    frames = 0
    missing_png = 0
    farm_ids: list[str] = []
    for farm in portfolio.farms:
        if farm.id in seen_farms:
            warnings.append(f"{portfolio.id}: farm id '{farm.id}' is already in another exported portfolio; its files were skipped")
            continue
        seen_farms.add(farm.id)
        farm_ids.append(farm.id)
        rel = f"assessment-farm-{farm.id}.json"
        try:
            s = source.assess_farm(portfolio, farm.id, as_of_d)
            _note_fixture(s, rel, warnings)
            _write(tmp, rel, s.data, files)
        except Exception as exc:
            warnings.append(f"{rel} not written: {_reason(exc)}")

        rel = f"imagery-{farm.id}.json"
        try:
            s = source.imagery(portfolio, farm.id, sr, as_of_d)
            _note_fixture(s, rel, warnings)
            _write(tmp, rel, s.data, files)
        except Exception as exc:
            warnings.append(f"{rel} not written: {_reason(exc)}")
            continue
        for frame in s.data.get("frames", []):
            frames += 1
            for url in (frame.get("urls") or {}).values():
                if not url or not url.startswith("/files/"):
                    continue
                sub = url[len("/files/"):]
                src = config.files_dir() / sub
                if src.is_file():
                    dst = tmp / sub
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(src, dst)
                    files.append(sub)
                else:
                    missing_png += 1

    box = portfolio_bbox(portfolio, 25.0)
    if box is not None:
        try:
            s = source.events(box, window_start(as_of_d))
            _note_fixture(s, events_file, warnings)
            _write(tmp, events_file, s.data, files)
        except Exception as exc:
            warnings.append(f"{events_file} not written: {_reason(exc)}")
    else:
        _write(tmp, events_file, [], files)
        warnings.append(f"{events_file}: portfolio has no farms")

    entry = SnapshotPortfolio(portfolio_id=portfolio.id, portfolio_name=portfolio.name, farm_ids=farm_ids,
                              portfolio_file=pf_file, assessment_file=assess_file, events_file=events_file)
    return entry, frames, missing_png


def export(portfolio: Portfolio | None = None, as_of: str | None = None, sr: bool = True,
           out_dir: Path | None = None, *, portfolios: list[Portfolio] | None = None,
           source: Any = None) -> SnapshotManifest:
    source = source or dispatch
    target = Path(out_dir) if out_dir else config.snapshot_dir()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f".{target.name}.tmp-{os.getpid()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    files: list[str] = []
    warnings: list[str] = []
    as_of_d = resolve_as_of(as_of)

    if portfolios:
        todo = list(portfolios)
    elif portfolio is not None:
        todo = [portfolio]
    else:
        todo = list(source.all_sample_portfolios())
    ids = [p.id for p in todo]
    if len(set(ids)) != len(ids):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        warnings.append(f"duplicate portfolio id(s) {', '.join(dup)}: only the first of each was exported")
        seen: set[str] = set()
        todo = [p for p in todo if not (p.id in seen or seen.add(p.id))]

    for rel, fn in (("crops.json", source.crops), ("countries.json", source.countries)):
        s = fn()
        _note_fixture(s, rel, warnings)
        _write(tmp, rel, s.data, files)

    entries: list[SnapshotPortfolio] = []
    frames = 0
    missing_png = 0
    seen_farms: set[str] = set()
    for i, p in enumerate(todo):
        entry, n, miss = _export_one(tmp, p, i == 0, as_of_d, sr, source, files, warnings, seen_farms)
        entries.append(entry)
        frames += n
        missing_png += miss
    if missing_png:
        warnings.append(f"{missing_png} imagery PNG(s) referenced by the timelines were not in the image cache")

    primary = entries[0] if entries else None
    manifest = SnapshotManifest(
        generated_at=config.iso_utc(),
        as_of=as_of_d.isoformat(),
        portfolio_id=primary.portfolio_id if primary else "",
        portfolio_name=primary.portfolio_name if primary else "",
        farm_ids=list(primary.farm_ids) if primary else [],
        files=["manifest.json"] + files,
        imagery_frames=frames,
        warnings=warnings,
        portfolios=entries,
    )
    (tmp / "manifest.json").write_text(
        json.dumps(manifest.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
    )

    old = target.parent / f".{target.name}.old-{os.getpid()}"
    if target.exists():
        target.rename(old)
    tmp.rename(target)
    if old.exists():
        shutil.rmtree(old, ignore_errors=True)
    log.info("snapshot written to %s (%d portfolios, %d files, %d warnings)", target, len(entries),
             len(manifest.files), len(warnings))
    return manifest


def _reason(exc: Exception) -> str:
    if isinstance(exc, ApiException):
        return f"{exc.error}: {exc.detail}"
    return f"{exc.__class__.__name__}: {exc}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Export the offline snapshot (CONTRACT §C).")
    ap.add_argument("--as-of", default=None)
    ap.add_argument("--no-sr", action="store_true")
    ap.add_argument("--portfolio", action="append", default=None,
                    help="Portfolio JSON file, repeatable; the first is the primary (default: every sample portfolio)")
    ap.add_argument("--out", default=None, help="Output dir (default: app/public/snapshot)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)

    from app.registry import load_providers

    for err in load_providers():
        print(f"warning: {err}", file=sys.stderr)
    pfs = [Portfolio.model_validate_json(Path(p).read_text()) for p in (args.portfolio or [])]
    m = export(None, args.as_of, not args.no_sr, Path(args.out) if args.out else None, portfolios=pfs or None)
    print(json.dumps({"portfolios": [e.portfolio_id for e in (m.portfolios or [])], "files": len(m.files),
                      "imageryFrames": m.imagery_frames, "warnings": m.warnings}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
