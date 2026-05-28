"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Copy, CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * App-wide error popup.
 *
 * Any client code can surface a failure to the user as a must-dismiss modal:
 *
 *   const { showError } = useErrorDialog();
 *   try { ... } catch (err) { showError(err, { context: "Saving the client" }); }
 *
 * The modal shows a plain-language headline, the underlying message, and a
 * support reference (id + page + time). The user can copy a formatted report
 * or open a pre-filled email to support — so "something broke" always comes
 * with something they can report back.
 */

const SUPPORT_EMAIL = "support@creditbanc.io";

type ShowErrorOptions = {
  /** Headline override. Defaults to "Something went wrong". */
  title?: string;
  /** Short description of what the user was doing, e.g. "Creating the client". */
  context?: string;
};

type ErrorDialogContextValue = {
  showError: (error: unknown, options?: ShowErrorOptions) => void;
};

function normalizeMessage(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    if (typeof anyErr.message === "string") return anyErr.message;
    if (typeof anyErr.error === "string") return anyErr.error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function makeReference(): string {
  return "CBV-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Default value logs instead of throwing, so calling showError from a tree that
// somehow isn't under the provider can never crash the page.
const ErrorDialogContext = createContext<ErrorDialogContextValue>({
  showError: (error) => console.error("[ErrorDialog: no provider]", error),
});

export function useErrorDialog() {
  return useContext(ErrorDialogContext);
}

type DialogState = {
  open: boolean;
  title: string;
  message: string;
  context: string;
  reference: string;
  time: string;
  where: string;
};

const CLOSED: DialogState = {
  open: false,
  title: "",
  message: "",
  context: "",
  reference: "",
  time: "",
  where: "",
};

export function ErrorDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(CLOSED);
  const [copied, setCopied] = useState(false);

  const showError = useCallback((error: unknown, options?: ShowErrorOptions) => {
    setCopied(false);
    setState({
      open: true,
      title: options?.title || "Something went wrong",
      message: normalizeMessage(error),
      context: options?.context || "",
      reference: makeReference(),
      time: new Date().toISOString(),
      where: typeof window !== "undefined" ? window.location.pathname : "",
    });
    // Mirror to the console so it's also in any captured logs.
    console.error("[ErrorDialog]", error);
  }, []);

  const close = useCallback(() => setState(CLOSED), []);

  const report = [
    "[Credit Banc Vault error report]",
    `Reference: ${state.reference}`,
    `Time: ${state.time}`,
    `Page: ${state.where || "—"}`,
    state.context ? `Action: ${state.context}` : null,
    `Message: ${state.message}`,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the report block
      // is select-all so the user can still copy it by hand.
    }
  };

  const mailto =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(`Vault error ${state.reference}`)}` +
    `&body=${encodeURIComponent(report)}`;

  return (
    <ErrorDialogContext.Provider value={{ showError }}>
      {children}
      {state.open && (
        <div className="fixed inset-0 bg-red-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl max-w-lg w-full p-10 md:p-12 animate-fade-in relative overflow-hidden border border-red-50">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full blur-3xl -mr-10 -mt-10" />

            <div className="text-center mb-8 relative z-10">
              <div className="mx-auto w-20 h-20 bg-red-50 rounded-[2rem] flex items-center justify-center mb-6 border border-red-100 shadow-inner">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
              <h2 className="text-3xl font-black text-red-950 uppercase tracking-tighter mb-2">
                {state.title}
              </h2>
              <p className="text-red-950/40 font-bold">
                {state.context
                  ? `This happened while: ${state.context}.`
                  : "Please copy the details below and send them to support so we can help."}
              </p>
            </div>

            <div className="bg-red-50/60 rounded-[2rem] p-6 mb-6 border border-red-100 relative z-10">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-900/40 mb-3">
                What happened
              </p>
              <p className="text-sm font-bold text-red-950 break-words select-all whitespace-pre-wrap mb-4">
                {state.message}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] font-bold text-red-900/50 select-all border-t border-red-100 pt-3">
                <span>Ref: {state.reference}</span>
                <span className="sm:text-right truncate">Page: {state.where || "—"}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 relative z-10">
              <Button
                type="button"
                variant="outline"
                onClick={copy}
                className="flex-1 h-14 border-2 border-red-100 text-red-950 font-black rounded-2xl hover:bg-red-50 transition-all active:scale-95"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-5 h-5 mr-2" /> Copy details
                  </>
                )}
              </Button>
              <a
                href={mailto}
                className="flex-1 h-14 inline-flex items-center justify-center gap-2 border-2 border-red-100 text-red-950 font-black rounded-2xl hover:bg-red-50 transition-all active:scale-95"
              >
                <Mail className="w-5 h-5" /> Email support
              </a>
              <Button
                type="button"
                onClick={close}
                className="flex-1 h-14 bg-red-500 hover:bg-red-600 text-white font-black rounded-2xl shadow-xl shadow-red-500/20 transition-all active:scale-95"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </ErrorDialogContext.Provider>
  );
}
