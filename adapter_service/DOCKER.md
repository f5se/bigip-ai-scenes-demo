# Adapter Service Docker 镜像构建与运行

面向交付：仅打包 **Observability Adapter**（FastAPI + `/metrics`）。**不含** Prometheus、Grafana、测试脚本与文档。

目标平台：**linux/amd64（x86_64）**。本地若是 macOS ARM，请到 x86 Linux 构建机编译，或用 `buildx` 交叉构建。

---

## 镜像内包含什么

| 包含 | 不包含 |
|------|--------|
| `main.py` / `mcp_events.py` / `mcp_metrics.py` | `scripts/` 压测与 mock 脚本 |
| `pricing_rules.json` | `README.md`、模板 md、checklist |
| `requirements.txt` 依赖 | `prometheus.yaml`、Grafana、compose 中的 Prom/Grafana |

由 `.dockerignore` 白名单控制，构建上下文再大也不会把无关文件打进镜像。

---

## 1. 构建机准备（x86 Linux，需走代理）

### 1.1 Docker daemon 代理（拉基础镜像）

在构建机配置，使 `docker pull` 能走代理访问 Docker Hub / 镜像源：

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf >/dev/null <<'EOF'
[Service]
Environment="HTTP_PROXY=http://PROXY_HOST:PROXY_PORT"
Environment="HTTPS_PROXY=http://PROXY_HOST:PROXY_PORT"
Environment="NO_PROXY=localhost,127.0.0.1,.local"
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
docker info | grep -i proxy
```

把 `PROXY_HOST:PROXY_PORT` 换成实际代理；若代理要账号密码：`http://user:pass@host:port`。

> 若公司提供内网镜像仓库（Harbor / 私有 registry），也可改 `FROM` 或配置 `registry-mirrors`，不一定必须直连 Docker Hub。

### 1.2 构建时 pip 代理（装 Python 依赖）

`pip install` 发生在 **Dockerfile 的 RUN 层**，通常还要再传 `build-arg`（daemon 代理不一定自动进 build 容器）：

```bash
export HTTP_PROXY=http://PROXY_HOST:PROXY_PORT
export HTTPS_PROXY=http://PROXY_HOST:PROXY_PORT
export NO_PROXY=localhost,127.0.0.1
# 可选：国内 PyPI 镜像，减轻外网压力
# export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
# export PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn
```

---

## 2. 在 x86 机器上编译镜像

把本仓库（至少 `adapter_service/`）拷到构建机后：

```bash
cd adapter_service

docker build \
  --platform linux/amd64 \
  --build-arg HTTP_PROXY="${HTTP_PROXY}" \
  --build-arg HTTPS_PROXY="${HTTPS_PROXY}" \
  --build-arg http_proxy="${HTTP_PROXY}" \
  --build-arg https_proxy="${HTTPS_PROXY}" \
  --build-arg NO_PROXY="${NO_PROXY}" \
  --build-arg no_proxy="${NO_PROXY}" \
  ${PIP_INDEX_URL:+--build-arg PIP_INDEX_URL="$PIP_INDEX_URL"} \
  ${PIP_TRUSTED_HOST:+--build-arg PIP_TRUSTED_HOST="$PIP_TRUSTED_HOST"} \
  -t llm-observability-adapter:1.0.0 \
  .
```

或使用 compose（同样在 `adapter_service/`）：

```bash
docker compose -f docker-compose.adapter.yaml build
```

验证架构：

```bash
docker image inspect llm-observability-adapter:1.0.0 --format '{{.Architecture}}'
# 期望: amd64
```

### 导出交付包（离线发给客户）

```bash
docker save llm-observability-adapter:1.0.0 | gzip > llm-observability-adapter-1.0.0-amd64.tar.gz
# 客户侧:
# gunzip -c llm-observability-adapter-1.0.0-amd64.tar.gz | docker load
```

---

## 3. 从 macOS ARM 交叉构建（可选）

本机是 Apple Silicon 时，可用 buildx 产出 amd64 镜像（构建机仍需能通过代理拉基础镜像）：

```bash
cd adapter_service

docker buildx create --name adapter-builder --use 2>/dev/null || docker buildx use adapter-builder

docker buildx build \
  --platform linux/amd64 \
  --build-arg HTTP_PROXY="${HTTP_PROXY}" \
  --build-arg HTTPS_PROXY="${HTTPS_PROXY}" \
  --build-arg http_proxy="${HTTP_PROXY}" \
  --build-arg https_proxy="${HTTPS_PROXY}" \
  --build-arg NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}" \
  -t llm-observability-adapter:1.0.0 \
  --load \
  .
```

macOS Docker Desktop 也需在 **Settings → Resources → Proxies**（或 daemon.json）配置代理。交叉构建偏慢，**交付建议仍以 x86 Linux 原生构建为准**。

---

## 4. 运行（日志轮转，避免占满磁盘）

Adapter 默认关闭 uvicorn access log（减少 Prometheus 抓取刷屏）。容器 stdout/stderr 仍由 Docker `json-file` 收集，**务必限制单文件大小与保留个数**。

### 方式 A：`docker run`

```bash
docker run -d \
  --name llm-observability-adapter \
  --restart unless-stopped \
  -p 8090:8090 \
  -e ADAPTER_DEDUP_TTL_SECONDS=300 \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  llm-observability-adapter:1.0.0
```

挂载自定义价格规则（可选）：

```bash
docker run -d \
  --name llm-observability-adapter \
  --restart unless-stopped \
  -p 8090:8090 \
  -v /path/to/pricing_rules.json:/app/pricing_rules.json:ro \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  llm-observability-adapter:1.0.0
```

### 方式 B：compose（已内置 logging 限制）

```bash
cd adapter_service
docker compose -f docker-compose.adapter.yaml up -d
curl -sS http://127.0.0.1:8090/health
```

### 全局默认（推荐在交付主机配置一次）

`/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

然后 `sudo systemctl restart docker`。这样即使忘记在 `run` 里写 `--log-opt`，也不会无限涨日志。

### 调试日志

生产请保持关闭。联调时可：

```bash
docker run ... -e ADAPTER_EVENT_DEBUG=1 -e ADAPTER_MCP_EVENT_DEBUG=1 ...
```

仍受 `max-size` / `max-file` 约束；调试结束请关掉并重建/重启容器。

---

## 5. 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `ADAPTER_PRICING_RULES_PATH` | 价格规则路径 | `/app/pricing_rules.json` |
| `ADAPTER_DEDUP_TTL_SECONDS` | `request_id` / MCP `trace_id` 去重 TTL | `300` |
| `ADAPTER_EVENT_DEBUG` | 打印 `POST /events` body | 关 |
| `ADAPTER_MCP_EVENT_DEBUG` | 打印 MCP 事件 body | 关 |
| `PORT` | 监听端口（容器内） | `8090` |

对外端口：`8090`（HTTP：`/events`、`/api/mcp-events`、`/metrics`、`/health`）。

Prometheus / Grafana 在**客户现有监控系统**中配置 scrape `adapter:8090/metrics` 即可，本镜像不捆绑。

---

## 6. 快速自检

```bash
curl -sS http://127.0.0.1:8090/health
curl -sS http://127.0.0.1:8090/metrics | head
docker logs --tail 50 llm-observability-adapter
```
