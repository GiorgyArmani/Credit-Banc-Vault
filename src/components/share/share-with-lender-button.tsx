"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2, Loader2, Copy, Check, Trash2, Link as LinkIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import clsx from "clsx";

interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

interface ShareableFile {
  id: string;
  file_name: string;
  doc_code: string;
  label: string;
}

interface Props {
  clientId: string;
  businessProfileId: string | null;
  /** Classes for the trigger button so it blends into its host (grid vs toolbar). */
  className?: string;
  triggerLabel?: string;
  /** Lenders already on the deal — offered as a dropdown for the link label so
   *  staff pick who they're sending to instead of retyping. Omitted (advisor
   *  view) → falls back to a free-text field. */
  lenderOptions?: string[];
}

const OTHER_LENDER = "__other__";

const EXPIRY_OPTIONS = [7, 14, 30] as const;

function link_status(l: ShareLink): { label: string; tone: string } {
  if (l.revoked_at) return { label: "Revoked", tone: "bg-slate-100 text-slate-500" };
  if (new Date(l.expires_at).getTime() < Date.now())
    return { label: "Expired", tone: "bg-amber-100 text-amber-700" };
  return { label: "Active", tone: "bg-emerald-100 text-emerald-700" };
}

function format_date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ShareWithLenderButton({
  clientId,
  businessProfileId,
  className,
  triggerLabel = "Share",
  lenderOptions,
}: Props) {
  const lender_choices = Array.from(new Set((lenderOptions ?? []).filter(Boolean)));
  // When lenders exist we show a dropdown; "Other…" flips to a free-text field.
  const [custom_mode, set_custom_mode] = useState(false);
  const [open, set_open] = useState(false);
  const [links, set_links] = useState<ShareLink[]>([]);
  const [loading_links, set_loading_links] = useState(false);
  const [generating, set_generating] = useState(false);
  const [expiry_days, set_expiry_days] = useState<number>(14);
  const [lender_label, set_lender_label] = useState("");
  const [copied_id, set_copied_id] = useState<string | null>(null);
  const [revoking_id, set_revoking_id] = useState<string | null>(null);
  const [files, set_files] = useState<ShareableFile[]>([]);
  const [loading_docs, set_loading_docs] = useState(false);
  // File ids the lender will receive. Defaults to every approved file once loaded.
  const [selected_ids, set_selected_ids] = useState<Set<string>>(new Set());

  // Files grouped under their category label for the picker.
  const grouped_files = useMemo(() => {
    const groups = new Map<string, ShareableFile[]>();
    for (const f of files) {
      const arr = groups.get(f.label) ?? [];
      arr.push(f);
      groups.set(f.label, arr);
    }
    return Array.from(groups.entries());
  }, [files]);

  function build_url(token: string): string {
    // Browser origin → respects whatever public host the proxy serves.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/share/${token}`;
  }

  async function load_links() {
    set_loading_links(true);
    try {
      const qs = new URLSearchParams({ client_id: clientId });
      if (businessProfileId) qs.set("business_profile_id", businessProfileId);
      const res = await fetch(`/api/share-links?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) set_links(data.links ?? []);
    } catch (err) {
      console.error("load share links error:", err);
    } finally {
      set_loading_links(false);
    }
  }

  async function load_docs() {
    set_loading_docs(true);
    try {
      const qs = new URLSearchParams({ client_id: clientId });
      if (businessProfileId) qs.set("business_profile_id", businessProfileId);
      const res = await fetch(`/api/share-links/documents?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const list = (data.files ?? []) as ShareableFile[];
        set_files(list);
        // Start with every file checked — staff uncheck what a lender shouldn't see.
        set_selected_ids(new Set(list.map((f) => f.id)));
      }
    } catch (err) {
      console.error("load shareable files error:", err);
    } finally {
      set_loading_docs(false);
    }
  }

  function toggle_id(id: string) {
    set_selected_ids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handle_open(next: boolean) {
    set_open(next);
    if (next) {
      load_links();
      load_docs();
    }
  }

  async function copy_link(token: string, id: string) {
    try {
      await navigator.clipboard.writeText(build_url(token));
      set_copied_id(id);
      toast.success("Link copied to clipboard");
      setTimeout(() => set_copied_id((c) => (c === id ? null : c)), 2000);
    } catch {
      toast.error("Couldn't copy — copy it manually");
    }
  }

  async function generate() {
    if (files.length > 0 && selected_ids.size === 0) {
      toast.error("Select at least one file to share");
      return;
    }
    set_generating(true);
    try {
      const res = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          business_profile_id: businessProfileId,
          expires_in_days: expiry_days,
          label: lender_label.trim() || undefined,
          // Send the exact files chosen. Always sent as an explicit list so the
          // link is a snapshot of what was selected now.
          document_ids: files.length > 0 ? Array.from(selected_ids) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to create link");
        return;
      }
      set_links((prev) => [data.link, ...prev]);
      set_lender_label("");
      await copy_link(data.link.token, data.link.id);
    } catch (err) {
      console.error("generate share link error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_generating(false);
    }
  }

  async function revoke(id: string) {
    set_revoking_id(id);
    try {
      const res = await fetch(`/api/share-links/${id}/revoke`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to revoke link");
        return;
      }
      // Drop it from the list — revoked links are gone from the staff view.
      set_links((prev) => prev.filter((l) => l.id !== id));
      toast.success("Link revoked");
    } catch (err) {
      console.error("revoke share link error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_revoking_id(null);
    }
  }

  return (
    <>
      <button
        onClick={() => handle_open(true)}
        className={clsx(
          "flex items-center justify-center gap-2 transition-colors",
          className ??
            "px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl"
        )}
      >
        <Share2 className="h-4 w-4" />
        {triggerLabel}
      </button>

      <Dialog open={open} onOpenChange={handle_open}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share documents with a lender</DialogTitle>
            <DialogDescription>
              Generates a secure link to this client&apos;s <strong>approved</strong> documents for
              the selected business. Anyone with the link can view and download until it expires.
            </DialogDescription>
          </DialogHeader>

          {/* Generate */}
          <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Lender name (optional)
              </label>
              {lender_choices.length > 0 && !custom_mode ? (
                <select
                  value={lender_choices.includes(lender_label) ? lender_label : ""}
                  onChange={(e) => {
                    if (e.target.value === OTHER_LENDER) {
                      set_custom_mode(true);
                      set_lender_label("");
                    } else {
                      set_lender_label(e.target.value);
                    }
                  }}
                  className="w-full h-10 text-sm border border-slate-200 rounded-lg px-3 bg-white text-slate-700"
                >
                  <option value="">Select a lender…</option>
                  {lender_choices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={OTHER_LENDER}>Other (type a name)…</option>
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={lender_label}
                    onChange={(e) => set_lender_label(e.target.value)}
                    placeholder="e.g. LG Funding"
                    maxLength={120}
                  />
                  {lender_choices.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        set_custom_mode(false);
                        set_lender_label("");
                      }}
                      className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
                    >
                      Pick lender
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* File picker — choose the exact files this lender sees. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Files to share
                </label>
                {files.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => set_selected_ids(new Set(files.map((f) => f.id)))}
                      className="text-emerald-600 hover:text-emerald-700"
                    >
                      All
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => set_selected_ids(new Set())}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      None
                    </button>
                  </div>
                )}
              </div>
              {loading_docs ? (
                <div className="py-4 text-center">
                  <Loader2 className="h-4 w-4 text-emerald-500 animate-spin mx-auto" />
                </div>
              ) : files.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">
                  No approved documents yet — approve documents before sharing.
                </p>
              ) : (
                <div className="max-h-[220px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {grouped_files.map(([label, group]) => (
                    <div key={label} className="py-1">
                      <p className="px-3 pt-1.5 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {label}
                      </p>
                      {group.map((f) => (
                        <label
                          key={f.id}
                          className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={selected_ids.has(f.id)}
                            onChange={() => toggle_id(f.id)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-slate-700 flex-1 truncate" title={f.file_name}>
                            {f.file_name}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Expires in
                </label>
                <select
                  value={expiry_days}
                  onChange={(e) => set_expiry_days(parseInt(e.target.value))}
                  className="h-10 text-sm font-semibold border border-slate-200 rounded-lg px-3 bg-white text-slate-700"
                >
                  {EXPIRY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={generate}
                disabled={generating}
                className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white min-w-[150px]"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Generate link
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Existing links */}
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 px-1">
              Links
            </p>
            {loading_links ? (
              <div className="py-6 text-center">
                <Loader2 className="h-5 w-5 text-emerald-500 animate-spin mx-auto" />
              </div>
            ) : links.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No links yet.</p>
            ) : (
              links.map((l) => {
                const status = link_status(l);
                const is_active = !l.revoked_at && new Date(l.expires_at).getTime() >= Date.now();
                return (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">
                          {l.label || "Untitled link"}
                        </span>
                        <span
                          className={clsx(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                            status.tone
                          )}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Expires {format_date(l.expires_at)} · {l.view_count} view
                        {l.view_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {is_active && (
                        <button
                          onClick={() => copy_link(l.token, l.id)}
                          title="Copy link"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                        >
                          {copied_id === l.id ? (
                            <Check className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {is_active && (
                        <button
                          onClick={() => revoke(l.id)}
                          disabled={revoking_id === l.id}
                          title="Revoke link"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {revoking_id === l.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
