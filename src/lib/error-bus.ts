// src/lib/error-bus.ts
//
// Imperative bridge to the app-wide error modal (ErrorDialogProvider).
//
// The modal lives in React context (useErrorDialog), but most failures are
// reported from plain `toast.error(...)` calls that aren't wired to the
// context. This tiny pub/sub lets ANY code — even non-React modules like the
// `toast` wrapper — surface a must-dismiss error popup by calling
// `dispatchError(...)`. The single mounted provider registers its handler on
// mount; errors dispatched before the handler exists are queued and flushed.

export type ErrorBusOptions = {
  /** Headline override. Defaults to "Something went wrong". */
  title?: string;
  /** Short description of what the user was doing, e.g. "Resending login". */
  context?: string;
};

export type ErrorBusPayload = {
  error: unknown;
  options?: ErrorBusOptions;
};

type Handler = (payload: ErrorBusPayload) => void;

let handler: Handler | null = null;
const pending: ErrorBusPayload[] = [];

/**
 * Called by ErrorDialogProvider on mount. Returns an unsubscribe fn for unmount.
 * Any errors that arrived before mount are flushed immediately.
 */
export function registerErrorHandler(next: Handler): () => void {
  handler = next;
  while (pending.length) {
    const queued = pending.shift();
    if (queued) next(queued);
  }
  return () => {
    if (handler === next) handler = null;
  };
}

/** Surface an error in the app-wide must-dismiss modal from anywhere. */
export function dispatchError(payload: ErrorBusPayload): void {
  if (handler) {
    handler(payload);
  } else {
    // Provider not mounted yet (very early render) — queue for flush.
    pending.push(payload);
  }
}
