import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { APP_PLATFORM, VERSION, endpoints } from "../config.js";
import { authedFetch } from "./http.js";

export interface SelectedTemplate {
  type: "SCRIBE_SESSION_CONFIGURATION" | "MEDICAL_RECORD_CONFIGURATION";
  id: string;
}

export interface CreateSessionInput {
  /** Template (ScribeSessionConfiguration) id — at least one template is required by the backend. */
  configurationDocumentId: string;
  scribePatientDocumentId?: string;
  selectedTemplates?: SelectedTemplate[];
  isTelemedicine?: boolean;
  externalConsultationId?: string;
  sampleRate?: number;
}

const url = (path: string) => `${endpoints.aiBackend}${path}`;

/**
 * Creates a consultation. As in the web app, the *client* generates the session id.
 * A 409 means the session already exists and is treated as success.
 */
export async function createSession(input: CreateSessionInput): Promise<string> {
  const sessionId = randomUUID();
  await authedFetch(url("/audio/sessions"), {
    body: {
      sessionId,
      threadDocumentId: randomUUID(),
      configurationDocumentId: input.configurationDocumentId,
      ...(input.selectedTemplates ? { selectedTemplates: input.selectedTemplates } : {}),
      ...(input.scribePatientDocumentId ? { scribePatientDocumentId: input.scribePatientDocumentId } : {}),
      ...(input.externalConsultationId ? { externalConsultationId: input.externalConsultationId } : {}),
      metadata: { appPlatform: APP_PLATFORM, appVersion: `telepatia-cli/${VERSION}` },
      config: { sampleRate: input.sampleRate ?? 16000 },
      isTelemedicine: input.isTelemedicine ?? false,
    },
  });
  return sessionId;
}

/** Uploads a pre-recorded audio file (wav/flac/ogg/opus/aiff, 1 KB–100 MB) for processing. */
export async function processAudio(sessionId: string, filePath: string, mime: string): Promise<{ totalSegments?: number }> {
  const data = await readFile(filePath);
  const form = new FormData();
  form.append("audio_file", new Blob([data], { type: mime }), basename(filePath));
  return (await authedFetch(url(`/audio/sessions/${sessionId}/process-audio`), {
    method: "POST",
    body: form,
    timeoutMs: 600_000,
  })) as { totalSegments?: number };
}

export const cancelSession = (sessionId: string) =>
  authedFetch(url(`/audio/sessions/${sessionId}/cancel`), { body: { supportsCancelledStatus: true } });

/** Asks the backend to finalize a stuck session (what the web app's "recover" does). */
export const resolveSession = (sessionId: string, opts: { forceEmr?: boolean; reprocessAll?: boolean } = {}) =>
  authedFetch(url(`/audio/sessions/${sessionId}/resolve`), {
    body: { forceEmr: opts.forceEmr ?? false, reprocessAll: opts.reprocessAll ?? false, origin: "scribe_web" },
    timeoutMs: 60_000,
  }) as Promise<{ actionsTaken?: string[]; finalized?: boolean; newStatus?: string }>;

export const regenerateNote = (sessionId: string, templateId?: string) =>
  authedFetch(url("/v1/scribe/generate-emr"), {
    body: { sessionId, origin: "scribe", ...(templateId ? { templateId } : {}) },
  }) as Promise<{ status?: string }>;

/** Anonymized transcript text. Returns null when the session has none (404). */
export async function getAnonymizedTranscript(sessionId: string): Promise<string | null> {
  try {
    const res = (await authedFetch(url(`/download-session-files/anonymized/${sessionId}/transcript`))) as { text?: string };
    return res?.text ?? null;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export const icdSearch = (query: string, language: string, limit = 20) =>
  authedFetch(url("/v1/reference-codes/icd/search"), { body: { query, language, limit } }) as Promise<{
    results: unknown[];
  }>;

export const patientEducation = (sections: { id: string; title: string; text: string }[], language?: string) =>
  authedFetch(url("/v1/patient-education/generate"), {
    body: { sections, ...(language ? { language } : {}) },
  }) as Promise<{ sections: { id: string; patientFriendlyText: string }[] }>;
