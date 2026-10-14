// src/app/admin/webinars/_components/use-tus-upload.ts
"use client";

// Resumable browser → Supabase Storage upload for 300 MB – 2 GB recordings.
// A single-request upload restarts from zero on any drop; tus resumes from the
// server-side offset. Uses the admin's own session: the bucket's only policy
// is an admin INSERT (migration 20261014_webinars.sql).

import { useCallback, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import {
  WEBINARS_BUCKET,
  TUS_CHUNK_BYTES,
  webinarVideoPath,
  describeUploadError,
} from "@/lib/webinars-shared";

export type TusState = {
  status: "idle" | "uploading" | "paused" | "error" | "done";
  bytesSent: number;
  bytesTotal: number;
  error: string | null;
};

const IDLE: TusState = { status: "idle", bytesSent: 0, bytesTotal: 0, error: null };

export function useTusUpload() {
  const [state, setState] = useState<TusState>(IDLE);
  const uploadRef = useRef<tus.Upload | null>(null);
  const settleRef = useRef<((ok: boolean) => void) | null>(null);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (state.status !== "uploading") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.status]);

  const start = useCallback((file: File, id: string): Promise<boolean> => {
    const supabase = createClient();
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    setState({ status: "uploading", bytesSent: 0, bytesTotal: file.size, error: null });

    return new Promise<boolean>((resolve) => {
      settleRef.current = resolve;
      const upload = new tus.Upload(file, {
        endpoint: `${base}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { apikey: anon, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: WEBINARS_BUCKET,
          objectName: webinarVideoPath(id),
          contentType: "video/mp4",
          cacheControl: "3600",
        },
        chunkSize: TUS_CHUNK_BYTES,
        // A 1.5 GB upload can outlive an access token — fetch the current one
        // (auto-refreshed by supabase-js) before every request.
        onBeforeRequest: async (req) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) req.setHeader("authorization", `Bearer ${token}`);
        },
        onProgress: (sent, total) => {
          setState((s) => ({ ...s, bytesSent: sent, bytesTotal: total }));
        },
        onError: (err) => {
          setState((s) => ({ ...s, status: "error", error: describeUploadError(err) }));
          // Don't settle: the admin can still Resume from this state.
        },
        onSuccess: () => {
          setState((s) => ({ ...s, status: "done", bytesSent: s.bytesTotal }));
          settleRef.current?.(true);
          settleRef.current = null;
        },
      });
      uploadRef.current = upload;
      upload.start();
    });
  }, []);

  const pause = useCallback(() => {
    uploadRef.current?.abort();
    setState((s) => ({ ...s, status: "paused" }));
  }, []);

  const resume = useCallback(() => {
    if (!uploadRef.current) return;
    setState((s) => ({ ...s, status: "uploading", error: null }));
    uploadRef.current.start();
  }, []);

  const cancel = useCallback(() => {
    // `true` also deletes the partial upload on the server.
    uploadRef.current?.abort(true).catch(() => {});
    uploadRef.current = null;
    settleRef.current?.(false);
    settleRef.current = null;
    setState(IDLE);
  }, []);

  // Back to idle WITHOUT telling the server anything. Use after a finished
  // upload — cancel()'s abort(true) is a tus termination, which must never be
  // sent for a video that has already landed.
  const reset = useCallback(() => {
    uploadRef.current = null;
    settleRef.current = null;
    setState(IDLE);
  }, []);

  return { state, start, pause, resume, cancel, reset };
}
