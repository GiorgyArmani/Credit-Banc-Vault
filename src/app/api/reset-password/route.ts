// app/api/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { send_password_reset_email } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reset-password
 * Sends a password reset email to the user
 * 
 * Request body:
 * - email: string (required)
 */
export async function POST(req: NextRequest) {
    try {
        // Use admin client to generate link
        const supabaseAdmin = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false } }
        );

        // Parse request body
        const { email } = await req.json();

        // Validate email
        if (!email) {
            return NextResponse.json(
                { message: "Email is required" },
                { status: 400 }
            );
        }

        // Generate password reset link
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: {
                redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'https://credit-banc-vault.vercel.app'}/auth/callback?next=/auth/update-password`,
            }
        });

        if (error) {
            console.error("Password reset link generation error:", error);
            // Don't reveal if email exists or not for security
            // Return success anyway
        } else if (data && data.properties && data.properties.action_link) {
            // Send branded email
            try {
                await send_password_reset_email({
                    email,
                    reset_link: data.properties.action_link
                });
                console.log(`✅ Password reset email sent to ${email}`);
            } catch (emailError) {
                console.error("Error sending password reset email:", emailError);
            }
        }

        // Always return success to prevent email enumeration
        return NextResponse.json({
            ok: true,
            message: "If an account exists with this email, a password reset link has been sent"
        });

    } catch (err: any) {
        console.error("reset-password error:", err);
        return NextResponse.json(
            { message: "Server error" },
            { status: 500 }
        );
    }
}
