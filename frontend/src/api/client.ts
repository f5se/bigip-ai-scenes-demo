export type Target = { host: string; port: number };

function redirectToLogin(): void {
  const path = window.location.pathname + window.location.search;
  if (path.startsWith("/login")) return;
  const returnTo = encodeURIComponent(path || "/");
  window.location.href = `/login?return_to=${returnTo}`;
}

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: "include" });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("Unauthorized");
  }
  return res;
}

export type AuthUser = { username: string };

export async function fetchAuthMe(): Promise<AuthUser> {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) throw new Error("Failed to load user");
  return res.json();
}

export async function logout(): Promise<void> {
  try {
    const res = await authFetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      console.error("logout failed", res.status);
    }
  } catch {
    // still redirect to login
  }
  window.location.href = "/login";
}

export type ProxyResult = {
  status_code: number;
  headers: Record<string, string>;
  body: unknown;
  elapsed_ms: number;
  error: string | null;
  /** Body actually POSTed to the VS (when proxied by backend). */
  sent_payload?: Record<string, unknown>;
};

export type DemoCaseMeta = {
  case_id: string;
  model: string;
  label: string;
  label_key: string;
  expected_pool: string;
  expected_status: number;
};

export type DemoCaseResult = DemoCaseMeta & {
  proxy: ProxyResult;
};

export type DefaultsConfig = {
  default_vs: Target;
  model_pool_map: Record<string, string>;
  model_options: string[];
  demo_cases: DemoCaseMeta[];
  demo_interval_ms: number;
};

export type ObservabilityConfig = {
  grafana_url: string;
  grafana_auto_login?: boolean;
};

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await authFetch("/api/health");
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

export async function fetchDefaults(): Promise<DefaultsConfig> {
  const res = await authFetch("/api/config/defaults");
  if (!res.ok) throw new Error("Failed to load defaults");
  return res.json();
}

export async function fetchObservabilityConfig(): Promise<ObservabilityConfig> {
  const res = await authFetch("/api/config/observability");
  if (!res.ok) throw new Error("Failed to load observability config");
  return res.json();
}

export async function proxyChat(
  target: Target,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<ProxyResult> {
  const res = await authFetch("/api/proxy/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      payload,
      extra_headers: extraHeaders ?? undefined,
    }),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail || "forbidden_host"
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Request failed");
  }
  return res.json();
}

export type ContextSizeRule = {
  model: string;
  dg_value: string;
  threshold_k: number;
  threshold_bytes: number;
  small_pool: string;
  small_model: string;
  large_pool: string;
  large_model: string;
};

export type ContextRouteInfo = {
  tier: "small" | "large";
  expected_pool: string;
  expected_model: string;
  over_threshold: boolean;
};

export type ContextSizeConfig = {
  default_vs: Target;
  rule: ContextSizeRule;
  presets: Array<{ label: string; bytes: number }>;
  multiturn_preview: {
    under_bytes: number;
    over_bytes: number;
    under_turns: number;
    over_turns: number;
    dialogue_rounds?: number;
  };
  timeline?: TimelineStep[];
};

export type TimelineStep = {
  step: number;
  role: string;
  preview: string;
  cumulative_bytes: number;
  message_count: number;
};

export type ContextProxyBundle = {
  model: string;
  messages_bytes: number;
  message_count?: number;
  content_chars?: number;
  target_messages_bytes?: number;
  route: ContextRouteInfo;
  proxy: ProxyResult;
  label_key?: string;
  turns?: number;
  dialogue_rounds?: number;
  trigger?: string;
  conversation_preview?: Array<{ role: string; preview: string }>;
  timeline?: TimelineStep[];
};

export async function fetchContextRoutingConfig(): Promise<ContextSizeConfig> {
  const res = await authFetch("/api/config/context-routing");
  if (!res.ok) throw new Error("Failed to load context routing config");
  return res.json();
}

export async function calcContextRouting(
  targetMessagesBytes: number
): Promise<{
  messages: Array<{ role: string; content: string }>;
  messages_bytes: number;
  route: ContextRouteInfo;
}> {
  const res = await authFetch("/api/demo/context-routing/calc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_messages_bytes: targetMessagesBytes }),
  });
  if (!res.ok) throw new Error("Calc failed");
  return res.json();
}

export async function runContextSingleDemo(
  target: Target,
  targetMessagesBytes: number
): Promise<ContextProxyBundle & { kind: string }> {
  const res = await authFetch("/api/demo/context-routing/single", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, target_messages_bytes: targetMessagesBytes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Demo failed");
  }
  return res.json();
}

export async function runContextMultiturnDemo(target: Target): Promise<{
  kind: string;
  threshold_bytes: number;
  timeline?: TimelineStep[];
  scenario_title_key?: string;
  under: ContextProxyBundle;
  over: ContextProxyBundle;
}> {
  const res = await authFetch("/api/demo/context-routing/multiturn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Multiturn demo failed");
  }
  return res.json();
}

export type ObsTrafficScene = "obsTokens" | "obsMetrics";

/** non_stream: all requests; stream: all requests; mixed: ~half models per run */
export type ObsTrafficStreamMode = "non_stream" | "stream" | "mixed";

export type ObsTrafficStatus = {
  running: boolean;
  started_from: ObsTrafficScene | null;
  target: Target;
  duration_minutes: number;
  concurrency: number;
  stream_mode: ObsTrafficStreamMode;
  stream_models: string[];
  stream_model_count: number;
  started_at: string | null;
  ends_at: string | null;
  elapsed_seconds: number;
  remaining_seconds: number;
  models: string[];
  stats: {
    sent: number;
    success: number;
    non_200: number;
    timeout: number;
    connection_failed: number;
    other_errors: number;
    error_total: number;
    last_error: string | null;
    last_status_code: number | null;
    last_model: string | null;
    recent_errors: Array<{
      model: string;
      status_code: number;
      error: string;
      at: string;
    }>;
  };
};

export async function fetchObsTrafficStatus(): Promise<ObsTrafficStatus> {
  const res = await authFetch("/api/demo/observability/traffic/status");
  if (!res.ok) throw new Error("Failed to load traffic sim status");
  return res.json();
}

export async function startObsTrafficSim(
  target: Target,
  durationMinutes: number,
  concurrency: number,
  startedFrom: ObsTrafficScene,
  streamMode: ObsTrafficStreamMode = "mixed"
): Promise<ObsTrafficStatus> {
  const res = await authFetch("/api/demo/observability/traffic/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      duration_minutes: durationMinutes,
      concurrency,
      started_from: startedFrom,
      stream_mode: streamMode,
    }),
  });
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: { started_from?: string; message?: string } }).detail;
    const e = new Error(detail?.message || "traffic_sim_already_running");
    (e as Error & { startedFrom?: string }).startedFrom = detail?.started_from;
    throw e;
  }
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to start traffic sim");
  }
  return res.json();
}

export async function stopObsTrafficSim(): Promise<ObsTrafficStatus> {
  const res = await authFetch("/api/demo/observability/traffic/stop", { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop traffic sim");
  return res.json();
}

export type AgentIdentityMode = "header" | "system_name" | "model_field";
export type AgentIdentityModeSelector = AgentIdentityMode | "random";

export type AgentMeta = {
  id: string;
  label_key: string;
  expected_pool: string;
  expected_model?: string;
  model_rewrite_expected?: boolean;
};

export type AgentRoutingConfig = {
  enterprise_model: string;
  identity_header: string;
  default_vs: Target;
  default_user_prompt: string;
  demo_interval_ms: number;
  agents: AgentMeta[];
};

export type AgentDemoResult = {
  agent_id: string;
  label_key: string;
  label: string;
  identity_mode: AgentIdentityMode;
  request_model: string;
  expected_pool: string;
  expected_model?: string;
  model_rewrite_expected?: boolean;
  expected_status: number;
  proxy: ProxyResult;
  payload_preview?: {
    model?: string;
    header?: string;
    system_name?: string;
  };
};

export async function fetchAgentRoutingConfig(): Promise<AgentRoutingConfig> {
  const res = await authFetch("/api/config/agent-routing");
  if (!res.ok) throw new Error("Failed to load agent routing config");
  return res.json();
}

export async function runAgentRoutingDemo(
  target: Target,
  identityMode: AgentIdentityModeSelector,
  userPrompt: string,
  agents?: string[],
  intervalMs?: number,
  agentIdentityModes?: Record<string, AgentIdentityMode>
): Promise<{
  results: AgentDemoResult[];
  identity_mode: AgentIdentityModeSelector;
  agent_identity_modes: Record<string, AgentIdentityMode>;
}> {
  const res = await authFetch("/api/demo/agent-routing/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      identity_mode: identityMode,
      user_prompt: userPrompt,
      agents: agents ?? undefined,
      interval_ms: intervalMs ?? 0,
      agent_identity_modes: agentIdentityModes ?? undefined,
    }),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: string | { message?: string } }).detail;
    const msg =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && "message" in detail
          ? String(detail.message)
          : "Agent routing demo failed";
    throw new Error(msg);
  }
  return res.json();
}

export type AgentTrafficStatus = {
  running: boolean;
  target: Target;
  duration_minutes: number;
  user_prompt: string;
  identity_mode: AgentIdentityModeSelector;
  agent_identity_modes: Record<string, AgentIdentityMode>;
  started_at: string | null;
  ends_at: string | null;
  elapsed_seconds: number;
  remaining_seconds: number;
  stats: {
    sent: number;
    success: number;
    non_200: number;
    timeout: number;
    connection_failed: number;
    other_errors: number;
    error_total: number;
    last_error: string | null;
    last_status_code: number | null;
    last_agent_id: string | null;
    last_identity_mode: string | null;
    recent_errors: Array<{
      agent_id: string;
      identity_mode: string;
      status_code: number;
      error: string;
      at: string;
    }>;
  };
};

export async function fetchAgentTrafficStatus(): Promise<AgentTrafficStatus> {
  const res = await authFetch("/api/demo/agent-routing/traffic/status");
  if (!res.ok) throw new Error("Failed to load agent traffic sim status");
  return res.json();
}

export async function startAgentTrafficSim(
  target: Target,
  identityMode: AgentIdentityModeSelector,
  userPrompt: string,
  durationMinutes: number
): Promise<AgentTrafficStatus> {
  const res = await authFetch("/api/demo/agent-routing/traffic/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      identity_mode: identityMode,
      user_prompt: userPrompt,
      duration_minutes: durationMinutes,
    }),
  });
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: { message?: string } }).detail;
    throw new Error(detail?.message || "agent_traffic_sim_already_running");
  }
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to start agent traffic sim");
  }
  return res.json();
}

export async function stopAgentTrafficSim(): Promise<AgentTrafficStatus> {
  const res = await authFetch("/api/demo/agent-routing/traffic/stop", { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop agent traffic sim");
  return res.json();
}

export async function runModelRoutingDemo(
  target: Target,
  cases: string[] | "all" = "all",
  intervalMs?: number
): Promise<{ results: DemoCaseResult[] }> {
  const res = await authFetch("/api/demo/model-routing/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, cases, interval_ms: intervalMs }),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail || "forbidden_host"
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Demo failed");
  }
  return res.json();
}

export type TblbPoolGroup = {
  pool: string;
  pool_short: string;
  tblb_enabled: boolean;
  models: string[];
};

export type TblbConfig = {
  default_vs: Target;
  default_scheduler: Target;
  scheduler_partition: string;
  tblb_demo_interval_ms: number;
  tblb_trigger_path: string;
  tblb_trigger_wait_sec: number;
  default_iterations: number;
  pools: TblbPoolGroup[];
};

export type TblbTriggerMemberResult = {
  ip: string;
  port: number;
  url: string;
  ok: boolean;
  status_code?: number;
  error?: string;
};

export type SchedulerMember = {
  ip: string;
  port: number;
  score: number;
  percent: number;
  metrics?: {
    waiting_queue?: number;
    cache_usage?: number;
    running_req?: number;
  };
  detected_variant?: string;
};

export type SchedulerPoolStatus = {
  name: string;
  partition: string;
  engine_type: string;
  member_count: number;
  members: SchedulerMember[];
};

export type TblbPortStat = {
  port: string;
  count: number;
  percent: number;
};

export type TblbModelResult = {
  model: string;
  expected_pool: string;
  pool_short: string;
  tblb_enabled: boolean;
  total: number;
  completed: number;
  success: number;
  errors: number;
  port_distribution: TblbPortStat[];
  /** Set from first successful 200 response via detectModelRewrite */
  model_rewritten?: boolean;
  response_model?: string | null;
};

export async function fetchTblbConfig(): Promise<TblbConfig> {
  const res = await authFetch("/api/config/tblb");
  if (!res.ok) throw new Error("Failed to load TBLB config");
  return res.json();
}

export function buildSchedulerDirectUrl(
  poolName: string,
  scheduler: Target,
  partition = "Common"
): string {
  return `http://${scheduler.host}:${scheduler.port}/pools/${poolName}/${partition}/status`;
}

export function buildSchedulerProxyUrl(
  poolName: string,
  scheduler: Target,
  partition = "Common"
): string {
  const params = new URLSearchParams({
    pool_name: poolName,
    host: scheduler.host,
    port: String(scheduler.port),
    partition,
  });
  return `/api/demo/tblb/scheduler/pool-status?${params}`;
}

export function buildMemberTriggerUrl(ip: string, port: number, path = "/trigger_update"): string {
  return `http://${ip}:${port}${path}`;
}

export async function triggerMemberLoad(
  members: Array<{ ip: string; port: number }>,
  path?: string
): Promise<{ results: TblbTriggerMemberResult[]; wait_seconds: number; path: string }> {
  const res = await authFetch("/api/demo/tblb/trigger-member-load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members, path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "trigger_member_load_failed");
  }
  return res.json();
}

export async function fetchSchedulerPoolStatus(
  poolName: string,
  scheduler: Target,
  partition = "Common"
): Promise<SchedulerPoolStatus> {
  const res = await authFetch(buildSchedulerProxyUrl(poolName, scheduler, partition));
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "scheduler_fetch_failed");
  }
  return res.json();
}

export function extractServerPort(body: unknown): number | null {
  function walk(obj: unknown): number | null {
    if (!obj || typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = walk(item);
        if (found !== null) return found;
      }
      return null;
    }
    const rec = obj as Record<string, unknown>;
    if ("server_port" in rec) {
      const value = rec.server_port;
      if (typeof value === "number") return value;
      if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
    }
    for (const v of Object.values(rec)) {
      const found = walk(v);
      if (found !== null) return found;
    }
    return null;
  }
  return walk(body);
}

export function buildPortDistribution(
  counts: Map<string, number>,
  total: number
): TblbPortStat[] {
  if (total <= 0) return [];
  return [...counts.entries()]
    .sort(([a], [b]) => {
      if (a === "error") return 1;
      if (b === "error") return -1;
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return parseInt(a, 10) - parseInt(b, 10);
    })
    .map(([port, count]) => ({
      port,
      count,
      percent: Math.round((count / total) * 1000) / 10,
    }));
}

export type PoolMemberGuardStatus = {
  pool: string;
  pool_short: string;
  member: string;
  disabled: boolean;
  found: boolean;
  state?: string | null;
  session?: string | null;
};

export async function checkPoolMemberGuard(): Promise<PoolMemberGuardStatus> {
  const res = await authFetch("/api/demo/pool-member/guard/status");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "pool_member_guard_status_failed");
  }
  return res.json();
}

export async function enablePoolMemberGuard(): Promise<{
  pool: string;
  pool_short: string;
  member: string;
  enabled: boolean;
  state?: string;
  session?: string;
}> {
  const res = await authFetch("/api/demo/pool-member/guard/enable", { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "pool_member_guard_enable_failed");
  }
  return res.json();
}

export type RetryFallbackConfig = {
  default_vs: Target;
  rule: {
    retry_model: string;
    retry_primary_pool: string;
    retry_fallback_pool: string;
    tcp_demo_models: string[];
    tcp_pool: string;
    tcp_bad_member: { node: string; port: number };
    tcp_good_member: { node: string; port: number };
    default_member: { node: string; port: number };
  };
  f5_mgmt: {
    host: string;
    partition: string;
    verify_tls: boolean;
  };
};

export type RetryFallbackMember = {
  name?: string;
  address?: string;
  state?: string;
  session?: string;
  fullPath?: string;
};

export type RetryStatusResult = {
  kind: "status-retry";
  retry_model: string;
  primary_pool: string;
  fallback_pool: string;
  member: string;
  member_stats: {
    before: {
      total_requests: number | null;
      request_keys: string[];
    };
    after: {
      total_requests: number | null;
      primary_key?: string | null;
      request_keys: string[];
      request_counters?: Record<string, number>;
    };
    compared_key?: string | null;
    delta_requests: number | null;
  };
  proxy: ProxyResult;
  result: {
    fallback_to_default: boolean;
    terminal_retry: boolean;
    all_members_unavailable: boolean;
    retry_observed: boolean;
    as_expected: boolean;
  };
};

export type RetryStatusCounter = {
  member: string;
  stats: {
    total_requests: number | null;
    primary_key?: string | null;
    request_keys: string[];
    request_counters?: Record<string, number>;
  };
};

export type RetryFallbackDebugStep = {
  at_ms: number;
  step: string;
  detail: string;
  [key: string]: unknown;
};

export type ProxyBodyDebug = {
  status_code?: number;
  elapsed_ms?: number;
  error?: string | null;
  server_port_extracted?: number | null;
  server_port_paths?: string[];
  body_has_server_port_key?: boolean;
  body_top_keys?: string[];
  body_model?: unknown;
  body_preview?: string;
};

export type TcpReselectPrepareResult = {
  kind: "tcp-reselect-prepare";
  member: string;
  member_recovered: boolean;
  stability_wait_seconds: number;
  member_before: RetryFallbackMember | null;
  member_after: RetryFallbackMember | null;
};

export type TcpReselectResult = {
  kind: "tcp-reselect";
  pool: string;
  fallback_pool: string;
  before: {
    tcp_pool_members: RetryFallbackMember[];
    default_pool_members: RetryFallbackMember[];
  };
  attempts: Array<{
    attempt?: number;
    status_code: number;
    error: string | null;
    server_port: number | null;
    message: string;
    routed_to_default_pool?: boolean;
  } & ProxyBodyDebug>;
  result: {
    expected_server_port: number;
    all_requests_on_expected_port: boolean;
    missing_port_attempts?: number[];
    observed_ports?: Array<number | null>;
  };
};

export type TcpForceFallbackResult = {
  kind: "tcp-force-fallback";
  pool: string;
  forced_offline_member: string;
  after: {
    tcp_pool_members: RetryFallbackMember[];
    default_pool_members: RetryFallbackMember[];
  };
  proxy: ProxyResult;
  debug?: {
    steps: RetryFallbackDebugStep[];
    body_analysis: ProxyBodyDebug;
    hint?: string;
  };
  result: {
    fallback_to_default: boolean;
    terminal_retry: boolean;
    all_members_unavailable: boolean;
    as_expected: boolean;
  };
};

export async function fetchRetryFallbackConfig(): Promise<RetryFallbackConfig> {
  const res = await authFetch("/api/config/retry-fallback");
  if (!res.ok) throw new Error("Failed to load retry/fallback config");
  return res.json();
}

async function postRetryDemo<T>(path: string, target: Target): Promise<T> {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Retry/Fallback demo failed");
  }
  return res.json() as Promise<T>;
}

export async function runRetryStatusDemo(target: Target): Promise<RetryStatusResult> {
  return postRetryDemo<RetryStatusResult>("/api/demo/retry-fallback/status-retry", target);
}

export async function fetchRetryStatusCounter(): Promise<RetryStatusCounter> {
  const res = await authFetch("/api/demo/retry-fallback/status-counter");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to load retry counter");
  }
  return res.json();
}

export async function prepareTcpReselectDemo(): Promise<TcpReselectPrepareResult> {
  const res = await authFetch("/api/demo/retry-fallback/tcp-reselect/prepare", {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Prepare failed");
  }
  return res.json();
}

export async function runTcpReselectDemo(target: Target): Promise<TcpReselectResult> {
  return postRetryDemo<TcpReselectResult>("/api/demo/retry-fallback/tcp-reselect", target);
}

export async function runTcpForceFallbackDemo(target: Target): Promise<TcpForceFallbackResult> {
  return postRetryDemo<TcpForceFallbackResult>(
    "/api/demo/retry-fallback/tcp-force-fallback",
    target
  );
}

/** Extract backend model id from chat completion JSON (or mock service message). */
export function extractResponseModel(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.model === "string" && b.model.trim()) {
    return b.model.trim();
  }
  const choices = b.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const zh = content.match(/正在运行的推理模型:\s*(\S+)/);
    if (zh?.[1]) return zh[1];
    const en = content.match(/running inference model:\s*(\S+)/i);
    if (en?.[1]) return en[1];
  }
  return null;
}

export function detectModelRewrite(
  requestModel: string,
  body: unknown,
  statusCode: number
): { rewritten: boolean; responseModel: string | null } {
  if (statusCode !== 200 || !body) {
    return { rewritten: false, responseModel: null };
  }
  const responseModel = extractResponseModel(body);
  if (!responseModel) {
    return { rewritten: false, responseModel: null };
  }
  return {
    rewritten: responseModel !== requestModel,
    responseModel,
  };
}

export function extractAssistantContent(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as Record<string, unknown>).choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  return choices?.[0]?.message?.content ?? "";
}

/** Proxy SSE consumer summary (chunk_count / done_seen), not upstream JSON with stream:true. */
export function isProxySseSummary(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return "chunk_count" in b || "done_seen" in b;
}

export function summarizeResponse(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const content = extractAssistantContent(body);
  if (content) return content;
  if (isProxySseSummary(body)) {
    const chunks = Number(b.chunk_count ?? 0);
    const done = b.done_seen ? " [DONE]" : "";
    const err = b.read_error ? ` (${String(b.read_error)})` : "";
    return `SSE stream: ${chunks} chunk(s)${done}${err}`;
  }
  if (b.error && typeof b.error === "object") {
    const err = b.error as Record<string, unknown>;
    return String(err.message ?? JSON.stringify(err));
  }
  return JSON.stringify(body).slice(0, 200);
}

/** True when Gateway returned F5 AI Guardrail block JSON (HTTP 200, no upstream forward). */
export function isGuardrailBlocked(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const content = extractAssistantContent(body);
  if (content) {
    return (
      /F5 AI Guardrail/i.test(content) ||
      /Request Rejected/i.test(content) ||
      /violated.*security policy/i.test(content) ||
      /request blocked by F5 AI Guardrails/i.test(content) ||
      /护栏.*拒绝|内容.*拒绝|违规/i.test(content)
    );
  }
  const id = String(b.id ?? "");
  if (/chatcmpl-error/i.test(id)) return true;
  return false;
}

export function isStreamResponse(body: unknown): boolean {
  return isProxySseSummary(body);
}

export function formatProxyError(error: string | null, t: (k: string) => string): string {
  if (!error) return "";
  if (error.startsWith("connection_failed")) return t("demo.connectionFailed");
  if (error.startsWith("timeout")) return t("demo.timeout");
  return error;
}

export type SystemPromptPreset = {
  id: string;
  label_key: string;
  description_key: string;
  system_content: string;
  user_content: string;
  expects_yaml: boolean;
  expects_injection_contained: boolean;
};

export type SystemPromptConfig = {
  default_vs: Target;
  demo_model: string;
  nonce: string;
  mock_llm_port: number;
  presets: SystemPromptPreset[];
  tags: {
    outer: string;
    admin: string;
    user: string;
    guardrails: string;
  };
};

export type SystemPromptPreview = {
  nonce: string;
  client_payload: Record<string, unknown>;
  forwarded_payload: Record<string, unknown>;
  original_system: string;
  wrapped_system: string;
  tags: SystemPromptConfig["tags"];
};

export type SystemPromptAnalysis = {
  yaml_like: boolean;
  markdown_like: boolean;
  injection_contained: boolean;
  policy_applied: boolean;
};

export async function fetchSystemPromptConfig(): Promise<SystemPromptConfig> {
  const res = await authFetch("/api/demo/system-prompt/config");
  if (!res.ok) throw new Error("Failed to load system prompt config");
  return res.json();
}

export async function previewSystemPromptWrap(
  system_content: string,
  user_content: string,
  model?: string
): Promise<SystemPromptPreview> {
  const res = await authFetch("/api/demo/system-prompt/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_content, user_content, model }),
  });
  if (!res.ok) throw new Error("Preview failed");
  return res.json();
}

export function looksLikeYaml(text: string): boolean {
  const stripped = text.trim();
  if (!stripped) return false;
  if (stripped.startsWith("---")) return true;
  return /^[\w.-]+:\s/m.test(stripped);
}

export function analyzeSystemPromptResponse(content: string): SystemPromptAnalysis {
  const lower = content.toLowerCase();
  return {
    yaml_like: looksLikeYaml(content),
    markdown_like: /^#{1,6}\s|^\*\s|^-\s|```/m.test(content),
    injection_contained: lower.includes("injection_contained: true"),
    policy_applied: lower.includes("policy_applied: true"),
  };
}

export type ModelAllowlistRecord = {
  model: string;
  action: "allow" | "block";
};

export type ModelAllowlistConfig = {
  default_vs: Target;
  datagroup: string;
  default_action: "allow" | "block";
  records: ModelAllowlistRecord[];
  allowed_model: string;
  allowed_models?: string[];
  irule_layer: string;
  vs_note: string;
};

export type ModelAllowlistPolicy = {
  model: string;
  action: "allow" | "block";
  source: "datagroup" | "default";
  datagroup: string;
};

export async function fetchModelAllowlistConfig(): Promise<ModelAllowlistConfig> {
  const res = await authFetch("/api/demo/model-allowlist/config");
  if (!res.ok) throw new Error("Failed to load model allowlist config");
  return res.json();
}

export async function fetchModelAllowlistPolicy(model: string): Promise<ModelAllowlistPolicy> {
  const res = await authFetch(
    `/api/demo/model-allowlist/policy?model=${encodeURIComponent(model)}`
  );
  if (!res.ok) throw new Error("Failed to resolve model policy");
  return res.json();
}

/** True when iRule Layer 0 model policy blocked the request (403 or policy JSON). */
export function isModelPolicyBlocked(body: unknown, statusCode: number): boolean {
  if (statusCode === 403) return true;
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const id = String(b.id ?? "");
  if (/chatcmpl-blocked/i.test(id)) return true;
  const content = extractAssistantContent(body);
  if (content) {
    return (
      /Request blocked by security policy/i.test(content) ||
      /is not permitted/i.test(content) ||
      /模型.*不允许|策略.*拒绝|未授权.*模型/i.test(content)
    );
  }
  const err = b.error;
  if (err && typeof err === "object") {
    const msg = String((err as Record<string, unknown>).message ?? "");
    if (/not permitted|blocked by security/i.test(msg)) return true;
  }
  return false;
}

export function resolveModelPolicyLocal(
  model: string,
  config: ModelAllowlistConfig
): ModelAllowlistPolicy {
  const hit = config.records.find((r) => r.model === model);
  if (hit) {
    return {
      model,
      action: hit.action,
      source: "datagroup",
      datagroup: config.datagroup,
    };
  }
  return {
    model,
    action: config.default_action,
    source: "default",
    datagroup: config.datagroup,
  };
}

export type MaxTokensPreset = {
  id: string;
  max_tokens: number;
  expected: "allow" | "block";
};

export type MaxTokensConfig = {
  default_vs: Target;
  demo_model: string;
  max_tokens_limit: number;
  irule_layer: string;
  vs_note: string;
  presets: MaxTokensPreset[];
};

export type MaxTokensPolicy = {
  max_tokens: number;
  max_tokens_limit: number;
  action: "allow" | "block";
  reason: "within_limit" | "exceeds_limit";
};

export async function fetchMaxTokensConfig(): Promise<MaxTokensConfig> {
  const res = await authFetch("/api/demo/max-tokens/config");
  if (!res.ok) throw new Error("Failed to load max tokens config");
  return res.json();
}

export async function fetchMaxTokensPolicy(max_tokens: number): Promise<MaxTokensPolicy> {
  const res = await authFetch(
    `/api/demo/max-tokens/policy?max_tokens=${encodeURIComponent(String(max_tokens))}`
  );
  if (!res.ok) throw new Error("Failed to resolve max tokens policy");
  return res.json();
}

/** True when iRule Layer 0 max_tokens policy blocked the request (403 or policy JSON). */
export function isMaxTokensBlocked(body: unknown, statusCode: number): boolean {
  if (statusCode === 403) return true;
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const id = String(b.id ?? "");
  if (/chatcmpl-blocked/i.test(id)) return true;
  const content = extractAssistantContent(body);
  if (content) {
    return (
      /max_tokens/i.test(content) ||
      /exceeds.*limit/i.test(content) ||
      /Request blocked by security policy/i.test(content) ||
      /token.*limit|超出.*上限|超过.*限制/i.test(content)
    );
  }
  const err = b.error;
  if (err && typeof err === "object") {
    const msg = String((err as Record<string, unknown>).message ?? "");
    if (/max_tokens|exceeds.*limit|token.*limit/i.test(msg)) return true;
  }
  return false;
}

export function resolveMaxTokensPolicyLocal(
  max_tokens: number,
  limit: number
): MaxTokensPolicy {
  if (max_tokens > limit) {
    return {
      max_tokens,
      max_tokens_limit: limit,
      action: "block",
      reason: "exceeds_limit",
    };
  }
  return {
    max_tokens,
    max_tokens_limit: limit,
    action: "allow",
    reason: "within_limit",
  };
}

export type MaxTokensRunResult = ProxyResult & {
  policy?: MaxTokensPolicy;
};

/** Server builds payload with explicit max_tokens before proxying to F5 VS. */
export async function runMaxTokensTest(
  target: Target,
  max_tokens: number,
  user_content?: string
): Promise<MaxTokensRunResult> {
  const res = await authFetch("/api/demo/max-tokens/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      max_tokens: Math.trunc(max_tokens),
      user_content: user_content || undefined,
    }),
  });
  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "forbidden_host");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Request failed");
  }
  return res.json();
}
