// src/lib/lender-api/providers/idea/client.ts
//
// Idea Financial Universal Broker API client. Server-only — holds the secret.
//
// REQUIRED ENV:
//   IDEA_CLIENT_ID, IDEA_CLIENT_SECRET — API key pair from the Idea broker portal
//   IDEA_AGENT_ID — the Idea agent every application is filed under (GET /v1/agents)
// OPTIONAL ENV (default to SANDBOX — production only by setting both explicitly):
//   IDEA_API_BASE   — https://partner.api.ideafinancial.net  (prod: https://partner.api.ideafinancial.com)
//   IDEA_TOKEN_URL  — https://oauth.ideafinancial.net/token   (prod: https://oauth.ideafinancial.com/token)
//
// AUTH: OAuth2 client_credentials. The token response carries `expires_in`
// (their docs say `expires_at`; the live API doesn't). Cached per server
// instance, refreshed 60 s early, and once more on a 401.
//
// NEVER LOG BODIES: applications carry SSNs, and GET /v1/applications/{id}
// echoes them back in full. Logs carry method, path, status and the NAMES of
// rejected fields only.

import { IDEA_DEFAULT_API_BASE, IDEA_DEFAULT_TOKEN_URL } from "./constants";
import type { IdeaApplication } from "./mapping";

export interface IdeaConfig {
  clientId: string;
  clientSecret: string;
  agentId: number;
  apiBase: string;
  tokenUrl: string;
}

export function getIdeaConfig(): IdeaConfig | null {
  const clientId = process.env.IDEA_CLIENT_ID?.trim();
  const clientSecret = process.env.IDEA_CLIENT_SECRET?.trim();
  const agentId = Number(process.env.IDEA_AGENT_ID?.trim());
  if (!clientId || !clientSecret || !Number.isInteger(agentId) || agentId <= 0) return null;
  return {
    clientId,
    clientSecret,
    agentId,
    apiBase: (process.env.IDEA_API_BASE?.trim() || IDEA_DEFAULT_API_BASE).replace(/\/+$/, ""),
    tokenUrl: process.env.IDEA_TOKEN_URL?.trim() || IDEA_DEFAULT_TOKEN_URL,
  };
}

export function isIdeaConfigured(): boolean {
  return getIdeaConfig() !== null;
}

export interface IdeaResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export const __testing = {
  reset() {
    cachedToken = null;
  },
};

async function getToken(cfg: IdeaConfig): Promise<{ token: string } | { error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value };
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "Could not reach Idea Financial (token)" };
  }
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    const code = body?.error ? ` (${body.error})` : "";
    console.error(`idea: token request failed HTTP ${res.status}${code}`);
    return { error: `Idea Financial rejected our credentials${code}` };
  }
  const ttl = Number(body.expires_in ?? body.expires_at) || 3600;
  cachedToken = { value: String(body.access_token), expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
  return { token: cachedToken.value };
}

/** ASP.NET problem details (`errors`: field → messages) or `{ message }`. */
export function describeIdeaError(status: number, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (d.errors && typeof d.errors === "object") {
    const parts = Object.entries(d.errors as Record<string, unknown>).map(
      ([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`
    );
    if (parts.length) return `Validation failed — ${parts.join("; ")}`;
  }
  if (typeof d.message === "string" && d.message.trim()) return d.message.trim();
  if (typeof d.title === "string" && d.title.trim()) return d.title.trim();
  if (status === 401 || status === 403) return "Idea Financial rejected our API credentials";
  return `Idea Financial returned HTTP ${status}`;
}

async function ideaRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: { json: unknown } | { form: FormData }
): Promise<IdeaResponse<T>> {
  const cfg = getIdeaConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Idea Financial is not configured" };

  let authRetried = false;
  for (;;) {
    const t = await getToken(cfg);
    if ("error" in t) return { ok: false, status: 401, data: null, error: t.error };

    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${t.token}`,
          Accept: "application/json",
          ...(body && "json" in body ? { "Content-Type": "application/json" } : {}),
        },
        body: !body ? undefined : "json" in body ? JSON.stringify(body.json) : body.form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: "Could not reach Idea Financial" };
    }

    if (res.status === 401 && !authRetried) {
      authRetried = true;
      cachedToken = null;
      continue;
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const fields = data?.errors && typeof data.errors === "object" ? ` fields=${Object.keys(data.errors).join(",")}` : "";
      console.error(`idea: ${method} ${path} HTTP ${res.status}${fields}`);
    }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : describeIdeaError(res.status, data) };
  }
}

export function createApplication(app: IdeaApplication) {
  const cfg = getIdeaConfig();
  return ideaRequest<{ id?: number | string }>("POST", "/v1/applications", {
    json: { ...app, agentId: cfg?.agentId },
  });
}

export function getApplication(id: string) {
  return ideaRequest<Record<string, unknown>>("GET", `/v1/applications/${encodeURIComponent(id)}`);
}

/** Moves the application to its next status (Draft → Processing). 204 on success. */
export function pushApplication(id: string) {
  return ideaRequest("POST", `/v1/applications/${encodeURIComponent(id)}/push`);
}

export interface IdeaFileUpload {
  bytes: Buffer;
  documentType: string;
  fileName: string;
  fileExtension: string;
  mimeType: string;
}

export function uploadApplicationFile(id: string, file: IdeaFileUpload) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
  form.append("documentType", file.documentType);
  form.append("fileName", file.fileName);
  form.append("fileExtension", file.fileExtension);
  form.append("mimeType", file.mimeType);
  form.append("fileSize", String(file.bytes.length));
  return ideaRequest<{ id?: number }>("POST", `/v1/applications/${encodeURIComponent(id)}/files`, { form });
}

/** Reads one of our own signed URLs. */
export async function fetchFileBytes(url: string): Promise<{ bytes: Buffer } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    return { bytes: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { error: "Could not read the file" };
  }
}
