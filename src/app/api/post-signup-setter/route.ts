// src/app/api/post-signup-setter/route.ts
//
// Provisions an appointment-setter account: creates the auth user and writes a
// public.users row with role='setter'. A setter serves the whole team — the
// advisor for each client they create is mirrored from the GHL contact owner
// (round-robin) at vault-creation time, NOT from a fixed per-setter advisor.
// See [[setter_role]].
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkStaffInviteCode } from "@/lib/auth/staff-invite";

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
    try {
        const body = await req.json();
        const { firstName, lastName, email, password, inviteCode } = body;

        if (!firstName || !lastName || !email || !password) {
            return NextResponse.json(
                { message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Gate: shared staff invite code (server-side — a form field alone isn't a gate).
        const inviteError = checkStaffInviteCode(inviteCode);
        if (inviteError) {
            return NextResponse.json({ message: inviteError.message }, { status: inviteError.status });
        }

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
        return NextResponse.json(
            { message: err?.message || "Server error during setter signup" },
            { status: 500 }
        );
    }
}
