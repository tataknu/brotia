"""Check that every number in the agent's answer appears in a tool output (the "never invent" rule).

Numbers the model wrote that no tool output, the question or the request context contains are listed in
a footnote under the answer, so the lender can see them. This is a guard, not a proof: a number can
appear in a tool output and still be used wrongly.
"""

from __future__ import annotations

import re
from typing import Iterable

_NUM = re.compile(r"(?<![\w.])[-−–]?\d+(?:[.,]\d+)*")
_SPANISH_HINTS = re.compile(r"\b(el|la|los|las|de|que|para|una|recomiendo|helada|lluvia|umbral|zona)\b", re.I)
_ENGLISH_HINTS = re.compile(r"\b(the|and|for|with|recommend|frost|rain|threshold|zone|of)\b", re.I)


def _interpretations(token: str) -> set[float]:
    t = token.replace("−", "-").replace("–", "-")
    out: set[float] = set()
    for cand in (t.replace(",", ""), t.replace(".", "").replace(",", "."), t.replace(",", ".")):
        try:
            out.add(float(cand))
        except ValueError:
            continue
    return out


def numbers_in(text: str) -> list[tuple[str, set[float]]]:
    return [(m.group(0), _interpretations(m.group(0))) for m in _NUM.finditer(text)]


def known_numbers(texts: Iterable[str]) -> set[float]:
    out: set[float] = set()
    for t in texts:
        for _, vals in numbers_in(t):
            out |= vals
    return out


def _close(a: float, known: set[float]) -> bool:
    for k in known:
        if abs(a - k) <= 0.051 or (k and abs(a - k) / abs(k) <= 0.005):
            return True
        if abs(abs(a) - abs(k)) <= 0.051:  # sign written as words ("2 °C below zero")
            return True
    return False


def unverified_numbers(answer: str, sources: Iterable[str]) -> list[str]:
    known = known_numbers(sources)
    bad: list[str] = []
    for token, vals in numbers_in(answer):
        if not vals or any(_close(v, known) for v in vals):
            continue
        if token not in bad:
            bad.append(token)
    return bad


def is_spanish(text: str) -> bool:
    return len(_SPANISH_HINTS.findall(text)) > len(_ENGLISH_HINTS.findall(text))


def footnote(bad: list[str], spanish: bool) -> str:
    joined = ", ".join(bad[:12])
    if spanish:
        return f"\n\n_Control de datos: estos números no aparecen en ninguna salida de herramienta: {joined}. Verifíquelos antes de usarlos._"
    return f"\n\n_Data check: these numbers do not appear in any tool output: {joined}. Verify them before relying on them._"
