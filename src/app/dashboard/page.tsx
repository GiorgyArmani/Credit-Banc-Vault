// src/app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import AdvisorDisplay from "@/components/advisor-display";
import ProfileDisplay from "@/components/profile-display";
import Vault from '@/components/vault';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Clock, UploadCloud } from 'lucide-react';

/**
 * DashboardPage Component
 * 
 * Main dashboard for clients to view their profile and upload documents.
 * 
 * COMPONENTS USED:
 * - AdvisorDisplay: Shows assigned advisor info (from client_data_vault)
 * - ProfileDisplay: Shows client profile info (from client_data_vault)
 * - Vault: Document upload interface
 * 
 * DATABASE FLOW:
 * Both AdvisorDisplay and ProfileDisplay fetch directly from client_data_vault
 * using the authenticated user's ID. No need for business_profiles queries here.
 */
export default function DashboardPage() {
  // supabase-client: Database client (not used in this component anymore)
  // AdvisorDisplay and ProfileDisplay handle their own data fetching
  const supabase = createClient();

  // user-email-state: Store user email for welcome message
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // ============================================
  // FETCH USER EMAIL ON MOUNT
  // Just get the email for the welcome message
  // Profile and advisor data are handled by their respective components
  // ============================================
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
    })();
  }, [supabase]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* ============================================ */}
      {/* HEADER SECTION */}
      {/* App branding and status badges */}
      {/* ============================================ */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          {/* logo-section: Brand logo and tagline */}
          <div className="flex items-center gap-3">
            {/* app-logo: Gradient icon */}
            <div className="h-9 w-9 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center">
              <UploadCloud className="h-5 w-5 text-white" />
            </div>
            {/* brand-info: App name and tagline */}
            <div>
              <h1 className="text-xl font-bold text-slate-900">CreditBanc Vault</h1>
              <p className="text-xs text-slate-600">Easy • Fast • Secure</p>
            </div>
          </div>

          {/* badges-section: Status and feature badges */}
          <div className="flex items-center gap-2">
            {/* beta-badge: Indicates beta status */}
            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">
              BETA
            </Badge>
            {/* features-list: Key features (hidden on mobile) */}
            <div className="hidden sm:flex items-center text-slate-600 text-sm gap-3">
              <span className="inline-flex items-center gap-1">
                <Shield className="h-4 w-4" /> Secure
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" /> 24–48h underwriting
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ============================================ */}
      {/* MAIN CONTENT SECTION */}
      {/* Dashboard content with cards */}
      {/* ============================================ */}
      <div className="container mx-auto px-4 py-8 space-y-8">
        
        {/* ============================================ */}
        {/* WELCOME SECTION */}
        {/* Personalized greeting */}
        {/* ============================================ */}
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-1">
            Welcome{userEmail ? `, ${userEmail}` : ''}!
          </h2>
          <p className="text-slate-600">
            Upload your required documents and track your progress.
          </p>
        </div>

        {/* ============================================ */}
        {/* ADVISOR CARD */}
        {/* Shows assigned advisor information */}
        {/* Fetches from: client_data_vault → advisors */}
        {/* ============================================ */}
        <AdvisorDisplay />

        {/* ============================================ */}
        {/* PROFILE CARD */}
        {/* Shows client profile information */}
        {/* Fetches from: client_data_vault */}
        {/* Displays: Funding goal, Entity type, Industry, Start date, Revenue, Credit */}
        {/* ============================================ */}
        <ProfileDisplay />

        {/* ============================================ */}
        {/* DOCUMENT VAULT CARD */}
        {/* Document upload interface */}
        {/* ============================================ */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-0">
            <CardTitle className="text-slate-900">Document Vault</CardTitle>
            <CardDescription className="text-slate-600">
              Upload your 6 months bank statements, ID (front & back), voided business check, and if applicable, a debt schedule.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {/* vault-component: Document upload UI */}
            <Vault />
          </CardContent>
        </Card>

        {/* ============================================ */}
        {/* SUBMIT BUTTON (OPTIONAL) */}
        {/* Uncomment when ready to enable submissions */}
        {/* ============================================ */}
        {/* <div className="flex justify-end">
          <Button 
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSubmit}
          >
            Submit documents
          </Button>
        </div> */}
      </div>
    </div>
  );
}