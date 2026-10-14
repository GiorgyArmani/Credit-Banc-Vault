// src/app/admin/webinars/_components/use-direct-upload.ts
"use client";

// Browser → Supabase Storage in ONE request, straight to the direct storage
// host. Chosen over resumable TUS (fixed 6 MB chunks, ~3 MB/s measured) for
// ~5× the speed; a dropped connection restarts the upload. XHR, not fetch:
// fetch has no upload-progress events. Uses the admin's own session — the
// bucket's only policy is an admin INSERT (migration 20261014_webinars.sql).

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { describeUploadError, webinarUploadUrl, webinarVideoPath } from "@/lib/webinars-shared";

export type UploadState = {
  status: "idle" | "uploading" | "error" | "done";
  bytesSent: number;
  bytesTotal: number;
  error: string | null;
};

const IDLE: UploadState = { status: "idle", bytesSent: 0, bytesTotal: 0, error: null };

export function useDirectUpload() {
  const [state, setState] = useState<UploadState>(IDLE);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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

  /** Resolves true on success, false on failure or cancel (state says which). */
  const start = useCallback(async (file: File, id: string): Promise<boolean> => {
    setState({ status: "uploading", bytesSent: 0, bytesTotal: file.size, error: null });

    const { data } = await createClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setState((s) => ({ ...s, status: "error", error: describeUploadError(new Error("response code: 401")) }));
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", webinarUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, webinarVideoPath(id)));
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      xhr.setRequestHeader("content-type", "video/mp4");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "max-age=3600");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setState((s) => ({ ...s, bytesSent: e.loaded, bytesTotal: e.total }));
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          setState((s) => ({ ...s, status: "done", bytesSent: s.bytesTotal }));
          resolve(true);
          return;
        }
        // Storage sometimes answers 400 with the real status in the body
        // ({"statusCode":"413",...}); keep both so describeUploadError sees it.
        const err = new Error(`response code: ${xhr.status} ${xhr.responseText}`);
        setState((s) => ({ ...s, status: "error", error: describeUploadError(err) }));
        resolve(false);
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        setState((s) => ({
          ...s,
          status: "error",
          error: "The connection dropped during the upload — check your network and upload again.",
        }));
        resolve(false);
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        setState(IDLE);
        resolve(false);
      };
      xhr.send(file);
    });
  }, []);

  const cancel = useCallback(() => {
    if (xhrRef.current) xhrRef.current.abort();
    else setState(IDLE);
  }, []);

  /** Back to idle without touching the network (after a finished upload). */
  const reset = useCallback(() => {
    xhrRef.current = null;
    setState(IDLE);
  }, []);

  return { state, start, cancel, reset };
}
