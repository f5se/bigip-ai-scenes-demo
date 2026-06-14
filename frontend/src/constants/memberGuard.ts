/** Sub-scenes that depend on pool_deepseek-chat ubuntu-ai:8005 being enabled. */
export const MEMBER_GUARD_PATHS = [
  "/scene/llm-router/model-routing",
  "/scene/llm-router/context-routing",
  "/scene/llm-router/agent-routing",
  "/scene/traffic-mgmt/tblb",
] as const;

export function shouldShowMemberGuard(pathname: string): boolean {
  return (MEMBER_GUARD_PATHS as readonly string[]).includes(pathname);
}
