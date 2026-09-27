import { c } from "../theme.js";

const width = () => Math.min(process.stdout.columns || 80, 100);

/** Word-wraps one line to the terminal width. Bullets get a coloured marker and a hanging indent. */
function wrap(raw: string, indent: string): string[] {
  const max = Math.max(20, width() - indent.length - 2);
  const lead = raw.match(/^\s*([-*•]|\d+\.)\s+/)?.[0] ?? "";
  const marker = lead ? c.brand(lead.trim().replace(/^[-*]$/, "•")) + " " : "";
  const hang = " ".repeat(lead ? lead.trim().replace(/^[-*]$/, "•").length + 1 : 0);
  const avail = max - hang.length;
  const lines: string[] = [];
  let line = "";
  for (const word of raw.slice(lead.length).trim().split(/\s+/)) {
    if (line && (line + " " + word).length > avail) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => indent + (i === 0 ? marker : hang) + l);
}

const inline = (s: string) =>
  s.replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(c.text(t))).replace(/(^|\s)_(.+?)_(?=\s|$)/g, (_, p, t) => p + c.italic(c.muted(t)));

/** Minimal Markdown → ANSI for notes: headings, bullets, bold, italics, rules. */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    // wrap paragraph by paragraph so bullets keep their own lines
    for (const l of paragraph) out.push(...wrap(l, "  ").map(inline));
    paragraph = [];
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("# ")) {
      flush();
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push("  " + c.bold(c.brandLight(line.slice(2))), "  " + c.subtle("─".repeat(Math.min(60, width() - 4))));
    } else if (line.startsWith("## ")) {
      flush();
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push("  " + c.brand("▍") + c.bold(c.text(line.slice(3))));
    } else if (line.startsWith("```")) {
      continue;
    } else if (line.trim() === "---") {
      flush();
      out.push("  " + c.subtle("─".repeat(Math.min(60, width() - 4))));
    } else if (!line.trim()) {
      flush();
      if (out[out.length - 1] !== "") out.push("");
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return out.join("\n") + "\n";
}

const STATUS: Record<string, [string, (s: string) => string]> = {
  recording: ["Grabando", c.red],
  stopped: ["Procesando", c.yellow],
  allChunksReceived: ["Procesando", c.yellow],
  processing: ["Procesando", c.yellow],
  completed: ["Lista", c.green],
  reviewed: ["Revisada", c.green],
  completedWithErrors: ["Con errores", c.yellow],
  error: ["Error", c.red],
  cancelled: ["Cancelada", c.muted],
  deleted: ["Eliminada", c.muted],
};

export function statusBadge(status: string): string {
  const [label, color] = STATUS[status] ?? [status, c.muted];
  return color("●") + " " + color(label);
}

export const statusLabel = (status: string) => (STATUS[status] ?? [status])[0];
