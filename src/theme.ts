/**
 * Terminal theme from Telepatia's public design tokens (telepatia.ai / scribe.telepatia.ai CSS).
 * Terminals are usually dark, so the light end of the green scale carries emphasis
 * and cream/olive replace ink for text.
 */

export const palette = {
  green200: "#94e1be", // green-200
  green300: "#59c699", // green-300 · brand accent on dark
  green400: "#2fa879", // green-400
  green500: "#068450", // green-500
  green600: "#076f42", // green-600 · ★ verde Telepatia
  green700: "#055a35", // green-700
  cream: "#f6f5eb", // cream
  olive200: "#d5e0d2", // olive-200
  olive400: "#a3b79e", // olive-400
  olive600: "#62775f", // olive-600 · eyebrow
  red: "#d14538", // red · clinical risk / errors only
  amber: "#e2a336", // not in the design system; used only for "processing"/warnings
} as const;

type Level = 0 | 1 | 2 | 3; // none | 16 colors | 256 | truecolor

function detectLevel(): Level {
  if (process.env.NO_COLOR || process.env.TERM === "dumb") return 0;
  if (!process.stdout.isTTY && !process.env.FORCE_COLOR) return 0;
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return 3;
  if (["iTerm.app", "vscode", "WezTerm", "ghostty"].includes(process.env.TERM_PROGRAM ?? "")) return 3;
  if ((process.env.TERM ?? "").includes("256")) return 2;
  return 1;
}

export const level = detectLevel();

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function to256([r, g, b]: [number, number, number]): number {
  const q = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function fgCode(hex: string, basic: number): string {
  if (level === 3) return `38;2;${hexToRgb(hex).join(";")}`;
  if (level === 2) return `38;5;${to256(hexToRgb(hex))}`;
  return String(basic);
}

const paint =
  (open: string, close = "39") =>
  (s: string) =>
    level === 0 ? s : `\x1b[${open}m${s}\x1b[${close}m`;

export const hex = (color: string, basic = 32) => paint(fgCode(color, basic));

export const c = {
  brand: hex(palette.green400, 32),
  brandLight: hex(palette.green300, 32),
  brandDark: hex(palette.green600, 32),
  muted: hex(palette.olive400, 90),
  subtle: hex(palette.olive600, 90),
  text: hex(palette.cream, 37),
  green: hex(palette.green300, 32),
  red: hex(palette.red, 31),
  yellow: hex(palette.amber, 33),
  cyan: hex(palette.green200, 36),
  bold: paint("1", "22"),
  dim: paint("2", "22"),
  italic: paint("3", "23"),
};

/** Linear interpolation between two hex colors, for gradients. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const h = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`;
}
