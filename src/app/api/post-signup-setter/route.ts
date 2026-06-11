// src/app/api/post-signup-setter/route.ts
//
// Provisions an appointment-setter account: creates the auth user, writes a
// public.users row with role='setter', and links setter_advisor_id to the
// advisor every client this setter creates will be assigned to. See
// [[setter_role]].
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkStaffInviteCode } from "@/lib/auth/staff-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The advisor every new setter is pointed at by default. Overridable via env
// so we don't have to redeploy to retarget; falls back to Matthew R Meehan's
// advisors.id (the first setter target). An admin can repoint an individual
// setter later by updating users.setter_advisor_id.
const DEFAULT_SETTER_ADVISOR_ID =
    process.env.SETTER_DEFAULT_ADVISOR_ID || "5f3d0a61-4132-4baf-8c88-da3a0066a252";

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

        // The setter must point at a real advisor or every client they create
        // would fail assignment. Verify the default target exists up front so we
        // fail with a clear message instead of a downstream FK error.
        const { data: advisor, error: advisorErr } = await supabaseAdmin
            .from("advisors")
            .select("id")
            .eq("id", DEFAULT_SETTER_ADVISOR_ID)
            .maybeSingle();

        if (advisorErr) throw advisorErr;
        if (!advisor) {
            return NextResponse.json(
                { message: "Default setter advisor not found. Contact an admin to configure SETTER_DEFAULT_ADVISOR_ID." },
                { status: 500 }
            );
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

        // Step 2: Upsert public.users with role='setter' + the advisor link.
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .upsert(
                {
                    id: userId,
                    first_name: String(firstName).trim(),
                    last_name: String(lastName).trim(),
                    email: String(email).trim().toLowerCase(),
                    role: "setter",
                    setter_advisor_id: DEFAULT_SETTER_ADVISOR_ID,
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
