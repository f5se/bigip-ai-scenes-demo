/// <reference types="vite/client" />

interface LlmDemoRuntimeConfig {
  grafana_url?: string;
  grafana_auto_login?: boolean;
}

interface Window {
  __LLM_DEMO_RUNTIME__?: LlmDemoRuntimeConfig;
}
