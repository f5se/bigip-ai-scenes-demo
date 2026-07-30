# Observability Adapter Service

一个可独立运行的 Adapter 程序，用于接收 F5 结构化日志，做标准化与费用计算，并通过 `/metrics` 提供 Prometheus 可抓取指标。

## 功能

- `POST /events`：接收 `llm_request_completed` 与 `subagent_request_completed` 事件
- `request_id` 去重（TTL）
- 模型价格映射（每 1M tokens 单价）
- 累计并导出 Prometheus 指标
- `POST /pricing/reload`：热加载价格规则
- `GET /metrics`：Prometheus 抓取端点
- `GET /health`：健康检查
- **Event Debug**（可选）：`ADAPTER_EVENT_DEBUG` 开启后，在终端打印每次 `POST /events` 的 JSON body

## MCP Tools Insight 事件（`schema_version=mcp_v1`）

- `POST /api/mcp-events`：单条 MCP 审计日志
- `POST /api/mcp-events/batch`：批量 `{"events":[...]}`
- 幂等键：`trace_id`（TTL 同 `ADAPTER_DEDUP_TTL_SECONDS`）
- 调试：`ADAPTER_MCP_EVENT_DEBUG=1`
- 指标前缀：`mcp_*`（与 `llm_*` 并存）

```bash
# 压测 / Grafana 联调
python scripts/mock_mcp_log_sender.py --count 100 --rate 20
```

完整本地链路见项目根目录 [`MCP-F5-DEPLOY-GUIDE.md`](../MCP-F5-DEPLOY-GUIDE.md)。

## 运行

```bash
cd adapter_service
conda activate f5-adapter-svc 
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8090
```

### Docker 镜像（交付）

仅打包 Adapter 运行时（不含测试脚本）。在 **linux/amd64** 构建机编译、代理与日志轮转说明见 **[DOCKER.md](DOCKER.md)**。

同机一并拉起 Adapter + Prometheus + Grafana：

```bash
cd adapter_service
docker compose -f docker-compose.stack.yaml up -d --build
```
## 环境变量

- `ADAPTER_PRICING_RULES_PATH`：价格规则文件路径（默认 `./pricing_rules.json`）
- `ADAPTER_DEDUP_TTL_SECONDS`：`request_id` 去重 TTL 秒数（默认 `300`）
- `ADAPTER_EVENT_DEBUG`：事件 body 调试开关，见下文 [Event Debug 备忘](#event-debug-备忘)

去重约束说明：

- Adapter 仅按 `request_id` 去重（幂等键）。
- 不按 `session_id` / `conversation_id` 去重。
- 同一会话的多轮请求必须使用不同 `request_id`，否则会被误判重复并影响统计。

## Event Debug 备忘

用于联调 F5 → Adapter 日志链路时，在**运行 Adapter 的终端**查看每次收到的请求体。

### 开启方式

环境变量（与 `uvicorn` 同进程生效）：


| 取值                          | 说明         |
| --------------------------- | ---------- |
| 未设置 / `0` / `false`         | 关闭（默认）     |
| `1` / `true` / `yes` / `on` | 开启（不区分大小写） |


```bash
cd adapter_service
ADAPTER_EVENT_DEBUG=1 python -m uvicorn main:app --host 0.0.0.0 --port 8090
```

启动成功且开关打开时，会先打印一行：

```text
[adapter] ADAPTER_EVENT_DEBUG=1 — POST /events body will be printed to stdout
```

### 打印内容

每收到一条**已通过 Pydantic 校验**的 `POST /events`，输出格式化 JSON（含 `LogEvent` 上 `extra="allow"` 的扩展字段），前缀为 `[adapter][event_debug]`。

### 注意事项

- 仅调试用，生产环境请保持关闭，避免终端刷屏与敏感字段泄露。
- JSON 非法、必填字段缺失等导致 **422** 的请求，在解析前失败，**不会**打印 body；需结合 FastAPI 返回的 `detail` 或抓包排查。
- 重复 `request_id` 被去重时，仍会先打印 body，再返回 `accepted: false`。

## Prometheus 配置示例

```yaml
scrape_configs:
  - job_name: llm-observability-adapter
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:8090"]
```

更多 `scrape_configs` 与 Grafana PromQL 模板见：`prometheus-grafana-templates.md`。

### Prometheus 指标标签（降基数）

业务指标标签为：`model`（`response_model`）、`pool`、`member`、`status_class`、`price_version`、`agent`、`identity_source`。  

- 经典 LLM Router：`agent=-`、`identity_source=-`  
- Subagent VS：`agent` 为 `agent_identity`（如 `scanner`），`identity_source` 为 `header` / `system_name` / `model_field`  
- Subagent 费用计价按 `**response_model**`（如 `llama3.2`），而非 `model_name_req`（常为 Agent 身份）

**不含 `client_ip`**（避免时间序列爆炸）；`client_ip`、`body_model_req`、`trace_id` 等仍在事件 JSON 中。

升级后请**重启 adapter**；Grafana 查询需增加 `agent=~"$agent"`、`identity_source=~"$identity_source"`（见 `prometheus-grafana-templates.md` § Subagent）。

## 最小事件示例

```json
{
  "schema_version": "v1",
  "event_type": "llm_request_completed",
  "event_time": "2026-05-28T02:40:12.345Z",
  "request_id": "req_1",
  "client_ip": "10.10.1.25",
  "http_method": "POST",
  "request_path": "/v1/chat/completions",
  "status_code": 200,
  "latency_ms": 842.7,
  "model_name_req": "deepseek-chat",
  "response_model": "deepseek-chat",
  "selected_pool": "pool_deepseek-chat",
  "selected_pool_member": "ubuntu-ai:8005",
  "retry_count": 0,
  "fallback_occurred": false,
  "upstream_provider": "openai_compatible",
  "streaming": true,
  "ttft_ms": 220,
  "prompt_tokens": 128,
  "completion_tokens": 256,
  "total_tokens": 384
}
```

Subagent 路由 VS 最小事件示例（`event_type=subagent_request_completed`）：

```json
{
  "schema_version": "v1",
  "event_type": "subagent_request_completed",
  "event_time": "2026-06-04T01:59:39.426Z",
  "request_id": "req_mpyukucb_6vf86rw0_192_168_1_254",
  "client_ip": "192.168.1.254",
  "http_method": "POST",
  "request_path": "/v1/chat/completions",
  "status_code": 200,
  "latency_ms": 4.0,
  "model_name_req": "scanner",
  "response_model": "llama3.2",
  "selected_pool": "/Common/pool_llama",
  "selected_pool_member": "172.16.40.122:8009",
  "retry_count": 0,
  "fallback_occurred": false,
  "upstream_provider": "openai_compatible",
  "streaming": false,
  "ttft_ms": 0.0,
  "ttft_observed": false,
  "upstream_ttfb_ms": 2.0,
  "upstream_ttfb_observed": true,
  "agent_identity": "scanner",
  "body_model_req": "EnterpriseAgentModel",
  "identity_source": "header",
  "gateway_action": "pass",
  "prompt_tokens": 26,
  "completion_tokens": 298,
  "total_tokens": 324,
  "usage_parse_status": "ok",
  "usage_profile_id": "ollama"
}
```

非流式请求使用 `upstream_ttfb_ms` / `upstream_ttfb_observed`（勿映射到 `ttft_ms`）：

```json
{
  "schema_version": "v1",
  "event_type": "llm_request_completed",
  "event_time": "2026-05-28T02:40:12.345Z",
  "request_id": "req_2",
  "client_ip": "10.10.1.25",
  "http_method": "POST",
  "request_path": "/v1/chat/completions",
  "status_code": 200,
  "latency_ms": 1200.5,
  "model_name_req": "deepseek-chat",
  "response_model": "deepseek-chat",
  "selected_pool": "pool_deepseek-chat",
  "selected_pool_member": "ubuntu-ai:8005",
  "retry_count": 0,
  "fallback_occurred": false,
  "upstream_provider": "openai_compatible",
  "streaming": false,
  "ttft_ms": 0,
  "ttft_observed": false,
  "upstream_ttfb_ms": 185.3,
  "upstream_ttfb_observed": true,
  "prompt_tokens": 128,
  "completion_tokens": 256,
  "total_tokens": 384
}
```

## 调用示例（curl）

```bash
curl -X POST "http://127.0.0.1:8090/events" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version":"v1",
    "event_type":"llm_request_completed",
    "event_time":"2026-05-28T02:40:12.345Z",
    "request_id":"req_1",
    "client_ip":"10.10.1.25",
    "http_method":"POST",
    "request_path":"/v1/chat/completions",
    "status_code":200,
    "latency_ms":842.7,
    "model_name_req":"deepseek-chat",
    "response_model":"deepseek-chat",
    "selected_pool":"pool_deepseek-chat",
    "selected_pool_member":"ubuntu-ai:8005",
    "retry_count":0,
    "fallback_occurred":false,
    "upstream_provider":"openai_compatible",
    "streaming":true,
    "ttft_ms":220,
    "prompt_tokens":128,
    "completion_tokens":256,
    "total_tokens":384
  }'
```

## 接口返回示例（POST /events）

### 1) 首次成功（accepted）

```json
{
  "accepted": true,
  "price_version": "v1",
  "currency": "USD",
  "cost": {
    "input": 1.792e-05,
    "output": 7.168e-05,
    "cache": 0.0,
    "total": 8.96e-05
  }
}
```

### 2) 重复 request_id（幂等去重）

```json
{
  "accepted": false,
  "reason": "duplicate_request_id"
}
```

### 3) 字段缺失报错（422）

当必填字段缺失（例如漏掉 `response_model`）时，FastAPI 会返回 422，例如：

```json
{
  "detail": [
    {
      "type": "missing",
      "loc": [
        "body",
        "response_model"
      ],
      "msg": "Field required",
      "input": {
        "schema_version": "v1",
        "event_type": "llm_request_completed"
      }
    }
  ]
}
```

## 快速压测/联调脚本

`scripts/mock_f5_log_sender.py` 用于向 `/events` 持续注入模拟 F5 结构化日志，便于联调 Prometheus / Grafana。

### 能力概览

- **持续运行**：`--run-forever`，直到 `Ctrl+C` 停止
- **目标速率控制**：`--rate`（req/s）
- **多模型随机分布**：`--models`（支持权重）
- **Tokens 范围可调**：`--prompt-range`、`--completion-range`
- **状态码分布可调**：`--status-weights`
- **成员池可配置**：`--members`
- **进度输出**：每隔 `--report-interval` 秒打印发送量、平均 RPS、错误统计
- **结束汇总**：输出状态码分布、模型分布，便于验证随机性

### 快速开始（批量模式）

```bash
cd adapter_service
python scripts/mock_f5_log_sender.py --url "http://127.0.0.1:8090/events" --count 200 --concurrency 10
```

### 常用场景

**持续运行（推荐 Grafana 联调）**

```bash
python scripts/mock_f5_log_sender.py \
  --url "http://127.0.0.1:8090/events" \
  --run-forever \
  --concurrency 20 \
  --rate 50 \
  --duplicate-rate 0.02 \
  --report-interval 5
```

**多模型随机分布**

```bash
python scripts/mock_f5_log_sender.py \
  --run-forever \
  --rate 80 \
  --models "deepseek-chat:20,deepseek-reasoner:15,gpt-4o:20,gpt-4.1-mini:10,qwen-max:10,claude-3-5-sonnet:10,llama-3.1-70b:15"
```

`--models` 支持 `模型:权重` 格式，未写权重时默认 `1.0`。

**放大 token 波动**

```bash
python scripts/mock_f5_log_sender.py \
  --run-forever \
  --rate 60 \
  --prompt-range "50,3000" \
  --completion-range "50,6000"
```

**自定义状态码分布**

```bash
python scripts/mock_f5_log_sender.py \
  --count 2000 \
  --concurrency 20 \
  --status-weights "200:90,429:6,500:4"
```

### 参数说明


| 参数                   | 说明                            | 默认值                            |
| -------------------- | ----------------------------- | ------------------------------ |
| `--url`              | Adapter `/events` 地址          | `http://127.0.0.1:8090/events` |
| `--count`            | 批量模式总发送条数                     | `200`                          |
| `--concurrency`      | 并发线程数                         | `10`                           |
| `--timeout`          | 单请求超时（秒）                      | `5.0`                          |
| `--duplicate-rate`   | 重复 `request_id` 比例 `[0,1]`    | `0.05`                         |
| `--seed`             | 随机种子（可复现实验）                   | `42`                           |
| `--models`           | 模型及权重，格式 `model[:weight],...` | 内置 7 个模型                       |
| `--members`          | pool member 列表，逗号分隔           | 4 个 member                     |
| `--status-weights`   | 状态码权重，如 `200:85,429:8,500:7`  | `200:85,429:8,500:7`           |
| `--prompt-range`     | 输入 tokens 范围 `min,max`        | `20,1200`                      |
| `--completion-range` | 输出 tokens 范围 `min,max`        | `20,2400`                      |
| `--rate`             | 目标速率（req/s），`0` 表示不控速         | `0`                            |
| `--run-forever`      | 持续运行，忽略 `--count` 停止条件        | 关闭                             |
| `--report-interval`  | 进度日志间隔（秒）                     | `5.0`                          |


### Grafana 联调提示

- 吞吐曲线不稳定时，可将面板 `rate(...[1m])` 改为 `rate(...[5m])`
- 脚本停止后速率曲线回到 0 属正常（Counter 不再增长）
- Dashboard 变量先选 `All`，再逐步加筛选

更多示例见：`scripts/mock_f5_log_sender_usage.md`。