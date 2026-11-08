"""svc-agent: the farming agent (ADR-0013 D9, CONTRACT POST /agent/recommend).

recommend(request) runs a Claude tool-use loop over the agent tools (app.agent.tools): get_zone,
get_crop_template, get_history, list_events, backtest and propose_change. Proposals are RuleChange
objects with status 'proposed' and actor {kind: 'agent'}; nothing is applied server-side. Every tool
call is reported in toolCalls, and numbers in the answer that no tool output contains are flagged
under the answer.

Key: ANTHROPIC_API_KEY from the environment or the gitignored service/.env (app.config). Never logged.
Model: CLM_AGENT_MODEL, else ANTHROPIC_MODEL, else claude-opus-5-5 (claude-sonnet-5-5 for speed).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from app import config
from app.agent import loop, tools as T, verify
from app.agent.prompt import first_user_message
from app.models import AgentRecommendation, AgentRequest
from app.routers.errors import ApiException

log = logging.getLogger("clm.agent")

__all__ = ["recommend", "NoApiKey", "make_client"]


class NoApiKey(ApiException):
    """No usable Anthropic key: the router answers 503 {error: 'no_api_key'}."""

    def __init__(self, detail: str = "ANTHROPIC_API_KEY is not set; the farming agent is unavailable"):
        super().__init__(503, "no_api_key", detail)


def make_client(api_key: str, timeout_s: float) -> Any:
    import anthropic

    return anthropic.Anthropic(api_key=api_key, max_retries=1, timeout=timeout_s)


def _api_error_text(exc: Exception) -> str:
    status = getattr(exc, "status_code", None)
    return f"{exc.__class__.__name__}" + (f" (HTTP {status})" if status else "")


def _fallback_answer(ctx: T.ToolContext, reason: str, spanish: bool) -> str:
    lines = [
        ("_El agente no pudo terminar: " if spanish else "_The agent could not finish: ") + reason + "._",
    ]
    if ctx.tool_calls:
        lines.append("")
        lines.append("Resultados de herramientas obtenidos:" if spanish else "Tool results gathered so far:")
        lines += [f"- `{c.name}`: {c.output_summary}" for c in ctx.tool_calls]
    if ctx.proposals:
        lines.append("")
        lines.append(("Propuestas registradas: " if spanish else "Proposals recorded: ") + str(len(ctx.proposals)))
    lines.append("")
    lines.append("_Nada cambia hasta que usted lo aplique._" if spanish else "_Nothing changes until you apply it._")
    return "\n".join(lines)


def recommend(request: AgentRequest, client: Any = None) -> AgentRecommendation:
    """POST /agent/recommend. The router already validated zoneId/farmId (400/404)."""
    key = config.anthropic_api_key()
    if not key:
        raise NoApiKey()
    started = time.monotonic()
    model = loop.agent_model()
    as_of = datetime.now(timezone.utc).date()
    ctx = T.ToolContext(
        portfolio=request.portfolio,
        as_of=as_of,
        recommendation_id=T.new_recommendation_id(),
        zone_id=request.zone_id,
        farm_id=request.farm_id,
        deadline=started + loop.deadline_s(),
    )
    spanish = verify.is_spanish(request.question)
    if client is None:
        client = make_client(key, loop.deadline_s())
    first = first_user_message(request.portfolio, request.question, request.zone_id, request.farm_id, as_of)

    error: str | None = None
    try:
        res = loop.run(client, ctx, first, model)
    except Exception as exc:
        try:
            import anthropic

            if isinstance(exc, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
                raise NoApiKey("the Anthropic API rejected the configured key; the farming agent is unavailable")
            known = isinstance(exc, (anthropic.APIError,))
        except ImportError:  # pragma: no cover
            known = False
        if not known:
            raise
        log.warning("agent: Anthropic API call failed: %s", _api_error_text(exc))
        error = _api_error_text(exc)
        res = loop.LoopResult(text="", stop="api_error", turns=0, error=error)

    text = res.text
    if res.stop == "api_error":
        text = _fallback_answer(ctx, ("error al llamar al modelo: " if spanish else "the model call failed: ") + (error or ""), spanish)
    elif res.stop == "deadline" or not text:
        why = ("se acabó el tiempo" if spanish else "it ran out of time") if res.stop == "deadline" else (
            "el modelo no devolvió texto" if spanish else "the model returned no text")
        text = _fallback_answer(ctx, why, spanish)
    else:
        if res.stop == "refusal":
            text = ("_El modelo declinó parte de esta solicitud._\n\n" if spanish else "_The model declined part of this request._\n\n") + text
        elif res.stop == "max_tokens":
            text += "\n\n_(respuesta truncada)_" if spanish else "\n\n_(answer cut short)_"
        elif res.stop == "turn_cap":
            text += ("\n\n_Se alcanzó el límite de llamadas a herramientas._" if spanish
                     else "\n\n_The tool-call limit was reached._")
        # proposals' new values are NOT evidence for themselves (only the old, effective values are);
        # propose_change outputs are excluded from ctx.outputs for the same reason.
        sources = ctx.outputs + [request.question, first] + [f"{p.old_value}" for p in ctx.proposals]
        bad = verify.unverified_numbers(res.text, sources)
        if bad:
            text += verify.footnote(bad, spanish)

    log.info("agent: model=%s turns=%d tools=%d proposals=%d stop=%s in %.1fs", model, res.turns,
             len(ctx.tool_calls), len(ctx.proposals), res.stop, time.monotonic() - started)
    return AgentRecommendation(
        id=ctx.recommendation_id,
        zone_id=request.zone_id,
        farm_id=request.farm_id,
        question=request.question,
        answer=text,
        proposals=ctx.proposals,
        evidence=ctx.evidence[:12],
        tool_calls=ctx.tool_calls,
        model=model,
        created_at=config.iso_utc(),
    )
