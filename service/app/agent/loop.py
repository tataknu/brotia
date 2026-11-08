"""The Claude tool-use loop (manual loop over the Messages API, Anthropic Python SDK).

- Model: env CLM_AGENT_MODEL, else ANTHROPIC_MODEL (app.config.agent_model), default claude-opus-5-5.
- At most MAX_TOOL_TURNS model turns that call tools; then one last turn with tool_choice none.
- One wall-clock deadline for the whole request (CLM_AGENT_DEADLINE_S, default 80 s, inside the
  contract's 90 s); each API call gets the remaining time as its timeout.
- Parallel tool_use blocks are executed in order and returned in ONE user message.
- The client is injectable (tests pass a fake; nothing here touches the network by itself).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

from app import config
from app.agent import tools as T
from app.agent.prompt import SYSTEM_PROMPT

log = logging.getLogger("clm.agent")

MAX_TOOL_TURNS = 8
MAX_TOKENS = 8000
DEFAULT_DEADLINE_S = 80.0
MIN_CALL_S = 8.0


def agent_model() -> str:
    return os.environ.get("CLM_AGENT_MODEL", "").strip() or config.agent_model()


def agent_effort() -> str:
    v = os.environ.get("CLM_AGENT_EFFORT", "").strip().lower()
    return v if v in {"low", "medium", "high", "xhigh", "max"} else "medium"


def deadline_s() -> float:
    try:
        return max(10.0, float(os.environ.get("CLM_AGENT_DEADLINE_S", DEFAULT_DEADLINE_S)))
    except ValueError:
        return DEFAULT_DEADLINE_S


@dataclass
class LoopResult:
    text: str
    stop: str  # 'end_turn' | 'max_tokens' | 'refusal' | 'turn_cap' | 'deadline' | 'api_error'
    turns: int
    error: str | None = None


def _blocks(resp: Any) -> list[Any]:
    return list(getattr(resp, "content", None) or [])


def _text(resp: Any) -> str:
    return "\n\n".join(b.text for b in _blocks(resp) if getattr(b, "type", None) == "text" and getattr(b, "text", "")).strip()


def _call(client: Any, ctx: T.ToolContext, messages: list[dict[str, Any]], model: str, with_tools: bool) -> Any:
    remaining = ctx.remaining()
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "tools": T.TOOL_SCHEMAS,
        "output_config": {"effort": agent_effort()},
        "timeout": max(1.0, remaining),
    }
    if not with_tools:
        kwargs["tool_choice"] = {"type": "none"}
    return client.messages.create(**kwargs)


def run(client: Any, ctx: T.ToolContext, first_message: str, model: str) -> LoopResult:
    """Run the loop. API errors propagate to the caller (recommend() maps them)."""
    messages: list[dict[str, Any]] = [{"role": "user", "content": first_message}]
    tool_turns = 0
    while True:
        out_of_turns = tool_turns >= MAX_TOOL_TURNS
        out_of_time = ctx.remaining() < MIN_CALL_S
        if out_of_time:
            return LoopResult(text="", stop="deadline", turns=tool_turns)
        resp = _call(client, ctx, messages, model, with_tools=not out_of_turns)
        stop = getattr(resp, "stop_reason", None)
        uses = [b for b in _blocks(resp) if getattr(b, "type", None) == "tool_use"]
        if stop == "tool_use" and uses and not out_of_turns:
            tool_turns += 1
            messages.append({"role": "assistant", "content": _blocks(resp)})
            results = []
            for b in uses:
                content, is_err = T.execute(ctx, b.name, getattr(b, "input", None))
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": content, "is_error": is_err})
            if tool_turns >= MAX_TOOL_TURNS or ctx.remaining() < 25:
                results.append({"type": "text", "text": "Tool budget reached. Answer now using only the tool outputs above."})
            messages.append({"role": "user", "content": results})
            continue
        if stop == "pause_turn":
            messages.append({"role": "assistant", "content": _blocks(resp)})
            tool_turns += 1
            continue
        text = _text(resp)
        if stop == "refusal":
            return LoopResult(text=text, stop="refusal", turns=tool_turns)
        if stop == "max_tokens":
            return LoopResult(text=text, stop="max_tokens", turns=tool_turns)
        if stop == "tool_use":  # tools requested after the cap; take whatever text came with it
            return LoopResult(text=text, stop="turn_cap", turns=tool_turns)
        return LoopResult(text=text, stop="end_turn", turns=tool_turns)
