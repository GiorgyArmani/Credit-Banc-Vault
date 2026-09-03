"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Plus,
  Check,
  X,
  Pencil,
  Loader2,
  Search,
  Copy,
  Mail,
  ChevronDown,
  Link2Off,
  PauseCircle,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Briefcase,
  FileCheck2,
} from "lucide-react";
import { BulkOnboarding } from "./bulk-onboarding";
import { FilePreviewModal } from "@/components/file-preview-modal";
import {
  addReferralPartner,
  renameReferralPartner,
  setReferralPartnerActive,
  updateReferralPartnerProfile,
  getPartnerComplianceLinks,
  inviteReferralPartnerToPortal,
  revokeReferralPartnerPortal,
  setPartnerDealDesk,
  deleteReferralPartner,
} from "../actions";

export interface PartnerRow {
  id: string;
  name: string;
  slug: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  commission_type: "percent" | "flat" | null;
  commission_value: number | null;
  portal_enabled: boolean;
  /** This partner works their own deals through the advisor tooling in the
   *  partner portal (role partner_advisor + an advisors row). */
  deal_desk_enabled: boolean;
  /** Deal-desk compliance. All null for a referrals-only partner, who has no
   *  paperwork: a partner_advisor signs a W-9 and uploads a voided check before
   *  their desk unlocks. `onboarding_completed_at` is the gate itself. */
  w9_signed_at: string | null;
  voided_check_uploaded_at: string | null;
  voided_check_filename: string | null;
  onboarding_completed_at: string | null;
  has_login: boolean;
  invited_at: string | null;
  /** NULL while they've been invited but haven't chosen a password yet. */
  password_set_at: string | null;
  last_login_at: string | null;
  referral_count: number;
  funded_count: number;
}

type Filter = "all" | "portal" | "no-link" | "unpriced";

// 103 partners and growing. A single scrolling list buries the controls that
// matter (search, filters, bulk onboarding) under a wall of rows and gives no
// sense of how far through you are.
const PAGE_SIZE = 20;

function referralUrl(marketingUrl: string, slug: string) {
  return `${marketingUrl}/referral-partner?referral_partner=${encodeURIComponent(slug)}`;
}

function commissionLabel(r: PartnerRow): string {
  if (!r.commission_type || r.commission_value === null) return "Not set";
  return r.commission_type === "percent"
    ? `${r.commission_value}% of funded`
    : `$${r.commission_value.toLocaleString("en-US")} flat`;
}

export function ReferralPartnersManager({
  initial,
  marketingUrl,
}: {
  initial: PartnerRow[];
  marketingUrl: string;
}) {
  const [rows, setRows] = useState<PartnerRow[]>(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-sync when the server component re-renders (router.refresh() after a bulk
  // import). Without this the list keeps the snapshot it mounted with, and the
  // freshly imported emails are invisible to the invite step.
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const matchesQuery =
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.slug ?? "").toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q) ||
      (r.company ?? "").toLowerCase().includes(q);
    if (!matchesQuery) return false;
    if (filter === "portal") return r.portal_enabled;
    if (filter === "no-link") return !r.slug;
    if (filter === "unpriced")
      return r.referral_count > 0 && (!r.commission_type || r.commission_value === null);
    return true;
  });

  const activeCount = rows.filter((r) => r.active).length;
  const portalCount = rows.filter((r) => r.portal_enabled).length;

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp rather than reset: deactivating the last row on page 6 should land you
  // on page 5, not throw you back to the top of the list.
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // A new search or filter re-shapes the list under you; staying on page 4 of a
  // result set that now has one page reads as "no results".
  useEffect(() => {
    setPage(1);
    setExpandedId(null);
    setConfirmingDeleteId(null);
  }, [query, filter]);

  function goToPage(n: number) {
    setPage(Math.min(Math.max(1, n), pageCount));
    // An open editor — or an armed delete — belongs to a row that's about to
    // leave the screen.
    setExpandedId(null);
    setConfirmingDeleteId(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function patchRow(id: string, patch: Partial<PartnerRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /**
   * Create a partner, optionally inviting them to the portal in the same click.
   *
   * `andInvite` is the whole manual-onboarding path in one action: create with a
   * name + email, mint the slug, provision the login and send the set-password
   * link. Without it, onboarding one partner is add → find the row → expand →
   * type email → save → invite.
   *
   * `withDealDesk` decides WHICH KIND of partner is being invited, at the moment
   * of invite. We almost always know from the first conversation — a CPA who
   * will only ever pass a link, or someone who intends to submit files — and
   * invite-then-toggle meant the second kind got a welcome email for a portal
   * that did not yet have their desk in it, and no compliance steps to do.
   */
  function handleAdd(andInvite = false, withDealDesk = false) {
    const name = newName.replace(/\s+/g, " ").trim();
    const email = newEmail.trim().toLowerCase();
    if (!name) return;
    if (andInvite && !email) {
      setError("An email is required to invite a partner.");
      return;
    }
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const res = await addReferralPartner(name, { email: email || null });
      if (!res.success) {
        setError(res.error || "Failed to add partner");
        return;
      }

      const stored = res.name || name;
      const id = res.id;

      // Invite BEFORE touching local state, so the row lands in its final shape
      // rather than flickering from "no portal" to "invited".
      let invited = false;
      if (andInvite && id) {
        const inv = await inviteReferralPartnerToPortal(id, { withDealDesk });
        if (inv.success) {
          invited = true;
          setNotice(
            withDealDesk
              ? `${stored} created and invited as a deal desk partner — they'll sign a W-9 and add a voided check before the desk opens.`
              : `${stored} created and invited — sign-in link sent to ${email}.`
          );
        } else {
          setError(
            `${stored} was created, but the invite failed: ${inv.error ?? "unknown error"}`
          );
        }
      } else {
        setNotice(`${stored} created.`);
      }

      const now = new Date().toISOString();
      setRows((prev) => {
        const existing = prev.find(
          (r) => r.name.toLowerCase() === stored.toLowerCase()
        );
        if (existing) {
          return prev
            .map((r) =>
              r.id === existing.id
                ? {
                    ...r,
                    active: true,
                    // The server fills a blank email but won't overwrite one.
                    email: r.email ?? (email || null),
                    slug: r.slug ?? res.slug ?? null,
                    portal_enabled: invited || r.portal_enabled,
                    has_login: invited || r.has_login,
                    invited_at: invited ? now : r.invited_at,
                  }
                : r
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        }
        return [
          ...prev,
          {
            // The real row id, not a placeholder — every row action (deactivate,
            // delete, invite) addresses the database by it.
            id: id ?? `tmp-${stored}`,
            name: stored,
            slug: res.slug ?? null,
            active: true,
            email: email || null,
            phone: null,
            company: null,
            notes: null,
            commission_type: null,
            commission_value: null,
            portal_enabled: invited,
            // Referrals-only unless this was an explicit "invite as deal desk"
            // — which is still a deliberate decision, just made a step earlier.
            deal_desk_enabled: invited && withDealDesk,
            // A partner invited to the desk owes the paperwork from minute one.
            w9_signed_at: null,
            voided_check_uploaded_at: null,
            voided_check_filename: null,
            onboarding_completed_at: null,
            has_login: invited,
            invited_at: invited ? now : null,
            password_set_at: null,
            last_login_at: null,
            referral_count: 0,
            funded_count: 0,
          },
        ].sort((a, b) => a.name.localeCompare(b.name));
      });

      setNewName("");
      setNewEmail("");
      // Surface the partner you just made instead of leaving them buried
      // somewhere on page 4 of an alphabetical list.
      setQuery(stored);
    });
  }

  function handleRename(id: string) {
    const name = editingName.replace(/\s+/g, " ").trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const res = await renameReferralPartner(id, name);
      if (!res.success) {
        setError(res.error || "Failed to rename");
        return;
      }
      setRows((prev) =>
        prev
          .map((r) => (r.id === id ? { ...r, name } : r))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
      setEditingName("");
    });
  }

  function handleToggle(id: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setReferralPartnerActive(id, active);
      if (!res.success) {
        setError(res.error || "Failed to update");
        return;
      }
      patchRow(id, { active });
    });
  }

  function handleInvite(r: PartnerRow, withDealDesk = false) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await inviteReferralPartnerToPortal(r.id, { withDealDesk });
      if (!res.success) {
        setError(res.error || "Could not invite");
        return;
      }
      patchRow(r.id, {
        portal_enabled: true,
        has_login: true,
        invited_at: new Date().toISOString(),
        deal_desk_enabled: withDealDesk || r.deal_desk_enabled,
      });
      setNotice(
        withDealDesk
          ? `${r.name} invited as a deal desk partner — they'll sign a W-9 and add a voided check before the desk opens.`
          : `Invite sent to ${r.email}.`
      );
    });
  }

  function handleRevoke(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await revokeReferralPartnerPortal(id);
      if (!res.success) {
        setError(res.error || "Could not pause access");
        return;
      }
      patchRow(id, { portal_enabled: false });
    });
  }

  function handleDealDesk(r: PartnerRow, enabled: boolean) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await setPartnerDealDesk(r.id, enabled);
      if (!res.success) {
        setError(res.error || "Could not update the deal desk");
        return;
      }
      patchRow(r.id, { deal_desk_enabled: enabled });
      setNotice(
        enabled
          ? `${r.name} can now create and work their own deals.`
          : `${r.name} is back to referrals only.`
      );
    });
  }

  function handleDelete(r: PartnerRow) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteReferralPartner(r.id);
      if (!res.success) {
        // Most failures are "this partner has referrals — deactivate instead".
        // Disarm so the message isn't hidden behind a live Yes button.
        setConfirmingDeleteId(null);
        setError(res.error || "Could not delete");
        return;
      }
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      setExpandedId(null);
      setConfirmingDeleteId(null);
      setNotice(`Deleted ${res.name || r.name}.`);
    });
  }

  async function copyLink(r: PartnerRow) {
    if (!r.slug) return;
    try {
      await navigator.clipboard.writeText(referralUrl(marketingUrl, r.slug));
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard blocked — the link is visible in the detail panel */
    }
  }

  return (
    <div className="max-w-5xl">
      <BulkOnboarding
        rows={rows}
        onInvited={(ids) => {
          const now = new Date().toISOString();
          setRows((prev) =>
            prev.map((r) =>
              ids.includes(r.id)
                ? { ...r, portal_enabled: true, has_login: true, invited_at: now }
                : r
            )
          );
        }}
      />

      {/* Add new — name + email together, because onboarding needs both and
          splitting them left half-configured partners who couldn't be invited.
          Email stays optional: attribution-only entries (ACG, Linkedin) never
          get a login. */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd(false)}
            placeholder="Partner name…"
            className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && handleAdd(Boolean(newEmail.trim()))
            }
            placeholder="Email (optional — required to invite)"
            className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => handleAdd(false)}
            disabled={isPending || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </button>

          <button
            type="button"
            onClick={() => handleAdd(true)}
            disabled={isPending || !newName.trim() || !newEmail.trim()}
            title={
              newEmail.trim()
                ? "Create, then email a sign-in link"
                : "Add an email to invite"
            }
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Add &amp; invite
          </button>

          {/* The same thing, for the partner we already know will submit deals.
              Separate button rather than a checkbox: it is a different KIND of
              partner, it grants client access, and it should read as its own
              decision rather than a modifier on the safe one. */}
          <button
            type="button"
            onClick={() => handleAdd(true, true)}
            disabled={isPending || !newName.trim() || !newEmail.trim()}
            title={
              newEmail.trim()
                ? "Create, invite, and open the deal desk — they sign a W-9 and add a voided check before it unlocks"
                : "Add an email to invite"
            }
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Briefcase className="h-4 w-4" />
            )}
            Add &amp; invite as deal desk
          </button>

          <span className="text-[11px] text-slate-400">
            A link name is generated automatically — edit it on the row.
          </span>
        </div>
      </div>

      {error && <p className="mb-3 text-sm font-semibold text-red-600">{error}</p>}
      {notice && <p className="mb-3 text-sm font-semibold text-emerald-600">{notice}</p>}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, link, email or firm…"
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["portal", "Portal on"],
              ["no-link", "No link"],
              ["unpriced", "Unpriced"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={
                filter === key
                  ? "px-3 py-2 text-[11px] font-bold uppercase tracking-wide rounded-xl bg-slate-900 text-white"
                  : "px-3 py-2 text-[11px] font-bold uppercase tracking-wide rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-800"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
          {activeCount} active · {portalCount} with portal · {rows.length} total
        </p>
        {filtered.length > 0 && (
          <p className="text-[11px] font-semibold text-slate-400">
            Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
            {filtered.length !== rows.length && " matching"}
          </p>
        )}
      </div>

      {/* List */}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden bg-white">
        {visible.map((r) => {
          const expanded = expandedId === r.id;
          return (
            <li key={r.id}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                {editingId === r.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(r.id)}
                      className="flex-1 px-3 py-1.5 border border-emerald-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <button
                      onClick={() => handleRename(r.id)}
                      disabled={isPending}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                      className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      className="flex flex-1 items-center gap-3 text-left min-w-0"
                    >
                      <ChevronDown
                        className={
                          expanded
                            ? "h-4 w-4 text-slate-400 shrink-0 rotate-180 transition-transform"
                            : "h-4 w-4 text-slate-300 shrink-0 transition-transform"
                        }
                      />
                      <span className="min-w-0">
                        <span
                          className={
                            r.active
                              ? "block text-sm font-semibold text-slate-800 truncate"
                              : "block text-sm font-semibold text-slate-400 line-through truncate"
                          }
                        >
                          {r.name}
                          {r.company && (
                            <span className="ml-2 font-normal text-slate-400">
                              {r.company}
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-400 truncate">
                          {r.slug ? (
                            <code className="text-slate-500">{r.slug}</code>
                          ) : (
                            <span className="text-amber-600 font-semibold">
                              no link
                            </span>
                          )}
                          {" · "}
                          {r.referral_count} referred · {r.funded_count} funded
                          {" · "}
                          {commissionLabel(r)}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Delete confirm takes over the whole action cluster.
                          Showing it inline beats a browser confirm(): the partner's
                          name stays on screen next to the button you're about to
                          press, so you can see you're deleting the right row. */}
                      {confirmingDeleteId === r.id ? (
                        <>
                          <span className="text-[11px] font-bold text-red-600 mr-1">
                            Delete permanently?
                          </span>
                          <button
                            onClick={() => handleDelete(r)}
                            disabled={isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold uppercase tracking-wide rounded-lg disabled:opacity-50"
                          >
                            {isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(null)}
                            className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-lg"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                      <>
                      {/* Invited ≠ activated: the partner only counts as onboarded
                          once they've set a password. Showing one "Portal" badge
                          for both hides the partners who never opened the email. */}
                      {r.portal_enabled &&
                        (r.password_set_at ? (
                          <span className="hidden sm:inline px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-emerald-50 text-emerald-600">
                            Portal
                          </span>
                        ) : (
                          <span
                            className="hidden sm:inline px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-50 text-amber-600"
                            title="Invited — hasn't set a password yet"
                          >
                            Invited
                          </span>
                        ))}
                      {r.slug && (
                        <button
                          onClick={() => copyLink(r)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg"
                          title="Copy referral link"
                        >
                          {copiedId === r.id ? (
                            <Check className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(r.id);
                          setEditingName(r.name);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg"
                        title="Rename"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleToggle(r.id, !r.active)}
                        disabled={isPending}
                        className={
                          r.active
                            ? "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            : "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600 hover:bg-emerald-50 rounded-lg"
                        }
                      >
                        {r.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteId(r.id)}
                        disabled={isPending}
                        className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                        title="Delete permanently"
                        aria-label={`Delete ${r.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {expanded && (
                <PartnerDetail
                  row={r}
                  marketingUrl={marketingUrl}
                  isPending={isPending}
                  onSaved={(patch) => patchRow(r.id, patch)}
                  onError={setError}
                  onNotice={setNotice}
                  onInvite={() => handleInvite(r)}
                  onInviteWithDealDesk={() => handleInvite(r, true)}
                  onRevoke={() => handleRevoke(r.id)}
                  onDealDesk={(enabled) => handleDealDesk(r, enabled)}
                  startTransition={startTransition}
                />
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-400">
            No partners found.
          </li>
        )}
      </ul>

      {pageCount > 1 && (
        <Pager page={safePage} pageCount={pageCount} onGo={goToPage} />
      )}
    </div>
  );
}

/**
 * Expanded editor for one partner. Kept in this file rather than split out —
 * it shares every piece of the list's state and would need all of it passed
 * back down anyway.
 */
function PartnerDetail({
  row,
  marketingUrl,
  isPending,
  onSaved,
  onError,
  onNotice,
  onInvite,
  onInviteWithDealDesk,
  onRevoke,
  onDealDesk,
  startTransition,
}: {
  row: PartnerRow;
  marketingUrl: string;
  isPending: boolean;
  onSaved: (patch: Partial<PartnerRow>) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
  onInvite: () => void;
  onInviteWithDealDesk: () => void;
  onRevoke: () => void;
  onDealDesk: (enabled: boolean) => void;
  startTransition: (cb: () => void) => void;
}) {
  const [slug, setSlug] = useState(row.slug ?? "");
  const [email, setEmail] = useState(row.email ?? "");
  const [phone, setPhone] = useState(row.phone ?? "");
  const [company, setCompany] = useState(row.company ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [commissionType, setCommissionType] = useState<"" | "percent" | "flat">(
    row.commission_type ?? ""
  );
  const [commissionValue, setCommissionValue] = useState(
    row.commission_value === null ? "" : String(row.commission_value)
  );

  function save() {
    onError(null);
    onNotice(null);
    startTransition(async () => {
      const res = await updateReferralPartnerProfile(row.id, {
        slug: slug.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        company: company.trim() || null,
        notes: notes.trim() || null,
        commission_type: commissionType || null,
        commission_value:
          commissionValue.trim() === "" ? null : Number(commissionValue),
      });
      if (!res.success) {
        onError(res.error || "Could not save");
        return;
      }
      onSaved({
        slug: (res.slug ?? slug.trim()) || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        company: company.trim() || null,
        notes: notes.trim() || null,
        commission_type: commissionType || null,
        commission_value:
          commissionValue.trim() === "" ? null : Number(commissionValue),
      });
      onNotice("Saved.");
    });
  }

  const liveLink = row.slug ? referralUrl(marketingUrl, row.slug) : null;

  return (
    <div className="bg-slate-50/70 border-t border-slate-100 px-4 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Link name (URL token)">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Jane_Doe"
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          {liveLink && (
            <p className="mt-1 text-[11px] text-slate-400 break-all">{liveLink}</p>
          )}
        </Field>

        <Field label="Email (required to invite)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@firm.com"
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </Field>

        <Field label="Phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </Field>

        <Field label="Firm">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </Field>

        <Field label="Commission (internal — not shown to the partner)">
          <div className="flex gap-2">
            <select
              value={commissionType}
              onChange={(e) =>
                setCommissionType(e.target.value as "" | "percent" | "flat")
              }
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none"
            >
              <option value="">Not set</option>
              <option value="percent">% of funded</option>
              <option value="flat">Flat $</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
              disabled={!commissionType}
              placeholder={commissionType === "flat" ? "500" : "5"}
              className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-100"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Applies to deals funded from now on — existing ledger rows keep the
            rate they were booked at.
          </p>
        </Field>

        <Field label="Notes">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          onClick={save}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </button>

        {row.portal_enabled ? (
          <>
            <button
              onClick={onInvite}
              disabled={isPending || !row.email}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-lg disabled:opacity-50"
              title="Send the sign-in link again"
            >
              <Mail className="h-4 w-4" />
              Re-send link
            </button>
            <button
              onClick={onRevoke}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-red-600 hover:bg-red-50 text-sm font-bold rounded-lg disabled:opacity-50"
            >
              <PauseCircle className="h-4 w-4" />
              Pause access
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onInvite}
              disabled={isPending || !row.email}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
              title={row.email ? "Create the login and email a sign-in link" : "Add an email first"}
            >
              <Mail className="h-4 w-4" />
              Invite to portal
            </button>
            {/* Skips the invite → toggle two-step for a partner we already know
                will be submitting files. Same provisioning, one click earlier. */}
            <button
              onClick={onInviteWithDealDesk}
              disabled={isPending || !row.email}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
              title={
                row.email
                  ? "Invite and open the deal desk — they sign a W-9 and add a voided check before it unlocks"
                  : "Add an email first"
              }
            >
              <Briefcase className="h-4 w-4" />
              Invite as deal desk
            </button>
          </>
        )}

        {!row.slug && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
            <Link2Off className="h-3.5 w-3.5" />
            No link — referrals can only be attributed by hand
          </span>
        )}

      </div>

      {/* Deal desk — a separate decision from portal access, and a bigger one.
          Portal access shows a partner their own referrals, read-only. The deal
          desk makes them an advisor on the files they create: client creation,
          documents, approvals, pipeline, underwriting submission. Kept visually
          apart from the Save/Invite row so it can't be flipped by muscle memory. */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px] flex-1">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-violet-600" />
              <span className="text-sm font-bold text-slate-900">Deal desk</span>
              {row.deal_desk_enabled && (
                <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                  Enabled
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {row.deal_desk_enabled
                ? "This partner creates and works their own deals in the portal — documents, approvals, pipeline and underwriting submission. They still earn their referral commission on every file they open."
                : "Let this partner create and work their own deals in the portal, the same way an advisor does. They only ever see files they own or follow."}
            </p>
            {!row.portal_enabled && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
                <Link2Off className="h-3.5 w-3.5" />
                Invite them to the portal first — the deal desk lives inside it
              </p>
            )}
          </div>

          <button
            onClick={() => onDealDesk(!row.deal_desk_enabled)}
            disabled={isPending || !row.portal_enabled}
            className={
              row.deal_desk_enabled
                ? "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                : "inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
            }
            title={
              row.portal_enabled
                ? undefined
                : "Invite this partner to the portal before enabling the deal desk"
            }
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Briefcase className="h-4 w-4" />
            )}
            {row.deal_desk_enabled ? "Turn off deal desk" : "Enable deal desk"}
          </button>
        </div>

        {/* Compliance. Only meaningful once the desk is on — a referrals-only
            partner has no paperwork to do. */}
        {row.deal_desk_enabled && (
          <PartnerCompliance row={row} />
        )}
      </div>

      {row.invited_at && (
        <p className="mt-3 text-[11px] text-slate-400">
          {`Invited ${new Date(row.invited_at).toLocaleDateString()}`}
          {" · "}
          {row.password_set_at ? (
            <>
              {`Password set ${new Date(row.password_set_at).toLocaleDateString()}`}
              {row.last_login_at &&
                ` · Last seen ${new Date(row.last_login_at).toLocaleDateString()}`}
            </>
          ) : (
            <span className="font-semibold text-amber-600">
              Hasn&apos;t opened the invite yet — re-send if it&apos;s been a while
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Page navigation for the partner list.
 *
 * Renders every page number when there are few enough, and a windowed
 * first…current±1…last when there aren't. Jumping straight to the last page
 * matters here: the list is alphabetical, so "the partners I just added" are
 * usually nowhere near the front.
 */
function Pager({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (n: number) => void;
}) {
  // Build the visible page tokens: numbers, with `null` standing for a gap.
  const tokens: (number | null)[] = [];
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i++) tokens.push(i);
  } else {
    const push = (n: number) => {
      if (!tokens.includes(n)) tokens.push(n);
    };
    push(1);
    if (page > 3) tokens.push(null);
    for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i++) push(i);
    if (page < pageCount - 2) tokens.push(null);
    push(pageCount);
  }

  const arrow =
    "inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white transition-colors";

  return (
    <nav
      aria-label="Referral partner pages"
      className="flex items-center justify-center gap-1.5 mt-4"
    >
      <button
        onClick={() => onGo(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className={arrow}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {tokens.map((t, i) =>
        t === null ? (
          <span key={`gap-${i}`} className="px-1 text-slate-300 select-none">
            …
          </span>
        ) : (
          <button
            key={t}
            onClick={() => onGo(t)}
            aria-current={t === page ? "page" : undefined}
            className={
              t === page
                ? "h-8 min-w-8 px-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
                : "h-8 min-w-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold transition-colors"
            }
          >
            {t}
          </button>
        )
      )}

      <button
        onClick={() => onGo(page + 1)}
        disabled={page === pageCount}
        aria-label="Next page"
        className={arrow}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

/**
 * Deal-desk compliance at a glance: W-9 signed, voided check on file, and
 * whether the gate is open.
 *
 * The links are fetched on click, never rendered into the page. Both documents
 * live in the private `vault` bucket and are reached by a 10-minute signed URL;
 * baking one into server HTML would put a working credential into something
 * that gets cached and screenshotted.
 */
function PartnerCompliance({ row }: { row: PartnerRow }) {
  const [links, setLinks] = useState<{
    w9_url?: string | null;
    voided_check_url?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  // Opens in the app's own previewer rather than a new tab: the signed URL is a
  // ten-minute credential to a W-9 (SSN/EIN) or a voided check (routing +
  // account number), and a tab of its own leaves it in browser history.
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const w9Done = !!row.w9_signed_at;
  const checkDone = !!row.voided_check_uploaded_at;
  // Grandfathered partners (migration 20260825) are complete with neither
  // document — they had the desk before the gate existed, and saying "complete"
  // where there is nothing to open is what tells an admin to go chase it.
  const grandfathered = !!row.onboarding_completed_at && !w9Done && !checkDone;

  async function fetchLinks() {
    setLoading(true);
    try {
      const res = await getPartnerComplianceLinks(row.id);
      if (res.success) setLinks({ w9_url: res.w9_url, voided_check_url: res.voided_check_url });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Compliance
        </span>
        {row.onboarding_completed_at ? (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
            {grandfathered ? "Grandfathered" : "Complete"}
          </span>
        ) : (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Desk locked
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
        <span className={w9Done ? "font-semibold text-slate-800" : "text-slate-400"}>
          {w9Done
            ? `W-9 signed ${new Date(row.w9_signed_at as string).toLocaleDateString()}`
            : "W-9 not signed"}
        </span>
        <span className={checkDone ? "font-semibold text-slate-800" : "text-slate-400"}>
          {checkDone
            ? `Voided check ${new Date(row.voided_check_uploaded_at as string).toLocaleDateString()}`
            : "No voided check"}
        </span>
      </div>

      {(w9Done || checkDone) &&
        (links ? (
          <div className="mt-2 flex flex-wrap gap-4 text-xs font-bold">
            {links.w9_url ? (
              <button
                type="button"
                onClick={() => setPreview({ name: `W-9 — ${row.name}.pdf`, url: links.w9_url as string })}
                className="text-violet-700 underline underline-offset-4 hover:text-violet-900"
              >
                Open W-9
              </button>
            ) : (
              w9Done && <span className="text-slate-400">W-9 file missing</span>
            )}
            {links.voided_check_url ? (
              <button
                type="button"
                onClick={() =>
                  setPreview({
                    name: row.voided_check_filename || "Voided check",
                    url: links.voided_check_url as string,
                  })
                }
                className="text-violet-700 underline underline-offset-4 hover:text-violet-900"
              >
                Open voided check
              </button>
            ) : (
              checkDone && <span className="text-slate-400">Check file missing</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={fetchLinks}
            disabled={loading}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 underline underline-offset-4 hover:text-violet-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            View documents
          </button>
        ))}

      {grandfathered && (
        <p className="mt-2 text-[11px] text-amber-600">
          Had the desk before the paperwork gate existed — chase the W-9 and voided
          check by hand.
        </p>
      )}

      <FilePreviewModal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        name={preview?.name ?? ""}
        url={preview?.url ?? null}
      />
    </div>
  );
}
