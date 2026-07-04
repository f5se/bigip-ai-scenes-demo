"""Shared Grafana dashboard builders and publish helpers."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

GRAFANA_URL = os.environ.get("GRAFANA_URL", "http://172.16.40.122:3001")
GRAFANA_USER = os.environ.get("GRAFANA_USER", "admin")
GRAFANA_PASSWORD = os.environ.get("GRAFANA_PASSWORD", "")
PROM_DS_UID = os.environ.get("GRAFANA_PROM_DS_UID", "dfp3flzrl70n4d")
UNIT_YUAN = "currencyCNY"  # Grafana 显示 ¥，与 Adapter pricing_rules currency=Yuan 一致


def _default_decimals(unit: str) -> int:
    if unit in ("percent", "percentunit"):
        return 2
    if unit == UNIT_YUAN:
        return 4
    return 0


def ds() -> dict:
    return {"type": "prometheus", "uid": PROM_DS_UID}


def prom_target(
    expr: str,
    legend: str = "",
    instant: bool = False,
    fmt: str | None = None,
) -> dict:
    target = {
        "datasource": ds(),
        "expr": expr,
        "legendFormat": legend,
        "refId": "A",
        "instant": instant,
        "range": not instant,
    }
    if fmt:
        target["format"] = fmt
    return target


def template_var(name: str, query: str, label: str) -> dict:
    return {
        "name": name,
        "type": "query",
        "datasource": ds(),
        "query": {"query": query, "refId": "A"},
        "includeAll": True,
        "allValue": ".*",
        "multi": True,
        "label": label,
        "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
    }


def row_panel(title: str, y: int) -> dict:
    return {
        "type": "row",
        "title": title,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "collapsed": False,
        "panels": [],
        "id": None,
    }


def stat_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 4,
    unit: str = "short",
    thresholds: list | None = None,
    decimals: int | None = None,
) -> dict:
    return {
        "type": "stat",
        "title": title,
        "gridPos": {"h": 4, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, instant=True)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "value",
            "graphMode": "area",
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals if decimals is not None else _default_decimals(unit),
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds
                    or [{"color": "green", "value": None}, {"color": "red", "value": 80}],
                },
            },
            "overrides": [],
        },
    }


def gauge_panel(title: str, expr: str, x: int, y: int, w: int = 4) -> dict:
    p = stat_panel(title, expr, x, y, w, unit="percent")
    p["type"] = "gauge"
    p["options"] = {
        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        "orientation": "auto",
        "showThresholdLabels": False,
        "showThresholdMarkers": True,
    }
    p["fieldConfig"]["defaults"]["min"] = 0
    p["fieldConfig"]["defaults"]["max"] = 100
    p["fieldConfig"]["defaults"]["thresholds"] = {
        "mode": "absolute",
        "steps": [
            {"color": "green", "value": None},
            {"color": "yellow", "value": 5},
            {"color": "red", "value": 15},
        ],
    }
    return p


def timeseries_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
    legend: str = "{{model}}",
    unit: str = "reqps",
    stacking: str = "none",
    decimals: int | None = None,
) -> dict:
    return {
        "type": "timeseries",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend)],
        "options": {
            "legend": {"displayMode": "table", "placement": "bottom", "calcs": ["lastNotNull", "max", "mean"]},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals if decimals is not None else _default_decimals(unit),
                "custom": {
                    "drawStyle": "line",
                    "lineInterpolation": "smooth",
                    "fillOpacity": 12,
                    "stacking": {"mode": stacking},
                },
            },
            "overrides": [],
        },
    }


def pie_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 8,
    h: int = 8,
    legend: str = "{{model}}",
    unit: str = "short",
    decimals: int | None = None,
) -> dict:
    return {
        "type": "piechart",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend, instant=True)],
        "options": {
            "legend": {"displayMode": "table", "placement": "right", "values": ["value", "percent"]},
            "pieType": "donut",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals if decimals is not None else _default_decimals(unit),
            },
            "overrides": [],
        },
    }


def bargauge_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
    legend: str = "{{model}}",
    unit: str = "short",
    decimals: int | None = None,
) -> dict:
    return {
        "type": "bargauge",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend, instant=True)],
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showUnfilled": True,
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals if decimals is not None else _default_decimals(unit),
            },
            "overrides": [],
        },
    }


def table_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 24,
    h: int = 8,
    columns: list[str] | None = None,
) -> dict:
    index = {name: idx for idx, name in enumerate(columns or [])}
    return {
        "type": "table",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, instant=True, fmt="table")],
        "options": {
            "showHeader": True,
            "sortBy": [{"displayName": "Value", "desc": True}],
            "footer": {"show": True, "reducer": ["sum"], "countRows": False},
        },
        "fieldConfig": {
            "defaults": {"custom": {"align": "auto", "filterable": True}},
            "overrides": [],
        },
        "transformations": [
            {
                "id": "organize",
                "options": {
                    "excludeByName": {"Time": True},
                    "renameByName": {"Value": "数值", "Value #A": "数值"},
                    "indexByName": index or None,
                },
            },
        ],
    }


def dashboard_shell(
    uid: str,
    title: str,
    description: str,
    tags: list[str],
    panels: list[dict],
    variables: list[dict],
    links: list[dict] | None = None,
) -> dict:
    return {
        "dashboard": {
            "id": None,
            "uid": uid,
            "title": title,
            "description": description,
            "tags": tags,
            "timezone": "browser",
            "schemaVersion": 39,
            "version": 1,
            "refresh": "10s",
            "time": {"from": "now-1h", "to": "now"},
            "graphTooltip": 1,
            "links": links or [],
            "templating": {
                "list": [
                    {
                        "name": "datasource",
                        "type": "datasource",
                        "query": "prometheus",
                        "hide": 2,
                    },
                    *variables,
                ]
            },
            "annotations": {"list": []},
            "panels": panels,
        },
        "folderId": 0,
        "overwrite": True,
    }


def publish(payload: dict, password: str) -> dict:
    import base64

    url = f"{GRAFANA_URL.rstrip('/')}/api/dashboards/db"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    token = base64.b64encode(f"{GRAFANA_USER}:{password}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise SystemExit(f"Grafana API error {exc.code}: {body}") from exc
