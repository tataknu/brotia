"""Loan schedules and exposure: parity with app/src/domain/schedule.test.ts (CONTRACT §E.8)."""

from __future__ import annotations

from datetime import date

from app.domain.schedule import (
    add_months,
    generate_installments,
    installments_total,
    make_loan,
    next_installment,
    outstanding_at,
)
from app.models import Loan


def _dates(r):
    return [i.due_date for i in r]


def test_bullet():
    r = generate_installments("bullet", "2026-01-10", "2027-01-10", 100_000)
    assert [(i.due_date, i.amount) for i in r] == [("2027-01-10", 100_000)]


def test_monthly_sum_exact_and_remainder_last():
    r = generate_installments("monthly", "2026-01-15", "2027-01-15", 100_000)
    assert len(r) == 12 and r[0].due_date == "2026-02-15" and r[-1].due_date == "2027-01-15"
    assert installments_total(r) == 100_000
    assert [i.amount for i in generate_installments("monthly", "2026-01-01", "2026-04-01", 100)] == [33.33, 33.33, 33.34]


def test_small_amounts_split_in_cents():
    r = generate_installments("monthly", "2026-08-06", "2031-08-06", 10)
    assert len(r) == 60 and all(0.16 <= i.amount <= 0.17 for i in r) and installments_total(r) == 10


def test_quarterly_and_semiannual():
    r = generate_installments("quarterly", "2026-03-01", "2027-03-01", 40_000)
    assert _dates(r) == ["2026-06-01", "2026-09-01", "2026-12-01", "2027-03-01"]
    assert all(i.amount == 10_000 for i in r)
    r = generate_installments("semiannual", "2026-02-01", "2027-06-30", 30_000)
    assert _dates(r) == ["2026-06-30", "2026-12-30", "2027-06-30"] and installments_total(r) == 30_000


def test_month_end_clamps():
    assert add_months("2027-03-31", -1) == "2027-02-28"
    assert add_months("2024-01-31", 1) == "2024-02-29"
    r = generate_installments("monthly", "2026-12-31", "2027-03-31", 3000)
    assert _dates(r) == ["2027-01-31", "2027-02-28", "2027-03-31"]


def test_at_harvest_and_custom():
    r = generate_installments("at_harvest", "2026-10-01", "2027-06-01", 5000, "2027-04-10")
    assert [(i.due_date, i.amount) for i in r] == [("2027-04-10", 5000)]
    assert _dates(generate_installments("at_harvest", "2026-10-01", "2027-06-01", 5000)) == ["2027-06-01"]
    assert _dates(generate_installments("at_harvest", "2026-10-01", "2027-06-01", 5000, "2027-08-01")) == ["2027-06-01"]
    assert generate_installments("custom", "2026-01-01", "2027-01-01", 1000) == []


def test_outstanding_and_next_installment():
    loan = Loan(origination_date="2026-01-15", maturity_date="2026-07-15", amount=60_000, currency="USD",
                schedule_type="monthly",
                installments=generate_installments("monthly", "2026-01-15", "2026-07-15", 60_000))
    assert outstanding_at(loan, "2026-01-01") == 0
    assert outstanding_at(loan, "2026-02-01") == 60_000
    assert outstanding_at(loan, "2026-02-15") == 50_000  # due date counts as paid
    assert outstanding_at(loan, date(2026, 8, 1)) == 0
    assert next_installment(loan, "2026-02-15").due_date == "2026-03-15"
    assert next_installment(loan, "2026-07-15") is None
    assert outstanding_at(None, "2026-01-01") == 0 and next_installment(None, "2026-01-01") is None


def test_empty_plan_behaves_like_bullet():
    loan = Loan(origination_date="2026-01-01", maturity_date="2027-01-01", amount=1000, currency="USD",
                schedule_type="custom", installments=[])
    assert outstanding_at(loan, "2026-06-01") == 1000
    assert outstanding_at(loan, "2027-01-01") == 0
    assert next_installment(loan, "2026-06-01").due_date == "2027-01-01"


def test_make_loan_matches_fixture_ovalle_semiannual(fixture_json):
    fx = next(f for f in fixture_json("portfolio-sample.json")["farms"] if f["id"] == "cl-ovalle-table-grape")["loan"]
    loan = make_loan("semiannual", fx["originationDate"], fx["maturityDate"], fx["amount"])
    assert [i.model_dump(by_alias=True) for i in loan.installments] == fx["installments"]


def test_at_harvest_multi_year_pays_every_harvest():
    """RT-1: a 4-year harvest loan repays at every harvest, not all at the first one."""
    r = generate_installments("at_harvest", "2025-06-01", "2029-06-01", 150000, "2025-11-10")
    assert _dates(r) == ["2025-11-10", "2026-11-10", "2027-11-10", "2028-11-10"]
    assert sum(i.amount for i in r) == 150000 and r[0].amount == 37500
