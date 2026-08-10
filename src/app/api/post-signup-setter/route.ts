// src/app/api/post-signup-setter/route.ts
//
// Provisions an appointment-setter account: creates the auth user and writes a
// public.users row with role='setter'. A setter serves the whole team — the
// advisor for each client they create is mirrored from the GHL contact owner
// (round-robin) at vault-creation time, NOT from a fixed per-setter advisor.
// See [[setter_role]].
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
    consumeStaffInvite,
    markStaffInviteAccepted,
    releaseStaffInvite,
} from "@/lib/auth/staff-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * POST /api/post-signup-setter
 */
export async function POST(req: NextRequest) {
    // Declared outside the try so the catch can hand a claimed invitation back.
    let claimedInviteId: string | null = null;

    try {
        const body = await req.json();
        const { firstName, lastName, email, password, inviteToken } = body;

        if (!firstName || !lastName || !email || !password) {
            return NextResponse.json(
                { message: "Missing required fields" },
                { status: 400 }
            );
        }

        // THE gate. Server-side because this endpoint can be POSTed directly —
        // the form that normally calls it is a convenience, not a control.
        // See [[staff_signup_invite_gate]].
        const invite = await consumeStaffInvite(inviteToken, "setter", email);
        if (!invite.ok) {
            return NextResponse.json({ message: invite.message }, { status: invite.status });
        }
        claimedInviteId = invite.invite.id;

        // Step 1: Create the auth user (email pre-confirmed — internal staff).
        const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: String(email).trim().toLowerCase(),
            password: password,
            email_confirm: true,
            user_metadata: {
                first_name: String(firstName).trim(),
                last_name: String(lastName).trim(),
            }
        });

        if (createError) throw createError;

        const userId = userData.user.id;

        // Audit link: which account this invitation produced. Best-effort.
        await markStaffInviteAccepted(claimedInviteId, userId);

        // Step 2: Upsert public.users with role='setter'.
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .upsert(
                {
                    id: userId,
                    first_name: String(firstName).trim(),
                    last_name: String(lastName).trim(),
                    email: String(email).trim().toLowerCase(),
                    role: "setter",
                },
                { onConflict: "id" }
            );

        if (dbError) throw dbError;

        return NextResponse.json({
            ok: true,
            message: "Setter account created successfully"
        });

    } catch (err: any) {
        console.error("post-signup-setter error:", err);
        // Signup failed after the invitation was claimed — give the link back.
        if (claimedInviteId) await releaseStaffInvite(claimedInviteId);
        return NextResponse.json(
            { message: err?.message || "Server error during setter signup" },
            { status: 500 }
        );
    }
}
