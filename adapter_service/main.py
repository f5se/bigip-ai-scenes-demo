import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, ConfigDict
from mcp_events import (
    ACCEPTED_MCP_EVENT_TYPES,
    ACCEPTED_MCP_SCHEMA_VERSIONS,
    McpEventsBatch,
    McpLogEvent,
)
from mcp_metrics import MCP_DUPLICATE_DROPS_TOTAL, MCP_EVENTS_PARSE_FAILURES, record_mcp_event

app = FastAPI(title="F5 LLM Observability Adapter", version="1.0.0")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name, "").strip().lower()
    if not val:
        return default
    return val in ("1", "true", "yes", "on")


PRICING_RULES_PATH = os.getenv("ADAPTER_PRICING_RULES_PATH", "./pricing_rules.json")
DEDUP_TTL_SECONDS = _env_int("ADAPTER_DEDUP_TTL_SECONDS", 300)
EVENT_DEBUG = _env_bool("ADAPTER_EVENT_DEBUG", False)
MCP_EVENT_DEBUG = _env_bool("ADAPTER_MCP_EVENT_DEBUG", EVENT_DEBUG)

if EVENT_DEBUG:
    print("[adapter] ADAPTER_EVENT_DEBUG=1 — POST /events body will be printed to stdout", flush=True)
if MCP_EVENT_DEBUG:
    print("[adapter] ADAPTER_MCP_EVENT_DEBUG=1 — POST /api/mcp-events body will be printed", flush=True)

ACCEPTED_EVENT_TYPES = frozenset(
    {"llm_request_completed", "subagent_request_completed"}
)

# model = response_model (backend model). agent / identity_source only for subagent VS.
METRIC_LABELS = (
    "model",
    "pool",
    "member",
    "status_class",
    "price_version",
    "agent",
    "identity_source",
)

REQUESTS_TOTAL = Counter("llm_requests_total", "Total processed LLM requests.", METRIC_LABELS)
PROMPT_TOKENS_TOTAL = Counter(
    "llm_prompt_tokens_total", "Accumulated prompt tokens.", METRIC_LABELS
)
COMPLETION_TOKENS_TOTAL = Counter(
    "llm_completion_tokens_total", "Accumulated completion tokens.", METRIC_LABELS
)
TOTAL_TOKENS_TOTAL = Counter("llm_total_tokens_total", "Accumulated total tokens.", METRIC_LABELS)
CACHE_READ_TOKENS_TOTAL = Counter(
    "llm_cache_read_tokens_total", "Accumulated cache-read tokens.", METRIC_LABELS
)
CACHE_WRITE_TOKENS_TOTAL = Counter(
    "llm_cache_write_tokens_total", "Accumulated cache-write tokens.", METRIC_LABELS
)
COST_TOTAL = Counter(
    "llm_cost_total",
    "Accumulated LLM cost by cost type.",
    METRIC_LABELS + ("cost_type", "currency"),
)
RETRY_REQUESTS_TOTAL = Counter(
    "llm_retry_requests_total", "Requests where retry_count > 0.", METRIC_LABELS
)
FALLBACK_REQUESTS_TOTAL = Counter(
    "llm_fallback_requests_total", "Requests where fallback occurred.", METRIC_LABELS
)
PARSE_FAILURES_TOTAL = Counter(
    "adapter_parse_failures_total",
    "Events dropped due to parse errors.",
    ("reason",),
)
SUBAGENT_REQUESTS_TOTAL = Counter(
    "llm_subagent_requests_total",
    "Subagent routing events (mirror of llm_requests_total with agent labels).",
    METRIC_LABELS,
)
USAGE_PARSE_FAILURES_TOTAL = Counter(
    "llm_usage_parse_failures_total",
    "Events where usage_parse_status is not ok.",
    METRIC_LABELS,
)
DUPLICATE_DROPS_TOTAL = Counter(
    "adapter_duplicate_drops_total", "Events dropped due to duplicate request_id."
)
LATENCY_MS = Histogram(
    "llm_latency_ms",
    "LLM latency in milliseconds.",
    METRIC_LABELS,
    buckets=(50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000, 8000, 15000),
)
TTFT_MS = Histogram(
    "llm_ttft_ms",
    "Time to first token in milliseconds.",
    METRIC_LABELS,
    buckets=(20, 50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000),
)
UPSTREAM_TTFB_MS = Histogram(
    "llm_upstream_ttfb_ms",
    "Upstream time to first byte in milliseconds (non-streaming sideband).",
    METRIC_LABELS,
    buckets=(20, 50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000),
)


class LogEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str
    event_type: str
    event_time: str
    request_id: str
    client_ip: str
    http_method: str
    request_path: str
    status_code: int
    latency_ms: float
    model_name_req: str
    response_model: str
    selected_pool: str
    selected_pool_member: str
    retry_count: int
    fallback_occurred: bool
    upstream_provider: str
    streaming: bool
    ttft_ms: float | None = None
    ttft_observed: bool | None = None
    upstream_ttfb_ms: float | None = None
    upstream_ttfb_observed: bool | None = None
    agent_identity: str | None = None
    body_model_req: str | None = None
    identity_source: str | None = None
    gateway_action: str | None = None
    usage_parse_status: str | None = None


@dataclass
class PricingRule:
    model_pattern: str
    match_type: str
    currency: str
    input_price_per_1m_tokens: float
    output_price_per_1m_tokens: float
    cache_read_price_per_1m_tokens: float
    cache_write_price_per_1m_tokens: float
    price_version: str
    priority: int


class Deduplicator:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._seen: dict[str, float] = {}
        self._lock = Lock()

    def check_and_put(self, request_id: str) -> bool:
        now = time.time()
        with self._lock:
            expired = [k for k, exp in self._seen.items() if exp < now]
            for key in expired:
                self._seen.pop(key, None)
            if request_id in self._seen:
                return False
            self._seen[request_id] = now + self.ttl_seconds
            return True


class PricingManager:
    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self.rules: list[PricingRule] = []
        self.default_rule = PricingRule(
            model_pattern="*",
            match_type="wildcard",
            currency="USD",
            input_price_per_1m_tokens=0.0,
            output_price_per_1m_tokens=0.0,
            cache_read_price_per_1m_tokens=0.0,
            cache_write_price_per_1m_tokens=0.0,
            price_version="default",
            priority=9999,
        )
        self.reload()

    def reload(self) -> None:
        path = self.config_path
        if not path.is_absolute():
            path = Path(__file__).resolve().parent / path
        if not path.exists():
            self.rules = []
            return

        data = json.loads(path.read_text(encoding="utf-8"))
        loaded_rules: list[PricingRule] = []
        for item in data.get("rules", []):
            loaded_rules.append(
                PricingRule(
                    model_pattern=item.get("model_pattern", "*"),
                    match_type=item.get("match_type", "exact"),
                    currency=item.get("currency", "USD"),
                    input_price_per_1m_tokens=float(item.get("input_price_per_1m_tokens", 0.0)),
                    output_price_per_1m_tokens=float(item.get("output_price_per_1m_tokens", 0.0)),
                    cache_read_price_per_1m_tokens=float(
                        item.get("cache_read_price_per_1m_tokens", 0.0)
                    ),
                    cache_write_price_per_1m_tokens=float(
                        item.get("cache_write_price_per_1m_tokens", 0.0)
                    ),
                    price_version=item.get("price_version", "default"),
                    priority=int(item.get("priority", 100)),
                )
            )
        self.rules = sorted(loaded_rules, key=lambda r: r.priority)

    def match_rule(self, model_name: str) -> PricingRule:
        for rule in self.rules:
            if self._matches(rule, model_name):
                return rule
        return self.default_rule

    @staticmethod
    def _matches(rule: PricingRule, model_name: str) -> bool:
        if rule.match_type == "exact":
            return model_name == rule.model_pattern
        if rule.match_type == "prefix":
            return model_name.startswith(rule.model_pattern)
        if rule.match_type == "regex":
            return re.match(rule.model_pattern, model_name) is not None
        if rule.match_type == "wildcard":
            return True
        return False


def _status_class(status_code: int) -> str:
    return f"{status_code // 100}xx"


def _non_negative_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def _non_negative_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed > 0 else 0.0


def _cost_for(tokens: int, price_per_1m: float) -> float:
    return (tokens / 1_000_000.0) * price_per_1m


def _should_observe_ttft(streaming: bool, ttft_ms: float, ttft_observed: bool | None) -> bool:
    if not streaming:
        return False
    if ttft_observed is True:
        return True
    if ttft_observed is False:
        return False
    return ttft_ms > 0


def _should_observe_upstream_ttfb(
    streaming: bool, upstream_ttfb_observed: bool | None
) -> bool:
    if streaming or upstream_ttfb_observed is not True:
        return False
    return True


def _normalize_agent(payload: LogEvent) -> str:
    if payload.event_type != "subagent_request_completed":
        return "-"
    identity = (payload.agent_identity or payload.model_name_req or "").strip()
    return identity or "unknown"


def _normalize_identity_source(payload: LogEvent) -> str:
    if payload.event_type != "subagent_request_completed":
        return "-"
    source = (payload.identity_source or "").strip()
    return source or "unknown"


def _pricing_model_name(payload: LogEvent) -> str:
    """Subagent events use agent id in model_name_req; price on actual backend model."""
    if payload.event_type == "subagent_request_completed":
        return (payload.response_model or payload.model_name_req or "").strip() or "unknown"
    return payload.model_name_req


deduplicator = Deduplicator(ttl_seconds=DEDUP_TTL_SECONDS)
mcp_deduplicator = Deduplicator(ttl_seconds=DEDUP_TTL_SECONDS)
pricing_manager = PricingManager(config_path=Path(PRICING_RULES_PATH))


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _debug_log_event_body(payload: LogEvent) -> None:
    body = payload.model_dump(mode="json")
    print(
        "[adapter][event_debug] POST /events body:\n"
        + json.dumps(body, ensure_ascii=False, indent=2),
        flush=True,
    )


@app.post("/events")
async def ingest_event(payload: LogEvent) -> dict[str, Any]:
    if EVENT_DEBUG:
        _debug_log_event_body(payload)

    if payload.event_type not in ACCEPTED_EVENT_TYPES:
        PARSE_FAILURES_TOTAL.labels("unsupported_event_type").inc()
        raise HTTPException(status_code=400, detail="unsupported event_type")

    if not deduplicator.check_and_put(payload.request_id):
        DUPLICATE_DROPS_TOTAL.inc()
        return {"accepted": False, "reason": "duplicate_request_id"}

    status_class = _status_class(payload.status_code)
    agent = _normalize_agent(payload)
    identity_source = _normalize_identity_source(payload)

    prompt_tokens = _non_negative_int(getattr(payload, "prompt_tokens", None))
    completion_tokens = _non_negative_int(getattr(payload, "completion_tokens", None))
    total_tokens = _non_negative_int(getattr(payload, "total_tokens", None))
    cache_read_tokens = _non_negative_int(getattr(payload, "cache_read_tokens", None))
    cache_write_tokens = _non_negative_int(getattr(payload, "cache_write_tokens", None))
    ttft_ms = _non_negative_float(payload.ttft_ms)
    upstream_ttfb_ms = _non_negative_float(payload.upstream_ttfb_ms)

    rule = pricing_manager.match_rule(_pricing_model_name(payload))
    labels = (
        payload.response_model or "unknown",
        payload.selected_pool,
        payload.selected_pool_member,
        status_class,
        rule.price_version,
        agent,
        identity_source,
    )

    input_cost = _cost_for(prompt_tokens, rule.input_price_per_1m_tokens)
    output_cost = _cost_for(completion_tokens, rule.output_price_per_1m_tokens)
    cache_cost = _cost_for(cache_read_tokens, rule.cache_read_price_per_1m_tokens) + _cost_for(
        cache_write_tokens, rule.cache_write_price_per_1m_tokens
    )
    total_cost = input_cost + output_cost + cache_cost

    REQUESTS_TOTAL.labels(*labels).inc()
    PROMPT_TOKENS_TOTAL.labels(*labels).inc(prompt_tokens)
    COMPLETION_TOKENS_TOTAL.labels(*labels).inc(completion_tokens)
    TOTAL_TOKENS_TOTAL.labels(*labels).inc(total_tokens)
    CACHE_READ_TOKENS_TOTAL.labels(*labels).inc(cache_read_tokens)
    CACHE_WRITE_TOKENS_TOTAL.labels(*labels).inc(cache_write_tokens)
    COST_TOTAL.labels(*labels, "input", rule.currency).inc(input_cost)
    COST_TOTAL.labels(*labels, "output", rule.currency).inc(output_cost)
    COST_TOTAL.labels(*labels, "cache", rule.currency).inc(cache_cost)
    COST_TOTAL.labels(*labels, "total", rule.currency).inc(total_cost)
    LATENCY_MS.labels(*labels).observe(payload.latency_ms)
    if _should_observe_ttft(payload.streaming, ttft_ms, payload.ttft_observed):
        TTFT_MS.labels(*labels).observe(ttft_ms)
    if _should_observe_upstream_ttfb(payload.streaming, payload.upstream_ttfb_observed):
        UPSTREAM_TTFB_MS.labels(*labels).observe(upstream_ttfb_ms)
    if payload.retry_count > 0:
        RETRY_REQUESTS_TOTAL.labels(*labels).inc()
    if payload.fallback_occurred:
        FALLBACK_REQUESTS_TOTAL.labels(*labels).inc()
    if payload.event_type == "subagent_request_completed":
        SUBAGENT_REQUESTS_TOTAL.labels(*labels).inc()
    usage_status = (payload.usage_parse_status or "ok").strip().lower()
    if usage_status and usage_status != "ok":
        USAGE_PARSE_FAILURES_TOTAL.labels(*labels).inc()

    return {
        "accepted": True,
        "event_type": payload.event_type,
        "agent": agent if agent != "-" else None,
        "identity_source": identity_source if identity_source != "-" else None,
        "price_version": rule.price_version,
        "currency": rule.currency,
        "cost": {
            "input": input_cost,
            "output": output_cost,
            "cache": cache_cost,
            "total": total_cost,
        },
    }


def _debug_log_mcp_event_body(payload: McpLogEvent) -> None:
    body = payload.model_dump(mode="json")
    print(
        "[adapter][mcp_event_debug] POST /api/mcp-events body:\n"
        + json.dumps(body, ensure_ascii=False, indent=2),
        flush=True,
    )


def _ingest_mcp_event(payload: McpLogEvent) -> dict[str, Any]:
    if MCP_EVENT_DEBUG:
        _debug_log_mcp_event_body(payload)

    if payload.schema_version not in ACCEPTED_MCP_SCHEMA_VERSIONS:
        MCP_EVENTS_PARSE_FAILURES.labels("unsupported_schema_version").inc()
        raise HTTPException(status_code=400, detail="unsupported schema_version")

    if payload.event_type not in ACCEPTED_MCP_EVENT_TYPES:
        MCP_EVENTS_PARSE_FAILURES.labels("unsupported_event_type").inc()
        raise HTTPException(status_code=400, detail="unsupported event_type")

    if not mcp_deduplicator.check_and_put(payload.trace_id):
        MCP_DUPLICATE_DROPS_TOTAL.inc()
        return {"accepted": False, "reason": "duplicate_trace_id", "trace_id": payload.trace_id}

    record_mcp_event(payload.model_dump(mode="json"))
    return {"accepted": True, "trace_id": payload.trace_id, "event_type": payload.event_type}


@app.post("/api/mcp-events")
async def ingest_mcp_event(payload: McpLogEvent) -> dict[str, Any]:
    return _ingest_mcp_event(payload)


@app.post("/api/mcp-events/batch")
async def ingest_mcp_events_batch(batch: McpEventsBatch) -> dict[str, Any]:
    results = [_ingest_mcp_event(item) for item in batch.events]
    accepted = sum(1 for r in results if r.get("accepted"))
    return {"accepted_count": accepted, "total": len(results), "results": results}


@app.post("/pricing/reload")
async def reload_pricing_rules() -> dict[str, Any]:
    pricing_manager.reload()
    return {"reloaded": True, "rules": len(pricing_manager.rules)}


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest().decode("utf-8"), media_type=CONTENT_TYPE_LATEST)
