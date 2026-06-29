import { useEffect, useState } from "react";
import { fetchObservabilityConfig } from "@/api/client";

export const DEFAULT_GRAFANA_BASE_URL = "http://localhost:3001";

const GRAFANA_DASHBOARD_PATH =
  "/d/adz84xj/f5-big-ip-llm?orgId=1&from=now-5m&to=now&timezone=browser&var-model=$__all&var-pool=$__all&var-member=$__all&var-client_ip=$__all&var-price_version=v1&refresh=10s";

export function buildGrafanaDashboardUrl(
  baseUrl: string = DEFAULT_GRAFANA_BASE_URL
): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${GRAFANA_DASHBOARD_PATH}`;
}

export function getRuntimeGrafanaBaseUrl(): string {
  const injected = window.__LLM_DEMO_RUNTIME__?.grafana_url?.trim();
  if (injected) {
    return injected.replace(/\/$/, "");
  }
  return DEFAULT_GRAFANA_BASE_URL;
}

export function useGrafanaConfig(): { dashboardUrl: string; baseUrl: string } {
  const runtimeBase = getRuntimeGrafanaBaseUrl();
  const [baseUrl, setBaseUrl] = useState(runtimeBase);

  useEffect(() => {
    if (runtimeBase !== DEFAULT_GRAFANA_BASE_URL) {
      setBaseUrl(runtimeBase);
      return;
    }
    fetchObservabilityConfig()
      .then((cfg) => setBaseUrl(cfg.grafana_url.replace(/\/$/, "")))
      .catch(() => {
        /* keep default */
      });
  }, [runtimeBase]);

  return {
    baseUrl,
    dashboardUrl: buildGrafanaDashboardUrl(baseUrl),
  };
}

/** @deprecated Use useGrafanaConfig().dashboardUrl */
export function useGrafanaDashboardUrl(): string {
  return useGrafanaConfig().dashboardUrl;
}
