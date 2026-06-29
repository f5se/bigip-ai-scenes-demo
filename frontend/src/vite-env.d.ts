/// <reference types="vite/client" />

interface LlmDemoRuntimeConfig {
  grafana_url?: string;
}

interface Window {
  __LLM_DEMO_RUNTIME__?: LlmDemoRuntimeConfig;
}
