// src/app/api/post-signup-underwriting/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { send_underwriting_welcome_email } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Initialize Supabase Admin client with service role key
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * Upserts a contact in GoHighLevel (GHL) CRM
 */
async function upsertGHLContact({
    firstName,
    lastName,
    email,
    tags = [],
}: {
    firstName: string;
    lastName: string;
    email: string;
    tags?: string[];
}) {
    const endpoint = "https://services.leadconnectorhq.com/contacts/upsert";

    const payload = {
        firstName,
        lastName,
        email,
        locationId: process.env.GHL_LOCATION_ID,
        source: "creditbanc-underwriting-signup",
        tags,
    };

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GHL upsert failed (${res.status}): ${text}`);
    }

    return res.json();
}

/**
 * POST /api/post-signup-underwriting
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { firstName, lastName, email, password } = body;

        if (!firstName || !lastName || !email || !password) {
            return NextResponse.json(
                { message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Step 1: Create the auth user
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

        // Step 2: Update public.users table with 'underwriting' role
        const { error: dbError } = await supabaseAdmin
            .from("users")
            .upsert(
                {
                    id: userId,
                    first_name: String(firstName).trim(),
                    last_name: String(lastName).trim(),
                    email: String(email).trim().toLowerCase(),
                    role: "underwriting",
                },
                { onConflict: "id" }
            );

        if (dbError) throw dbError;

        // Step 3: GHL Sync
        try {
            await upsertGHLContact({
                firstName,
                lastName,
                email,
                tags: ["underwriting-team", "creditbanc-internal"]
            });
        } catch (ghlErr) {
            console.error("GHL Sync failed for underwriter:", ghlErr);
            // Don't fail the whole signup if GHL fails
        }

        // Step 4: Send welcome email
        try {
            await send_underwriting_welcome_email({
                underwriter_name: `${firstName} ${lastName}`,
                underwriter_email: email,
                login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`,
            });
        } catch (emailErr) {
            console.error("Welcome email failed for underwriter:", emailErr);
        }

        return NextResponse.json({
            ok: true,
            message: "Underwriting account created successfully"
        });

    } catch (err: any) {
        console.error("post-signup-underwriting error:", err);
        return NextResponse.json(
            { message: err?.message || "Server error during underwriting signup" },
            { status: 500 }
        );
    }
}
