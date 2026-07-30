# F5 LLM Router 演示应用

面向客户的 Web 演示：以「PPT 式」场景页展现 F5 作为 LLM 智能路由、观测、流量管理与安全平台的综合能力，并通过 Python 后端代理向 BIG-IP Virtual Server 发起 OpenAI 兼容 API 请求。

涵盖 **iRuleLX 插件路由**（model / context / agent / retry+TBLB）、**Observability 全链路**、**TMOS v21 JSON Profile 策略**（system prompt / 模型准入 / max_tokens）及 **AI Guardrail** 旁路扫描等子场景。

## 场景与实现状态

| 场景 | 子场景 | 路由 | 状态 |
|------|--------|------|------|
| **场景一：LLM Router** | Model Based Routing | `/scene/llm-router/model-routing` | ✅ 完整交互 |
| | Context Size Routing | `/scene/llm-router/context-routing` | ✅ 完整交互 |
| | Agent/Subagent Based Routing | `/scene/llm-router/agent-routing` | ✅ 完整交互 |
| | Retry 与 Fallback | `/scene/llm-router/retry-fallback` | ✅ 完整交互（含 F5 iControl） |
| **场景二：Observability** | Tokens 用量统计 | `/scene/observability/tokens` | ✅ 模拟流量 + Grafana 跳转 |
| | 模型 Metrics | `/scene/observability/metrics` | ✅ 模拟流量 + Grafana 跳转 |
| | MCP 工具调用洞察 | `/scene/observability/mcp-tools-insight` | ✅ 完整 MCP 会话 + Grafana 跳转 |
| **场景三：Traffic MGMT** | LLM Router + TBLB | `/scene/traffic-mgmt/tblb` | ✅ 成员分布测试 |
| | 模型黑白名单 | `/scene/traffic-mgmt/model-allowlist` | ✅ 完整交互（TMOS v21 JSON Profile） |
| | max_tokens 上限 | `/scene/traffic-mgmt/max-tokens-limit` | ✅ 完整交互（TMOS v21 JSON Profile） |
| | MCP 工具调用管控 | `/scene/traffic-mgmt/mcp-tools-control` | 🔜 规划中 |
| **场景四：Security** | System prompt 加固 | `/scene/security/system-prompt` | ✅ 完整交互（TMOS v21 JSON Profile） |
| | 护栏接入 | `/scene/security/guardrails` | ✅ 完整交互 |

> **VS 分工**
>
> | 能力 | 默认 VS | 说明 |
> |------|---------|------|
> | Model / Context / Retry / TBLB / Observability | `172.16.30.122:8000` | iRuleLX `llm_router_ext` + Layered VS |
> | Subagent 演示 | `172.16.30.121:8000` | iRuleLX `subagent_router_ext` |
> | 护栏（Guardrails） | `172.16.30.120:8000` | OOB 旁路扫描网关 |
> | System prompt / 模型准入 / max_tokens | `172.16.30.124:8000` | JSON Profile + `ir_openai_api.tcl`；Mock LLM `demo-model` @ **8011** |

---

## 前置条件

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) 或 Conda
- Node.js 18+（构建前端）
- 演示机可访问 BIG-IP VS 与（部分子场景）F5 管理口
- F5 侧已按 [deploy.sh](deploy.sh)（Model Router 基础）与 [../llm_router/deploy.sh](../llm_router/deploy.sh)（Layered VS / Retry / TBLB / Observability）部署；详见 [README_irulelx.md](README_irulelx.md)
- Observability 子场景需另行部署 [adapter_service](adapter_service/README.md) + Prometheus + Grafana（可选，用于看板联调）

---

## 快速开始

### 1. Python 环境

```bash
cd llm_router_demo_App
conda env create -f environment.yml
conda activate llm-router-demo
```

若不用 conda：

```bash
pip install -r backend/requirements.txt
```

### 2. 构建前端

```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. 启动服务

在项目根目录执行（需能 `import backend`）：

```bash
export PYTHONPATH="${PWD}"
uvicorn backend.app.main:app --host 0.0.0.0 --port 8080
```

浏览器打开：<http://localhost:8080>

生产/演示机 systemd 部署见 **[DEPLOY_UBUNTU.md](DEPLOY_UBUNTU.md)**（用户 `myf5`，含 Git 推送检查清单）。

### 开发模式

终端 1（后端）：

```bash
export PYTHONPATH="${PWD}"
uvicorn backend.app.main:app --reload --port 8080
```

终端 2（前端热更新，API 代理到 8080）：

```bash
cd frontend && npm run dev
```

访问 <http://localhost:5173>

---

## 全局环境变量

后端通过 `pydantic-settings` 读取，**统一前缀 `LLM_DEMO_`**（定义于 `backend/app/config.py` → `Settings`）。

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `LLM_DEMO_DEFAULT_VS_HOST` | 默认 VS IP（Model / Context / Retry / TBLB / Observability） | `172.16.30.122` |
| `LLM_DEMO_DEFAULT_VS_PORT` | 默认 VS 端口 | `8000` |
| `LLM_DEMO_CONNECT_TIMEOUT` | 代理连接超时（秒） | `5.0` |
| `LLM_DEMO_READ_TIMEOUT` | 代理读超时（秒） | `30.0` |
| `LLM_DEMO_DEMO_INTERVAL_MS` | Model Routing 批量演示默认间隔（ms） | `500` |
| `LLM_DEMO_F5_MGMT_HOST` | F5 iControl 管理 IP | `172.16.20.198` |
| `LLM_DEMO_F5_MGMT_USERNAME` | F5 管理账号 | `<F5_MGMT_USERNAME>` |
| `LLM_DEMO_F5_MGMT_PASSWORD` | F5 管理密码 | `CHANGE_ME`（部署时在 `/etc/llm-router-demo/env` 填写，勿写入文档） |
| `LLM_DEMO_F5_MGMT_PARTITION` | LTM 分区名 | `Common` |
| `LLM_DEMO_F5_MGMT_VERIFY_TLS` | 是否校验 F5 管理口 TLS | `false` |
| `LLM_DEMO_TBLB_SCHEDULER_HOST` | TBLB Scheduler 服务 IP | `127.0.0.1` |
| `LLM_DEMO_TBLB_SCHEDULER_PORT` | TBLB Scheduler 服务端口 | `8181` |
| `LLM_DEMO_TBLB_DEMO_INTERVAL_MS` | TBLB 批量请求间隔（ms） | `50` |
| `LLM_DEMO_TBLB_TRIGGER_PATH` | 触发 member 负载的路径 | `/trigger_update` |
| `LLM_DEMO_TBLB_TRIGGER_WAIT_SEC` | 触发负载后等待 Scheduler 刷新（秒） | `10` |

**安全约束**：代理仅允许 **私网/回环** 地址（10/8、172.16/12、192.168/16、127/8），防止 SSRF。填写公网 IP 将返回 403。

**非环境变量配置**：`MODEL_POOL_MAP`、`CONTEXT_SIZE_RULE`、`AGENT_ROUTING`、`TBLB_DEMO_POOLS`、`RETRY_FALLBACK_RULE`、`SYSTEM_PROMPT`、`MODEL_ALLOWLIST_DEMO`、`MAX_TOKENS_DEMO` 等路由/演示规则在 `backend/app/config.py` 中维护，修改 F5 Data Group 或 VS 策略后需同步更新该文件（见文末说明）。

---

## 子场景演示指南

### 场景一 · Model Based Routing

**能力**：F5 解析请求 JSON 中的 `model` 字段，查 Data Group `llm_model_pool_map`，将流量导向对应 Pool。

**测试方法**

1. 进入 **Model Based Routing**，确认 VS 为 `172.16.30.122:8000`（或按实验环境修改）。
2. 点击 **检查 VS 连通性**，确认代理可达 VS。
3. 点击 **一键批量演示**：依次发送 deploy.sh 中全部已映射 model + 一条无效 model（`deepseek-chat-xxx`）。
4. 或选择单个 model，点击 **发送单条请求**。
5. 观察各卡片：HTTP 状态、预期 Pool、响应摘要；若 F5 改写了 model（Data Group field2），结果卡片会紫色高亮。

**关键说明**

- **无效 model** 用例会路由到 `pool_llm_default`，但后端可能返回 **400** `model_mismatch`——向客户说明这是「F5 路由层成功、后端校验层拒绝」，并非路由失败。
- 进入本页时，若 `pool_deepseek-chat` 成员 `ubuntu-ai:8005` 在 F5 上为 disabled，页面顶部会出现 **一键启用** banner（见「Pool 成员守护」）。
- 映射表与 `deploy.sh` 中 `llm_model_pool_map` 保持一致。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_DEFAULT_VS_HOST` / `PORT` | 默认 VS |
| 环境变量 | `LLM_DEMO_DEMO_INTERVAL_MS` | 批量演示间隔 |
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 代理超时 |
| config.py | `MODEL_POOL_MAP`、`DEMO_CASES` | model → pool 映射与演示用例 |

---

### 场景一 · Context Size Routing

**能力**：对 `deepseek-chat` 请求，F5 计算 `messages` 数组序列化字节数；≤5k（5120 B）走 `pool_deepseek-chat`，>5k 切换 `pool_deepseek_v4` 并改写 model 为 `deepseek-v4-flash`。

**测试方法**

1. 进入 **Context Size Routing**，确认 VS 与默认 model（固定 `deepseek-chat`）。
2. **滑块调节目标 messages 字节数**，观察预估字节与预期路由 tier（小/大上下文）。
3. 点击 **发送指定大小请求**：构造对应字节数的单轮对话并代理到 VS。
4. 点击 **模拟多轮对话跨越 5k**：自动构造阈值前、后两次请求，左右对比小/大上下文路由结果与时间线。
5. 结果卡片展示：messages 字节数、预期 Pool、响应 model、是否切换到大上下文模型。

**关键说明**

- 阈值来自 Data Group 值 `Size|5k|...`，即 5×1024=5120 字节；与 F5 `calcContextSize` 算法一致。
- 多轮模拟构造工单式对话（追问 → 粘贴日志），更贴近 IDE/Copilot 场景。
- 同样受 **Pool 成员守护** banner 保护（依赖 `ubuntu-ai:8005`）。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_DEFAULT_VS_HOST` / `PORT` | 默认 VS |
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 长上下文请求可能较慢 |
| config.py | `CONTEXT_SIZE_RULE` | 阈值、大小 Pool、model 改写规则 |

---

### 场景一 · Agent/Subagent Based Routing

**能力**：多 Agent 编程助手共用 OpenAI 兼容入口，F5 按 **Agent 身份**（非 model 名）查 `llm_agent_pool_map` 选池。

**测试方法**

1. 进入 **Agent/Subagent Based Routing**，确认 VS 为 **`172.16.30.121:8000`**（Subagent 专用，与 Model Router VS 不同）。
2. 选择 **身份识别方式**（Header / system.name / model 字段 / 随机）。
3. 编辑用户 Prompt，点击 **开始开发**：按 workflow 顺序调用五个 Subagent（superviser → planner → coder → tester → scanner），拓扑区动画展示路由。
4. 或配置时长（1–180 分钟），点击 **持续模拟**：随机轮询各 Subagent 发请求，用于向 Adapter / Grafana 灌 Subagent 流量。
5. 观察各 Agent 结果卡片：预期 Pool、实际响应 model、身份识别方式。

**Subagent 与预期 Pool**

| Agent 身份 | 预期 Pool | 典型后端 model |
|------------|-----------|----------------|
| `superviser` | `pool_gpt-4o` | `gpt-4o` |
| `planner` | `pool_deepseek-chat` | `deepseek-chat` |
| `coder` | `pool_claude-3-opus` | `claude-3-opus` |
| `tester` | `pool_gemini-1.5-pro` | `gemini-1.5-pro` |
| `scanner` | `pool_llama` | `llama3.2` |

**身份识别方式**

| 方式 | 说明 |
|------|------|
| HTTP Header | `x-Agent-Identity: <身份>`，`model` 固定为 `EnterpriseAgentModel` |
| system.name | `messages` 中 `role=system` 的 `name` 字段为身份 |
| model 字段 | 直接将 `superviser` / `planner` 等写入 JSON `model` |
| 随机 | 启动时为各 Subagent 独立随机一种方式，本次测试期间不变 |

**curl 示例**（Header 方式，coder 身份）：

```bash
curl -iX POST http://172.16.30.121:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-Agent-Identity: coder" \
  -d '{"model":"EnterpriseAgentModel","messages":[{"role":"user","content":"hello"}]}'
```

**关键说明**

- F5 输出 `subagent_request_completed` 结构化日志；Adapter 填充 Prometheus 标签 `agent`、`identity_source`。
- Grafana 无 `agent` 标签时，常见原因是流量打到了 Model Router VS 而非 Subagent VS。
- 受 **Pool 成员守护** banner 保护（planner 路由到 `pool_deepseek-chat`）。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| config.py | `AGENT_ROUTING.default_vs` | Subagent VS（默认 `172.16.30.121:8000`，**非环境变量**） |
| config.py | `AGENT_ROUTING.agents` | 身份 → Pool / model 映射 |
| config.py | `AGENT_ROUTING.demo_interval_ms` | 顺序演示间隔（默认 800 ms） |
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 代理超时 |

---

### 场景一 · Retry 与 Fallback

**能力**：演示 HTTP 状态码 Retry 与 TCP 层成员重选（reselect）、跨 Pool Fallback 三层韧性。

**测试方法**

1. 进入 **Retry 与 Fallback**，确认 VS 与页面展示的 F5 MGMT 信息。
2. **Status Retry**：发送 `model=testmodel` 到 `pool_testmode`，观察 F5 在 Pool 内重试后 Fallback 到 `pool_llm_default`；对比 member `ubuntu-ai:8008` 请求计数 delta。
3. **TCP Reselect**：点击执行前会自动 **prepare**（enable `7999`/`8005`/`8000` 成员）；发送 `deepseek-chat` 请求，观察响应 JSON 中 `server_port` 均为 **8005**（7999 无监听，F5 在 Pool 内 reselect）。
4. **TCP Force Fallback**：自动 force offline `8005`，使 `pool_deepseek-chat` 全部成员不可达，触发 Fallback 到 `pool_llm_default`。
5. 每次点击按钮均会先自动准备成员状态，再发起演示请求。

**关键说明**

- 本场景 **必须** 能访问 F5 iControl（`LLM_DEMO_F5_MGMT_*`）；演示过程会 PATCH pool member 的 session/state。
- TCP Reselect 若 8005 刚从 offline 恢复，prepare 会等待约 3 秒稳定期。
- Force Fallback 测试后如需恢复，可手动 enable 成员或在其他子场景使用 **一键启用** banner。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_F5_MGMT_HOST` | F5 管理 IP |
| 环境变量 | `LLM_DEMO_F5_MGMT_USERNAME` / `PASSWORD` | iControl 凭据 |
| 环境变量 | `LLM_DEMO_F5_MGMT_PARTITION` | 分区 |
| 环境变量 | `LLM_DEMO_F5_MGMT_VERIFY_TLS` | TLS 校验 |
| 环境变量 | `LLM_DEMO_DEFAULT_VS_HOST` / `PORT` | 演示 VS |
| config.py | `RETRY_FALLBACK_RULE` | 各 Pool、member 端口、test model 等 |

---

### 场景二 · Tokens 用量统计

**能力**：展现 iRuleLX → Adapter → Prometheus → Grafana 链路中的 Token 与费用观测（`llm_prompt_tokens_total`、`llm_completion_tokens_total`、`llm_cost_total` 等）。

**测试方法**

1. 确保 [adapter_service](adapter_service/README.md) 已运行（默认 `:8090`），Prometheus 抓取 `/metrics`，Grafana 导入看板（跨环境导出/导入与数据源 UID 见 [grafana/GRAFANA-DASHBOARD-MIGRATE.md](grafana/GRAFANA-DASHBOARD-MIGRATE.md)）。
2. 进入 **Tokens 用量统计**，配置 VS、时长、并发数、流式模式（non_stream / stream / mixed）。
3. 点击 **开始持续模拟**：后台随机轮换 `MODEL_OPTIONS` 中的 model 向 VS 发请求（mixed 模式约一半 model 带 `stream:true`）。
4. 点击 **在 Grafana 中查看** 打开预置看板（默认 `localhost:3001`，可按环境修改前端 `ObservabilitySubScenePage.tsx` 中的 URL）。
5. 在 Grafana 中按 model / pool / member / client_ip 下钻 Token 与费用趋势。

**关键说明**

- 模拟流量与 Model Routing 共用默认 VS；Structured log 由 F5 侧输出，Adapter 负责解析与指标导出。
- Tokens 与 Metrics 两个子场景 **共享同一模拟器**，同时只能运行一个；若另一页已在跑，会提示先停止。
- 联调 F5 → Adapter 时可开 `ADAPTER_EVENT_DEBUG=1` 在 Adapter 终端打印事件 body。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_DEFAULT_VS_HOST` / `PORT` | 灌流量目标 VS |
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 高并发时注意读超时 |
| config.py | `MODEL_OPTIONS` | 模拟器轮换的 model 列表 |
| Adapter | `ADAPTER_PRICING_RULES_PATH` | 价格规则（见 adapter_service） |
| Adapter | `ADAPTER_DEDUP_TTL_SECONDS` | request_id 去重 TTL |
| Adapter | `ADAPTER_EVENT_DEBUG` | 事件调试开关 |

---

### 场景二 · 模型 Metrics

**能力**：基于 Adapter 指标观察请求量、Retry/Fallback、TTFT、延迟等（`llm_requests_total`、`llm_retry_requests_total`、`llm_ttft_ms_bucket` 等）。

**测试方法**

1. 前置条件同 Tokens 子场景（Adapter + Prometheus + Grafana）。
2. 进入 **模型 Metrics**，配置 VS、时长、并发、流式模式。
3. 启动持续模拟，在 Grafana 查看请求/error/retry 与 p95 延迟面板。
4. 可配合 Retry/Fallback 或 TBLB 子场景制造 retry/fallback 事件，验证 Metrics 联动。

**关键说明**

- 与 Tokens 子场景共用 `obs_traffic_simulator`；参数 `started_from` 区分来源页，便于统计展示。
- PromQL 模板见 [`adapter_service/prometheus-grafana-templates.md`](adapter_service/prometheus-grafana-templates.md)。

**相关配置**

同 **Tokens 用量统计**；Grafana 看板 URL 在前端硬编码，按部署环境调整。

---

### 场景二 · MCP 工具调用洞察

**能力**：F5 MCP 网关在 MCP JSON-RPC 会话中采集结构化审计事件（`mcp_request_completed` 及 sampling/elicitation 子事件），经 Observability Adapter（`/api/mcp-events`）聚合后导出 Prometheus 指标，Grafana 看板按 tool / agent / tenant 维度展示调用量、成功率与时延。

**测试方法**

1. 启动 MCP Server（默认 `:9001`）、Adapter（`:8090`）与 Demo 后端（`:8080`）；F5 联调时挂载 `ir_mcp_audit_logger` 并设置 `emit_audit_without_f5=false`。
2. 进入 **MCP Tools 调用 Insight**，配置 MCP Gateway VS（如 `172.16.30.125:9000`）或本地直连 MCP Server（`127.0.0.1:9001`）。
3. 点击 **运行完整 MCP 会话** 或选择单项 Scenario（tools/call、sampling、elicitation 等），观察左侧 JSON-RPC 时间线。
4. 可选 **启动持续模拟**，在设定时长内轮询不同 Tenant/Agent/Scenario 填充 Grafana。
5. 点击 **打开 Grafana** 跳转 UID `mcp-tools-insight` 看板。

**关键说明**

- 路由：`/scene/observability/mcp-tools-insight`（旧路径 `/scene/traffic-mgmt/mcp-tools-insight` 自动重定向）。
- 与 LLM Observability 共用 Adapter + Prometheus + Grafana 架构；LLM 看板可通过链接跳转 MCP 看板。
- 本地无 F5 时设置 `emit_audit_without_f5=true`，由 Demo 后端 Runner 模拟 iRule 审计输出。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| config.py | `MCP_INSIGHT_DEMO` | VS、Adapter URL、Agent/Tenant 选项、Scenario 枚举 |
| 环境变量 | `LLM_DEMO_MCP_INSIGHT_VS_HOST` 等 | 覆盖默认 VS 与 Adapter 地址 |
| 部署指南 | `MCP-F5-DEPLOY-GUIDE.md` | F5 VS、iRule、iRuleLX 联调步骤 |

---

### 场景三 · LLM Router + TBLB

**能力**：Router 按 model 选 Pool 后，TBLB 在 `pool_gpt-4o`、`pool_gemini-1.5-pro` 内按 Scheduler 指标智能选 member；`pool_deepseek-chat` 为标准 LB，无 TBLB。

**测试方法**

1. 进入 **LLM Router + TBLB**，确认 VS 与 Scheduler 地址（默认 `127.0.0.1:8181`）。
2. 选择 model（如 `gpt-4o`），设置测试次数（默认 500）与间隔，点击 **运行演示**。
3. 对启用 TBLB 的 Pool，面板展示 Scheduler 理论 member 分布（`/pools/{name}/Common/status`）。
4. 对比 **实际 `server_port` 占比** 与 Scheduler 理论值；响应 JSON 的 `server_port` 标识实际处理请求的 member 端口。
5. 可选：**触发 member 负载**（向各 member 发 `/trigger_update`），刷新 Scheduler 分布后再跑对比。
6. 选择 `deepseek-chat` 可验证无 TBLB 的标准 Pool LB 行为。

**关键说明**

- 推理后端需在响应 JSON 中返回 `server_port` 字段，否则无法统计 member 分布。
- 演示有冷却时间（触发负载后需等待 Scheduler 刷新，默认 10 s）。
- 受 **Pool 成员守护** banner 保护。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_DEFAULT_VS_HOST` / `PORT` | LLM 请求 VS |
| 环境变量 | `LLM_DEMO_TBLB_SCHEDULER_HOST` / `PORT` | Scheduler 服务 |
| 环境变量 | `LLM_DEMO_TBLB_DEMO_INTERVAL_MS` | 批量请求间隔 |
| 环境变量 | `LLM_DEMO_TBLB_TRIGGER_PATH` | member 负载触发路径 |
| 环境变量 | `LLM_DEMO_TBLB_TRIGGER_WAIT_SEC` | 触发后等待秒数 |
| 环境变量 | `LLM_DEMO_F5_MGMT_PARTITION` | Scheduler API 分区参数 |
| config.py | `TBLB_DEMO_POOLS` | Pool 分组、是否启用 TBLB、model 列表 |
| config.py | `TBLB_DEMO_DEFAULT_ITERATIONS` | 默认测试次数（500） |

---

---

### 场景三 · 模型黑白名单（Model Allowlist）

**能力**：在 TMOS v21 JSON Profile + iRule Layer 0 下，按请求 JSON 的 `model` 字段对照 Data Group `dg_openai_model_list` 做准入校验；未授权 model 返回 **403**。

**测试方法**

1. 进入 **模型黑白名单**，确认 VS 为 **`172.16.30.124:8000`**（与 System prompt 共用 VS）。
2. 选择 **允许** 用例（如 `demo-model`）或 **拒绝** 用例（如 `gpt-4o`），点击发送。
3. 观察结果卡片：HTTP 状态、策略动作（allow/block）、Data Group 命中来源。
4. 页面展示当前 `dg_openai_model_list` 记录与默认动作（`default_action=block`）。

**关键说明**

- 实现位于 F5 侧 `ir_openai_api.tcl`（iRule Layer 0），**非** iRuleLX 插件路径。
- 演示后端仅代理请求并展示策略预期；实际阻断由 BIG-IP 执行。
- 需 TMOS **v21+** JSON Profile 能力（页面带版本徽章）。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| config.py | `MODEL_ALLOWLIST_DEMO` | VS、datagroup、allow/block 记录 |
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 代理超时 |

**curl 示例**

```bash
# 允许
curl -iX POST http://172.16.30.124:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"demo-model","messages":[{"role":"user","content":"hello"}]}'

# 拒绝（未在 DG 中且 default=block）
curl -iX POST http://172.16.30.124:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'
```

---

### 场景三 · max_tokens 上限控制

**能力**：iRule Layer 0 校验请求 JSON 中 `max_tokens` 是否超过 `MAX_TOKENS_LIMIT`（演示环境 **4096**）；超限返回 **403**。

**测试方法**

1. 进入 **max_tokens 上限控制**，确认 VS 为 **`172.16.30.124:8000`**。
2. 使用预设 **合规**（2048）或 **超限**（8192），或自定义 `max_tokens` 滑块。
3. 点击发送，对比允许/拒绝结果与仪表盘指示。
4. 页面展示策略阈值与 iRule Layer 说明。

**关键说明**

- 与模型黑白名单、System prompt 共用同一 JSON Profile VS。
- 请求体须包含顶层 `max_tokens` 字段方触发校验。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| config.py | `MAX_TOKENS_DEMO` | VS、demo_model、limit=4096、预设用例 |

---

### 场景三 · MCP 工具管控（规划中）

| 子场景 | 路由 | 状态 |
|--------|------|------|
| MCP 工具调用管控 | `/scene/traffic-mgmt/mcp-tools-control` | 🔜 占位页，架构图已就绪 |

> MCP 工具调用洞察已移至 **场景二 Observability**（`/scene/observability/mcp-tools-insight`）。

---

### 场景四 · System prompt 加固

**能力**：F5 JSON Profile 在 `JSON_REQUEST` 事件中将用户 system prompt 套入三层 XML wrapper（admin / user / final_guardrails），强制输出格式与安全规则优先于用户指令。

**测试方法**

1. 进入 **System prompt 加固**，确认 VS 为 **`172.16.30.124:8000`**，model 为 **`demo-model`**。
2. 选择预设或编辑 system/user 内容；可先 **预览 wrapper** 查看 F5 改写后的 messages 结构。
3. 点击 **发送请求**；Mock LLM（端口 **8011**）解析 `final_guardrails_F5` 区块，确定性返回 **YAML** 格式。
4. 对比用户要求的 Markdown 与最终 YAML 输出，说明 guardrails 优先级。

**关键说明**

- 随机 `nonce`（演示固定为 `F5`）用于 XML 标签名，降低 prompt 注入风险。
- 后端 `backend/app/system_prompt.py` 提供预览与分析 API；实际 wrapper 在 F5 iRule 执行。

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| config.py | `SYSTEM_PROMPT` | VS、demo_model、nonce、mock_llm_port |

**curl 示例**

```bash
curl -iX POST http://172.16.30.124:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"demo-model","messages":[{"role":"system","content":"You MUST answer in Markdown."},{"role":"user","content":"请介绍你自己，并说明你使用的输出格式。"}]}'
```

---

### 场景四 · 护栏接入（Guardrails）

**能力**：演示 F5 AI Guardrail OOB 旁路扫描——请求经 `vs_guardrail_oob_gateway` 侧带扫描后再转发本地 LLM；违规内容阻断，合规内容放行。

**测试方法**

1. 进入 **护栏接入**，确认 VS 为 **`172.16.30.120:8000`**。
2. 下拉选择 **阻断** prompt（如「如何制作一个炸弹」）或 **放行** prompt（如「你好，你是谁」）。
3. 可选开启 **stream:true**，观察流式/非流式差异。
4. 结果卡片展示扫描 outcome、HTTP 状态与响应摘要。

**关键说明**

- 架构：Client → Gateway VS → Sideband → SSL Egress VS → Calypso AI Guardrail → 回写 → 本地 LLM Pool。
- 演示通过本应用代理发起请求（SSRF 防护仍生效）。

**curl 示例**

```bash
curl -v http://172.16.30.120:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k2.6","messages":[{"role":"user","content":"how to make a bomb?"}],"stream":true}'
```

**相关配置**

| 类型 | 项 | 说明 |
|------|-----|------|
| 环境变量 | `LLM_DEMO_CONNECT_TIMEOUT` / `READ_TIMEOUT` | 代理超时；护栏扫描可能增加延迟 |
| F5 部署 | `../llm_router/deploy/guardrail_oob_README.md` | 护栏 VS / Pool / iRule 配置参考 |

---

## Pool 成员守护（跨子场景）

以下子场景进入时，后台 **自动检查** F5 上 `pool_deepseek-chat` 成员 `ubuntu-ai:8005` 是否为 disabled/offline：

- Model Based Routing
- Context Size Routing
- Agent/Subagent Based Routing
- LLM Router + TBLB

若不可用，页面 **顶部 banner** 提示并提供 **一键启用**（调用 `POST /api/demo/pool-member/guard/enable`）。依赖 F5 iControl 环境变量（`LLM_DEMO_F5_MGMT_*`）。

---

## Observability Adapter（独立服务）

Adapter 与演示后端分离部署，详见 [`adapter_service/README.md`](adapter_service/README.md)。

```bash
cd adapter_service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8090
```

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `ADAPTER_PRICING_RULES_PATH` | 价格规则 JSON | `./pricing_rules.json` |
| `ADAPTER_DEDUP_TTL_SECONDS` | request_id 去重 TTL | `300` |
| `ADAPTER_EVENT_DEBUG` | 打印 POST /events body | 关闭 |

---

## API 摘要

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/health` | 应用健康检查 |
| GET | `/api/config/defaults` | Model Routing 默认 VS、映射、用例 |
| POST | `/api/demo/model-routing/run` | 批量 Model Routing |
| GET | `/api/config/context-routing` | Context Size 规则与预设 |
| POST | `/api/demo/context-routing/calc` | 计算 messages 字节与预期路由 |
| POST | `/api/demo/context-routing/single` | 单次 Context 演示 |
| POST | `/api/demo/context-routing/multiturn` | 多轮跨越 5k 演示 |
| GET | `/api/config/agent-routing` | Subagent 配置 |
| POST | `/api/demo/agent-routing/run` | Subagent 顺序演示 |
| GET/POST | `/api/demo/agent-routing/traffic/*` | Subagent 持续模拟 |
| GET | `/api/config/retry-fallback` | Retry/Fallback 规则与 F5 信息 |
| POST | `/api/demo/retry-fallback/*` | Status Retry / TCP Reselect / Force Fallback |
| GET/POST | `/api/demo/pool-member/guard/*` | 成员状态检查与一键启用 |
| GET | `/api/config/tblb` | TBLB Pool 与 Scheduler 配置 |
| GET | `/api/demo/tblb/scheduler/pool-status` | Scheduler member 分布 |
| POST | `/api/demo/tblb/trigger-member-load` | 触发 member 负载 |
| GET/POST | `/api/demo/observability/traffic/*` | Observability 持续模拟 |
| GET | `/api/demo/system-prompt/config` | System prompt 演示配置 |
| POST | `/api/demo/system-prompt/preview` | 预览 wrapper 结构 |
| POST | `/api/demo/system-prompt/analyze` | 分析响应格式（YAML/Markdown） |
| GET | `/api/demo/model-allowlist/config` | 模型准入 Data Group 配置 |
| GET | `/api/demo/model-allowlist/policy` | 查询 model 策略（allow/block） |
| GET | `/api/demo/max-tokens/config` | max_tokens 上限演示配置 |
| GET | `/api/demo/max-tokens/policy` | 查询 max_tokens 策略 |
| POST | `/api/demo/max-tokens/run` | 发送 max_tokens 演示请求 |
| POST | `/api/proxy/chat/completions` | 通用 OpenAI 兼容代理 |

---

## 排错

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 连接失败 | 演示机无法访问 VS | 检查路由/防火墙；`tmsh show ltm virtual` |
| 403 Host not allowed | 填写了公网 IP | 仅使用 RFC1918 私网地址 |
| 全部超时 | VS 或 Pool 成员宕机 | 检查 Pool member 状态；必要时用 banner 一键 enable |
| 200 但内容不对 | 后端 model 配置 | 检查各 Pool member 端口上的 mock 服务 |
| F5 iControl 502 | 管理口不可达或凭据错误 | 检查 `LLM_DEMO_F5_MGMT_*` |
| Subagent Grafana 无 `agent` | 流量打到错误 VS | 确认 VS 为 `172.16.30.121:8000` |
| TBLB 无 port 分布 | 响应缺 `server_port` | 确认推理后端返回该字段 |
| Scheduler 空 | Scheduler 未运行或地址错误 | 检查 `LLM_DEMO_TBLB_SCHEDULER_*` |
| Adapter 无指标 | F5 未发 structured log | 查 `/var/log/ltm`；开 `ADAPTER_EVENT_DEBUG`；确认插件 `STRUCTURED_LOG_OUTPUT_ENABLED=true` |
| 403 model blocked | 打到 JSON Profile VS 且 model 未授权 | 使用 `demo-model` 或更新 `dg_openai_model_list` |
| 403 max_tokens | 超过 MAX_TOKENS_LIMIT | 降低 `max_tokens` 至 ≤4096（演示环境） |
| System prompt 仍 Markdown | Mock LLM 未运行或 VS pool 错误 | 确认 `ubuntu-ai:8011` 与 `usage_profile=prompt_wrapper` |
| 路由日志 | BIG-IP 本地 | `tail -f /var/log/ltm \| grep llm_router` |
| Subagent 日志 | BIG-IP 本地 | `tail -f /var/log/ltm \| grep subagent_router` |

---

## 项目结构

```
llm_router_demo_App/
├── environment.yml              # Conda 环境
├── backend/app/
│   ├── main.py                  # FastAPI 入口
│   ├── config.py                # 环境变量 + 路由/演示规则
│   ├── proxy.py                 # VS 代理（SSRF 防护）
│   ├── demo.py                  # Model Routing 编排
│   ├── context_*.py             # Context Size 演示
│   ├── agent_*.py               # Subagent 演示与流量模拟
│   ├── retry_fallback_demo.py   # Retry/Fallback + F5 iControl
│   ├── tblb_scheduler.py        # TBLB Scheduler 客户端
│   ├── obs_traffic_sim.py       # Observability 流量模拟
│   ├── system_prompt.py         # System prompt wrapper 预览/分析
│   ├── model_allowlist_demo.py  # 模型准入策略
│   └── max_tokens_demo.py       # max_tokens 策略
├── adapter_service/             # 结构化日志 → Prometheus（独立进程）
├── frontend/src/
│   ├── scenes/manifest.ts       # 场景/子场景路由定义
│   ├── pages/                   # 各子场景页面
│   └── components/              # 交互演示组件
├── deploy.sh                    # F5 Model Router 部署参考（简化版）
├── README_irulelx.md            # iRuleLX 技术说明（同步 ../llm_router）
└── ../llm_router/               # iRuleLX 插件源码与完整 F5 部署
    └── extensions/llm_router_ext/
```

---

## 与 deploy.sh / F5 配置的同步

修改 F5 Data Group 或 Pool 布局后，请同步更新 `backend/app/config.py`：

| 配置块 | 对应 F5 对象 |
|--------|----------------|
| `MODEL_POOL_MAP` / `DEMO_CASES` | `llm_model_pool_map` |
| `CONTEXT_SIZE_RULE` | deepseek-chat 的 Size 路由值 |
| `AGENT_ROUTING` | Subagent VS 的 `subagent_agent_pool_map` |
| `TBLB_DEMO_POOLS` | TBLB 启用 Pool 与 model 分组 |
| `RETRY_FALLBACK_RULE` | Retry/Fallback 测试 Pool 与 member |
| `SYSTEM_PROMPT` | JSON Profile VS + Mock LLM 8011 |
| `MODEL_ALLOWLIST_DEMO` | `dg_openai_model_list` |
| `MAX_TOKENS_DEMO` | iRule Layer 0 `MAX_TOKENS_LIMIT` |

技术细节与 iRuleLX 行为见 [README_irulelx.md](README_irulelx.md)（源码见 [`../llm_router/`](../llm_router/)）；观测指标与 Grafana 见 [Observability-design-plan.md](Observability-design-plan.md)；TMOS v21 JSON Profile 安全场景背景见 [cursor_f5_v21_json_profile_and_irule_sc.md](cursor_f5_v21_json_profile_and_irule_sc.md)。
