import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { postDemoUsageEvent, postDemoUsageBeacon } from "@/api/client";
import { resolveSceneRoute } from "@/utils/sceneRoute";

const HEARTBEAT_MS = 45_000;

/**
 * Route-level scene usage tracking: enter / leave / heartbeat / unload beacon.
 */
export function useDemoUsageTracking(enabled: boolean) {
  const location = useLocation();
  const enterAtRef = useRef<number>(0);
  const routeRef = useRef(resolveSceneRoute(location.pathname));
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;

    const prev = routeRef.current;
    const next = resolveSceneRoute(location.pathname);
    const now = Date.now();

    if (enterAtRef.current > 0 && prev.path !== next.path) {
      const dwell = Math.max(0, now - enterAtRef.current);
      void postDemoUsageEvent({
        event: "scene_leave",
        path: prev.path,
        scene_id: prev.scene_id,
        sub_feature_id: prev.sub_feature_id,
        dwell_ms: dwell,
        client_ts: new Date(now).toISOString(),
      });
    }

    routeRef.current = next;
    enterAtRef.current = now;
    void postDemoUsageEvent({
      event: "scene_enter",
      path: next.path,
      scene_id: next.scene_id,
      sub_feature_id: next.sub_feature_id,
      client_ts: new Date(now).toISOString(),
    });
  }, [enabled, location.pathname]);

  useEffect(() => {
    if (!enabled) return;

    const flushLeave = () => {
      if (!enabledRef.current || enterAtRef.current <= 0) return;
      const route = routeRef.current;
      const now = Date.now();
      const dwell = Math.max(0, now - enterAtRef.current);
      postDemoUsageBeacon({
        event: "scene_leave",
        path: route.path,
        scene_id: route.scene_id,
        sub_feature_id: route.sub_feature_id,
        dwell_ms: dwell,
        client_ts: new Date(now).toISOString(),
      });
      enterAtRef.current = 0;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Keep visit open across tab switches; only pagehide finalizes leave.
        if (!enabledRef.current || enterAtRef.current <= 0) return;
        const route = routeRef.current;
        const elapsed = Math.max(0, Date.now() - enterAtRef.current);
        postDemoUsageBeacon({
          event: "scene_heartbeat",
          path: route.path,
          scene_id: route.scene_id,
          sub_feature_id: route.sub_feature_id,
          elapsed_ms: elapsed,
          client_ts: new Date().toISOString(),
        });
      }
    };

    window.addEventListener("pagehide", flushLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (!enabledRef.current || enterAtRef.current <= 0) return;
      if (document.visibilityState === "hidden") return;
      const route = routeRef.current;
      const elapsed = Math.max(0, Date.now() - enterAtRef.current);
      void postDemoUsageEvent({
        event: "scene_heartbeat",
        path: route.path,
        scene_id: route.scene_id,
        sub_feature_id: route.sub_feature_id,
        elapsed_ms: elapsed,
        client_ts: new Date().toISOString(),
      });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
