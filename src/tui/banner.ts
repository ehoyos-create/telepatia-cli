import { VERSION } from "../config.js";
import { c, hex, level, mix, palette } from "../theme.js";

/**
 * Telepatia's isotipo (the two-arc "T" from the official SVG logo),
 * rasterised from its path into half-block characters, 28 columns wide.
 */
const LOGO = [
  "█████████▄▄▄    ▄▄▄█████████",
  "█████████████▄▄█████████████",
  "         ▀▀██████▀▀         ",
  "          ▄██████▄          ",
  "         ████▀▀████         ",
  "         ███▀  ▀███         ",
  "        ████    ████        ",
  "        ████    ████        ",
  "        ████    ████        ",
  "        ████    ████        ",
  "        ████    ████        ",
  "        ████    ████        ",
  "         ▀▀▀    ▀▀▀         ",
];

/** "TELEPATIA" in the figlet "ANSI Regular" font. */
const WORDMARK = [
  "████████ ███████ ██      ███████ ██████   █████  ████████ ██  █████ ",
  "   ██    ██      ██      ██      ██   ██ ██   ██    ██    ██ ██   ██",
  "   ██    █████   ██      █████   ██████  ███████    ██    ██ ███████",
  "   ██    ██      ██      ██      ██      ██   ██    ██    ██ ██   ██",
  "   ██    ███████ ███████ ███████ ██      ██   ██    ██    ██ ██   ██",
];

const LOGO_W = LOGO[0].length;
const WORD_W = WORDMARK[0].length;
const GAP = 5;

/** Paints each character along a horizontal gradient (flat brand green on basic terminals). */
function gradient(line: string, from: string, to: string): string {
  if (level < 2) return c.brand(line);
  const chars = [...line];
  return chars.map((ch, i) => (ch === " " ? ch : hex(mix(from, to, i / Math.max(1, chars.length - 1)))(ch))).join("");
}

/** Logo rows get a top-to-bottom gradient, light to deep green. */
const logoRow = (row: string, i: number) =>
  level < 2 ? c.brand(row) : hex(mix(palette.green300, palette.green600, i / (LOGO.length - 1)))(row);

const wordRow = (row: string) => gradient(row, palette.green300, palette.green500);

const tagline = () => `${c.bold(c.text("Scribe"))} ${c.subtle("·")} ${c.muted("tu consulta, desde la terminal")}`;
const version = () => c.subtle(`v${VERSION} · proyecto comunitario, no oficial`);

const center = (s: string, visible: number, width: number) => " ".repeat(Math.max(0, Math.floor((width - visible) / 2))) + s;

export function banner(status?: string): string {
  const cols = process.stdout.columns || 80;
  const indent = "  ";

  // Wide terminals: logo on the left, wordmark on the right.
  if (cols >= indent.length + LOGO_W + GAP + WORD_W) {
    const right = ["", "", "", ...WORDMARK.map(wordRow), "", tagline(), version(), "", status ?? ""];
    const lines = LOGO.map((row, i) => `${indent}${logoRow(row, i)}${" ".repeat(GAP)}${right[i] ?? ""}`);
    return `\n${lines.join("\n")}\n`;
  }

  // Medium: logo centred above the wordmark.
  if (cols >= indent.length + WORD_W) {
    const lines = [
      ...LOGO.map((row, i) => indent + center(logoRow(row, i), LOGO_W, WORD_W)),
      "",
      ...WORDMARK.map((r) => indent + wordRow(r)),
      "",
      indent + tagline(),
      indent + version(),
      ...(status ? [indent + status] : []),
    ];
    return `\n${lines.join("\n")}\n`;
  }

  // Narrow: logo and a spaced-out name.
  const lines = [
    ...LOGO.map((row, i) => indent + logoRow(row, i)),
    "",
    indent + center(c.bold(c.brandLight("t e l e p a t i a")), 17, LOGO_W),
    indent + center(c.muted("s c r i b e"), 11, LOGO_W),
    "",
    indent + version(),
    ...(status ? [indent + status] : []),
  ];
  return `\n${lines.join("\n")}\n`;
}

/** Compact one-line header for sub-screens. */
export const miniHeader = (title: string) => `${c.brand("▀█▀")} ${c.bold(c.text("telepatia"))} ${c.subtle("›")} ${c.text(title)}`;
