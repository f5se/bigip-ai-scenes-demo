import { useEffect, useState } from "react";
import { fetchObservabilityConfig } from "@/api/client";

export const DEFAULT_GRAFANA_BASE_URL = "http://localhost:3001";
export const GRAFANA_OPEN_PATH = "/api/grafana/open";

export function normalizeGrafanaBaseUrl(baseUrl: string = DEFAULT_GRAFANA_BASE_URL): string {
  return baseUrl.replace(/\/$/, "");
}

export function getRuntimeGrafanaBaseUrl(): string {
  const injected = window.__LLM_DEMO_RUNTIME__?.grafana_url?.trim();
  if (injected) {
    return normalizeGrafanaBaseUrl(injected);
  }
  return DEFAULT_GRAFANA_BASE_URL;
}

export function useGrafanaConfig(): { openUrl: string; baseUrl: string } {
  const runtimeBase = getRuntimeGrafanaBaseUrl();
  const [baseUrl, setBaseUrl] = useState(runtimeBase);

  useEffect(() => {
    if (runtimeBase !== DEFAULT_GRAFANA_BASE_URL) {
      setBaseUrl(runtimeBase);
      return;
    }
    fetchObservabilityConfig()
      .then((cfg) => setBaseUrl(normalizeGrafanaBaseUrl(cfg.grafana_url)))
      .catch(() => {
        /* keep default */
      });
  }, [runtimeBase]);

  return {
    baseUrl,
    openUrl: GRAFANA_OPEN_PATH,
  };
}
