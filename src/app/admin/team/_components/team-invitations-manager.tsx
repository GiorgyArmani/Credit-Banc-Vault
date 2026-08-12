"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  INVITABLE_ROLES,
  ROLE_LABEL,
  type InvitableRole,
  type InviteState,
} from "@/lib/auth/staff-invite-shared";
import {
  inviteStaffMember,
  resendStaffInvite,
  revokeStaffInvite,
  deleteStaffInvite,
} from "../actions";

export interface InviteRow {
  id: string;
  email: string;
  role: InvitableRole;
  first_name: string | null;
  last_name: string | null;
  note: string | null;
  expires_at: string;
  invited_by_email: string | null;
  send_count: number;
  last_sent_at: string | null;
  created_at: string;
  state: InviteState;
  accepted_at: string | null;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

type Tab = "invitations" | "members";

const STATE_STYLES: Record<InviteState, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200" },
  accepted: { label: "Accepted", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  expired: { label: "Expired", className: "bg-slate-100 text-slate-500 border-slate-200" },
  revoked: { label: "Cancelled", className: "bg-rose-50 text-rose-600 border-rose-200" },
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-slate-900 text-white",
  advisor: "bg-emerald-100 text-emerald-800",
  underwriting: "bg-indigo-100 text-indigo-800",
  setter: "bg-amber-100 text-amber-800",
  // Deliberately a different colour family from `advisor`: these are external
  // people (CPAs, bankers) working their own deals, and an admin scanning this
  // list should be able to tell at a glance which advisors aren't employees.
  partner_advisor: "bg-violet-100 text-violet-800",
};

/** Display names for the member list, which shows every staff role — not just
 *  the invitable ones ROLE_LABEL covers. */
const MEMBER_ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  advisor: "Advisor",
  underwriting: "Underwriting",
  setter: "Setter",
  partner_advisor: "Partner Advisor",
};

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "in 6 days" / "5 days ago" — an expiry date alone makes the reader do the
 *  arithmetic that decides whether to resend. */
function relativeDays(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

export function TeamInvitationsManager({
  invites,
  members,
}: {
  invites: InviteRow[];
  members: MemberRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("invitations");
  const [rows, setRows] = useState<InviteRow[]>(invites);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<InviteState | "all">("all");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("advisor");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-sync when the server component re-renders after router.refresh().
  useEffect(() => {
    setRows(invites);
  }, [invites]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const matches =
      !q ||
      r.email.toLowerCase().includes(q) ||
      [r.first_name, r.last_name].filter(Boolean).join(" ").toLowerCase().includes(q);
    if (!matches) return false;
    if (stateFilter !== "all") return r.state === stateFilter;
    return true;
  });

  const pendingCount = rows.filter((r) => r.state === "pending").length;

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    setTimeout(() => setNotice(null), 6000);
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await inviteStaffMember({ email, role, firstName, lastName });
      if (!res.success) {
        setError(res.error || "Could not send that invitation");
        return;
      }
      flash(res.warning || `Invitation sent to ${email.trim().toLowerCase()}.`);
      if (res.warning) setError(res.warning);
      setEmail("");
      setFirstName("");
      setLastName("");
      setFormOpen(false);
      router.refresh();
    });
  }

  function run(id: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) {
    setError(null);
    setNotice(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.success) {
        setError(res.error || "That didn't work");
        return;
      }
      flash(ok);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Tabs + invite button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(
            [
              ["invitations", `Invitations${pendingCount ? ` (${pendingCount})` : ""}`],
              ["members", `Team (${members.length})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === key ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "invitations" && (
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
          >
            {formOpen ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {formOpen ? "Cancel" : "Invite teammate"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      )}

      {tab === "invitations" && (
        <>
          {formOpen && (
            <form
              onSubmit={handleInvite}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Work email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@creditbanc.com"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-1.5 text-xs text-slate-400">
                    The invitation only works for this address — it can&apos;t be forwarded and used
                    by someone else.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    First name <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Last name <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Role
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {INVITABLE_ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                          role === r
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {ROLE_LABEL[r]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Admin isn&apos;t invitable by email — promote an existing account instead.
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send invitation
              </button>
            </form>
          )}

          {/* Search + state filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "pending", "accepted", "expired", "revoked"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStateFilter(s)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                    stateFilter === s
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-500 hover:text-slate-900 border border-slate-200"
                  }`}
                >
                  {s === "all" ? "All" : STATE_STYLES[s].label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {filtered.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Mail className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  {rows.length === 0 ? "No invitations yet" : "Nothing matches that"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {rows.length === 0
                    ? "Invite an advisor, underwriter or setter to get started."
                    : "Try a different search or filter."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
                  const busy = busyId === r.id && isPending;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                      <div className="min-w-[200px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {name || r.email}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              ROLE_BADGE[r.role] ?? "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {ROLE_LABEL[r.role] ?? r.role}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              STATE_STYLES[r.state].className
                            }`}
                          >
                            {STATE_STYLES[r.state].label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {name && <span className="mr-2">{r.email}</span>}
                          {r.state === "pending" && (
                            <span>Expires {relativeDays(r.expires_at)}</span>
                          )}
                          {r.state === "expired" && (
                            <span>Expired {relativeDays(r.expires_at)}</span>
                          )}
                          {r.state === "accepted" && (
                            <span>Joined {shortDate(r.accepted_at)}</span>
                          )}
                          {r.state === "revoked" && <span>Cancelled</span>}
                          {r.invited_by_email && (
                            <span className="ml-2 text-slate-400">
                              · invited by {r.invited_by_email}
                            </span>
                          )}
                          {r.send_count > 1 && (
                            <span className="ml-2 text-slate-400">· sent {r.send_count}×</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {(r.state === "pending" || r.state === "expired") && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(r.id, () => resendStaffInvite(r.id), `New link sent to ${r.email}.`)
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
                            title="Sends a brand-new link and kills the old one"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Resend
                          </button>
                        )}

                        {r.state === "pending" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(r.id, () => revokeStaffInvite(r.id), `Invitation for ${r.email} cancelled.`)
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        )}

                        {r.state !== "accepted" &&
                          (confirmingDeleteId === r.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(r.id, () => deleteStaffInvite(r.id), "Invitation deleted.")
                                }
                                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteId(null)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-500"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmingDeleteId(r.id)}
                              className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-slate-50 hover:text-rose-500"
                              title="Remove this row entirely"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === "members" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {members.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-slate-400">
              No staff accounts yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-[200px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{m.name}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          ROLE_BADGE[m.role] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {MEMBER_ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {m.email} · joined {shortDate(m.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
        <span>
          Invitation links are single-use and expire after 7 days. We store only a hash of each
          link, so it can&apos;t be looked up here — if someone loses theirs, hit Resend, which
          issues a new link and immediately invalidates the old one.
        </span>
      </p>
    </div>
  );
}
