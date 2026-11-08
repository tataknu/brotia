"""Warm every imagery cache for a portfolio (no peer time budget), so the demo and the offline
snapshot are complete and deterministic.

    cd service && .venv/bin/python -m app.imagery.warm                      # the sample portfolio, today
    .venv/bin/python -m app.imagery.warm --sample sample-cl-sur               # another sample (GET /portfolios/samples)
    .venv/bin/python -m app.imagery.warm --as-of 2026-11-07 --farm cl-requinoa-cherry
    .venv/bin/python -m app.imagery.warm --portfolio path/to/portfolio.json --no-sr

Network etiquette is unchanged (app.http: <= 8 concurrent calls to Planetary Computer per ADR-0023, cached).
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import date
from pathlib import Path

from app import config
from app.models import Portfolio

from . import signals, timeline


def _portfolio(path: str | None, sample_id: str | None = None) -> Portfolio:
    if path:
        return Portfolio.model_validate(json.loads(Path(path).read_text()))
    from app import domain

    return domain.get_sample_portfolio(sample_id)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--portfolio", help="Portfolio JSON (default: the sample portfolio)")
    ap.add_argument("--sample", default=None, help="sample portfolio id (default sample-cl; see GET /portfolios/samples)")
    ap.add_argument("--as-of", default=None, help="YYYY-MM-DD (default: today UTC)")
    ap.add_argument("--farm", action="append", help="only this farm id (repeatable)")
    ap.add_argument("--no-sr", action="store_true", help="skip super-resolution")
    ap.add_argument("--timeline-only", action="store_true", help="only the imagery timelines")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    as_of = date.fromisoformat(a.as_of) if a.as_of else config.utcnow().date()
    pf = _portfolio(a.portfolio, a.sample)
    out = []
    for farm in pf.farms:
        if a.farm and farm.id not in a.farm:
            continue
        row = {"farm": farm.id}
        t = time.monotonic()
        tl = timeline.build_timeline(pf, farm, not a.no_sr, as_of)
        row["timeline_s"] = round(time.monotonic() - t, 1)
        row["frames"] = len(tl.frames)
        row["observed"] = sum(1 for f in tl.frames if f.kind == "observed")
        row["sr_frames"] = sum(1 for f in tl.frames if f.sr_kind)
        if not a.timeline_only:
            t = time.monotonic()
            vs = signals.vigour_signals(pf, farm, as_of, budget_s=None)
            row["signals_s"] = round(time.monotonic() - t, 1)
            pc = vs["peers"]
            row.update(ndviZ=vs["ndviZ"], ndmiZ=vs["ndmiZ"], nPeers=pc.n_peers, reading=pc.reading,
                       irrigated=vs["irrigatedEvidence"]["value"], abandonment=vs["abandonment"].flag)
        print(json.dumps(row), flush=True)
        out.append(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
