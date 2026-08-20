import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchMcpWireExamples, type McpWireExamples } from "@/api/client";

type Props = {
  i18nPrefix: string;
  protocolVersionLabel?: string;
};

function CodeBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-700/70 bg-slate-950/80">
      <div className="border-b border-slate-800 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <pre className="max-h-56 overflow-auto p-2 text-[11px] leading-relaxed text-slate-200">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (value == null) return "(empty body)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function McpProtocolDiffPanel({ i18nPrefix, protocolVersionLabel }: Props) {
  const { t } = useTranslation();
  const [examples, setExamples] = useState<McpWireExamples | null>(null);

  useEffect(() => {
    fetchMcpWireExamples()
      .then(setExamples)
      .catch(() => setExamples(null));
  }, []);

  const links = examples?.spec_links;

  return (
    <details className="rounded-lg border border-violet-600/40 bg-violet-950/20 text-xs text-slate-300">
      <summary className="cursor-pointer list-none px-3 py-2 font-medium text-violet-300">
        <span>{t(`${i18nPrefix}.protocolDiff.title`)}</span>
        {protocolVersionLabel ? <span className="ml-1 text-[11px] text-violet-300/80">· {protocolVersionLabel}</span> : null}
      </summary>
      <div className="space-y-3 border-t border-violet-700/30 p-3">
      <ul className="list-disc space-y-1 pl-4">
        <li>{t(`${i18nPrefix}.protocolDiff.0`)}</li>
        <li>{t(`${i18nPrefix}.protocolDiff.1`)}</li>
        <li>{t(`${i18nPrefix}.protocolDiff.2`)}</li>
      </ul>

      {examples ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="font-medium text-cyan-300">{t(`${i18nPrefix}.protocolDiff.legacyCol`)}</p>
            <CodeBlock title="HTTP" text={examples.legacy_initialize.http} />
            <CodeBlock title="JSON-RPC initialize" text={formatJson(examples.legacy_initialize.json)} />
            <CodeBlock title="HTTP tools/call" text={examples.legacy_tools_call.http} />
            <CodeBlock title="JSON-RPC tools/call" text={formatJson(examples.legacy_tools_call.json)} />
          </div>
          <div className="space-y-2">
            <p className="font-medium text-emerald-300">{t(`${i18nPrefix}.protocolDiff.v2026Col`)}</p>
            <CodeBlock title="HTTP" text={examples.v2026_discover.http} />
            <CodeBlock title="JSON-RPC server/discover" text={formatJson(examples.v2026_discover.json)} />
            <CodeBlock title="HTTP tools/call" text={examples.v2026_tools_call.http} />
            <CodeBlock title="JSON-RPC tools/call" text={formatJson(examples.v2026_tools_call.json)} />
          </div>
        </div>
      ) : null}

      {links ? (
        <p className="space-x-3 text-[11px] text-slate-400">
          <a className="text-cyan-300 underline" href={links.spec} target="_blank" rel="noreferrer">
            {t(`${i18nPrefix}.protocolDiff.specLink`)}
          </a>
          <a className="text-cyan-300 underline" href={links.blog} target="_blank" rel="noreferrer">
            {t(`${i18nPrefix}.protocolDiff.blogLink`)}
          </a>
          <a className="text-cyan-300 underline" href={links.mrtr} target="_blank" rel="noreferrer">
            {t(`${i18nPrefix}.protocolDiff.mrtrLink`)}
          </a>
        </p>
      ) : null}
      </div>
    </details>
  );
}
