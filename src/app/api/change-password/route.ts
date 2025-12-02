// app/api/change-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/change-password
 * Allows authenticated users to change their password
 * 
 * Request body:
 * - currentPassword: string (optional - for verification)
 * - newPassword: string (required)
 */
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();

        // Check if user is authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { message: "Unauthorized - please log in" },
                { status: 401 }
            );
        }

        // Parse request body
        const { newPassword } = await req.json();

        // Validate new password
        if (!newPassword || newPassword.length < 6) {
            return NextResponse.json(
                { message: "New password must be at least 6 characters" },
                { status: 400 }
            );
        }

        // Update password using Supabase Auth
        const { error: updateError } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (updateError) {
            console.error("Password update error:", updateError);
            return NextResponse.json(
                { message: updateError.message || "Failed to update password" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ok: true,
            message: "Password updated successfully"
        });

    } catch (err: any) {
        console.error("change-password error:", err);
        return NextResponse.json(
            { message: err?.message || "Server error" },
            { status: 500 }
        );
    }
}
