"""ADR-0023 per-source concurrency: Planetary Computer at 8, national/government sites at 2 or less, and the
global pool never caps Planetary Computer below its own limit or lets a slow source hold global slots."""

from __future__ import annotations

import threading
import time

import httpx
import respx

from app import http, registry

PLANETARY_COMPUTER = {"s2_l2a_pc": 8, "copernicus_dem": 8}
NATIONAL = {
    "dga_decrees", "dga_arcgis", "dga_snowmelt",          # DGA
    "ran_station",                                          # agromet.cl / RAN
    "ciren_catastro", "ciren_irrigated",                    # CIREN
    "cr2met_r1", "cr2met_nrt",                              # ftp.cr2.cl
    "cems", "gwis_ba", "firms",                             # Copernicus EMS, GWIS, NASA FIRMS
    "conaf_comunas", "open_meteo",
}


def _registered() -> dict[str, int]:
    assert registry.load_providers() == []
    from app.risk import dem  # noqa: F401  (registers copernicus_dem)

    return {name: cfg.max_concurrency for name, cfg in http._sources.items()}  # noqa: SLF001


def test_planetary_computer_sources_run_eight_at_a_time():
    lim = _registered()
    for name, want in PLANETARY_COMPUTER.items():
        assert lim[name] == want, name
        assert http.source_limit(name) == want


def test_national_sites_stay_at_two_or_less():
    lim = _registered()
    for name in NATIONAL:
        assert name in lim, f"{name} not registered"
        assert lim[name] <= 2, f"{name} has max_concurrency {lim[name]}"


def test_global_pool_does_not_cap_planetary_computer():
    lim = _registered()
    assert http.GLOBAL_MAX_CONCURRENCY >= max(lim.values())
    assert http.GLOBAL_MAX_CONCURRENCY >= max(PLANETARY_COMPUTER.values()) + 2


def test_requests_queued_on_a_slow_source_do_not_hold_global_slots(monkeypatch):
    """Many calls waiting on a 1-slot source must leave the global pool free for another source."""
    http.reset_state()
    monkeypatch.setattr(http, "_global_sem", threading.BoundedSemaphore(2))
    http.register_source("t_slow", max_concurrency=1, retries=0, timeout_s=5)
    http.register_source("t_fast", max_concurrency=2, retries=0, timeout_s=5)
    release = threading.Event()

    def slow_side_effect(request):
        release.wait(5)
        return httpx.Response(200, json={"ok": 1})

    with respx.mock(assert_all_called=False) as m:
        m.get(url__startswith="https://slow.test/").mock(side_effect=slow_side_effect)
        m.get("https://fast.test/x").mock(return_value=httpx.Response(200, json={"ok": 1}))
        threads = [threading.Thread(target=http.get_json, args=("t_slow", f"https://slow.test/{i}"),
                                    kwargs={"ttl": None}) for i in range(4)]
        for t in threads:
            t.start()
        time.sleep(0.2)  # one slow call in flight, three queued on the source semaphore
        t0 = time.monotonic()
        r = http.get_json("t_fast", "https://fast.test/x", ttl=None)
        fast_s = time.monotonic() - t0
        release.set()
        for t in threads:
            t.join(10)
    assert r.body == {"ok": 1}
    assert fast_s < 2.0, f"fast source waited {fast_s:.1f} s behind a slow one"
    http.reset_state()
