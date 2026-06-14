#!/usr/bin/env python3
import argparse
import json
import random
import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib import error, request


def now_rfc3339() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_int_range(value: str, name: str) -> tuple[int, int]:
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 2:
        raise ValueError(f"{name} must be in 'min,max' format")
    left = int(parts[0])
    right = int(parts[1])
    if left < 0 or right < 0 or left > right:
        raise ValueError(f"{name} must satisfy 0 <= min <= max")
    return left, right


def parse_status_weights(value: str) -> tuple[list[int], list[float]]:
    status_codes: list[int] = []
    weights: list[float] = []
    for item in parse_csv(value):
        try:
            status_str, weight_str = item.split(":", 1)
            code = int(status_str.strip())
            weight = float(weight_str.strip())
        except ValueError as err:
            raise ValueError("status-weights format must be like '200:85,429:8,500:7'") from err
        if weight <= 0:
            raise ValueError("status weight must be > 0")
        status_codes.append(code)
        weights.append(weight)
    if not status_codes:
        raise ValueError("status-weights cannot be empty")
    return status_codes, weights


def parse_model_weights(value: str) -> tuple[list[str], list[float]]:
    models: list[str] = []
    weights: list[float] = []
    for item in parse_csv(value):
        if ":" in item:
            model, weight_str = item.split(":", 1)
            weight = float(weight_str.strip())
        else:
            model = item
            weight = 1.0
        model = model.strip()
        if not model:
            continue
        if weight <= 0:
            raise ValueError("model weight must be > 0")
        models.append(model)
        weights.append(weight)
    if not models:
        raise ValueError("models cannot be empty")
    return models, weights


def infer_pool(model: str) -> str:
    normalized = model.lower()
    if "deepseek" in normalized:
        return "pool_deepseek-chat"
    if "gpt" in normalized or "o1" in normalized or "o3" in normalized:
        return "pool_openai"
    if "qwen" in normalized:
        return "pool_qwen"
    if "claude" in normalized:
        return "pool_claude"
    return "pool_llm_default"


def make_event(
    index: int,
    models: list[str],
    model_weights: list[float],
    prompt_range: tuple[int, int],
    completion_range: tuple[int, int],
    status_codes: list[int],
    status_weights: list[float],
    members: list[str],
    duplicate_of: str | None = None,
) -> dict:
    model = random.choices(models, weights=model_weights, k=1)[0]
    pool = infer_pool(model)
    member = random.choice(members)
    status = random.choices(status_codes, weights=status_weights, k=1)[0]
    streaming = random.choice([True, False])
    retry_count = random.randint(1, 3) if status in (429, 500) else 0
    fallback = retry_count > 0 and random.choice([True, False])

    prompt_tokens = random.randint(prompt_range[0], prompt_range[1])
    completion_tokens = random.randint(completion_range[0], completion_range[1])
    total_tokens = prompt_tokens + completion_tokens

    req_id = duplicate_of or f"req_mock_{index}_{uuid.uuid4().hex[:12]}"
    event = {
        "schema_version": "v1",
        "event_type": "llm_request_completed",
        "event_time": now_rfc3339(),
        "request_id": req_id,
        "client_ip": f"10.10.1.{random.randint(2, 254)}",
        "http_method": "POST",
        "request_path": "/v1/chat/completions",
        "status_code": status,
        "latency_ms": round(random.uniform(100, 2500), 2),
        "model_name_req": model,
        "response_model": model,
        "selected_pool": pool,
        "selected_pool_member": member,
        "retry_count": retry_count,
        "fallback_occurred": fallback,
        "fallback_target_pool": "pool_llm_default" if fallback else None,
        "upstream_provider": "openai_compatible",
        "streaming": streaming,
        "ttft_ms": round(random.uniform(50, 600), 2) if streaming else 0,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    if not fallback:
        event.pop("fallback_target_pool", None)
    if streaming:
        event["ttft_observed"] = True
    else:
        event.pop("ttft_observed", None)
        ttfb = round(random.uniform(30, 500), 2)
        event["upstream_ttfb_ms"] = ttfb
        event["upstream_ttfb_observed"] = True
    return event


def post_event(url: str, event: dict, timeout: float) -> tuple[int, str]:
    data = json.dumps(event).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send mock F5 structured logs to adapter /events.")
    parser.add_argument("--url", default="http://127.0.0.1:8090/events", help="Adapter events endpoint")
    parser.add_argument("--count", type=int, default=200, help="Total events to send")
    parser.add_argument("--concurrency", type=int, default=10, help="Worker threads")
    parser.add_argument("--timeout", type=float, default=5.0, help="Per request timeout seconds")
    parser.add_argument("--duplicate-rate", type=float, default=0.05, help="Duplicate request_id ratio")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument(
        "--models",
        default=(
            "deepseek-chat:25,deepseek-reasoner:15,gpt-4o:20,gpt-4.1-mini:10,"
            "qwen-max:10,claude-3-5-sonnet:10,llama-3.1-70b:10"
        ),
        help="Model list with optional weights, e.g. 'gpt-4o:30,deepseek-chat:70'",
    )
    parser.add_argument(
        "--members",
        default="ubuntu-ai:8005,ubuntu-ai:8000,ubuntu-ai:8010,ubuntu-ai:8011",
        help="Pool members list, comma separated",
    )
    parser.add_argument(
        "--status-weights",
        default="200:85,429:8,500:7",
        help="HTTP status distribution, e.g. '200:90,429:5,500:5'",
    )
    parser.add_argument("--prompt-range", default="20,1200", help="Prompt tokens range: min,max")
    parser.add_argument("--completion-range", default="20,2400", help="Completion tokens range: min,max")
    parser.add_argument("--rate", type=float, default=0.0, help="Target send rate req/s, 0 means no pacing")
    parser.add_argument(
        "--run-forever",
        action="store_true",
        help="Run continuously until Ctrl+C; ignores --count for total stop condition",
    )
    parser.add_argument("--report-interval", type=float, default=5.0, help="Progress report interval seconds")
    args = parser.parse_args()

    if args.concurrency <= 0:
        raise ValueError("--concurrency must be > 0")
    if args.count <= 0:
        raise ValueError("--count must be > 0")
    if not (0.0 <= args.duplicate_rate <= 1.0):
        raise ValueError("--duplicate-rate must be in [0, 1]")
    if args.rate < 0:
        raise ValueError("--rate must be >= 0")
    if args.report_interval <= 0:
        raise ValueError("--report-interval must be > 0")

    models, model_weights = parse_model_weights(args.models)
    members = parse_csv(args.members)
    status_codes, status_weights = parse_status_weights(args.status_weights)
    prompt_range = parse_int_range(args.prompt_range, "--prompt-range")
    completion_range = parse_int_range(args.completion_range, "--completion-range")
    if not members:
        raise ValueError("--members cannot be empty")

    random.seed(args.seed)
    lock = threading.Lock()
    results: dict[str, int] = {"ok": 0, "duplicate": 0, "http_error": 0, "transport_error": 0, "sent": 0}
    status_counter: dict[int, int] = defaultdict(int)
    model_counter: dict[str, int] = defaultdict(int)
    duplicates_source: list[str] = []
    duplicate_lock = threading.Lock()
    next_send_ts = time.monotonic()
    pace_lock = threading.Lock()

    def wait_for_slot() -> None:
        nonlocal next_send_ts
        if args.rate <= 0:
            return
        with pace_lock:
            now = time.monotonic()
            if now < next_send_ts:
                time.sleep(next_send_ts - now)
                now = time.monotonic()
            next_send_ts = now + (1.0 / args.rate)

    def run_one(i: int) -> None:
        wait_for_slot()
        duplicate_of = None
        with duplicate_lock:
            if duplicates_source and random.random() < args.duplicate_rate:
                duplicate_of = random.choice(duplicates_source)
        event = make_event(
            i,
            models=models,
            model_weights=model_weights,
            prompt_range=prompt_range,
            completion_range=completion_range,
            status_codes=status_codes,
            status_weights=status_weights,
            members=members,
            duplicate_of=duplicate_of,
        )
        with duplicate_lock:
            if duplicate_of is None and random.random() < args.duplicate_rate:
                duplicates_source.append(event["request_id"])

        status, body = post_event(args.url, event, args.timeout)
        with lock:
            results["sent"] += 1
            status_counter[status] += 1
            model_counter[event["response_model"]] += 1
            if status == 200:
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    payload = {}
                if payload.get("accepted") is False and payload.get("reason") == "duplicate_request_id":
                    results["duplicate"] += 1
                else:
                    results["ok"] += 1
            elif status == 0:
                results["transport_error"] += 1
            else:
                results["http_error"] += 1

    started = time.time()
    keep_running = True

    def reporter() -> None:
        while keep_running:
            time.sleep(args.report_interval)
            elapsed_sec = max(time.time() - started, 1e-9)
            with lock:
                sent = results["sent"]
                ok = results["ok"]
                dup = results["duplicate"]
                http_error = results["http_error"]
                transport_error = results["transport_error"]
            print(
                f"[progress] sent={sent} ok={ok} dup={dup} "
                f"http_error={http_error} transport_error={transport_error} "
                f"avg_rps={sent / elapsed_sec:.2f}"
            )

    report_thread = threading.Thread(target=reporter, daemon=True)
    report_thread.start()

    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            if args.run_forever:
                i = 0
                futures: set = set()
                while True:
                    while len(futures) < args.concurrency * 2:
                        futures.add(pool.submit(run_one, i))
                        i += 1
                    done = {f for f in futures if f.done()}
                    futures -= done
                    time.sleep(0.01)
            else:
                futures = [pool.submit(run_one, i) for i in range(args.count)]
                for _ in as_completed(futures):
                    pass
    except KeyboardInterrupt:
        print("\nInterrupted by user, stopping sender...")
    finally:
        keep_running = False
    elapsed = time.time() - started

    print("=== mock sender finished ===")
    print(f"url={args.url}")
    mode = "continuous" if args.run_forever else "batch"
    print(
        f"mode={mode} count={args.count} concurrency={args.concurrency} "
        f"rate={args.rate} elapsed={elapsed:.2f}s"
    )
    print(f"ok={results['ok']} duplicate={results['duplicate']}")
    print(f"http_error={results['http_error']} transport_error={results['transport_error']}")
    if elapsed > 0:
        print(f"throughput={results['sent'] / elapsed:.2f} req/s")
    print("status distribution:")
    for status, num in sorted(status_counter.items(), key=lambda item: item[0]):
        print(f"  {status}: {num}")
    print("model distribution:")
    for model, num in sorted(model_counter.items(), key=lambda item: item[1], reverse=True):
        print(f"  {model}: {num}")


if __name__ == "__main__":
    main()
