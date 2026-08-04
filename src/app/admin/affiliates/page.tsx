// src/app/admin/affiliates/page.tsx
//
// Admin overview of the affiliate program: every affiliate with their referral
// and funding counts, plus the payout ledger with retry/mark-delivered controls
// for the Giftronaut sends. Proxy already gates /admin to admins; we re-check
// defensively. Reads via the service role (affiliate tables are RLS-locked).
// A separate index — does NOT fork the canonical client detail route.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PayoutActions } from "./_components/payout-actions";
import { Gift } from "lucide-react";

export const dynamic = "force-dynamic";

const PAYOUT_LABELS: Record<string, string> = {
  queued: "Queued",
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  canceled: "Canceled",
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * A payout the guardrails stopped: `hold_reason` is set, so the cron worker will
 * never auto-send it. It needs an admin decision, hence "Held" rather than the
 * routine "Queued".
 */
function isHeld(p: { status: string; hold_reason?: string | null }): boolean {
  return Boolean(p.hold_reason) && p.status !== "sent" && p.status !== "delivered" && p.status !== "canceled";
}

/** Still inside the 24h review window — the worker hasn't been allowed to send yet. */
function isWaiting(p: { status: string; hold_reason?: string | null; release_at?: string | null }): boolean {
  if (isHeld(p) || p.status === "sent" || p.status === "delivered" || p.status === "canceled") return false;
  return Boolean(p.release_at) && new Date(p.release_at as string) > new Date();
}

/** "in 14h" / "in 40m" — how long until the gift card is created. */
function untilRelease(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any minute";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `in ${hours}h`;
  return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminAffiliatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const db = createAdminClient();

  const [{ data: affiliates }, { data: leads }, { data: payouts }] = await Promise.all([
    db.from("affiliates").select("id, referral_code, first_name, last_name, email, link_clicks, status, created_at").order("created_at", { ascending: false }),
    db.from("affiliate_leads").select("affiliate_id, status"),
    db.from("affiliate_payouts").select("id, affiliate_id, commission_amount, status, giftronaut_order_id, error, hold_reason, release_at, attempts, created_at, affiliates(first_name, last_name, email)").order("created_at", { ascending: false }),
  ]);

  const affRows = affiliates ?? [];
  const leadRows = leads ?? [];
  const payoutRows = payouts ?? [];

  // Per-affiliate aggregates.
  const referralsByAff = new Map<string, number>();
  for (const l of leadRows) {
    if (!l.affiliate_id) continue;
    referralsByAff.set(l.affiliate_id, (referralsByAff.get(l.affiliate_id) ?? 0) + 1);
  }
  const fundedByAff = new Map<string, number>();
  const paidByAff = new Map<string, number>();
  for (const p of payoutRows) {
    if (!p.affiliate_id) continue;
    // A canceled payout means the deal didn't actually fund (or was reverted
    // inside the review window) — it must not inflate the funded count.
    if (p.status !== "canceled") {
      fundedByAff.set(p.affiliate_id, (fundedByAff.get(p.affiliate_id) ?? 0) + 1);
    }
    if (p.status === "sent" || p.status === "delivered") {
      paidByAff.set(p.affiliate_id, (paidByAff.get(p.affiliate_id) ?? 0) + Number(p.commission_amount || 0));
    }
  }

  const totalPaid = payoutRows
    .filter((p) => p.status === "sent" || p.status === "delivered")
    .reduce((s, p) => s + Number(p.commission_amount || 0), 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <Gift className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-emerald-950 tracking-tight">Affiliate Program</h1>
          <p className="text-emerald-900/50 font-bold text-sm">
            {affRows.length} affiliates · {fmtMoney(totalPaid)} rewards paid
          </p>
        </div>
      </div>

      {/* affiliates */}
      <section className="rounded-3xl border border-emerald-100 bg-white overflow-hidden">
        <div className="px-6 py-5 border-b border-emerald-50">
          <h2 className="font-black text-emerald-950 uppercase tracking-tight">Affiliates</h2>
        </div>
        {affRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-emerald-900/40 font-bold">No affiliates yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                  <th className="px-6 py-3">Affiliate</th>
                  <th className="px-6 py-3">Code</th>
                  <th className="px-6 py-3">Clicks</th>
                  <th className="px-6 py-3">Referrals</th>
                  <th className="px-6 py-3">Funded</th>
                  <th className="px-6 py-3">Paid</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {affRows.map((a) => (
                  <tr key={a.id} className="border-t border-emerald-50 font-bold text-emerald-950">
                    <td className="px-6 py-4">
                      <div>{[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}</div>
                      <div className="text-emerald-900/50 text-sm">{a.email}</div>
                    </td>
                    <td className="px-6 py-4 text-emerald-900/60 font-mono text-sm">{a.referral_code}</td>
                    <td className="px-6 py-4">{a.link_clicks ?? 0}</td>
                    <td className="px-6 py-4">{referralsByAff.get(a.id) ?? 0}</td>
                    <td className="px-6 py-4">{fundedByAff.get(a.id) ?? 0}</td>
                    <td className="px-6 py-4">{fmtMoney(paidByAff.get(a.id) ?? 0)}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs uppercase tracking-wide">
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* payouts */}
      <section className="rounded-3xl border border-emerald-100 bg-white overflow-hidden">
        <div className="px-6 py-5 border-b border-emerald-50">
          <h2 className="font-black text-emerald-950 uppercase tracking-tight">Payouts</h2>
        </div>
        {payoutRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-emerald-900/40 font-bold">No payouts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                  <th className="px-6 py-3">Affiliate</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Order</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map((p: any) => {
                  const aff = p.affiliates;
                  const held = isHeld(p);
                  const waiting = isWaiting(p);
                  return (
                    <tr key={p.id} className="border-t border-emerald-50 font-bold text-emerald-950">
                      <td className="px-6 py-4">
                        <div>{aff ? [aff.first_name, aff.last_name].filter(Boolean).join(" ") : "—"}</div>
                        <div className="text-emerald-900/50 text-sm">{aff?.email}</div>
                      </td>
                      <td className="px-6 py-4">{fmtMoney(Number(p.commission_amount || 0))}</td>
                      <td className="px-6 py-4">
                        <span
                          className={
                            "inline-block rounded-full px-3 py-1 text-xs uppercase tracking-wide " +
                            (p.status === "failed"
                              ? "bg-red-50 text-red-600"
                              : held
                                ? "bg-amber-50 text-amber-700"
                                : p.status === "canceled"
                                  ? "bg-slate-100 text-slate-500"
                                  : waiting
                                    ? "bg-sky-50 text-sky-700"
                                    : "bg-emerald-50 text-emerald-700")
                          }
                        >
                          {held ? "Held" : PAYOUT_LABELS[p.status] ?? p.status}
                        </span>
                        {/* Why a payout is sitting unsent. A queued row is on the
                            24h clock and still cancellable, so say when it goes —
                            that window is the only chance to stop the money. */}
                        {waiting && (
                          <div className="mt-1 text-xs font-bold text-sky-700">
                            Sends {untilRelease(p.release_at)}
                          </div>
                        )}
                        {(p.hold_reason || p.error) && (
                          <div className="mt-1 max-w-xs text-xs font-medium text-emerald-900/60">
                            {p.hold_reason || p.error}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-emerald-900/50 font-mono text-xs">{p.giftronaut_order_id || "—"}</td>
                      <td className="px-6 py-4 text-emerald-900/60">{fmtDate(p.created_at)}</td>
                      <td className="px-6 py-4">
                        <PayoutActions
                          payoutId={p.id}
                          status={p.status}
                          held={held}
                          releaseAt={p.release_at}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
