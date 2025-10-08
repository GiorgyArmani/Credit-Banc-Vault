// src/app/api/ghl-fields/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Check if required env variables exist
    const ghl_token = process.env.GHL_TOKEN;
    const location_id = process.env.GHL_LOCATION_ID;
    
    if (!ghl_token) {
      return NextResponse.json(
        { error: "GHL_TOKEN environment variable is not set" },
        { status: 500 }
      );
    }
    
    if (!location_id) {
      return NextResponse.json(
        { error: "GHL_LOCATION_ID environment variable is not set" },
        { status: 500 }
      );
    }

    // Fetch custom fields from GHL API
    // CHANGED: custom-fields → customFields (camelCase)
    const response = await fetch(
      `https://services.leadconnectorhq.com/locations/${location_id}/customFields`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${ghl_token}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error_text = await response.text();
      throw new Error(
        `GHL API failed (${response.status}): ${error_text}`
      );
    }

    const data = await response.json();

    // Format the fields for easy reading
    const formatted_fields = data.customFields.map((field: any) => {
      // Generate environment variable name
      const env_name = `GHL_CF_${field.name
        .toUpperCase()
        .replace(/\s+/g, "_")
        .replace(/[^A-Z0-9_]/g, "")}`;
      
      return {
        name: field.name,
        key: field.key,
        id: field.id,
        data_type: field.dataType,
        object_type: field.objectType,
        suggested_env_name: env_name,
        // Ready-to-paste line for .env.local
        env_line: `${env_name}=${field.id}`,
      };
    });

    // Return formatted response
    return NextResponse.json({
      success: true,
      total_fields: formatted_fields.length,
      location_id: location_id,
      fields: formatted_fields,
      // All env lines ready to copy-paste into .env.local
      copy_paste_env_lines: formatted_fields
        .map((f: { env_line: string }) => f.env_line)
        .join("\n"),
    });
  } catch (error: any) {
    console.error("Error fetching GHL custom fields:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || "Failed to fetch custom fields" 
      },
      { status: 500 }
    );
  }
}