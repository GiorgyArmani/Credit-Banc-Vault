// src/components/lender-api/lender-api-submit-panel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Copy, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import type { Gap, PickDefinition, SubmittableDocument } from "@/lib/lender-api/types";
import { VAULT_FIELD_LABELS, type VaultField } from "@/lib/lender-api/vault-fields";
import { needsResendConfirmation } from "@/lib/lender-api/rules";

interface Preview {
  provider: { id: string; displayName: string; picks: PickDefinition[]; requiredVaultFields: VaultField[] };
  assignment: { id: string; status: string; lender_name: string };
  business_name: string | null;
  vault: {
    values: Record<VaultField, string | null>;
    ssn_last4: string | null;
    parsed: VaultField[];
    free_text: { industry: string | null; loan_purpose: string | null; home_address: string | null; business_address: string | null };
  };
  suggested_picks: Record<string, string | null>;
  gaps: Gap[];
  documents: SubmittableDocument[];
  /** Newest attempt first. */
  submissions: Array<{ status: string; error: string | null; updated_at: string }>;
}

const OWNER_FIELDS: VaultField[] = [
  "owner_1_name", "ssn", "owner_1_dob", "client_phone",
  "owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip",
];
const BUSINESS_FIELDS: VaultField[] = ["ein", "business_street", "company_city", "company_state", "company_zip_code"];

export function LenderApiSubmitPanel({
  open,
  onOpenChange,
  assignmentId,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  onSubmitted: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Partial<Record<VaultField, string>>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [serverGaps, setServerGaps] = useState<Gap[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [result, setResult] = useState<{
    external_id: string;
    reference_id: string;
    warning: string | null;
    /** Set when the lender decided inside the submission (e.g. Bitty). */
    lender_status: { kind: string; stage: string; note?: string } | null;
    documents_queued: number;
  } | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);
  const [serverConfirmError, setServerConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setResult(null);
    setConfirmResend(false);
    setServerConfirmError(null);
    setServerGaps(null);
    setFieldErrors(null);
    setEdits({});
    fetch(`/api/lender-assignments/${assignmentId}/lender-api/preview`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(json.error || "Could not load the submission preview");
          onOpenChange(false);
          return;
        }
        const p = json as Preview;
        setPreview(p);
        setPicks(Object.fromEntries(Object.entries(p.suggested_picks).filter(([, v]) => !!v)) as Record<string, string>);
        setSelected(new Set(p.documents.filter((d) => d.preselected).map((d) => d.id)));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, assignmentId, onOpenChange]);

  const value = (field: VaultField) =>
    field in edits ? edits[field] ?? "" : field === "ssn" ? "" : preview?.vault.values[field] ?? "";

  // Gaps the user has visibly addressed in the form are hidden; the server
  // re-validates everything on send and returns the authoritative list.
  const openGaps = useMemo(() => {
    const gaps = serverGaps ?? preview?.gaps ?? [];
    return gaps.filter((g) => {
      if (g.field.startsWith("pick:")) return !picks[g.field.slice(5)];
      if (g.field in VAULT_FIELD_LABELS) return !(edits[g.field as VaultField] ?? "").trim();
      return true;
    });
  }, [serverGaps, preview, picks, edits]);

  // The previous attempt may have reached the lender: sending again needs UW to
  // confirm with them first (the server enforces the same rule). A stalled
  // "sending" row has no error text yet, so fall back to explaining the stall.
  const latestAttempt = preview?.submissions?.[0] ?? null;
  const confirmMessage =
    (needsResendConfirmation(latestAttempt, Date.now())
      ? latestAttempt?.error ??
        "The previous attempt stalled before the lender answered, so they may already have it. Confirm with them, then tick to send again."
      : null) ?? serverConfirmError;
  const needsConfirm = !!confirmMessage;

  const documentGroups = useMemo(() => {
    const groups = new Map<string, SubmittableDocument[]>();
    for (const d of preview?.documents ?? []) groups.set(d.label, [...(groups.get(d.label) ?? []), d]);
    return Array.from(groups.entries());
  }, [preview]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function send() {
    if (!preview) return;
    const vault_updates: Record<string, string> = {};
    for (const [field, v] of Object.entries(edits) as Array<[VaultField, string]>) {
      if (field === "ssn") {
        if (v.trim()) vault_updates.ssn = v;
      } else if (v !== (preview.vault.values[field] ?? "")) {
        vault_updates[field] = v;
      }
    }
    // Parsed address values UW left untouched are still confirmed by sending.
    for (const field of preview.vault.parsed) {
      if (!(field in vault_updates) && preview.vault.values[field]) vault_updates[field] = preview.vault.values[field]!;
    }

    setSending(true);
    setFieldErrors(null);
    try {
      const res = await fetch(`/api/lender-assignments/${assignmentId}/lender-api/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vault_updates,
          picks,
          document_ids: Array.from(selected),
          ...(needsConfirm && confirmResend ? { confirm_resend: true } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.needs_confirmation) {
        setServerConfirmError(json.error || "The previous attempt may have reached the lender.");
        setConfirmResend(false);
        toast.error(json.error || "Confirm with the lender before sending again");
        return;
      }
      if (res.status === 400 && json.gaps) {
        setServerGaps(json.gaps);
        toast.error(json.error || "Some required information is missing");
        return;
      }
      if (!res.ok) {
        if (json.field_errors) setFieldErrors(json.field_errors);
        toast.error(json.error || "Submission failed");
        return;
      }
      setResult({
        external_id: json.external_id,
        reference_id: json.reference_id,
        warning: json.warning ?? null,
        lender_status: json.lender_status ?? null,
        documents_queued: json.documents_queued ?? 0,
      });
      toast.success(`Sent to ${preview.provider.displayName}`);
      await onSubmitted();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setSending(false);
    }
  }

  function copyForLender() {
    if (!result || !preview) return;
    void navigator.clipboard.writeText(`Lead ID: ${result.external_id}\nBusiness: ${preview.business_name ?? ""}`);
    toast.success("Lead ID and business name copied");
  }

  const renderField = (field: VaultField) => {
    const required = preview?.provider.requiredVaultFields.includes(field);
    const parsed = preview?.vault.parsed.includes(field) && !(field in edits);
    return (
      <div key={field} className="space-y-1">
        <Label className="text-[11px] font-bold text-slate-600">
          {VAULT_FIELD_LABELS[field]}
          {required && <span className="text-rose-500"> *</span>}
          {parsed && <Badge variant="outline" className="ml-2 text-[9px] border-amber-300 text-amber-700">parsed — confirm</Badge>}
        </Label>
        <Input
          type={field === "owner_1_dob" ? "date" : field === "ssn" ? "password" : "text"}
          autoComplete="off"
          placeholder={field === "ssn" && preview?.vault.ssn_last4 ? `On file ••${preview.vault.ssn_last4} — type to replace` : ""}
          value={value(field)}
          onChange={(e) => setEdits((prev) => ({ ...prev, [field]: e.target.value }))}
        />
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Send to {preview?.provider.displayName ?? "lender"}</SheetTitle>
          <SheetDescription>
            {preview?.business_name ?? ""} — review what will be sent. Corrections are saved to the client&apos;s vault.
          </SheetDescription>
        </SheetHeader>

        {loading || !preview ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : result ? (
          <div className="space-y-4 py-6">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-bold">
                {result.documents_queued > 0
                  ? "Application created — documents are uploading in the background."
                  : "Application created."}
              </p>
            </div>
            {result.lender_status && (
              <div
                className={
                  result.lender_status.kind === "approved"
                    ? "rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                    : result.lender_status.kind === "declined"
                      ? "rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
                      : "rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                }
              >
                <p className="font-bold">
                  {preview.provider.displayName}: {result.lender_status.stage}
                </p>
                {result.lender_status.note && <p className="mt-1 whitespace-pre-line">{result.lender_status.note}</p>}
              </div>
            )}
            <div className="rounded-lg border border-slate-200 p-4 text-sm space-y-1">
              <p>Lead ID: <span className="font-mono">{result.external_id}</span></p>
              <p>Business: {preview.business_name}</p>
              <p className="text-slate-500">Reference: <span className="font-mono">{result.reference_id}</span></p>
            </div>
            {result.warning && <p className="text-sm text-amber-700">{result.warning}</p>}
            <Button variant="outline" onClick={copyForLender}>
              <Copy className="h-4 w-4 mr-2" /> Copy lead ID + business name
            </Button>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {confirmMessage && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                <p className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4" /> The previous attempt may have reached {preview.provider.displayName}
                </p>
                <p>{confirmMessage}</p>
                <label className="flex items-start gap-2 text-[12px] font-medium">
                  <Checkbox
                    className="mt-0.5"
                    checked={confirmResend}
                    onCheckedChange={(c) => setConfirmResend(c === true)}
                  />
                  <span>I confirmed with the lender that the previous attempt was not received</span>
                </label>
              </div>
            )}
            {openGaps.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Needed before sending</p>
                <ul className="mt-1 list-disc pl-5">
                  {openGaps.map((g) => (
                    <li key={g.field}>{g.label}{g.kind === "invalid" ? " (invalid)" : ""}</li>
                  ))}
                </ul>
              </div>
            )}
            {fieldErrors && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <p className="font-bold">{preview.provider.displayName} rejected:</p>
                <ul className="mt-1 list-disc pl-5">
                  {Object.entries(fieldErrors).map(([f, msgs]) => (
                    <li key={f}>{f}: {msgs.join(", ")}</li>
                  ))}
                </ul>
              </div>
            )}

            <section className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Owner</h3>
              {preview.vault.free_text.home_address && (
                <p className="text-[11px] text-slate-500">On file: {preview.vault.free_text.home_address}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{OWNER_FIELDS.map(renderField)}</div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Business</h3>
              {preview.vault.free_text.business_address && (
                <p className="text-[11px] text-slate-500">On file: {preview.vault.free_text.business_address}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{BUSINESS_FIELDS.map(renderField)}</div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {preview.provider.displayName} details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {preview.provider.picks.map((def) => (
                  <div key={def.key} className="space-y-1">
                    <Label className="text-[11px] font-bold text-slate-600">
                      {def.label}
                      {def.required && <span className="text-rose-500"> *</span>}
                    </Label>
                    <Select value={picks[def.key] || undefined} onValueChange={(v) => setPicks((p) => ({ ...p, [def.key]: v }))}>
                      <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>
                        {def.options.map((o) => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {def.key === "industry_name" && preview.vault.free_text.industry && (
                      <p className="text-[10px] text-slate-400">Vault says: {preview.vault.free_text.industry}</p>
                    )}
                    {def.key === "loan_use" && preview.vault.free_text.loan_purpose && (
                      <p className="text-[10px] text-slate-400 line-clamp-2">Vault says: {preview.vault.free_text.loan_purpose}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Documents ({selected.size} selected)
              </h3>
              {documentGroups.length === 0 && <p className="text-sm text-slate-500">No documents on file for this business.</p>}
              {documentGroups.map(([label, docs]) => {
                const allOn = docs.every((d) => selected.has(d.id));
                return (
                  <div key={label} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-bold text-slate-700">{label}</p>
                      <button
                        type="button"
                        className="text-[10px] font-bold uppercase tracking-widest text-emerald-600"
                        onClick={() => docs.forEach((d) => toggle(d.id, !allOn))}
                      >
                        {allOn ? "Clear" : "Select all"}
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {docs.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-[12px]">
                          <Checkbox checked={selected.has(d.id)} onCheckedChange={(c) => toggle(d.id, c === true)} />
                          <span className="truncate">{d.file_name}</span>
                          {!d.stampable && (
                            <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700">not watermarked</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        {!result && preview && !loading && (
          <SheetFooter className="border-t border-slate-100 pt-4">
            <p className="text-[11px] text-slate-500 mr-auto">
              Sends the owner&apos;s SSN and {selected.size} document{selected.size === 1 ? "" : "s"} to {preview.provider.displayName}.
            </p>
            <Button disabled={sending || openGaps.length > 0 || (needsConfirm && !confirmResend)} onClick={send} className="bg-emerald-500 hover:bg-emerald-600 text-white">
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Send to {preview.provider.displayName}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
