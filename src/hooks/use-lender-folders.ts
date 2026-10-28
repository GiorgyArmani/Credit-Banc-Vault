"use client";

/**
 * useLenderFolders — what the Lender Documentation folders need besides files.
 *
 *  - `lender_name_suggestions`: names for "New lender folder". This file's
 *    lenders first, then the company lender list (lender_guidelines).
 *  - While the section is OPEN, a folder is created for every lender working
 *    the file (submitted / approved / funded, not removed in admin review) that
 *    has none yet. Lazy on purpose: files nobody sorts lender docs on never
 *    collect empty folders. A lender covered by a folder with a matching name
 *    ("Newity" vs "Newity Business Loans") is left alone.
 *
 * Shared by the underwriting file and the admin client file so both build the
 * same folders.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    LENDER_DOCUMENTATION_DOC_CODE,
    lenderNamesMatch,
    type DocumentGroup,
} from "@/lib/document-groups";

type AssignmentRow = {
    lender_name: string | null;
    status: string | null;
    admin_review: string | null;
    business_profile_id: string | null;
};

export function useLenderFolders({
    client_vault_id,
    active_business_id,
    document_groups,
    add_document_group,
    open,
    refresh_key,
}: {
    client_vault_id: string | null | undefined;
    active_business_id: string | null;
    document_groups: DocumentGroup[];
    add_document_group: (group: DocumentGroup) => void;
    /** True while the Lender Documentation section is expanded. */
    open: boolean;
    /** Bump to re-read the file's lenders (e.g. after a lender is added). */
    refresh_key?: unknown;
}) {
    const [lender_list_names, set_lender_list_names] = useState<string[]>([]);
    const [assignments, set_assignments] = useState<AssignmentRow[]>([]);

    // The company lender list. lender_guidelines is one row per PROGRAM, so
    // names repeat.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data, error } = await createClient()
                .from("lender_guidelines")
                .select("lender_name")
                .order("lender_name", { ascending: true });
            if (error) console.error("lender list load failed:", error);
            if (cancelled || !data) return;
            const seen = new Set<string>();
            const names: string[] = [];
            for (const r of data as { lender_name: string | null }[]) {
                const n = (r.lender_name ?? "").trim();
                if (!n || seen.has(n.toLowerCase())) continue;
                seen.add(n.toLowerCase());
                names.push(n);
            }
            set_lender_list_names(names);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // The lenders this file has been sent to.
    useEffect(() => {
        if (!client_vault_id) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await createClient()
                .from("client_lender_assignments")
                .select("lender_name, status, admin_review, business_profile_id")
                .eq("client_id", client_vault_id);
            if (error) console.error("lender assignments load failed:", error);
            if (!cancelled && data) set_assignments(data as AssignmentRow[]);
        })();
        return () => {
            cancelled = true;
        };
    }, [client_vault_id, refresh_key]);

    const file_lender_names = useMemo(() => {
        const names: string[] = [];
        for (const a of assignments) {
            if (a.admin_review === "rejected") continue;
            if (a.status !== "submitted" && a.status !== "approved_by_lender" && a.status !== "funded") continue;
            if (a.business_profile_id && active_business_id && a.business_profile_id !== active_business_id) continue;
            const n = (a.lender_name ?? "").trim();
            if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
        }
        return names;
    }, [assignments, active_business_id]);

    const lender_name_suggestions = useMemo(() => {
        const out = file_lender_names.map((name) => ({ name, hint: "On this file" }));
        for (const name of lender_list_names) {
            if (!out.some((o) => lenderNamesMatch(o.name, name))) out.push({ name, hint: "Lender list" });
        }
        return out;
    }, [file_lender_names, lender_list_names]);

    // The ref stops a re-render from firing the same POST twice; the create
    // API also returns the existing row on a duplicate.
    const ensured = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!open || !active_business_id) return;
        const existing = document_groups.filter(
            (g) => g.doc_code === LENDER_DOCUMENTATION_DOC_CODE && g.is_active
        );
        const missing = file_lender_names.filter(
            (n) =>
                !existing.some((g) => lenderNamesMatch(g.name, n)) &&
                !ensured.current.has(`${active_business_id}:${n.toLowerCase()}`)
        );
        if (missing.length === 0) return;
        for (const n of missing) ensured.current.add(`${active_business_id}:${n.toLowerCase()}`);
        void (async () => {
            for (const name of missing) {
                try {
                    const res = await fetch("/api/document-groups", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            doc_code: LENDER_DOCUMENTATION_DOC_CODE,
                            name,
                            business_profile_id: active_business_id,
                            client_vault_id: client_vault_id ?? null,
                        }),
                    });
                    const result = await res.json().catch(() => null);
                    if (res.ok && result?.group) add_document_group(result.group);
                    else console.error("lender folder create failed:", name, result?.error);
                } catch (err) {
                    console.error("lender folder create error:", name, err);
                }
            }
        })();
    }, [open, active_business_id, file_lender_names, document_groups, client_vault_id, add_document_group]);

    return { lender_name_suggestions };
}
