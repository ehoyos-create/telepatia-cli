/**
 * Turns a session's `medicalRecordMutable` JSON into readable Markdown.
 *
 * Section values come in several shapes (see HN/aWe/W8 in the web bundle):
 *   - plain string
 *   - { content: string, status }                        → plain
 *   - { content: { data: { k: { title, content } } } }   → structured (sub-fields)
 *   - { assessment, plan: { content: [{content}] } }     → assessment / plan
 *   - { content: { data: { scales, variables } } }       → clinical scales
 * Anything unrecognised is printed as JSON so no information is silently lost.
 */

const DEFAULT_TITLES: Record<string, string> = {
  chiefComplaint: "Motivo de consulta",
  historyOfPresentIllness: "Enfermedad actual",
  currentTreatment: "Tratamiento actual",
  reviewOfSystems: "Revisión por sistemas",
  pastMedicalHistory: "Antecedentes",
  pastMedicalGynecologicalHistory: "Antecedentes gineco-obstétricos",
  vitalSigns: "Signos vitales",
  anthropometricMeasures: "Medidas antropométricas",
  physicalExamination: "Examen físico",
  laboratoryAndDiagnosticTestResults: "Resultados de laboratorio y ayudas diagnósticas",
  assessmentPlan: "Análisis y plan",
  assessmentPlanPsychology: "Análisis y plan",
  recommendationWarningSigns: "Recomendaciones y signos de alarma",
  diagnosis: "Diagnóstico",
  subjective: "Subjetivo",
  objective: "Objetivo",
  summary: "Resumen",
  identification: "Identificación",
  procedure: "Procedimiento",
  extraOralExamination: "Examen extraoral",
  intraOralExamination: "Examen intraoral",
  odontogram: "Odontograma",
  pastMedicalHistoryPsychology: "Antecedentes",
  mentalExaminationPsychology: "Examen mental",
  psychologyGenogram: "Genograma",
  scales: "Escalas",
};

export interface TemplateNode {
  key: string;
  order?: number | null;
  enabled?: boolean | null;
  hidden?: boolean | null;
  name?: Record<string, string | null> | null;
}

export interface Section {
  key: string;
  title: string;
  text: string;
  status?: string;
}

const humanize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Equivalent of the web app's W8(): best-effort string extraction. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return v
      .map((x) => (isObj(x) && typeof x.content === "string" ? `- ${x.content}` : textOf(x)))
      .filter(Boolean)
      .join("\n");
  if (isObj(v)) {
    for (const k of ["content", "text", "data", "value"]) if (typeof v[k] === "string") return v[k] as string;
  }
  return "";
}

function sectionText(value: unknown): string {
  let inner: unknown = value;
  if (isObj(value) && isObj(value.content)) inner = value.content;

  if (isObj(inner) && isObj(inner.data)) {
    const data = inner.data;
    // Clinical scales
    if (isObj(data.scales)) {
      return Object.entries(data.scales)
        .map(([k, s]) => {
          const sc = isObj(s) ? s : {};
          const name = typeof sc.name === "string" && sc.name ? sc.name : k;
          const val = sc.value ?? "";
          const interp = typeof sc.interpretation === "string" ? ` — ${sc.interpretation}` : "";
          return `- **${name}**: ${textOf(val)}${interp}`;
        })
        .join("\n");
    }
    // Structured sub-fields
    const order = Array.isArray(inner.order) ? (inner.order as string[]) : Object.keys(data);
    const parts = order
      .filter((k) => k in data)
      .map((k) => {
        const f = data[k];
        const title = isObj(f) && typeof f.title === "string" ? f.title : humanize(k);
        const content = (isObj(f) ? textOf(f.content) : textOf(f)).trim();
        if (!content) return "";
        // Multi-line values (e.g. plan items) go below their label.
        return content.includes("\n") ? `**${title}:**\n${content}` : `**${title}:** ${content}`;
      })
      .filter(Boolean);
    // A recognised structure whose fields are all empty is an empty section, not unknown data.
    return parts.join(parts.some((x) => x.includes("\n")) ? "\n\n" : "\n");
  }

  // Assessment / plan split
  const ap = isObj(inner) && "assessment" in inner && "plan" in inner ? inner : null;
  if (ap) {
    const assessment = textOf(ap.assessment);
    const plan = textOf(isObj(ap.plan) ? ap.plan.content : ap.plan);
    return [assessment && `**Análisis:**\n${assessment}`, plan && `**Plan:**\n${plan}`].filter(Boolean).join("\n\n");
  }

  const t = textOf(value);
  if (t) return t;
  // { content: "" | null, status, title } → just empty
  if (isObj(value) && ("content" in value || typeof value.status === "string")) return textOf(value.content);
  return value == null ? "" : "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

export function noteSections(record: unknown, order?: unknown, opts: { nodes?: TemplateNode[]; locale?: string } = {}): Section[] {
  if (!isObj(record)) return [];
  const lang = (opts.locale ?? "es").slice(0, 2);
  const nodeTitle = new Map<string, string>();
  for (const n of opts.nodes ?? []) {
    const t = n.name?.[lang] ?? n.name?.default;
    if (t) nodeTitle.set(n.key, t);
  }
  const visibleNodes = (opts.nodes ?? [])
    .filter((n) => n.key && !n.key.includes(".") && n.hidden !== true && n.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((n) => n.key);

  const keys = visibleNodes.length
    ? visibleNodes.filter((k) => k in record)
    : Array.isArray(order)
      ? (order as string[]).filter((k) => k in record)
      : Object.keys(record);
  // Keep sections present in the record but missing from the order list — except ones the template hides.
  const hidden = new Set((opts.nodes ?? []).filter((n) => n.hidden === true || n.enabled === false).map((n) => n.key));
  for (const k of Object.keys(record)) if (!keys.includes(k) && !hidden.has(k)) keys.push(k);

  return keys.map((key) => {
    const value = record[key];
    return {
      key,
      title:
        nodeTitle.get(key) ??
        (isObj(value) && typeof value.title === "string" && value.title.trim() ? value.title.trim() : undefined) ??
        DEFAULT_TITLES[key] ??
        humanize(key),
      text: sectionText(value).trim(),
      status: isObj(value) && typeof value.status === "string" ? value.status : undefined,
    };
  });
}

export function sectionsToMarkdown(sections: Section[]): string {
  return sections
    .map((s) => `## ${s.title}\n\n${s.text || (s.status && s.status !== "completed" ? `_(${s.status})_` : "_(vacío)_")}`)
    .join("\n\n");
}

/** Transcript can be a string, an array of segments, or an object with segments. */
export function transcriptToText(t: unknown): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    return t
      .map((seg) => {
        if (typeof seg === "string") return seg;
        if (isObj(seg)) {
          const speaker = typeof seg.speaker === "string" ? `${seg.speaker}: ` : "";
          return speaker + textOf(seg.text ?? seg.content ?? seg.transcript ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (isObj(t)) {
    for (const k of ["text", "transcript", "content"]) if (typeof t[k] === "string") return t[k] as string;
    for (const k of ["segments", "utterances", "chunks"]) if (Array.isArray(t[k])) return transcriptToText(t[k]);
  }
  return JSON.stringify(t, null, 2);
}
