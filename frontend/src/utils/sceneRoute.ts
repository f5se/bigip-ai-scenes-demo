import { scenes } from "@/scenes/manifest";

export type SceneRouteInfo = {
  path: string;
  scene_id: string;
  sub_feature_id: string | null;
};

const EXTRA: SceneRouteInfo[] = [
  { path: "/", scene_id: "home", sub_feature_id: null },
  { path: "/admin/usage", scene_id: "admin", sub_feature_id: "usage" },
];

function normalizePath(pathname: string): string {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (path === "/scene/traffic-mgmt/mcp-tools-insight" || path === "/scene/traffic-mgmt/mcp-gateway") {
    return "/scene/observability/mcp-tools-insight";
  }
  return path || "/";
}

export function resolveSceneRoute(pathname: string): SceneRouteInfo {
  const path = normalizePath(pathname);
  const extra = EXTRA.find((item) => item.path === path);
  if (extra) return extra;

  for (const scene of scenes) {
    if (scene.path === path) {
      return { path, scene_id: scene.id, sub_feature_id: null };
    }
    for (const sf of scene.subFeatures || []) {
      if (sf.path === path) {
        return { path, scene_id: scene.id, sub_feature_id: sf.id };
      }
    }
  }
  return { path, scene_id: "unknown", sub_feature_id: null };
}
