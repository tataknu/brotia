"""Insurance request outbox (v1.1, ADR-0025): POST validates and queues, GET lists newest first, no outbound calls."""

from __future__ import annotations

import copy
import json

import httpx
import pytest

from app import store


def _body(portfolio_id: str = "pf-ins-test", farm_id: str = "cl-ovalle-table-grape", **payload_patch):
    payload = {
        "partner": "suyana",
        "lender": "Banco Valle Andino",
        "portfolioName": "Chile sample",
        "farm": {
            "name": "Ovalle table grape",
            "crop": "table_grape",
            "areaHa": 12.4,
            "centroid": [-71.2, -30.6],
            "country": "CL",
            "zoneId": "auto-cl-ovalle-table-grape",
            "zoneName": "Ovalle",
        },
        "loan": {"currency": "USD", "amount": 250000, "outstanding": 180000.5, "maturityDate": "2028-04-30"},
        "risk": {
            "asOf": "2026-11-07",
            "score": 58.6,
            "tier": "watch",
            "drivers": [
                {"peril": "water", "text": "DGA decree No. 177 active until 2027-07-10."},
                {"peril": "abandonment", "text": "Vigour collapsed for 6 composites."},
            ],
        },
        "perils": ["water", "frost"],
        "uncoveredPerils": ["abandonment"],
        "note": "  Please quote before the bloom.  ",
    }
    payload.update(payload_patch)
    return {"portfolioId": portfolio_id, "farmId": farm_id, "payload": payload}


@pytest.fixture()
def no_network(monkeypatch):
    """Any outbound HTTP call during these tests fails loudly."""

    def boom(*a, **k):
        raise AssertionError("insurance endpoints must not make outbound calls")

    monkeypatch.setattr(httpx.Client, "send", boom)
    monkeypatch.setattr(httpx.AsyncClient, "send", boom)


def test_post_queues_and_echoes_camel_case(client, no_network):
    r = client.post("/insurance/requests", json=_body())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["id"].startswith("ins-") and len(out["id"]) == 16
    assert out["status"] == "queued"
    assert out["createdAt"].endswith("Z")
    assert out["portfolioId"] == "pf-ins-test"
    assert out["farmId"] == "cl-ovalle-table-grape"
    p = out["payload"]
    assert p["partner"] == "suyana"
    assert p["farm"]["areaHa"] == 12.4
    assert p["farm"]["centroid"] == [-71.2, -30.6]
    assert p["loan"]["maturityDate"] == "2028-04-30"
    assert p["risk"]["asOf"] == "2026-11-07"
    assert p["perils"] == ["water", "frost"]
    assert p["uncoveredPerils"] == ["abandonment"]
    assert p["note"] == "Please quote before the bloom."
    # snake_case never leaks
    assert "area_ha" not in json.dumps(out)


def test_row_is_stored_in_duckdb(client):
    out = client.post("/insurance/requests", json=_body(portfolio_id="pf-ins-db")).json()
    rows = store.query("SELECT portfolio_id, farm_id, status, payload FROM insurance_requests WHERE id = ?", [out["id"]])
    assert len(rows) == 1
    pid, fid, status, payload = rows[0]
    assert (pid, fid, status) == ("pf-ins-db", "cl-ovalle-table-grape", "queued")
    assert json.loads(payload)["farm"]["name"] == "Ovalle table grape"


def test_get_lists_newest_first_and_filters_by_portfolio(client, no_network):
    a = client.post("/insurance/requests", json=_body(portfolio_id="pf-ins-list", farm_id="farm-a")).json()
    b = client.post("/insurance/requests", json=_body(portfolio_id="pf-ins-list", farm_id="farm-b")).json()
    client.post("/insurance/requests", json=_body(portfolio_id="pf-ins-other", farm_id="farm-c"))
    r = client.get("/insurance/requests", params={"portfolioId": "pf-ins-list"})
    assert r.status_code == 200, r.text
    got = r.json()
    assert {x["id"] for x in got} == {a["id"], b["id"]}
    assert [x["createdAt"] for x in got] == sorted((x["createdAt"] for x in got), reverse=True)
    assert all(x["portfolioId"] == "pf-ins-list" and x["status"] == "queued" for x in got)
    # the stored payload round-trips unchanged
    assert next(x for x in got if x["id"] == a["id"])["payload"] == a["payload"]
    assert next(x for x in got if x["id"] == a["id"])["createdAt"] == a["createdAt"]


def test_get_empty_portfolio_is_empty_list(client):
    r = client.get("/insurance/requests", params={"portfolioId": "pf-nobody"})
    assert r.status_code == 200
    assert r.json() == []


def test_get_requires_portfolio_id(client):
    r = client.get("/insurance/requests")
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"
    assert "portfolioId" in r.json()["detail"]


def test_loan_may_be_null_and_note_optional(client):
    body = _body(loan=None)
    del body["payload"]["note"]
    r = client.post("/insurance/requests", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["payload"]["loan"] is None
    assert r.json()["payload"]["note"] is None


def _bad(path: list, value):
    body = _body()
    node = body
    for k in path[:-1]:
        node = node[k]
    if value is KeyError:
        del node[path[-1]]
    else:
        node[path[-1]] = value
    return body


@pytest.mark.parametrize(
    "path,value",
    [
        (["payload", "perils"], []),
        (["payload", "perils"], ["frost", "frost"]),
        (["payload", "perils"], ["heat"]),  # not a parametric peril in v1.1
        (["payload", "partner"], "someone-else"),
        (["payload", "risk", "score"], 101),
        (["payload", "risk", "tier"], "severe"),
        (["payload", "risk", "asOf"], "07/11/2026"),
        (["payload", "risk", "drivers"], [{"peril": "frost", "text": "x"}] * 4),
        (["payload", "farm", "areaHa"], 0),
        (["payload", "farm", "centroid"], [-71.2, -95.0]),
        (["payload", "farm", "crop"], "wheat"),
        (["payload", "loan", "amount"], -1),
        (["payload", "loan", "maturityDate"], "2028-13-01"),
        (["payload", "note"], "x" * 1001),
        (["portfolioId"], ""),
        (["farmId"], "has spaces"),
        (["payload", "farm"], KeyError),
    ],
)
def test_invalid_payloads_are_400(client, path, value):
    r = client.post("/insurance/requests", json=_bad(path, copy.deepcopy(value)))
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "invalid_request"


def test_invalid_post_stores_nothing(client):
    client.get("/insurance/requests", params={"portfolioId": "pf-any"})  # creates the table when run alone
    before = store.query("SELECT count(*) FROM insurance_requests")[0][0]
    client.post("/insurance/requests", json=_bad(["payload", "perils"], []))
    assert store.query("SELECT count(*) FROM insurance_requests")[0][0] == before
