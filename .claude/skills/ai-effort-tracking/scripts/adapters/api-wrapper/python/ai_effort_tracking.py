"""Adapter: any SDK client -> RawUsageRecord (capture level N1 equivalent).

The highest-fidelity adapter there is: when you own the client, ``usage``
arrives in the response and nothing has to be reconstructed.

The whole point of this module is the normaliser table below. Three providers
count cache tokens with mutually incompatible semantics, and getting it wrong
does not raise -- it produces a presentable, wrong number.
See references/adapter-contract.md.

    from ai_effort_tracking import wrap
    client = wrap(OpenAI(), provider="deepseek", dir="metrics/events")
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable

ADAPTER_ID = "api-wrapper-python@1.0.0"

CANONICAL_FIELDS = (
    "input_uncached",
    "cache_read",
    "cache_write_short",
    "cache_write_long",
    "output",
    "thinking",
)


def _empty() -> dict[str, int]:
    return {f: 0 for f in CANONICAL_FIELDS}


def _get(obj: Any, *names: str, default: Any = None) -> Any:
    """Read a field from either a dict or an SDK model object."""
    for name in names:
        if isinstance(obj, dict):
            if name in obj:
                obj = obj[name]
                continue
            return default
        if hasattr(obj, name):
            obj = getattr(obj, name)
            continue
        return default
    return obj if obj is not None else default


def _anthropic(u: Any) -> dict[str, int]:
    """``input_tokens`` already excludes cache -- nothing to subtract."""
    t = _empty()
    t["input_uncached"] = _get(u, "input_tokens", default=0) or 0
    t["cache_read"] = _get(u, "cache_read_input_tokens", default=0) or 0
    t["cache_write_short"] = _get(u, "cache_creation", "ephemeral_5m_input_tokens", default=0) or 0
    t["cache_write_long"] = _get(u, "cache_creation", "ephemeral_1h_input_tokens", default=0) or 0
    t["output"] = _get(u, "output_tokens", default=0) or 0
    t["thinking"] = _get(u, "output_tokens_details", "thinking_tokens", default=0) or 0
    return t


def _openai(u: Any) -> dict[str, int]:
    """``cached_tokens`` is a SUBSET of ``prompt_tokens``: subtract, or you pay twice."""
    cached = _get(u, "prompt_tokens_details", "cached_tokens", default=0) or 0
    prompt = _get(u, "prompt_tokens", default=0) or 0
    t = _empty()
    t["input_uncached"] = max(0, prompt - cached)
    t["cache_read"] = cached
    t["output"] = _get(u, "completion_tokens", default=0) or 0
    t["thinking"] = _get(u, "completion_tokens_details", "reasoning_tokens", default=0) or 0
    return t


def _deepseek(u: Any) -> dict[str, int]:
    """``prompt_tokens`` = hit + miss, and hit/miss are billed at different rates."""
    hit = _get(u, "prompt_cache_hit_tokens", default=0) or 0
    miss = _get(u, "prompt_cache_miss_tokens", default=None)
    if miss is None:
        miss = max(0, (_get(u, "prompt_tokens", default=0) or 0) - hit)
    t = _empty()
    t["input_uncached"] = miss
    t["cache_read"] = hit
    t["output"] = _get(u, "completion_tokens", default=0) or 0
    t["thinking"] = _get(u, "completion_tokens_details", "reasoning_tokens", default=0) or 0
    return t


def _google(u: Any) -> dict[str, int]:
    """Field names not verified against Google's docs -- validate before trusting."""
    m = _get(u, "usageMetadata", default=None) or u
    cached = _get(m, "cachedContentTokenCount", default=0) or 0
    t = _empty()
    t["input_uncached"] = max(0, (_get(m, "promptTokenCount", default=0) or 0) - cached)
    t["cache_read"] = cached
    t["output"] = _get(m, "candidatesTokenCount", default=0) or 0
    t["thinking"] = _get(m, "thoughtsTokenCount", default=0) or 0
    return t


NORMALISERS: dict[str, Callable[[Any], dict[str, int]]] = {
    "anthropic": _anthropic,
    "openai": _openai,
    "deepseek": _deepseek,
    "google": _google,
    # Format compatibility is not billing compatibility: these reuse OpenAI's
    # shape but need their own verified rates in pricing.json.
    "alibaba": _openai,
    "moonshot": _openai,
}


def normalise_usage(provider: str, usage: Any) -> dict[str, int] | None:
    fn = NORMALISERS.get(provider)
    if fn is None:
        raise ValueError(f'no normaliser for provider "{provider}" -- see adapter-contract.md')
    if usage is None:
        return None
    return fn(usage)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _session_file(dir_: str, session_id: str, when_iso: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", session_id)
    return os.path.join(dir_, f"{when_iso[:10]}--{safe}.jsonl")


def _write_record(dir_: str, session_id: str, record: dict) -> None:
    os.makedirs(dir_, exist_ok=True)
    with open(_session_file(dir_, session_id, record["started_at"]), "a", encoding="utf8") as fh:
        fh.write(json.dumps(record) + "\n")


def _usage_of(response: Any) -> Any:
    return _get(response, "usage", default=None) or _get(response, "usageMetadata", default=None)


def wrap(
    client: Any,
    *,
    provider: str,
    surface: str = "custom-api-client",
    dir: str = "metrics/events",
    session_id: str | None = None,
    trace_id: str | None = None,
    on_record: Callable[[dict], None] | None = None,
) -> Any:
    """Wrap a client so every completion call emits a RawUsageRecord.

    Only counts and identifiers are kept; prompts and responses never reach
    the ledger.
    """
    if provider not in NORMALISERS:
        raise ValueError(f'unknown provider "{provider}"')
    session = session_id or f"api-{int(time.time())}"

    def emit(record: dict) -> None:
        if on_record is not None:
            on_record(record)
        else:
            _write_record(dir, session, record)

    def instrument(fn: Callable) -> Callable:
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            started = _now_iso()
            response = fn(*args, **kwargs)
            usage = _usage_of(response)
            if usage is not None:
                model = _get(response, "model", default=None) or kwargs.get("model")
                emit(
                    {
                        "provider": provider,
                        "surface": surface,
                        "model": model,
                        "session_id": session,
                        "trace_id": trace_id,
                        "started_at": started,
                        "ended_at": _now_iso(),
                        "tokens": normalise_usage(provider, usage),
                        "raw": {"model": model, "usage": _to_plain(usage)},
                        "adapter": ADAPTER_ID,
                        "capture_level": "N1",
                        "execution_host": "api",
                        "review_measurement": "declared",
                    }
                )
            return response

        return wrapped

    # Proxy only the create() calls; everything else passes through untouched.
    for path in (("chat", "completions", "create"), ("messages", "create"), ("responses", "create")):
        node: Any = client
        for part in path[:-1]:
            node = getattr(node, part, None)
            if node is None:
                break
        if node is not None and callable(getattr(node, path[-1], None)):
            setattr(node, path[-1], instrument(getattr(node, path[-1])))
    return client


def _to_plain(obj: Any) -> Any:
    """Best-effort conversion of an SDK model into plain JSON-serialisable data."""
    for attr in ("model_dump", "dict", "to_dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return fn()
            except TypeError:
                pass
    if isinstance(obj, dict):
        return obj
    return {k: v for k, v in vars(obj).items() if not k.startswith("_")} if hasattr(obj, "__dict__") else str(obj)
