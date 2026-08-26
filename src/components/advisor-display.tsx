// src/components/advisor-display.tsx
"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mail, Phone, User, AlertCircle } from "lucide-react";

// ============================================
// TYPE DEFINITIONS
// Define the structure of data we'll work with
// ============================================

enum ComponentState {
  LOADING = "LOADING",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
  NO_DATA = "NO_DATA",
}

type AdvisorInfo = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_pic_url: string | null;
};

/**
 * How the card is being placed.
 *
 * "full" is the original full-bleed card — a 256px portrait, stacked contact
 * rows, two full-width buttons. It needs most of a page to itself.
 *
 * "rail" is the client portal's sidebar version: same data, sized for a ~320px
 * column so it can sit permanently beside the work instead of costing a full
 * screen of scroll above it. One component either way, because the fetch and
 * the four load states are the fiddly part and duplicating them into a second
 * file would mean two places to fix the next time the advisor lookup changes.
 */
type AdvisorVariant = "full" | "rail";

/**
 * AdvisorDisplay Component
 */
export default function AdvisorDisplay({
  onLoad,
  variant = "full",
}: {
  onLoad?: () => void;
  variant?: AdvisorVariant;
}): React.ReactElement {
  const supabase = createClient();
  const [component_state, set_component_state] = useState<ComponentState>(
    ComponentState.LOADING
  );
  const [advisor, setAdvisor] = useState<AdvisorInfo | null>(null);
  const [error_message, set_error_message] = useState<string>("");

  useEffect(() => {
    if (component_state !== ComponentState.LOADING) {
      onLoad?.();
    }
  }, [component_state, onLoad]);

  useEffect(() => {
    async function fetch_advisor_info() {
      try {
        set_component_state(ComponentState.LOADING);
        const { data: { user }, error: user_error } = await supabase.auth.getUser();

        if (user_error) {
          console.error("❌ Authentication error:", user_error);
          set_error_message("Authentication failed. Please try logging in again.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        if (!user) {
          console.warn("⚠️ No authenticated user found");
          set_error_message("Please log in to view your advisor information.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        const { data: vault_data, error: vault_error } = await supabase
          .from("client_data_vault")
          .select("id, advisor_id, advisor_name")
          .eq("user_id", user.id)
          .maybeSingle();

        if (vault_error) {
          console.error("❌ Client data vault query error:", vault_error);
          set_error_message("Error loading your vault data. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        if (!vault_data) {
          console.warn("⚠️ No client data vault found for user:", user.id);
          set_error_message("No vault data found. Please complete your vault setup.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        if (!vault_data.advisor_id) {
          console.warn("⚠️ No advisor assigned in vault record");
          set_error_message("No advisor has been assigned to your account yet. An advisor will be assigned soon.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        const { data: advisor_data, error: advisor_error } = await supabase
          .from("advisors")
          .select("id, first_name, last_name, email, phone, profile_pic_url")
          .eq("id", vault_data.advisor_id)
          .maybeSingle();

        if (advisor_error) {
          console.error("❌ Advisor query error:", advisor_error);
          set_error_message("Error loading advisor information. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        if (!advisor_data) {
          console.error("❌ Advisor not found for ID:", vault_data.advisor_id);
          set_error_message("Advisor information not found. Please contact support.");
          set_component_state(ComponentState.ERROR);
          return;
        }

        setAdvisor(advisor_data);
        set_component_state(ComponentState.SUCCESS);

      } catch (err: any) {
        console.error("❌ Unexpected error:", err);
        set_error_message(err.message || "An unexpected error occurred.");
        set_component_state(ComponentState.ERROR);
      }
    }

    fetch_advisor_info();
  }, []);

  const get_initials = (first_name: string, last_name: string): string => {
    return `${first_name.charAt(0)}${last_name.charAt(0)}`.toUpperCase();
  };

  const render_loading_state = (): React.ReactElement => {
    return (
      <Card className="w-full border-emerald-50 rounded-[2.5rem] shadow-sm overflow-hidden">
        <CardHeader className="p-8 pb-4">
          <CardTitle className="flex items-center gap-2 text-xl font-black text-emerald-950 uppercase tracking-tighter">
            <User className="h-5 w-5 text-emerald-500" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <div className="animate-pulse flex flex-col items-center space-y-4 w-full">
              <div className="rounded-full bg-slate-200 h-24 w-24 md:h-64 md:w-64"></div>
              <div className="flex flex-col items-center space-y-3 w-full">
                <div className="h-5 bg-slate-200 rounded w-40"></div>
                <div className="h-4 bg-slate-200 rounded w-32"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const render_error_state = (): React.ReactElement => {
    return (
      <Card className="w-full border-emerald-50 rounded-[2.5rem] shadow-sm overflow-hidden">
        <CardHeader className="p-8 pb-4">
          <CardTitle className="flex items-center gap-2 text-xl font-black text-emerald-950 uppercase tracking-tighter">
            <User className="h-5 w-5 text-emerald-500" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8 pt-0">
          <div className="text-center py-8">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-left">
                  <p className="text-amber-800 text-sm font-bold uppercase tracking-tight">Unable to Load Advisor</p>
                  <p className="text-amber-700 text-xs mt-1">{error_message}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const render_success_state = (): React.ReactElement => {
    if (!advisor) return render_error_state();

    return (
      <Card id="tour-advisor" className="w-full border-emerald-100 rounded-[2.5rem] shadow-sm hover:shadow-xl transition-all duration-500 overflow-hidden bg-white/80 backdrop-blur-sm">
        <CardHeader className="p-8 pb-4">
          <CardTitle className="flex items-center gap-2 text-xl font-black text-emerald-950 uppercase tracking-tighter">
            <User className="h-5 w-5 text-emerald-500" />
            Your Advisor
          </CardTitle>
        </CardHeader>

        <CardContent className="p-8 pt-0 space-y-8">
          <div className="flex flex-col items-center text-center gap-4">
            <Avatar className="h-24 w-24 md:h-64 md:w-64 border-4 border-emerald-100 shadow-sm transition-transform hover:scale-105 duration-200">
              <AvatarImage
                src={advisor.profile_pic_url || undefined}
                alt={`${advisor.first_name} ${advisor.last_name}`}
              />
              <AvatarFallback className="bg-emerald-100 text-emerald-700 font-bold text-2xl">
                {get_initials(advisor.first_name, advisor.last_name)}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1">
              <h3 className="text-2xl font-black text-emerald-950 tracking-tighter">
                {advisor.first_name} {advisor.last_name}
              </h3>
              <p className="text-sm font-black text-emerald-500 uppercase tracking-widest">
                Business Funding Advisor
              </p>
              <p className="text-xs font-bold text-emerald-900/40">
                Your dedicated advisor for all funding needs
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                <Mail className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40">Email</p>
                <a
                  href={`mailto:${advisor.email}`}
                  className="text-base font-bold text-emerald-950 hover:text-emerald-500 transition-colors truncate block"
                >
                  {advisor.email}
                </a>
              </div>
            </div>

            {advisor.phone && (
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                  <Phone className="h-6 w-6 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40">Phone</p>
                  <a
                    href={`tel:${advisor.phone}`}
                    className="text-base font-bold text-emerald-950 hover:text-emerald-500 transition-colors"
                  >
                    {advisor.phone}
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-full shadow-lg shadow-emerald-500/10 transition-all active:scale-95"
              onClick={() => window.location.href = `mailto:${advisor.email}`}
            >
              <Mail className="h-4 w-4 mr-2" />
              Email Advisor
            </Button>

            {advisor.phone && (
              <Button
                variant="outline"
                className="flex-1 h-12 border-emerald-100 text-emerald-950 font-black rounded-full hover:bg-emerald-50 transition-all active:scale-95"
                onClick={() => window.location.href = `tel:${advisor.phone}`}
              >
                <Phone className="h-4 w-4 mr-2" />
                Call Advisor
              </Button>
            )}
          </div>

          <div className="bg-emerald-50/50 rounded-2xl p-4 mt-6">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-emerald-900/40 text-center leading-relaxed">
              Reach out anytime by email or phone if questions come up.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Rail variant ──────────────────────────────────────────────────────────
  //
  // The tour anchor lives on the shell rather than the success state so
  // #tour-advisor resolves even while the advisor is still loading — the tour
  // auto-runs on first visit and would otherwise skip a step on a slow fetch.
  const render_rail_shell = (children: React.ReactNode): React.ReactElement => (
    <section
      id="tour-advisor"
      className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"
    >
      <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.18em] text-cb-gray">
        Your advisor
      </p>
      {children}
    </section>
  );

  const render_rail = (): React.ReactElement => {
    if (component_state === ComponentState.LOADING) {
      return render_rail_shell(
        <div className="flex animate-pulse items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-black/5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 rounded bg-black/5" />
            <div className="h-2.5 w-32 rounded bg-black/5" />
          </div>
        </div>
      );
    }

    if (component_state !== ComponentState.SUCCESS || !advisor) {
      return render_rail_shell(
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-800">{error_message}</p>
        </div>
      );
    }

    return render_rail_shell(
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 border border-black/5">
            <AvatarImage
              src={advisor.profile_pic_url || undefined}
              alt={`${advisor.first_name} ${advisor.last_name}`}
            />
            <AvatarFallback className="bg-cb-mint/15 text-sm font-bold text-cb-ink">
              {get_initials(advisor.first_name, advisor.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-manrope text-base font-extrabold leading-tight tracking-tight text-cb-ink">
              {advisor.first_name} {advisor.last_name}
            </p>
            <p className="text-[11px] font-semibold text-cb-ink/45">
              Business Funding Advisor
            </p>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-black/5 pt-4">
          <a
            href={`mailto:${advisor.email}`}
            className="flex items-center gap-2.5 text-[13px] text-cb-ink/70 transition-colors hover:text-cb-ink"
          >
            <Mail className="h-3.5 w-3.5 shrink-0 text-cb-mint" />
            <span className="truncate">{advisor.email}</span>
          </a>
          {advisor.phone && (
            <a
              href={`tel:${advisor.phone}`}
              className="flex items-center gap-2.5 text-[13px] text-cb-ink/70 transition-colors hover:text-cb-ink"
            >
              <Phone className="h-3.5 w-3.5 shrink-0 text-cb-mint" />
              <span>{advisor.phone}</span>
            </a>
          )}
        </div>

        <div className="flex gap-2">
          <a
            href={`mailto:${advisor.email}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cb-ink px-3 py-2.5 text-xs font-semibold text-cb-mint transition-colors hover:bg-cb-ink/90"
          >
            <Mail className="h-3.5 w-3.5" />
            Email
          </a>
          {advisor.phone && (
            <a
              href={`tel:${advisor.phone}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-black/10 px-3 py-2.5 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
        </div>
      </div>
    );
  };

  if (variant === "rail") return render_rail();

  switch (component_state) {
    case ComponentState.LOADING: return render_loading_state();
    case ComponentState.ERROR: return render_error_state();
    case ComponentState.SUCCESS: return render_success_state();
    case ComponentState.NO_DATA: return <div></div>;
    default: return render_error_state();
  }
}