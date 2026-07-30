import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ObsTrafficSimProvider } from "@/context/ObsTrafficSimContext";
import { HomePage } from "@/pages/HomePage";
import { SceneOverviewPage } from "@/pages/SceneOverviewPage";
import { ModelRoutingPage } from "@/pages/ModelRoutingPage";
import { ContextRoutingPage } from "@/pages/ContextRoutingPage";
import { AgentRoutingPage } from "@/pages/AgentRoutingPage";
import { RetryFallbackPage } from "@/pages/RetryFallbackPage";
import { ObservabilitySubScenePage } from "@/pages/ObservabilitySubScenePage";
import { TblbPage } from "@/pages/TblbPage";
import { GuardrailsPage } from "@/pages/GuardrailsPage";
import { ModelAllowlistPage } from "@/pages/ModelAllowlistPage";
import { MaxTokensPage } from "@/pages/MaxTokensPage";
import { McpToolsInsightPage } from "@/pages/McpToolsInsightPage";
import { McpToolsControlPage } from "@/pages/McpToolsControlPage";
import { SystemPromptPage } from "@/pages/SystemPromptPage";

export default function App() {
  return (
    <ObsTrafficSimProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />

            <Route path="/scene/llm-router" element={<SceneOverviewPage sceneId="llm-router" />} />
            <Route path="/scene/llm-router/model-routing" element={<ModelRoutingPage />} />
            <Route path="/scene/llm-router/context-routing" element={<ContextRoutingPage />} />
            <Route path="/scene/llm-router/agent-routing" element={<AgentRoutingPage />} />
            <Route
              path="/scene/llm-router/retry-fallback"
              element={<RetryFallbackPage />}
            />

            <Route path="/scene/observability" element={<SceneOverviewPage sceneId="observability" />} />
            <Route
              path="/scene/observability/tokens"
              element={<ObservabilitySubScenePage pageKey="obsTokens" />}
            />
            <Route
              path="/scene/observability/metrics"
              element={<ObservabilitySubScenePage pageKey="obsMetrics" />}
            />
            <Route
              path="/scene/observability/mcp-tools-insight"
              element={<McpToolsInsightPage />}
            />
            <Route
              path="/scene/traffic-mgmt/mcp-tools-insight"
              element={<Navigate to="/scene/observability/mcp-tools-insight" replace />}
            />

            <Route path="/scene/traffic-mgmt" element={<SceneOverviewPage sceneId="traffic-mgmt" />} />
            <Route path="/scene/traffic-mgmt/tblb" element={<TblbPage />} />
            <Route
              path="/scene/traffic-mgmt/model-allowlist"
              element={<ModelAllowlistPage />}
            />
            <Route
              path="/scene/traffic-mgmt/max-tokens-limit"
              element={<MaxTokensPage />}
            />
            <Route
              path="/scene/traffic-mgmt/mcp-tools-control"
              element={<McpToolsControlPage />}
            />
            <Route
              path="/scene/traffic-mgmt/mcp-gateway"
              element={<Navigate to="/scene/observability/mcp-tools-insight" replace />}
            />

            <Route path="/scene/security" element={<SceneOverviewPage sceneId="security" />} />
            <Route path="/scene/security/system-prompt" element={<SystemPromptPage />} />
            <Route path="/scene/security/guardrails" element={<GuardrailsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ObsTrafficSimProvider>
  );
}
