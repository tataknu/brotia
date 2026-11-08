"""svc-agent tests: tool loop, proposals schema, backtest, no-key path. No network: a scripted fake
Anthropic client stands in for the API, and weather/events builders are monkeypatched."""

from __future__ import annotations

import json
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

import app.agent as agent
from app.agent import data, loop, rules, tools as T, verify
from app.agent.backtest import KnownEvent, run_backtest
from app.models import AgentRecommendation, AgentRequest, Portfolio, Provenance, Series, SeriesPoint

REQ_ZONE = "auto-cl-requinoa-cherry"
REQ_FARM = "cl-requinoa-cherry"
OVALLE_ZONE = "auto-cl-ovalle-table-grape"


# ───────────────────────── fakes ─────────────────────────


def text_block(t: str) -> Any:
    return SimpleNamespace(type="text", text=t)


def tool_use(id_: str, name: str, inp: dict) -> Any:
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def resp(stop: str, *blocks: Any) -> Any:
    return SimpleNamespace(stop_reason=stop, content=list(blocks))


class FakeMessages:
    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def create(self, **kw):
        # Guard: the loop must always send these, and never forced tool choice (400 on Opus 5.5).
        assert {"model", "max_tokens", "system", "messages", "tools"} <= set(kw)
        assert kw.get("tool_choice", {"type": "auto"})["type"] in ("auto", "none")
        self.calls.append({**kw, "messages": list(kw["messages"])})  # snapshot: the loop appends in place
        if not self.script:
            raise AssertionError("fake client: unexpected extra call")
        step = self.script.pop(0)
        if callable(step):
            return step(kw)
        if isinstance(step, Exception):
            raise step
        return step


class FakeClient:
    def __init__(self, script):
        self.messages = FakeMessages(script)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    monkeypatch.delenv("CLM_AGENT_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    # A real client must never be built in tests.
    monkeypatch.setattr(agent, "make_client", lambda *a, **k: (_ for _ in ()).throw(AssertionError("real client built")))
    data.clear_memo()
    yield
    data.clear_memo()


@pytest.fixture()
def portfolio(sample_portfolio) -> Portfolio:
    return Portfolio.model_validate(sample_portfolio)


def _prov(source="ran_station") -> Provenance:
    return Provenance(source=source, source_label="RAN station (test)", observed_at=None, fetched_at="2026-11-07T16:00:00Z",
                      resolution="station", licence_tier="unresolved", data_tier="enhanced", stale=False, estimated=False)


def synthetic_tmin(d: date) -> float:
    """Mild nights, with a −3.0 °C night on 2013-09-18, −2.2 °C on 2016-09-20, −4.5 °C on 2019-09-10."""
    special = {date(2013, 9, 18): -3.0, date(2016, 9, 20): -2.2, date(2019, 9, 10): -4.5}
    return special.get(d, 4.0)


@pytest.fixture()
def fake_weather(monkeypatch):
    from app.sources import weather

    calls = []

    def get_series(variable, farm, start, end, country="CL"):
        calls.append((variable, farm.id, start, end))
        pts = []
        d = start
        while d <= end:
            v = synthetic_tmin(d) if variable == "tmin" else (12.0 if d == date(2019, 11, 20) else 0.0)
            pts.append(SeriesPoint(date=d.isoformat(), value=v, p10=None, p50=None, p90=None))
            d += timedelta(days=1)
        return Series(variable=variable, unit="°C" if variable == "tmin" else "mm", points=pts, provenance=_prov())

    monkeypatch.setattr(weather, "get_series", get_series)
    return calls


@pytest.fixture()
def no_events(monkeypatch):
    from app.sources import events

    monkeypatch.setattr(events, "list_events", lambda bbox, since, until=None: [])


def _request(portfolio, question="Suggest frost settings for this zone.", zone=REQ_ZONE, farm=None) -> AgentRequest:
    return AgentRequest(portfolio=portfolio, zone_id=zone, farm_id=farm, question=question)


# ───────────────────────── backtest (pure) ─────────────────────────


def test_backtest_counts_known_and_proxy_events():
    windows = {y: (date(y, 9, 1), date(y, 10, 5)) for y in (2013, 2016, 2019, 2020)}
    daily = {}
    for y, (s, e) in windows.items():
        d = s
        while d <= e:
            daily[d] = synthetic_tmin(d)
            d += timedelta(days=1)
    known = [KnownEvent("ref:frost-2013", "frost", date(2013, 9, 16), date(2013, 9, 21), "Sep 2013 frost", "test")]
    r = run_backtest("frost", daily, windows, [-2.0, -2.4, -3.5], damage_proxy=-3.9, known_events=known)
    by = {c["value"]: c for c in r["candidates"]}
    # damaging seasons: 2013 (known event), 2019 (−4.5 <= −3.9 proxy); 2016 (−2.2) is not damaging
    assert r["seasonsEvaluated"] == 4 and r["damagingSeasons"] == 2
    assert by[-2.0] == {"value": -2.0, "hits": 2, "falseAlarms": 1, "missed": 0, "quiet": 1}
    assert by[-2.4] == {"value": -2.4, "hits": 2, "falseAlarms": 0, "missed": 0, "quiet": 2}
    assert by[-3.5] == {"value": -3.5, "hits": 1, "falseAlarms": 0, "missed": 1, "quiet": 2}  # misses Sep 2013


def test_backtest_harvest_rain_and_skips_missing_seasons():
    windows = {2019: (date(2019, 11, 10), date(2020, 1, 15)), 2021: (date(2021, 11, 10), date(2022, 1, 15))}
    daily = {}
    d = date(2019, 11, 8)
    while d <= date(2020, 1, 15):
        daily[d] = 0.0
        d += timedelta(days=1)
    daily[date(2019, 11, 20)] = 12.0
    daily[date(2019, 11, 21)] = 10.0
    r = run_backtest("harvest_rain", daily, windows, [15, 20, 30], damage_proxy=30.0, known_events=[])
    assert r["seasonsEvaluated"] == 1 and [s["season"] for s in r["seasonsSkipped"]] == [2021]
    by = {c["value"]: c for c in r["candidates"]}
    assert by[15.0]["falseAlarms"] == 1 and by[20.0]["falseAlarms"] == 1 and by[30.0]["quiet"] == 1
    assert r["seasons"][0]["extreme"] == 22.0


# ───────────────────────── rules / proposals ─────────────────────────


def test_effective_leaf_layers(portfolio):
    zone = rules.zone_by_id(portfolio, REQ_ZONE)
    farm = portfolio.farm(REQ_FARM)
    p = ["rules", "stages", "bloom", "frostCriticalC"]
    assert rules.effective_leaf(portfolio, "cherry", p, zone) == (-2.4, "template")
    assert rules.effective_leaf(portfolio, "cherry", p, zone, farm) == (-2.0, "farm")
    oz = rules.zone_by_id(portfolio, OVALLE_ZONE)
    assert rules.effective_leaf(portfolio, "table_grape", ["rules", "stages", "harvest", "harvestRainMm72h"], oz) == (5, "zone")


def test_propose_change_builds_contract_rule_change(portfolio):
    ctx = T.ToolContext(portfolio=portfolio, as_of=date(2026, 11, 7), recommendation_id="rec-test", zone_id=REQ_ZONE)
    ctx.data_outputs.append('{"candidates": [{"value": -2.0, "hits": 2}]}')  # as if a backtest ran first (ST-1)
    out, err = T.execute(ctx, "propose_change", {
        "scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.rules.stages.bloom.frostCriticalC",
        "newValue": -2.0, "reason": "Backtest: -2.0 caught 2 of 2 damaging seasons with 1 false alarm."})
    assert not err, out
    body = json.loads(out)
    assert body["oldValue"] == -2.4 and body["shadowedBy"] == [{"farmId": REQ_FARM, "farmValue": -2.0}]
    ch = ctx.proposals[0]
    assert ch.status == "proposed" and ch.actor.kind == "agent" and ch.recommendation_id == "rec-test"
    assert ch.old_value == -2.4 and ch.new_value == -2.0 and ch.scope.level == "zone"
    # bad paths, bad values and no-ops are tool errors, not proposals
    for bad in (
        {"scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.rules.stages.flowering.frostCriticalC", "newValue": -2, "reason": "x"},
        {"scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.rules.stages.bloom.frostCriticalC", "newValue": -40, "reason": "x"},
        {"scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.stages.bloom.start", "newValue": "9-1", "reason": "x"},
        {"scope": {"level": "portfolio", "id": portfolio.id}, "path": "creditRules.x.enabled", "newValue": 1, "reason": "x"},
        {"scope": {"level": "zone", "id": OVALLE_ZONE}, "path": "overrides.table_grape.rules.stages.harvest.harvestRainMm72h", "newValue": 5, "reason": "x"},
        {"scope": {"level": "zone", "id": "nope"}, "path": "overrides.cherry.weights.a", "newValue": 0.5, "reason": "x"},
    ):
        out, err = T.execute(ctx, "propose_change", bad)
        assert err and "error" in json.loads(out)
    assert len(ctx.proposals) == 1
    out, err = T.execute(ctx, "propose_change", {"scope": {"level": "farm", "id": REQ_FARM},
                                                 "path": "overrides.rules.stages.bloom.frostCriticalC", "newValue": None,
                                                 "reason": "reset"})
    assert not err and ctx.proposals[-1].old_value == -2.0 and ctx.proposals[-1].new_value is None


def test_placeholder_builders_become_errors_not_fixtures(portfolio, monkeypatch):
    """A builder raising NotImplementedError (placeholder) must be reported, never escape recommend()
    (dispatch would then serve the contract fixture)."""
    from app.sources import events, weather

    def not_impl(*a, **k):
        raise NotImplementedError("placeholder")

    monkeypatch.setattr(weather, "get_series", not_impl)
    monkeypatch.setattr(events, "list_events", not_impl)
    ctx = T.ToolContext(portfolio=portfolio, as_of=date(2026, 11, 7), recommendation_id="rec-x", zone_id=REQ_ZONE)
    out, err = T.execute(ctx, "backtest", {"rule": "frost", "candidates": [-2.0]})
    body = json.loads(out)
    assert not err and body["available"] is False and "not implemented" in body["reason"]
    assert body["candidates"] == []  # never zeros for missing data
    out, err = T.execute(ctx, "get_history", {"variable": "tmin", "stage": "bloom", "years": 3})
    body = json.loads(out)
    assert not err and body["available"] is False and "note" in body
    out, err = T.execute(ctx, "list_events", {})
    body = json.loads(out)
    assert "not implemented" in body["catalogError"]
    assert any(e["id"] == "ref:frost-2013-09-central-chile" for e in body["referenceEvents"])  # Requínoa is in the band
    monkeypatch.setattr(rules, "effective_stages", not_impl)
    out, err = T.execute(ctx, "get_crop_template", {"crop": "cherry"})
    assert err and "not implemented" in json.loads(out)["error"]
    out, err = T.execute(ctx, "no_such_tool", {})
    assert err
    assert [c.name for c in ctx.tool_calls] == ["backtest", "get_history", "list_events", "get_crop_template", "no_such_tool"]


# ───────────────────────── the loop ─────────────────────────


def test_tool_loop_end_to_end(portfolio, fake_weather, no_events):
    def final(kw):
        # last user message carries both parallel tool results, ids matched, in one message
        return resp("end_turn", text_block(
            "**Bloom frost:** move the zone trigger from **−2.4 °C** to **−2.0 °C**. In the backtest it caught "
            "the September 2013 frost. Expected loss 777 units."))

    script = [
        resp("tool_use", text_block("Checking."), tool_use("tu1", "get_crop_template", {"zoneId": REQ_ZONE}),
             tool_use("tu2", "get_zone", {})),
        resp("tool_use", tool_use("tu3", "backtest", {"rule": "frost", "candidates": [-2.0, -3.5], "fromSeason": 2013,
                                                     "toSeason": 2020})),
        resp("tool_use", tool_use("tu4", "propose_change", {
            "scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.rules.stages.bloom.frostCriticalC",
            "newValue": -2.0, "reason": "Backtest 2013–2020: −2.0 °C caught the Sep 2013 frost."})),
        final,
    ]
    fc = FakeClient(script)
    rec = agent.recommend(_request(portfolio), client=fc)

    calls = fc.messages.calls
    assert len(calls) == 4 and calls[0]["model"] == "claude-opus-5-5"
    second_last_user = calls[1]["messages"][-1]
    assert second_last_user["role"] == "user"
    assert [b["tool_use_id"] for b in second_last_user["content"]] == ["tu1", "tu2"]
    assert all(b["type"] == "tool_result" and not b["is_error"] for b in second_last_user["content"])

    assert [c.name for c in rec.tool_calls] == ["get_crop_template", "get_zone", "backtest", "propose_change"]
    bt = json.loads(calls[2]["messages"][-1]["content"][0]["content"])
    assert bt["available"] is True and bt["stage"] == "bloom" and bt["currentValue"] == -2.4
    by = {c["value"]: c for c in bt["candidates"]}
    assert by[-2.0]["hits"] >= 1 and by[-3.5]["missed"] >= 1  # −3.5 misses the −3.0 Sep 2013 night
    assert fake_weather and all(v == "tmin" for v, *_ in fake_weather)

    # contract shape, proposals and evidence
    again = AgentRecommendation.model_validate(json.loads(rec.model_dump_json(by_alias=True)))
    assert again.id == rec.id and rec.zone_id == REQ_ZONE and rec.model == "claude-opus-5-5"
    assert len(rec.proposals) == 1
    p = rec.proposals[0]
    assert (p.status, p.actor.kind, p.recommendation_id, p.old_value, p.new_value) == ("proposed", "agent", rec.id, -2.4, -2.0)
    assert {e.kind for e in rec.evidence} >= {"backtest"}
    dumped = rec.model_dump(by_alias=True, mode="json")
    assert set(dumped["toolCalls"][0]) == {"name", "input", "outputSummary"}
    assert set(dumped["proposals"][0]) >= {"oldValue", "newValue", "recommendationId"}
    # the invented number is flagged; the cited ones are not
    assert "777" in rec.answer.split("_Data check")[-1] and "−2.4" not in rec.answer.split("_Data check")[-1]


def test_turn_cap_then_forced_answer(portfolio, no_events):
    n = loop.MAX_TOOL_TURNS
    script = [resp("tool_use", tool_use(f"t{i}", "get_zone", {})) for i in range(n)]
    script.append(lambda kw: (kw.get("tool_choice") == {"type": "none"} or (_ for _ in ()).throw(AssertionError(kw)))
                  and resp("end_turn", text_block("Zone has 1 farm.")))
    fc = FakeClient(script)
    rec = agent.recommend(_request(portfolio), client=fc)
    assert len(rec.tool_calls) == n and rec.answer.startswith("Zone has 1 farm.")
    assert fc.messages.calls[-1]["tool_choice"] == {"type": "none"}
    last_user = fc.messages.calls[-1]["messages"][-1]["content"]
    assert last_user[-1]["type"] == "text" and "Answer now" in last_user[-1]["text"]


def test_spanish_question_and_model_env(portfolio, monkeypatch, no_events):
    monkeypatch.setenv("CLM_AGENT_MODEL", "claude-sonnet-5-5")
    fc = FakeClient([resp("end_turn", text_block("Recomiendo mantener el umbral de la zona."))])
    rec = agent.recommend(_request(portfolio, question="¿Qué umbral de helada recomiendas para la zona?"), client=fc)
    assert rec.model == "claude-sonnet-5-5" and fc.messages.calls[0]["model"] == "claude-sonnet-5-5"
    assert rec.proposals == [] and "Data check" not in rec.answer


# ───────────────────────── keys and API failures ─────────────────────────


def test_no_key_raises_typed_error(portfolio, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(agent.NoApiKey) as ei:
        agent.recommend(_request(portfolio), client=FakeClient([]))
    assert ei.value.status == 503 and ei.value.error == "no_api_key"


def test_no_key_endpoint_503(client, sample_portfolio, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/agent/recommend", json={"portfolio": sample_portfolio, "question": "hi", "zoneId": REQ_ZONE})
    assert r.status_code == 503 and r.json()["error"] == "no_api_key"


def test_api_errors(portfolio, no_events):
    import anthropic
    import httpx2

    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    fc = FakeClient([resp("tool_use", tool_use("t1", "get_zone", {})), anthropic.APIConnectionError(request=req)])
    rec = agent.recommend(_request(portfolio), client=fc)
    assert "could not finish" in rec.answer and "APIConnectionError" in rec.answer
    assert [c.name for c in rec.tool_calls] == ["get_zone"] and rec.proposals == []

    bad = anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=req), body=None)
    with pytest.raises(agent.NoApiKey):
        agent.recommend(_request(portfolio), client=FakeClient([bad]))


def test_endpoint_with_fake_client(client, sample_portfolio, monkeypatch, no_events):
    fc = FakeClient([resp("end_turn", text_block("No change needed."))])
    monkeypatch.setattr(agent, "make_client", lambda *a, **k: fc)
    r = client.post("/agent/recommend", json={"portfolio": sample_portfolio, "question": "Any change?", "zoneId": REQ_ZONE})
    assert r.status_code == 200, r.text
    assert r.headers.get("x-clm-fixture") is None  # the real agent answered, not the fixture
    body = r.json()
    assert body["answer"] == "No change needed." and body["zoneId"] == REQ_ZONE and body["toolCalls"] == []


def test_verify_numbers():
    src = ['{"value": -2.4, "hits": 3, "season": 2013}', "−2.0"]
    assert verify.unverified_numbers("Keep **−2.4 °C**: 3 hits since 2013; try -2,0.", src) == []
    assert verify.unverified_numbers("Loss 4,693 and 12.5 mm", src) == ["4,693", "12.5"]
    assert verify.is_spanish("Recomiendo bajar el umbral de la helada") and not verify.is_spanish("Lower the frost threshold")



def test_numeric_strings_are_accepted_for_numeric_leaves():
    """Live Opus 5.5 sent newValue "-2.0" (a string) for frostCriticalC; it must be accepted as -2.0."""
    from app.agent import rules as agent_rules

    assert agent_rules.check_value("frostCriticalC", "-2.0") == -2.0
    assert agent_rules.check_value("frostCriticalC", "\u22122,5") == -2.5
    import pytest as _pytest

    with _pytest.raises(agent_rules.PathError):
        agent_rules.check_value("frostCriticalC", "cold")
    with _pytest.raises(agent_rules.PathError):
        agent_rules.check_value("frostCriticalC", "nan")


def test_ungrounded_proposal_is_refused_and_flagged(portfolio, fake_weather, no_events):
    """ST-1: a proposed threshold no get_history/backtest output contains is a tool error, and a number the
    model writes that only a proposal echoes is flagged under the answer."""
    script = [
        resp("tool_use", tool_use("t1", "propose_change", {
            "scope": {"level": "zone", "id": REQ_ZONE},
            "path": "overrides.cherry.rules.stages.bloom.frostCriticalC",
            "newValue": -3.7, "reason": "Looks safer."})),
        resp("end_turn", text_block("I recommend setting bloom frost to -3.7 °C for this zone.")),
    ]
    rec = agent.recommend(_request(portfolio), client=FakeClient(script))
    assert rec.proposals == []
    assert [c.name for c in rec.tool_calls] == ["propose_change"]
    assert rec.tool_calls[0].output_summary.startswith("error")
    assert "Data check" in rec.answer and "-3.7" in rec.answer.split("Data check")[-1]


def test_grounded_proposal_after_backtest(portfolio, fake_weather, no_events):
    ctx = T.ToolContext(portfolio=portfolio, as_of=date(2026, 11, 7), recommendation_id="rec-g", zone_id=REQ_ZONE)
    prop = {"scope": {"level": "zone", "id": REQ_ZONE}, "path": "overrides.cherry.rules.stages.bloom.frostCriticalC",
            "newValue": -3.5, "reason": "backtest"}
    out, err = T.execute(ctx, "propose_change", prop)
    assert err and "backtest" in json.loads(out)["error"]
    out, err = T.execute(ctx, "backtest", {"rule": "frost", "candidates": [-2.0, -3.5], "fromSeason": 2013, "toSeason": 2020})
    assert not err
    out, err = T.execute(ctx, "propose_change", {**prop, "newValue": 3.5})  # sign flip is not grounded
    assert err
    out, err = T.execute(ctx, "propose_change", prop)
    assert not err and ctx.proposals[-1].new_value == -3.5
