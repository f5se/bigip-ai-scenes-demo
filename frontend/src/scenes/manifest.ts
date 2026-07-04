export type SubFeature = {
  id: string;
  path: string;
  titleKey: string;
  ready: boolean;
  /** Show TMOS v21 minimum version badge after sub-scene title */
  versionBadge?: boolean;
  /** i18n prefix under scenes.* for placeholder pages */
  pageKey?: string;
};

export type Scene = {
  id: string;
  path: string;
  titleKey: string;
  descKey: string;
  /** Prefix for scenes.{i18nKey}.* in i18n files */
  i18nKey: string;
  overviewDiagramKey?: string;
  subFeatures?: SubFeature[];
};

export const scenes: Scene[] = [
  {
    id: "llm-router",
    path: "/scene/llm-router",
    titleKey: "nav.scene1",
    descKey: "home.scene1Desc",
    i18nKey: "llmRouter",
    overviewDiagramKey: "llmRouterOverview",
    subFeatures: [
      {
        id: "model-routing",
        path: "/scene/llm-router/model-routing",
        titleKey: "nav.modelRouting",
        ready: true,
      },
      {
        id: "context-routing",
        path: "/scene/llm-router/context-routing",
        titleKey: "nav.contextRouting",
        ready: true,
      },
      {
        id: "agent-routing",
        path: "/scene/llm-router/agent-routing",
        titleKey: "nav.agentRouting",
        ready: true,
      },
      {
        id: "retry-fallback",
        path: "/scene/llm-router/retry-fallback",
        titleKey: "nav.retryFallback",
        ready: true,
      },
    ],
  },
  {
    id: "observability",
    path: "/scene/observability",
    titleKey: "nav.scene2",
    descKey: "home.scene2Desc",
    i18nKey: "observability",
    overviewDiagramKey: "observability",
    subFeatures: [
      {
        id: "tokens",
        path: "/scene/observability/tokens",
        titleKey: "nav.obsTokens",
        ready: true,
        pageKey: "obsTokens",
      },
      {
        id: "metrics",
        path: "/scene/observability/metrics",
        titleKey: "nav.obsMetrics",
        ready: true,
        pageKey: "obsMetrics",
      },
    ],
  },
  {
    id: "traffic-mgmt",
    path: "/scene/traffic-mgmt",
    titleKey: "nav.scene3",
    descKey: "home.scene3Desc",
    i18nKey: "trafficMgmt",
    overviewDiagramKey: "trafficMgmt",
    subFeatures: [
      {
        id: "tblb",
        path: "/scene/traffic-mgmt/tblb",
        titleKey: "nav.tblb",
        ready: true,
        pageKey: "tblb",
      },
      {
        id: "model-allowlist",
        path: "/scene/traffic-mgmt/model-allowlist",
        titleKey: "nav.modelAllowlist",
        ready: true,
        versionBadge: true,
        pageKey: "modelAllowlist",
      },
      {
        id: "max-tokens-limit",
        path: "/scene/traffic-mgmt/max-tokens-limit",
        titleKey: "nav.maxTokensLimit",
        ready: true,
        versionBadge: true,
        pageKey: "maxTokensLimit",
      },
      {
        id: "mcp-tools-insight",
        path: "/scene/traffic-mgmt/mcp-tools-insight",
        titleKey: "nav.mcpToolsInsight",
        ready: true,
        versionBadge: true,
        pageKey: "mcpToolsInsight",
      },
      {
        id: "mcp-tools-control",
        path: "/scene/traffic-mgmt/mcp-tools-control",
        titleKey: "nav.mcpToolsControl",
        ready: false,
        pageKey: "mcpToolsControl",
      },
    ],
  },
  {
    id: "security",
    path: "/scene/security",
    titleKey: "nav.scene4",
    descKey: "home.scene4Desc",
    i18nKey: "security",
    overviewDiagramKey: "security",
    subFeatures: [
      {
        id: "system-prompt",
        path: "/scene/security/system-prompt",
        titleKey: "nav.systemPrompt",
        ready: true,
        versionBadge: true,
        pageKey: "systemPrompt",
      },
      {
        id: "guardrails",
        path: "/scene/security/guardrails",
        titleKey: "nav.guardrails",
        ready: true,
        versionBadge: true,
        pageKey: "guardrails",
      },
    ],
  },
];

export const MERMAID_DIAGRAMS: Record<string, string> = {
  modelRouting: `flowchart TB
  Client[Client] -->|POST JSON| VS[Virtual Server]
  VS --> Plugin[iRuleLX Plugin]
  Plugin -->|extract model| DG[Data Group llm_model_pool_map]
  DG -->|pool path| LB[flow.lbSelect]
  LB --> P1[pool_gpt-4o]
  LB --> P2[pool_deepseek-chat]
  LB --> P3[pool_llm_default]
  P1 --> BE1[Inference backend]
  P2 --> BE2[Inference backend]
  P3 --> BE3[Default backend]`,
  modelRoutingBiz: `flowchart LR
  Client[业务应用] --> Gateway[F5 统一入口]
  Gateway --> Decision[按请求中的 model 名称路由]
  Decision --> M1[deepseek-chat 资源池]
  Decision --> M2[gpt-4o 资源池]
  Decision --> M3[gemini-2.5-flash 资源池]
  Decision --> Default[default model 兜底资源池]`,
  modelRoutingBizEn: `flowchart LR
  Client[Business Applications] --> Gateway[F5 Unified Entry]
  Gateway --> Decision[Route by request model name]
  Decision --> M1[deepseek-chat pool]
  Decision --> M2[gpt-4o pool]
  Decision --> M3[gemini-2.5-flash pool]
  Decision --> Default[default model fallback pool]`,

  contextRouting: `flowchart TB
  Client[Client deepseek-chat] --> VS[Virtual Server]
  VS --> Plugin[iRuleLX]
  Plugin --> Calc[calcContextSize messages JSON bytes]
  Calc -->|bytes <= 5k| Small[pool_deepseek-chat]
  Calc -->|bytes > 5k| Large[pool_deepseek_v4]
  Small --> M1[deepseek-chat backend]
  Large --> M2[deepseek-v4-flash backend]`,
  contextRoutingBiz: `flowchart LR
  User[用户连续对话] --> Gateway[F5 统一入口]
  Gateway --> Judge[判断上下文大小]
  Judge -->|短对话| Small[低成本快速模型]
  Judge -->|长对话| Large[大上下文模型]`,
  contextRoutingBizEn: `flowchart LR
  User[Ongoing user conversation] --> Gateway[F5 Unified Entry]
  Gateway --> Judge[Evaluate context size]
  Judge -->|Short context| Small[Fast low-cost model]
  Judge -->|Long context| Large[Large-context model]`,

  agentRouting: `flowchart TB
  subgraph agents [Multi-Agent System]
    S[superviser]
    P[planner]
    C[coder]
    T[tester]
    SC[scanner]
  end
  agents -->|identity in header / system.name / model| VS[Virtual Server]
  VS --> DG[Data Group llm_agent_pool_map]
  DG --> P1[pool_gpt-4o]
  DG --> P2[pool_deepseek-chat]
  DG --> P3[pool_claude-3-opus]
  DG --> P4[pool_gemini-1.5-pro]
  DG --> P5[pool_llama]`,
  agentRoutingBiz: `flowchart LR
  User[业务需求] --> Agents[多 Agent 协同<br/>调度/规划/编码/测试/安扫]
  Agents -->|统一 OpenAI 兼容 API| Gateway[F5 统一入口]
  Gateway -->|按 Agent 身份| P1[强推理池]
  Gateway --> P2[长上下文池]
  Gateway --> P3[代码模型池]
  Gateway --> P4[专项小模型池]`,
  agentRoutingBizEn: `flowchart LR
  User[Business need] --> Agents[Multi-agent workflow<br/>supervise/plan/code/test/scan]
  Agents -->|One OpenAI-compatible API| Gateway[F5 unified entry]
  Gateway -->|By agent identity| P1[Flagship pool]
  Gateway --> P2[Long-context pool]
  Gateway --> P3[Code pool]
  Gateway --> P4[Specialized pool]`,

  retryFallback: `flowchart TB
  Client[Client POST] --> VS[Entry VS · ILX Plugin]
  VS --> DG["DG: primary + fallback pool"]
  DG --> Mode{RETRY enabled?}

  Mode -->|no| Fast[FastPath · lbSelect + TMM passthrough]
  Mode -->|yes · non-stream| Orch[Orchestrator · request.respond]

  Orch --> Loop["Attempt queue<br/>primary 1+MAX_RETRIES, then fallback<br/>next try only on 5xx/429"]

  Loop --> Sideband["ILXHttpRequest sideband<br/>every attempt incl. first try"]
  Sideband --> Layered[Layered_VS_For_Retry · iRule]

  Layered --> Pool[pool from X-LLM-Target-Pool]
  Pool -->|LB_FAILED / TCP| Reselect[LB::reselect same pool]
  Reselect -->|members exhausted| IRuleFB[iRule → fallback pool]
  IRuleFB -->|both pools dead| Terminal["503 · X-LLM-Retry-Terminal"]

  Pool --> Members[Pool members]
  IRuleFB --> Members
  Layered -->|HTTP status| Loop
  Loop -->|2xx or final| Resp[Plugin assembles response to client]`,
  retryFallbackBiz: `flowchart LR
  App[业务请求] --> Primary[主模型池]
  Primary --> Check{是否成功}
  Check -->|成功| Return[正常返回]
  Check -->|失败| Retry[自动重试]
  Retry --> Backup[备用模型池]
  Backup --> Return`,
  retryFallbackBizEn: `flowchart LR
  App[Business request] --> Primary[Primary model pool]
  Primary --> Check{Success?}
  Check -->|Yes| Return[Return response]
  Check -->|No| Retry[Automatic retries]
  Retry --> Backup[Backup model pool]
  Backup --> Return`,

  observability: `flowchart LR
  Client[App / Client] --> VS[ BIG-IP Virtual Server ]
  VS --> ILX[iRuleLX + Logging]
  ILX --> Event[Structured event llm_request_completed]
  Event --> Adapter[Observability Adapter /events]
  Adapter --> Calc[Dedup + Pricing + Counters]
  Calc --> Prom[Prometheus scrape /metrics]
  Prom --> Grafana[Grafana Dashboard]
  ILX --> LTM[LTM log]
  LTM --> SIEM[SIEM / APM]`,
  observabilityBiz: `flowchart LR
  Traffic[LLM 业务流量] --> F5[F5 统一网关]
  F5 --> Metrics[用量/性能/费用数据]
  Metrics --> Prom[Prometheus]
  Prom --> Grafana[Grafana 看板]
  Metrics --> Ops[运维与 FinOps 决策]`,
  observabilityBizEn: `flowchart LR
  Traffic[LLM business traffic] --> F5[F5 Unified Gateway]
  F5 --> Metrics[Usage/Performance/Cost data]
  Metrics --> Prom[Prometheus]
  Prom --> Grafana[Grafana Dashboard]
  Metrics --> Ops[Ops and FinOps decisions]`,

  obsTokens: `flowchart LR
  ILX[iRuleLX structured event] --> Adapter[Adapter events endpoint]
  Adapter --> Parse[usage parse + normalize]
  Parse --> Pricing[pricing rules + cost calc]
  Pricing --> Metric[metrics counters endpoint]
  Metric --> Prom[Prometheus]
  Prom --> Grafana[Grafana token/cost panels]`,
  obsTokensBiz: `flowchart LR
  Requests[模型调用请求] --> Count[统计输入输出 Tokens]
  Count --> Cost[按价格版本计算费用]
  Cost --> Dash[Grafana 成本与用量看板]
  Dash --> Finance[成本分摊/预算管理]`,
  obsTokensBizEn: `flowchart LR
  Requests[Model invocation requests] --> Count[Count prompt/completion tokens]
  Count --> Cost[Calculate cost by price version]
  Cost --> Dash[Grafana usage and cost dashboard]
  Dash --> Finance[Chargeback and budget control]`,

  obsMetrics: `flowchart LR
  ILX[iRuleLX structured event] --> Adapter[Adapter events endpoint]
  Adapter --> Agg[status/retry/fallback aggregate]
  Adapter --> Hist[ttft/latency histogram buckets]
  Agg --> Metric[metrics endpoint]
  Hist --> Metric
  Metric --> Prom[Prometheus]
  Prom --> Grafana[Grafana metrics panels]`,
  obsMetricsBiz: `flowchart LR
  Requests[模型调用] --> Observe[持续观测质量]
  Observe --> Latency[时延与首包]
  Observe --> Error[错误/重试/fallback]
  Latency --> Dash[Grafana 实时看板]
  Error --> Dash`,
  obsMetricsBizEn: `flowchart LR
  Requests[Model invocations] --> Observe[Continuous quality monitoring]
  Observe --> Latency[Latency and TTFT]
  Observe --> Error[Error/Retry/Fallback]
  Latency --> Dash[Grafana live dashboard]
  Error --> Dash`,

  trafficMgmt: `flowchart TB
  Client[Client JSON] --> EntryVS[Entry VS iRuleLX]
  EntryVS --> Router[model/context/agent routing + retry]
  Router -->|ILXHttpRequest X-LLM-Target-Pool| LayeredVS[Layered VS TBLB iRule]
  LayeredVS -->|POST /scheduler/select| Scheduler[TBLB Scheduler]
  Scheduler --> Metrics[vLLM/SGLang metrics]
  LayeredVS -->|pool member pin| Members[Inference Pool Members]
  LayeredVS -->|LB_FAILED hybrid| LayeredVS`,
  trafficMgmtBiz: `flowchart LR
  Apps[多业务系统] --> Entry[F5 统一 LLM 网关]
  Entry --> Router[LLM Router 业务选池]
  Router --> TBLB[TBLB 池内智能调度]
  TBLB --> Cluster[同一模型下多套 GPU 实例]
  Cluster --> Value[更低首包时延 更高 GPU 利用率]`,
  trafficMgmtBizEn: `flowchart LR
  Apps[Business applications] --> Entry[F5 Unified LLM Gateway]
  Entry --> Router[LLM Router pool selection]
  Router --> TBLB[TBLB intelligent member pick]
  TBLB --> Cluster[Multiple GPU instances per model]
  Cluster --> Value[Lower TTFT and better GPU utilization]`,

  tblb: `flowchart TB
  subgraph plugin [Entry iRuleLX layered-gateway]
    DG[Data Group routing] --> Attempt[ILXHttpRequest per attempt]
  end
  Attempt -->|X-LLM-Target-Pool| iRule[Layered VS TBLB iRule]
  iRule -->|sideband POST| Sched[TBLB Scheduler]
  Sched -->|fetch| F5[F5 Pool members]
  Sched -->|scrape| Met[vLLM/SGLang /metrics]
  Sched -->|score + weighted random| iRule
  iRule -->|pool member hop| Mem1[Member A]
  iRule -->|pool member hop| Mem2[Member B]
  iRule -->|LB_FAILED exclude + reselect| iRule
  Mem1 --> Resp[Response + X-LLM-Selected-Member]
  Mem2 --> Resp
  Resp --> Attempt`,
  tblbBiz: `flowchart TB
  Apps[多业务系统] --> Entry[F5 统一 LLM 网关入口]
  Entry --> Router[LLM Router 按 model 选池]
  Router -->|model=gpt-4o| P1[pool_gpt-4o]
  Router -->|model=gemini-1.5-pro| P2[pool_gemini-1.5-pro]
  Router -->|model=deepseek-chat| P3[pool_deepseek-chat]
  P1 --> TBLB1[TBLB 智能选最优 member]
  P2 --> TBLB2[TBLB 智能选最优 member]
  P3 --> StdLB[标准 Pool 负载均衡 未启用 TBLB]
  TBLB1 --> GPU1[多套 GPU 推理实例]
  TBLB2 --> GPU2[多套 GPU 推理实例]
  StdLB --> GPU3[推理实例]`,
  tblbBizEn: `flowchart TB
  Apps[Business applications] --> Entry[F5 Unified LLM Gateway]
  Entry --> Router[LLM Router routes by model]
  Router -->|model=gpt-4o| P1[pool_gpt-4o]
  Router -->|model=gemini-1.5-pro| P2[pool_gemini-1.5-pro]
  Router -->|model=deepseek-chat| P3[pool_deepseek-chat]
  P1 --> TBLB1[TBLB picks best member]
  P2 --> TBLB2[TBLB picks best member]
  P3 --> StdLB[Standard pool LB no TBLB]
  TBLB1 --> GPU1[Multiple GPU instances]
  TBLB2 --> GPU2[Multiple GPU instances]
  StdLB --> GPU3[Inference instances]`,

  security: `flowchart TB
  Client --> VS[VS]
  VS --> ILX[iRuleLX]
  ILX --> Prompt[System prompt hardening]
  ILX --> Guard[Guardrails]
  Guard --> Backend[Backend LLM]`,

  systemPrompt: `sequenceDiagram
  participant C as Client
  participant F5 as BIGIP_JSON_Profile
  participant M as MockLLM_8011

  C->>F5: POST demo-model + system messages
  Note over F5: JSON_REQUEST ir_openai_api.tcl
  F5->>F5: merge system + nonce F5 wrapper
  F5->>M: forwarded JSON
  M->>M: parse BIG-IP mandatory rules block
  M-->>F5: YAML response
  F5-->>C: OpenAI compatible JSON`,
  systemPromptBiz: `flowchart LR
  Agent[不可信 Agent / Copilot] --> F5[F5 统一网关 172.16.30.124]
  F5 --> Wrap[System Prompt Wrapper<br/>admin + user + BIG-IP 强制规则]
  Wrap --> LLM[demo-model 模拟 LLM]
  LLM --> F5
  F5 --> Agent`,
  systemPromptBizEn: `flowchart LR
  Agent[Untrusted Agent / Copilot] --> F5[F5 Gateway 172.16.30.124]
  F5 --> Wrap[System Prompt Wrapper<br/>admin + user + BIG-IP mandatory rules]
  Wrap --> LLM[demo-model mock LLM]
  LLM --> F5
  F5 --> Agent`,

  guardrails: `flowchart LR
  Client[Client / curl] --> GW[vs_guardrail_oob_gateway :8000]
  GW -->|SIDEBAND POST /backend/v1/scans| Egress[vs_guardrail_ssl_egress :8031]
  Egress -->|HTTPS + SNI| GR[pool_guardrail_aigr → Calypso AI]
  GR -->|outcome| Egress
  Egress --> GW
  GW -->|passed / cleared| LLM[Default Pool 本地 LLM]
  GW -->|flagged| Client`,
  guardrailsBiz: `flowchart TB
  Apps[业务应用 / Copilot] --> ModelVS[模型 Virtual Server<br/>统一 LLM 入口]

  ModelVS -.旁路扫描.-> Guardrail[F5 AI Guardrail<br/>内容安全服务]
  Guardrail -.扫描结果.-> ModelVS

  ModelVS -->|合规：放行请求| LLM[推理模型集群]
  LLM -->|模型输出| ModelVS
  ModelVS -->|合规：返回响应| Apps
  ModelVS -->|违规：阻断请求或响应| Apps`,
  guardrailsBizEn: `flowchart TB
  Apps[Business apps / Copilot] --> ModelVS[Model Virtual Server<br/>Unified LLM entry]

  ModelVS -.Sideband scan.-> Guardrail[F5 AI Guardrail<br/>Content safety service]
  Guardrail -.Scan outcome.-> ModelVS

  ModelVS -->|Compliant: allow request| LLM[Inference cluster]
  LLM -->|Model output| ModelVS
  ModelVS -->|Compliant: return response| Apps
  ModelVS -->|Violation: block request or response| Apps`,

  llmRouterOverview: `flowchart LR
  subgraph entry [Unified entry]
    VS[vs_llm_inference_gateway]
  end
  VS --> R1[Model routing]
  VS --> R2[Context routing]
  VS --> R3[Agent routing]
  VS --> R4[Retry / Fallback]
  R1 --> Pools[Multiple LTM Pools]
  R2 --> Pools
  R3 --> Pools
  R4 --> Pools`,
  llmRouterOverviewBiz: `flowchart LR
  Apps[多业务系统] --> Entry[F5 单一入口]
  Entry --> R1[按模型分流]
  Entry --> R2[按上下文分流]
  Entry --> R3[按 Agent 身份分流]
  Entry --> R4[异常自动兜底]
  R1 --> Pool[多套模型资源池]
  R2 --> Pool
  R3 --> Pool
  R4 --> Pool`,
  llmRouterOverviewBizEn: `flowchart LR
  Apps[Multiple business systems] --> Entry[F5 Single Entry]
  Entry --> R1[Model-based routing]
  Entry --> R2[Context-size routing]
  Entry --> R3[Agent-based routing]
  Entry --> R4[Automatic resilience fallback]
  R1 --> Pool[Multiple model resource pools]
  R2 --> Pool
  R3 --> Pool
  R4 --> Pool`,

  placeholder: `flowchart LR
  A[Planned capability] --> B[F5 BIG-IP]
  B --> C[Demo coming soon]`,

  mcpToolsInsight: `flowchart LR
  Agent[AI Agent] --> VS[F5 MCP Gateway VS]
  VS --> Audit[Structured audit events]
  Audit --> Adapter[Adapter normalize + aggregate]
  Adapter --> Prom[Prometheus /metrics]
  Prom --> Grafana[Grafana insight dashboards]`,
  mcpToolsInsightBiz: `flowchart LR
  Agents[企业 AI Agent] --> Gateway[F5 MCP 网关]
  Gateway --> Logs[工具调用审计与指标]
  Logs --> Insight[按工具/Agent/租户洞察调用规模与趋势]`,
  mcpToolsInsightBizEn: `flowchart LR
  Agents[Enterprise AI agents] --> Gateway[F5 MCP Gateway]
  Gateway --> Logs[Tool-call audit and metrics]
  Logs --> Insight[Insight by tool, agent, and tenant]`,
  mcpToolsControl: `flowchart LR
  Agent[AI Agent / Client] --> VS[F5 MCP Gateway VS]
  VS --> Auth[Auth + policy]
  VS --> Route[MCP server routing]
  Route --> S1[MCP Server A]
  Route --> S2[MCP Server B]`,
  mcpToolsControlBiz: `flowchart LR
  Agents[企业 AI Agent] --> Gateway[F5 MCP 网关]
  Gateway --> Policy[鉴权 / 限流 / 路由策略]
  Policy --> Tools[统一管控 MCP 工具暴露与调用]`,
  mcpToolsControlBizEn: `flowchart LR
  Agents[Enterprise AI agents] --> Gateway[F5 MCP Gateway]
  Gateway --> Policy[Auth / rate limits / routing policy]
  Policy --> Tools[Governed MCP tool access]`,

  modelAllowlist: `sequenceDiagram
  participant C as Client
  participant F5 as BIGIP_JSON_Profile
  participant DG as dg_openai_model_list
  participant M as MockLLM_8011

  C->>F5: POST with model field
  Note over F5: iRule Layer 0 model check
  F5->>DG: lookup model action
  alt allow e.g. demo-model
    F5->>M: forward request
    M-->>F5: 200 response
    F5-->>C: OpenAI JSON
  else block or default block
    F5-->>C: 403 policy blocked
  end`,
  modelAllowlistBiz: `flowchart LR
  Apps[Copilot / Agent 应用] --> Gateway[F5 统一 LLM 网关]
  Gateway --> Check[模型准入校验<br/>仅审批 model 可进入]
  Check -->|已授权 model| LLM[企业推理服务]
  Check -->|未授权 model| Block[拒绝并返回错误]
  LLM --> Gateway
  Gateway --> Apps`,
  modelAllowlistBizEn: `flowchart LR
  Apps[Copilot / Agent apps] --> Gateway[F5 Unified LLM Gateway]
  Gateway --> Check[Model admission check<br/>Approved models only]
  Check -->|Authorized model| LLM[Enterprise inference]
  Check -->|Unauthorized model| Block[Reject with error]
  LLM --> Gateway
  Gateway --> Apps`,

  maxTokensLimit: `sequenceDiagram
  participant C as Client
  participant F5 as BIGIP_JSON_Profile
  participant LLM as Backend

  C->>F5: POST demo-model max_tokens=2048
  Note over F5: iRule Layer 0 max_tokens check
  F5->>LLM: forward
  LLM-->>F5: 200
  F5-->>C: allow

  C->>F5: POST demo-model max_tokens=8192
  F5->>F5: exceeds MAX_TOKENS_LIMIT 4096
  F5-->>C: 403 block`,
  maxTokensLimitBiz: `flowchart LR
  Agent[Agent / Copilot] --> F5[F5 统一 LLM 网关]
  F5 --> Check[max_tokens 上限校验<br/>MAX_TOKENS_LIMIT=4096]
  Check -->|2048 合规| LLM[推理服务]
  Check -->|8192 超限| Block[403 拒绝]
  LLM --> F5
  F5 --> Agent`,
  maxTokensLimitBizEn: `flowchart LR
  Agent[Agent / Copilot] --> F5[F5 Unified LLM Gateway]
  F5 --> Check[max_tokens ceiling check<br/>MAX_TOKENS_LIMIT=4096]
  Check -->|2048 compliant| LLM[Inference backend]
  Check -->|8192 over limit| Block[403 reject]
  LLM --> F5
  F5 --> Agent`,
};

export const CURL_EXAMPLES = {
  success: `curl -iX POST http://172.16.30.122:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}]}'`,
  fail: `curl -iX POST http://172.16.30.122:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-chat-xxx","messages":[{"role":"user","content":"hello"}]}'`,
};
