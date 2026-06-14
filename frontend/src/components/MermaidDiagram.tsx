import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import { useTranslation } from "react-i18next";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
});

type Props = {
  chart: string;
  className?: string;
};

export function MermaidDiagram({ chart, className = "" }: Props) {
  const { t } = useTranslation();
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!containerRef.current) return;
      try {
        const { svg } = await mermaid.render(`mmd-${id}`, chart);
        if (!cancelled) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          containerRef.current.innerHTML = "";
        }
      }
    };
    render();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="flex min-h-[200px] items-center justify-center overflow-x-auto rounded-lg bg-slate-950/50 p-4 [&_svg]:max-w-full"
      />
      {error && (
        <p className="mt-2 text-sm text-red-400">Diagram error: {error}</p>
      )}
      <button
        type="button"
        className="mt-2 text-xs text-cyan-500 hover:text-cyan-400"
        onClick={() => setShowSource((s) => !s)}
      >
        {showSource ? t("app.hideSource") : t("app.viewSource")}
      </button>
      {showSource && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
          {chart}
        </pre>
      )}
    </div>
  );
}
