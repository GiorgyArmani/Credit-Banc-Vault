// src/lib/lender-api/providers/bitty/client.ts
//
// Bitty Portal Submission API client. Server-only — holds the API key.
// Spec: "Bitty – Portal Submission API" v4.0 (PDF from Bitty, no public URL).
//
// REQUIRED ENV:
//   BITTY_API_KEY  — sent as `apikey` in the JSON body (there is no auth header)
// OPTIONAL ENV:
//   BITTY_API_BASE — defaults to development. Production is https://broker.bittyadvance.com
//
// Development keys do not work in production and vice versa, and development
// submissions never reach the live portal, so `development: true` is sent
// whenever the base is not production.
//
// NEVER LOG BODIES: submissions carry the owner's SSN and base64 files. Logs
// carry the HTTP status only.

import { BITTY_DEV_API_BASE, BITTY_PROD_API_BASE, BITTY_SUBMIT_PATH } from "./constants";
import type { BittyFile, BittySubmission } from "./mapping";

export interface BittyConfig {
  apiKey: string;
  apiBase: string;
  development: boolean;
}

export function getBittyConfig(): BittyConfig | null {
  const apiKey = process.env.BITTY_API_KEY?.trim();
  if (!apiKey) return null;
  const apiBase = (process.env.BITTY_API_BASE?.trim() || BITTY_DEV_API_BASE).replace(/\/+$/, "");
  return { apiKey, apiBase, development: apiBase !== BITTY_PROD_API_BASE };
}

export function isBittyConfigured(): boolean {
  return getBittyConfig() !== null;
}

export interface BittyHttpResult {
  /** 0 = never got an HTTP answer (network error, timeout). */
  status: number;
  data: unknown;
}

export async function submitToBitty(payload: BittySubmission, files: BittyFile[]): Promise<BittyHttpResult> {
  const cfg = getBittyConfig();
  if (!cfg) return { status: 0, data: null };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${BITTY_SUBMIT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        apikey: cfg.apiKey,
        ...(cfg.development ? { development: true } : {}),
        ...payload,
        ...(files.length ? { files } : {}),
      }),
      // Bitty underwrites inside this call before answering.
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    console.error("bitty: submit did not get an answer");
    return { status: 0, data: null };
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  console.info(`bitty: submit HTTP ${res.status}`);
  return { status: res.status, data };
}

/** Fetches one of our own signed URLs as base64 for the inline `files` array. */
export async function fetchAsBase64(url: string): Promise<{ base64: string } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    return { base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch {
    return { error: "Could not read the file" };
  }
}
