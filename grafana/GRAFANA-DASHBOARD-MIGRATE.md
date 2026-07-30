# Grafana 看板跨环境迁移指南

将 **172.16.40.122** 演示环境中的 Grafana 看板以 JSON 导出，并在另一套环境（客户侧 / 新机）导入部署。

| 项目 | 源环境（示例） | 说明 |
|------|----------------|------|
| Grafana | `http://172.16.40.122:3001` | 账号密码以现场为准（不要写入文档） |
| 本仓库已存 JSON | `grafana/dashboards/*.json` | 可直接带到新环境；若源环境有更新，请重新导出覆盖 |
| 源环境 Prometheus 数据源 UID | `dfp3flzrl70n4d` | 导出的 JSON 面板里会写死该 UID；新环境需对齐或批量替换 |

当前相关看板（UID / 文件名）：

| 看板 | Dashboard UID | 仓库文件 |
|------|---------------|----------|
| F5 BIG-IP LLM Observability | `f5-bigip-llm-v2` | `grafana/dashboards/f5-bigip-llm-v2.json` |
| LLM Subagent Routing | `llm-subagent-routing-v2` | `grafana/dashboards/llm-subagent-routing-v2.json` |
| MCP Tools Insight | `mcp-tools-insight` | `grafana/dashboards/mcp-tools-insight.json` |

---

## 1. 从 172.16.40.122 导出 JSON

### 方法 A：Grafana UI（推荐，无需脚本）

1. 浏览器打开 `http://172.16.40.122:3001` 并登录。
2. 左侧 **☰** → **Dashboards**，打开目标看板。
3. 右上角 **Share**（分享图标）→ **Export**。
4. 建议勾选：
   - **Export for sharing externally**（若有）：去掉本机仅相关的元数据，便于带到别的 Grafana。
5. 点击 **Save to file**，得到 `*.json`。
6. 对每个看板重复上述步骤，或将文件保存到本仓库 `grafana/dashboards/` 同名覆盖，便于版本管理。

> Grafana 新版菜单可能是：看板右上角 **⋯** → **Share** → **Export**，或 **Export** → **Download file**。

### 方法 B：HTTP API（适合批量）

在能访问源 Grafana 的机器上执行（按现场改密码与看板 UID）：

```bash
export GRAFANA_URL="http://172.16.40.122:3001"
export GRAFANA_USER="<GRAFANA_USERNAME>"
export GRAFANA_PASSWORD="YOUR_PASSWORD"

# 按看板 UID 导出完整 dashboard JSON
for uid in f5-bigip-llm-v2 llm-subagent-routing-v2 mcp-tools-insight; do
  curl -sS -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
    "${GRAFANA_URL}/api/dashboards/uid/${uid}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); json.dump(d['dashboard'], sys.stdout, ensure_ascii=False, indent=2)" \
    > "${uid}.json"
  echo "wrote ${uid}.json"
done
```

API 返回的是 `{ "dashboard": {...}, "meta": {...} }`；导入时一般使用其中的 **`dashboard` 对象**（上面脚本已抽出）。

### 导出后建议检查

打开 JSON，确认：

- 存在 `"uid": "f5-bigip-llm-v2"`（或对应看板 UID）
- 多处出现 `"type": "prometheus"` 与 `"uid": "dfp3flzrl70n4d"`（源环境数据源 UID）

若 UID 与上表不一致，以你导出文件中的实际值为准，后续替换步骤使用该值。

---

## 2. 新环境：先配置 Prometheus 数据源

看板导入前，新 Grafana **必须已有可用的 Prometheus 数据源**，且能查到 Adapter 指标。

### 2.1 添加数据源

1. 打开新环境 Grafana（同机 compose 默认多为 `http://<host>:3001`）。
2. **☰** → **Connections** → **Data sources** → **Add data source** → **Prometheus**。
3. 填写：

| 字段 | 同机 docker-compose.stack | Grafana / Prometheus 都在宿主机 | Prometheus 在别的机器 |
|------|---------------------------|----------------------------------|------------------------|
| **Name** | `Prometheus` | `Prometheus` | `Prometheus` |
| **URL** | `http://prometheus:9090` | `http://127.0.0.1:9090` | `http://<prom-ip>:9090` |

4. **Save & test**，应显示成功。

### 2.2 确认能刮到 Adapter

在新环境 Prometheus UI（默认 `:9090`）→ **Status** → **Targets**，确认 `llm-observability-adapter` 为 **UP**。

或：

```bash
curl -sS "http://<prometheus-host>:9090/api/v1/query?query=up" | head
curl -sS "http://<adapter-host>:8090/metrics" | grep -E '^llm_requests_total' | head
```

### 2.3 记下新数据源的 UID（后面改 JSON 会用到）

1. **Data sources** → 点开刚建的 Prometheus。
2. 浏览器地址栏通常类似：  
   `.../datasources/edit/xxxxxxxx`  
   其中 `xxxxxxxx` 即为 **UID**；或在数据源详情页查看 **UID** 字段。
3. 也可用 API：

```bash
curl -sS -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" "http://<new-grafana>:3001/api/datasources" \
  | python3 -m json.tool
# 找到 type=prometheus 的条目中的 "uid"
```

下文用 `NEW_DS_UID` 表示该值。

---

## 3. 新环境：导入看板 JSON

### 方法 A：Grafana UI 导入（推荐）

1. **☰** → **Dashboards** → **New** → **Import**。
2. **Upload dashboard JSON file**，选择导出的 `*.json`；或把 JSON 粘贴到文本框。
3. 点击 **Load**。
4. 在导入页：
   - **Name** / **Folder**：按需修改。
   - **Prometheus**（数据源下拉）：**选择新环境的 Prometheus 数据源**。  
     多数 Grafana 版本会在此处提供「映射数据源」；选好后会把面板里的旧 UID 映射到新数据源。
5. **Import**。
6. 打开看板，时间范围选 **Last 15 minutes**，确认面板有数据（需已有流量或 mock 注入）。

对三个 JSON 文件各导入一次。

> 若导入页**没有**数据源下拉、导入后全是 No data，见下一节「修改数据源 UID」。

### 方法 B：HTTP API 导入

```bash
export GRAFANA_URL="http://NEW_GRAFANA_HOST:3001"
export GRAFANA_USER="<GRAFANA_USERNAME>"
export GRAFANA_PASSWORD="YOUR_PASSWORD"

# 先按第 4 节把 JSON 里的数据源 UID 改成 NEW_DS_UID，再执行：
python3 <<'PY'
import json, os, urllib.request, base64

url = os.environ["GRAFANA_URL"].rstrip("/") + "/api/dashboards/db"
auth = base64.b64encode(
    f'{os.environ["GRAFANA_USER"]}:{os.environ["GRAFANA_PASSWORD"]}'.encode()
).decode()

for path in [
    "f5-bigip-llm-v2.json",
    "llm-subagent-routing-v2.json",
    "mcp-tools-insight.json",
]:
    with open(path, encoding="utf-8") as f:
        dash = json.load(f)
    # API 导出若带外层 meta，取 dashboard；UI 导出通常已是 dashboard 本体
    if "dashboard" in dash and "panels" not in dash:
        dash = dash["dashboard"]
    dash["id"] = None  # 强制新建/按 uid 更新，避免与源环境内部 id 冲突
    body = json.dumps({"dashboard": dash, "overwrite": True, "folderId": 0}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {auth}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        print(path, resp.status, resp.read()[:200])
PY
```

---

## 4. 修改数据源 UID（导入后 No data / 未映射成功时）

导出的 JSON 里，变量与面板大量引用源环境 UID，例如：

```json
"datasource": {
  "type": "prometheus",
  "uid": "dfp3flzrl70n4d"
}
```

新环境数据源 UID 不同时，需要二选一：**导入时在 UI 映射**，或 **改 JSON / 改新数据源 UID**。

### 方案 A：导入时在 UI 选择新数据源（优先）

见 §3 方法 A 第 4 步。成功后一般无需改文件。

### 方案 B：批量替换 JSON 中的旧 UID（适合离线改包）

将源 UID `dfp3flzrl70n4d` 全部换成新环境的 `NEW_DS_UID`：

```bash
OLD_UID="dfp3flzrl70n4d"
NEW_UID="NEW_DS_UID"   # 换成 §2.3 查到的值

for f in f5-bigip-llm-v2.json llm-subagent-routing-v2.json mcp-tools-insight.json; do
  # macOS:
  sed -i '' "s/${OLD_UID}/${NEW_UID}/g" "$f"
  # Linux:
  # sed -i "s/${OLD_UID}/${NEW_UID}/g" "$f"
done

# 确认已无旧 UID
grep -R "dfp3flzrl70n4d" . || echo "OK: old uid cleared"
```

用 Python 更稳妥（避免误伤其它字段）：

```bash
OLD_UID="dfp3flzrl70n4d"
NEW_UID="NEW_DS_UID"
python3 <<PY
import json, pathlib
old, new = "${OLD_UID}", "${NEW_UID}"

def walk(o):
    if isinstance(o, dict):
        if o.get("type") == "prometheus" and o.get("uid") == old:
            o["uid"] = new
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for i in o:
            walk(i)

for p in pathlib.Path(".").glob("*.json"):
    data = json.loads(p.read_text(encoding="utf-8"))
    walk(data)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("updated", p)
PY
```

改完后再按 §3 导入（或 `overwrite: true` 覆盖）。

### 方案 C：把新环境数据源 UID 改成与源环境一致

若希望**不改 JSON**、直接使用仓库里现成的 `grafana/dashboards/*.json`：

1. 删除新环境刚建的 Prometheus 数据源（若尚无其它看板依赖）。
2. 重新 **Add data source** → Prometheus。
3. 在创建页找到 **UID**（部分版本在 **Settings** / JSON 模型中可编辑），设为：

   `dfp3flzrl70n4d`

4. URL 仍按新环境填写（如 `http://prometheus:9090`），**Save & test**。
5. 再导入未改过的 JSON。

> 注意：UID 全局唯一；若该 UID 已被占用会创建失败，此时改用方案 A/B。

### 方案 D：导入后在看板内改数据源（面板少时）

1. 打开看板 → **Dashboard settings** → **Variables**，把变量用的 datasource 改成新 Prometheus。
2. 各面板 **Edit** → 查询区数据源下拉改为新 Prometheus → Apply → Save。

面板多时不推荐，优先 A/B/C。

---

## 5. 导入后自检

1. Prometheus Targets：`adapter` / `llm-observability-adapter` 为 **UP**。
2. Grafana Explore：数据源选新 Prometheus，查询：

   ```promql
   sum(rate(llm_requests_total[1m]))
   ```

   有序列或至少不报 datasource 错误。
3. 打开导入的看板：顶部变量（`model` / `pool` / `agent` 等）能拉出标签；面板非持续 No data。
4. 若变量下拉为空：多半是还没有对应标签的指标（先打流量，或确认 scrape 的是正确 Adapter）。

---

## 6. 与本仓库交付物的关系

| 交付物 | 用途 |
|--------|------|
| `docker-compose.stack.yaml` | 同机拉起 Adapter + Prometheus + Grafana（**不**预置 Grafana 数据源） |
| `grafana/dashboards/*.json` | 可直接作为导入文件；UID 默认绑定 `dfp3flzrl70n4d` |
| 本文档 | 从 `172.16.40.122` 导出 → 新环境建数据源 → 导入 → 必要时改 UID |

推荐流程（客户新环境）：

1. `docker compose -f docker-compose.stack.yaml up -d`（或客户自有 Prom/Grafana）
2. 按 §2 手动添加 Prometheus 数据源
3. 按 §3 导入 `grafana/dashboards/*.json`（导入页映射数据源，或按 §4 处理 UID）
4. 按 §5 自检
