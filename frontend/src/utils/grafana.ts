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

export function useGrafanaDashboardUrl(): string {
  const [url, setUrl] = useState(() => buildGrafanaDashboardUrl());

  useEffect(() => {
    fetchObservabilityConfig()
      .then((cfg) => setUrl(buildGrafanaDashboardUrl(cfg.grafana_url)))
      .catch(() => {
        /* keep default */
      });
  }, []);

  return url;
}
