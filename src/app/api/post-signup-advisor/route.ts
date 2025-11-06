// app/api/post-signup-advisor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
 * 1. Creates user record in public.users with 'advisor' role
 * 2. Creates contact in GHL with advisor tags
 */
export async function POST(req: NextRequest) {
  try {
    // Parse request body
    const { userId, firstName, lastName, email, tags } = await req.json();

    // Validate required fields
    if (!userId || !firstName || !lastName || !email) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Step 1: Upsert user in public.users table with 'advisor' role
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
      console.error("Database error:", dbError);
      throw dbError;
    }

    // Step 2: Create or update contact in GHL with advisor tags
    await upsertGHLContact({ 
      firstName, 
      lastName, 
      email, 
      tags: tags || ["creditbanc-advisor"] 
    });

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