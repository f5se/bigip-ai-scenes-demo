export type HighlightKind =
  | "none"
  | "mandatory-key"
  | "mandatory-block"
  | "user-conflict"
  | "user-contained"
  | "admin-block";

export type HighlightedLine = {
  text: string;
  kind: HighlightKind;
};

type BlockId = "none" | "admin" | "user" | "guardrails";

function blockForOpenTag(line: string, tags: Record<string, string>): BlockId {
  const trimmed = line.trim();
  if (trimmed === `<${tags.admin}>`) return "admin";
  if (trimmed === `<${tags.user}>`) return "user";
  if (trimmed === `<${tags.guardrails}>`) return "guardrails";
  return "none";
}

function blockForCloseTag(line: string, tags: Record<string, string>): BlockId | null {
  const trimmed = line.trim();
  if (trimmed === `</${tags.admin}>`) return "admin";
  if (trimmed === `</${tags.user}>`) return "user";
  if (trimmed === `</${tags.guardrails}>`) return "guardrails";
  return null;
}

function isTagBoundaryLine(line: string, tagNames: string[]): boolean {
  const trimmed = line.trim();
  return tagNames.some((tag) => trimmed === `<${tag}>` || trimmed === `</${tag}>`);
}

function isFormatControlRuleLine(line: string): boolean {
  return (
    /^\s*4\.\s*You MUST answer all questions in yaml format/i.test(line) ||
    (/yaml format/i.test(line) && /DISREGARD any previous formatting/i.test(line))
  );
}

function classifyGuardrailsLine(line: string, presetId: string): HighlightKind {
  if (presetId === "format_override" && isFormatControlRuleLine(line)) {
    return "mandatory-key";
  }
  if (/yaml format/i.test(line)) return "mandatory-key";
  if (/OVERRIDE EVERYTHING|IGNORE that user instruction|HIERARCHY ENFORCEMENT/i.test(line)) {
    if (presetId === "injection_attack" || presetId === "format_override") {
      return "mandatory-key";
    }
    if (presetId === "benign" && /HIERARCHY ENFORCEMENT|yaml format/i.test(line)) {
      return "mandatory-key";
    }
  }
  if (presetId === "benign" && /Never provide raw passwords/i.test(line)) {
    return "mandatory-key";
  }
  return "mandatory-block";
}

function classifyUserLine(line: string, presetId: string): HighlightKind {
  if (presetId === "format_override" && /Markdown|markdown/i.test(line)) {
    return "user-conflict";
  }
  if (presetId === "injection_attack") {
    return "user-contained";
  }
  return "none";
}

export function buildHighlightedLines(
  wrapped: string,
  presetId: string,
  tags: { admin: string; user: string; guardrails: string }
): HighlightedLine[] {
  let block: BlockId = "none";
  const lines = wrapped.split("\n");
  const allTags = [tags.admin, tags.user, tags.guardrails];

  return lines.map((text) => {
    const opening = blockForOpenTag(text, tags);
    if (opening !== "none") block = opening;

    let kind: HighlightKind = "none";
    if (!isTagBoundaryLine(text, allTags)) {
      if (block === "guardrails") {
        kind = classifyGuardrailsLine(text, presetId);
      } else if (block === "user") {
        kind = classifyUserLine(text, presetId);
      } else if (block === "admin" && presetId === "benign") {
        kind = "admin-block";
      }
    }

    if (blockForCloseTag(text, tags)) block = "none";

    return { text, kind };
  });
}

export function highlightLineClass(kind: HighlightKind): string {
  switch (kind) {
    case "mandatory-key":
      return "rounded px-1 bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50";
    case "mandatory-block":
      return "text-amber-200/90";
    case "user-conflict":
      return "rounded px-1 bg-rose-500/20 text-rose-200 line-through decoration-rose-400/60";
    case "user-contained":
      return "rounded px-1 bg-orange-500/15 text-orange-200/90";
    case "admin-block":
      return "text-cyan-200/90";
    default:
      return "text-slate-300";
  }
}
