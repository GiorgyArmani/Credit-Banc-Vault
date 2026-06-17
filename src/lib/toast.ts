// src/lib/toast.ts
//
// Drop-in replacement for sonner's `toast`. Everything behaves exactly like
// sonner EXCEPT `toast.error(...)`, which is rerouted to the app-wide
// must-dismiss error modal (ErrorDialogProvider) so failures are impossible to
// miss and always show clear, copyable detail.
//
// Usage is unchanged — just import from here instead of "sonner":
//   import { toast } from "@/lib/toast";
//   toast.success("Saved");                 // normal sonner toast
//   toast.error("Couldn't save", { ... });  // center-screen error popup

import { toast as sonnerToast, type ExternalToast } from "sonner";
import type { ReactNode } from "react";
import { dispatchError } from "./error-bus";

/** Best-effort stringify of a sonner message/description (usually a string). */
function toText(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  // ReactNode that isn't plain text (element, thunk, …) — can't render as text.
  return undefined;
}

/**
 * Rerouted `toast.error`. Combines the message and any `description` into the
 * modal's detail block so nothing is lost. Keeps sonner's call signature so
 * existing call sites compile unchanged.
 */
export function showErrorToast(message?: ReactNode, data?: ExternalToast) {
  const parts = [toText(message), toText(data?.description)].filter(
    (p): p is string => !!p && p.trim().length > 0
  );
  dispatchError({
    error: parts.length ? parts.join("\n\n") : "An unexpected error occurred.",
  });
  // Return a no-op id so callers expecting sonner's return value don't break.
  return "" as unknown as string | number;
}

/**
 * Proxy sonner's `toast` so `toast(...)`, `toast.success`, `toast.info`,
 * `toast.loading`, `toast.promise`, `toast.dismiss`, etc. all work as before,
 * while `toast.error` opens the modal.
 */
export const toast = new Proxy(sonnerToast, {
  get(target, prop, receiver) {
    if (prop === "error") return showErrorToast;
    return Reflect.get(target, prop, receiver);
  },
}) as typeof sonnerToast;
