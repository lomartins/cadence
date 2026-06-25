import type { ClassifyResult, WorkMode } from "../shared/types.js";

interface Signal {
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
}

interface Rule {
  mode: WorkMode;
  re: RegExp;
  weight: number;
}

// Keyword rules. Order doesn't matter; weights accumulate per mode.
const RULES: Rule[] = [
  { mode: "debugging", re: /\b(debug|bug|error|fix|crash|stack ?trace|exception|fail(?:ing|s|ed)?|traceback|broken|regression)\b/i, weight: 2 },
  { mode: "writing/docs", re: /\b(write|writing|document(?:ation)?|docs?|readme|changelog|blog|guide|tutorial draft|comment(?:s)?|prose)\b/i, weight: 2 },
  { mode: "planning/architecture", re: /\b(plan|design|architect(?:ure)?|approach|strategy|structure|schema|trade-?offs?|rfc|spec|diagram|model the)\b/i, weight: 2 },
  { mode: "code review / reading", re: /\b(review|read(?:ing)?|understand|walk ?through|audit|inspect|skim|trace through|what does this)\b/i, weight: 1.5 },
  { mode: "learning/research", re: /\b(learn|research|how (?:do|to|can)|what (?:is|are)|why does|example of|investigate|look up|find out|compare)\b/i, weight: 1.5 },
  { mode: "repetitive/mechanical", re: /\b(rename|reformat|format|lint|bulk|replace all|find and replace|boilerplate|scaffold|migrate|codemod|repetitive|tedious)\b/i, weight: 2 },
  { mode: "crunch", re: /\b(ship(?:ping)?|deadline|asap|urgent|crunch|hotfix|prod(?:uction)? down|release now|emergency|right now)\b/i, weight: 2.5 },
  { mode: "break", re: /\b(break|coffee|lunch|rest|pause for|step away|decompress|breather)\b/i, weight: 2 },
  { mode: "deep-focus coding", re: /\b(implement|build|create|add|feature|refactor|function|class|component|endpoint|write (?:a|the|some) code)\b/i, weight: 1.5 },
];

function extOf(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const fp = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
    if (typeof fp === "string") {
      const m = fp.match(/\.([a-z0-9]+)$/i);
      return m?.[1]?.toLowerCase();
    }
  }
  return undefined;
}

const DOC_EXT = new Set(["md", "mdx", "rst", "txt", "adoc"]);

export function classify(sig: Signal): ClassifyResult {
  const scores = new Map<WorkMode, number>();
  const add = (m: WorkMode, w: number) => scores.set(m, (scores.get(m) ?? 0) + w);

  const prompt = sig.prompt ?? "";
  for (const r of RULES) {
    if (r.re.test(prompt)) add(r.mode, r.weight);
  }

  // tool signals
  const tool = sig.tool_name ?? "";
  if (/^(Read|Grep|Glob)$/.test(tool)) add("code review / reading", 1);
  if (/^(Edit|Write|NotebookEdit)$/.test(tool)) add("deep-focus coding", 1);
  if (tool === "Bash") {
    const cmd = ((sig.tool_input as Record<string, unknown>)?.command as string) ?? "";
    if (/\b(test|jest|vitest|pytest|cargo test|go test)\b/i.test(cmd)) add("debugging", 1);
  }

  // file-extension signal
  const ext = extOf(sig.tool_input);
  if (ext && DOC_EXT.has(ext)) add("writing/docs", 1.5);

  if (scores.size === 0) {
    return { workMode: "deep-focus coding", confidence: 0.4 };
  }

  let best: WorkMode = "deep-focus coding";
  let bestScore = 0;
  let total = 0;
  for (const [m, s] of scores) {
    total += s;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  // confidence: share of the winner, floored so a single clear hit is decisive
  const confidence = Math.max(0.4, Math.min(0.95, bestScore / Math.max(total, bestScore)));
  return { workMode: best, confidence };
}
