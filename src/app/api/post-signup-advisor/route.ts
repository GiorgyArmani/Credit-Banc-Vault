// app/api/post-signup-advisor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { send_advisor_welcome_email } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Initialize Supabase Admin client with service role key
// This allows bypassing Row Level Security (RLS) policies
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * Upserts a contact in GoHighLevel (GHL) CRM
 * Creates or updates contact with advisor-specific tags
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

  // Prepare the payload for GHL API
  const payload = {
    firstName,
    lastName,
    email,
    locationId: process.env.GHL_LOCATION_ID,
    source: "creditbanc-advisor-signup",
    tags,
  };

  // Make the API request to GHL
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

  // Handle API errors
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL upsert failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * POST /api/post-signup-advisor
 * Handles advisor signup process:
 * 1. Creates user record in Supabase Auth (server-side, auto-confirmed)
 * 2. Uploads profile picture (server-side to bypass RLS)
 * 3. Creates user record in public.users with 'advisor' role
 * 4. Creates advisor record in public.advisors table
 * 5. Creates contact in GHL with advisor tags
 * 6. Sends branded welcome email (without password for security)
 */
export async function POST(req: NextRequest) {
  try {
    // Parse request body
    const body = await req.json();
    const { firstName, lastName, email, phone, profilePicUrl, password, tags, profilePicBase64, profilePicName } = body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Step 1: Create the auth user in Supabase (Server-side)
    // We use admin.createUser to auto-confirm and suppress the default email
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: String(firstName).trim(),
        last_name: String(lastName).trim(),
      }
    });

    if (createError) {
      console.error("User creation error:", createError);
      throw createError;
    }

    const userId = userData.user.id;
    console.log(`✅ User created and auto-confirmed: ${email} (${userId})`);

    // Step 2: Handle Profile Picture Upload (Server-side to bypass RLS)
    let finalProfilePicUrl = profilePicUrl || null;

    if (profilePicBase64 && profilePicName) {
      try {
        // Extract the actual base64 data (remove "data:image/xxx;base64," prefix if present)
        const base64Data = profilePicBase64.includes('base64,')
          ? profilePicBase64.split('base64,')[1]
          : profilePicBase64;

        const fileBuffer = Buffer.from(base64Data, 'base64');
        const fileExt = profilePicName.split('.').pop();
        const fileName = `${userId}-${Date.now()}.${fileExt}`;
        const filePath = `advisor-profiles/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from('advisor-profiles')
          .upload(filePath, fileBuffer, {
            contentType: 'image/webp', // Defaulting to webp or could be inferred
            upsert: true
          });

        if (uploadError) {
          console.error("Server-side profile upload error:", uploadError);
        } else {
          const { data: { publicUrl } } = supabaseAdmin.storage
            .from('advisor-profiles')
            .getPublicUrl(filePath);
          finalProfilePicUrl = publicUrl;
          console.log(`✅ Profile picture uploaded: ${finalProfilePicUrl}`);
        }
      } catch (uploadErr) {
        console.error("Error processing profile picture:", uploadErr);
      }
    }

    // Step 3: Upsert user in public.users table with 'advisor' role
    // Uses upsert to handle duplicate signup attempts gracefully
    const { error: dbError } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: userId,
          first_name: String(firstName).trim(),
          last_name: String(lastName).trim(),
          email: String(email).trim().toLowerCase(),
          role: "advisor", // 👈 Assign advisor role instead of free
        },
        { onConflict: "id" }
      );

    // Handle database errors
    if (dbError) {
      console.error("Database error (users table):", dbError);
      throw dbError;
    }

    // Step 4: Insert into public.advisors table
    const { error: advisorError } = await supabaseAdmin
      .from("advisors")
      .insert({
        user_id: userId,
        first_name: String(firstName).trim(),
        last_name: String(lastName).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phone ? String(phone).trim() : null,
        profile_pic_url: finalProfilePicUrl,
        is_active: true,
      });

    // Handle advisor table errors
    if (advisorError) {
      console.error("Database error (advisors table):", advisorError);
      throw advisorError;
    }

    // Step 5: Create or update contact in GHL with advisor tags
    await upsertGHLContact({
      firstName,
      lastName,
      email,
      tags: tags || ["creditbanc-advisor"]
    });

    // Step 6: Send branded welcome email (without password for security)
    try {
      await send_advisor_welcome_email({
        advisor_name: `${firstName} ${lastName}`,
        advisor_email: email,
        login_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io'}/auth/login`,
      });
      console.log(`✅ Welcome email sent successfully to ${email}`);
    } catch (email_error: any) {
      // Log error but don't fail the signup
      console.error('⚠️ Error sending welcome email:', email_error);
      // Continue with success response even if email fails
    }

    // Return success response
    return NextResponse.json({
      ok: true,
      message: "Advisor account created successfully"
    });

  } catch (err: any) {
    // Log and return error
    console.error("post-signup-advisor error:", err);
    return NextResponse.json(
      { message: err?.message || "Server error during advisor signup" },
      { status: 500 }
    );
  }
}