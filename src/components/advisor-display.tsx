// src/components/advisor-display.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Mail, Phone, User } from "lucide-react";

// Type definition for advisor information
type AdvisorInfo = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_pic_url: string | null;
};

/**
 * AdvisorDisplay Component
 * 
 * This component fetches and displays the advisor assigned to the current client.
 * It shows the advisor's profile picture, name, and contact information.
 * 
 * Usage: <AdvisorDisplay />
 */
export default function AdvisorDisplay() {
  const supabase = createClient();
  
  // State management
  const [advisor, setAdvisor] = useState<AdvisorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // Fetch advisor information on component mount
  // ============================================
  useEffect(() => {
    async function fetch_advisor_info() {
      try {
        setLoading(true);
        
        // Step 1: Get the current authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          setError("No authenticated user found");
          return;
        }

        // Step 2: Get the user's business profile ID
        const { data: profile, error: profileError } = await supabase
          .from("business_profiles")
          .select("id")
          .eq("user_id", user.id)
          .single();
        
        if (profileError) throw profileError;
        if (!profile) {
          setError("No business profile found");
          return;
        }

        // Step 3: Get the integration record which contains advisor_id
        const { data: integration, error: integrationError } = await supabase
          .from("integrations")
          .select("advisor_id")
          .eq("profile_id", profile.id)
          .single();
        
        if (integrationError) throw integrationError;
        if (!integration?.advisor_id) {
          setError("No advisor assigned yet");
          return;
        }

        // Step 4: Fetch the advisor details
        const { data: advisorData, error: advisorError } = await supabase
          .from("advisors")
          .select("id, first_name, last_name, email, phone, profile_pic_url")
          .eq("id", integration.advisor_id)
          .single();
        
        if (advisorError) throw advisorError;
        
        // Update state with advisor information
        setAdvisor(advisorData);
        
      } catch (err: any) {
        console.error("Error fetching advisor:", err);
        setError(err.message || "Failed to load advisor information");
      } finally {
        setLoading(false);
      }
    }

    fetch_advisor_info();
  }, [supabase]);

  // ============================================
  // Helper function to get initials from name
  // Used as fallback when no profile picture exists
  // ============================================
  const get_initials = (first_name: string, last_name: string): string => {
    return `${first_name.charAt(0)}${last_name.charAt(0)}`.toUpperCase();
  };

  // ============================================
  // Render loading state
  // ============================================
  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse flex space-x-4">
              {/* Skeleton loader for avatar */}
              <div className="rounded-full bg-slate-200 h-16 w-16"></div>
              <div className="flex-1 space-y-3 py-1">
                {/* Skeleton loader for text */}
                <div className="h-4 bg-slate-200 rounded w-32"></div>
                <div className="h-3 bg-slate-200 rounded w-48"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ============================================
  // Render error state
  // ============================================
  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Advisor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-amber-800 text-sm">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ============================================
  // Render advisor information
  // ============================================
  if (!advisor) {
    return null;
  }

  return (
    <Card className="w-full hover:shadow-lg transition-shadow duration-200">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-emerald-700">
          <User className="h-5 w-5" />
          Your Advisor
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Advisor profile section */}
        <div className="flex items-start gap-4">
          {/* Avatar with profile picture or initials fallback */}
          <Avatar className="h-16 w-16 border-2 border-emerald-100">
            {/* If profile_pic_url exists, use it as the image source */}
            <AvatarImage 
              src={advisor.profile_pic_url || undefined} 
              alt={`${advisor.first_name} ${advisor.last_name}`}
            />
            {/* Fallback to initials if no profile picture */}
            <AvatarFallback className="bg-emerald-100 text-emerald-700 font-semibold text-lg">
              {get_initials(advisor.first_name, advisor.last_name)}
            </AvatarFallback>
          </Avatar>

          {/* Advisor name and title */}
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900">
              {advisor.first_name} {advisor.last_name}
            </h3>
            <p className="text-sm text-slate-600">
              Business Funding Advisor
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Your dedicated advisor for all funding needs
            </p>
          </div>
        </div>

        {/* Contact information section */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          {/* Email contact */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
              <Mail className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-600 font-medium">Email</p>
              <a 
                href={`mailto:${advisor.email}`}
                className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline truncate block"
              >
                {advisor.email}
              </a>
            </div>
          </div>

          {/* Phone contact (only shown if phone number exists) */}
          {advisor.phone && (
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Phone className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600 font-medium">Phone</p>
                <a 
                  href={`tel:${advisor.phone}`}
                  className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
                >
                  {advisor.phone}
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          {/* Email button */}
          <Button 
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => window.location.href = `mailto:${advisor.email}`}
          >
            <Mail className="h-4 w-4 mr-2" />
            Send Email
          </Button>
          
          {/* Call button (only shown if phone exists) */}
          {advisor.phone && (
            <Button 
              variant="outline"
              className="flex-1 border-emerald-600 text-emerald-600 hover:bg-emerald-50"
              onClick={() => window.location.href = `tel:${advisor.phone}`}
            >
              <Phone className="h-4 w-4 mr-2" />
              Call Now
            </Button>
          )}
        </div>

        {/* Help text */}
        <div className="bg-slate-50 rounded-lg p-3 mt-4">
          <p className="text-xs text-slate-600 text-center">
            Have questions? Your advisor is here to help you through every step of the funding process.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}