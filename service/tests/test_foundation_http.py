"""ADR-0012 fetch path: cache, stale-on-error, empty-is-not-success, dedup, guards."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

import httpx
import pytest
import respx

from app import config, http, store


@pytest.fixture(autouse=True)
def _reset():
    http.reset_state()
    yield
    http.reset_state()


def _src(name: str) -> str:
    http.register_source(name, max_concurrency=2, retries=0, timeout_s=5)
    return name


def test_success_is_cached_and_served_from_cache():
    s = _src("t_cache")
    url = "https://example.test/a"
    with respx.mock() as m:
        route = m.get(url).mock(return_value=httpx.Response(200, json={"v": 1}))
        r1 = http.get_json(s, url, params={"x": 1}, ttl=3600)
        r2 = http.get_json(s, url, params={"x": 1}, ttl=3600)
    assert r1.body == {"v": 1} and not r1.from_cache and not r1.stale
    assert r2.body == {"v": 1} and r2.from_cache and not r2.stale
    assert route.call_count == 1


def test_failing_source_returns_stale_cached_value():
    s = _src("t_stale")
    url = "https://example.test/b"
    with respx.mock() as m:
        m.get(url).mock(side_effect=[httpx.Response(200, json={"v": 42}), httpx.Response(503)])
        first = http.get_json(s, url, ttl=0)  # expires immediately -> next call refreshes
        second = http.get_json(s, url, ttl=0)
    assert first.body == {"v": 42} and not first.stale
    assert second.body == {"v": 42}
    assert second.stale and second.from_cache
    assert "503" in (second.error or "")
    assert second.fetched_at == first.fetched_at
    # health bookkeeping reflects the failure
    st = {r["source"]: r for r in store.source_status_list()}[s]
    assert st["ok"] is False and st["stale"] is True


def test_stale_backoff_avoids_hammering_upstream():
    s = _src("t_backoff")
    url = "https://example.test/c"
    with respx.mock() as m:
        route = m.get(url).mock(side_effect=[httpx.Response(200, json=[1]), httpx.Response(500), httpx.Response(200, json=[2])])
        http.get_json(s, url, ttl=0)
        r2 = http.get_json(s, url, ttl=0)
        r3 = http.get_json(s, url, ttl=0)  # within STALE_RETRY_S: served stale, no upstream call
    assert r2.stale and r3.stale and r3.body == [1]
    assert route.call_count == 2


def test_failure_without_cache_raises_fetch_error():
    s = _src("t_nocache")
    url = "https://example.test/d"
    with respx.mock() as m:
        m.get(url).mock(return_value=httpx.Response(502))
        with pytest.raises(http.FetchError) as ei:
            http.get_json(s, url)
    assert ei.value.source == s and "502" in ei.value.reason


def test_transport_error_serves_stale():
    s = _src("t_transport")
    url = "https://example.test/e"
    with respx.mock() as m:
        m.get(url).mock(side_effect=[httpx.Response(200, content=b"abc"), httpx.ConnectTimeout("boom")])
        http.get_bytes(s, url, ttl=0)
        r = http.get_bytes(s, url, ttl=0)
    assert r.body == b"abc" and r.stale and "timeout" in r.error


def test_empty_is_not_success():
    s = _src("t_empty")
    url = "https://example.test/f"
    with respx.mock() as m:
        m.get(url).mock(side_effect=[httpx.Response(200, json={"rows": [1]}), httpx.Response(200, json=[])])
        http.get_json(s, url, ttl=0)
        r = http.get_json(s, url, ttl=0)
    assert r.stale and r.body == {"rows": [1]} and "empty" in r.error

    url2 = "https://example.test/g"
    with respx.mock() as m:
        m.get(url2).mock(return_value=httpx.Response(200, json=[]))
        with pytest.raises(http.FetchError):
            http.get_json(s, url2)
        ok = http.get_json(s, url2, allow_empty=True)
    assert ok.body == [] and not ok.stale


def test_validate_rejects_bad_body():
    s = _src("t_validate")
    url = "https://example.test/h"
    with respx.mock() as m:
        m.get(url).mock(return_value=httpx.Response(200, json={"error": "x"}))
        with pytest.raises(http.FetchError) as ei:
            http.get_json(s, url, validate=lambda b: "data" in b)
    assert "validation" in ei.value.reason


def test_in_flight_dedup():
    s = _src("t_dedup")
    url = "https://example.test/i"
    calls = []

    def slow(request):
        calls.append(1)
        time.sleep(0.3)
        return httpx.Response(200, json={"ok": True})

    results = []
    with respx.mock() as m:
        m.get(url).mock(side_effect=slow)
        threads = [threading.Thread(target=lambda: results.append(http.get_json(s, url))) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    assert len(calls) == 1
    assert len(results) == 4 and all(r.body == {"ok": True} for r in results)


def test_user_agent_is_honest():
    s = _src("t_ua")
    url = "https://example.test/j"
    with respx.mock() as m:
        route = m.get(url).mock(return_value=httpx.Response(200, json={"a": 1}))
        http.get_json(s, url)
    assert route.calls.last.request.headers["user-agent"] == config.USER_AGENT


def test_retry_on_429_then_success():
    http.register_source("t_retry", retries=1, timeout_s=5)
    url = "https://example.test/k"
    with respx.mock() as m:
        route = m.get(url).mock(
            side_effect=[httpx.Response(429, headers={"Retry-After": "0"}), httpx.Response(200, json={"a": 2})]
        )
        r = http.get_json("t_retry", url)
    assert r.body == {"a": 2} and route.call_count == 2


def test_post_json_cached_by_body():
    s = _src("t_post")
    url = "https://example.test/l"
    with respx.mock() as m:
        route = m.post(url).mock(return_value=httpx.Response(200, json={"n": 1}))
        http.post_json(s, url, json_body={"q": 1})
        http.post_json(s, url, json_body={"q": 1})
        http.post_json(s, url, json_body={"q": 2})
    assert route.call_count == 2


def test_open_meteo_embargo_blocks_network(monkeypatch):
    monkeypatch.setattr(config, "utcnow", lambda: datetime(2026, 11, 7, 20, 0, tzinfo=timezone.utc))
    s = _src("open_meteo")
    url = "https://archive-api.open-meteo.com/v1/archive"
    with respx.mock(assert_all_called=False) as m:
        route = m.get(url).mock(return_value=httpx.Response(200, json={"x": 1}))
        with pytest.raises(http.FetchError) as ei:
            http.get_json(s, url, params={"latitude": -34})
    assert route.call_count == 0 and "quota" in ei.value.reason


def test_offline_mode_serves_cache_only(monkeypatch):
    s = _src("t_offline")
    url = "https://example.test/m"
    with respx.mock() as m:
        m.get(url).mock(return_value=httpx.Response(200, json={"v": 9}))
        http.get_json(s, url, ttl=0)
    monkeypatch.setenv("CLM_OFFLINE", "1")
    with respx.mock(assert_all_called=False) as m:
        route = m.get(url).mock(return_value=httpx.Response(200, json={"v": 10}))
        r = http.get_json(s, url, ttl=0)
        with pytest.raises(http.FetchError):
            http.get_json(s, "https://example.test/never-cached")
    assert route.call_count == 0 and r.stale and r.body == {"v": 9}
