// src/lib/lender-api/providers/pirs/client.ts
//
// Pirs Portal Web API client (PIRS Capital). Server-only — holds a portal password.
//
// REQUIRED ENV: PIRS_API_USERNAME, PIRS_API_PASSWORD
//   A Pirs Portal LOGIN (Broker / BrokerManager / MasterBroker). Every
//   application is filed under this user, and PIRS emails only that user and
//   the ones above it. Changing the user's portal password breaks the API
//   until the env is updated.
// OPTIONAL ENV:
//   PIRS_API_BASE      — defaults to the sandbox. Production is https://pirsportal.com
//   PIRS_WEBHOOK_TOKEN — the secret WE put in the callbackUrl sent with each
//                        application (PIRS's pushes are unsigned; see index.ts).
//                        Unset = no callbackUrl, statuses arrive by Refresh only.
//
// AUTH: HTTP Basic on every request. JSON in and out.
//
// NEVER LOG BODIES: applications carry SSNs, and every application response
// echoes them in full. Logs carry method, path, status and the NAMES of
// rejected fields only.

import { PIRS_DEFAULT_API_BASE } from "./constants";
import type { PirsApplication } from "./mapping";

export interface PirsConfig {
  username: string;
  password: string;
  apiBase: string;
}

export function getPirsConfig(): PirsConfig | null {
  const username = process.env.PIRS_API_USERNAME?.trim();
  const password = process.env.PIRS_API_PASSWORD?.trim();
  if (!username || !password) return null;
  return {
    username,
    password,
    apiBase: (process.env.PIRS_API_BASE?.trim() || PIRS_DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

export function isPirsConfigured(): boolean {
  return getPirsConfig() !== null;
}

/**
 * Where PIRS pushes application changes, or undefined when we can't take
 * them: no webhook token, or no public https app URL (a localhost URL is
 * unreachable from PIRS).
 */
export function pirsCallbackUrl(): string | undefined {
  const token = process.env.PIRS_WEBHOOK_TOKEN?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!token || !appUrl || !/^https:\/\//i.test(appUrl) || /localhost|127\.0\.0\.1/i.test(appUrl)) return undefined;
  return `${appUrl}/api/webhooks/lender-api/pirs?token=${encodeURIComponent(token)}`;
}

export interface PirsResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** ASP.NET Web API 400: `{ message, modelState: { "applicationViewModel.Field": [msgs] } }`. */
export function readPirsModelState(data: unknown): Record<string, string[]> {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const ms = d.modelState ?? d.ModelState;
  const out: Record<string, string[]> = {};
  if (ms && typeof ms === "object") {
    for (const [k, v] of Object.entries(ms as Record<string, unknown>)) {
      const field = k.replace(/^applicationViewModel\./i, "");
      out[field] = Array.isArray(v) ? v.map(String) : [String(v)];
    }
  }
  return out;
}

export function describePirsError(status: number, data: unknown): string {
  const fields = readPirsModelState(data);
  const parts = Object.entries(fields).map(([k, msgs]) => `${k}: ${msgs.join(", ")}`);
  if (parts.length) return `Validation failed — ${parts.join("; ")}`;
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  for (const key of ["message", "Message", "exceptionMessage", "ExceptionMessage"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
  }
  if (status === 401) return "PIRS rejected our portal credentials";
  if (status === 403) return "PIRS refused: our portal user can't act on this application";
  if (status === 500) return "PIRS had an internal error (their help page says to contact their portal administrator)";
  return `PIRS returned HTTP ${status}`;
}

async function pirsRequest<T = unknown>(method: "GET" | "POST", path: string, json?: unknown): Promise<PirsResponse<T>> {
  const cfg = getPirsConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "PIRS is not configured" };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`,
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      // Attachments/Create downloads each file before it answers.
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach PIRS" };
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An unknown fund id answers 500 with an IIS HTML page, not JSON.
    data = null;
  }
  if (!res.ok) {
    const fields = Object.keys(readPirsModelState(data));
    console.error(`pirs: ${method} ${path.replace(/\d+/g, "{id}")} HTTP ${res.status}${fields.length ? ` fields=${fields.join(",")}` : ""}`);
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : describePirsError(res.status, data) };
}

export function createApplication(app: PirsApplication) {
  const callbackUrl = pirsCallbackUrl();
  return pirsRequest<Record<string, unknown>>("POST", "/api/Application/Create", callbackUrl ? { ...app, callbackUrl } : app);
}

export function getApplication(fundId: string) {
  return pirsRequest<Record<string, unknown>>("GET", `/api/Application/Get/${encodeURIComponent(fundId)}`);
}

export function getOptions(fundId: string) {
  return pirsRequest<Record<string, unknown>>("GET", `/api/Application/Options/${encodeURIComponent(fundId)}`);
}

export interface PirsAttachment {
  fileName: string;
  description: string;
  /** PIRS downloads it during the call (sandbox-verified), so a 24 h signed URL is enough. */
  url: string;
}

export function createAttachments(fundId: string, attachments: PirsAttachment[]) {
  return pirsRequest<Array<Record<string, unknown>>>(
    "POST",
    `/api/Attachments/Create?fundId=${encodeURIComponent(fundId)}`,
    attachments
  );
}
