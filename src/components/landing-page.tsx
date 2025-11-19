"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Shield,
  Zap,
  Clock,
  CheckCircle,
  ArrowRight,
  Play,
  Upload,
  FolderCheck,
  Send,
  Menu,
  X,
} from "lucide-react"

export function LandingPage() {
  const [activeStep, setActiveStep] = useState(1)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const pillars = [
    {
      icon: Zap,
      title: "Easy",
      description: "Guided upload by document type (bank statements, ID, voided check, etc.).",
    },
    {
      icon: Clock,
      title: "Fast",
      description: "Real-time progress and one-click submission to underwriting (24–48h).",
    },
    {
      icon: Shield,
      title: "Secure",
      description: "Encrypted at rest and in transit. Access protected by Supabase Auth.",
    },
  ]

  const steps = [
    { icon: Upload, title: "Upload", desc: "Drag-and-drop or select files by category." },
    { icon: FolderCheck, title: "Track", desc: "Follow your checklist and see what's missing." },
    { icon: Send, title: "Submit", desc: "Lock and send everything when complete." },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      
      {/* header-navigation: Fixed navigation bar with logo and menu */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            
            {/* logo-section: Company logo on the left */}
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-2">
                <Image
                  src="/vaultlogo.svg"
                  alt="Credit Banc Vault"
                  width={140}
                  height={60}
                  priority
                  className="h-20 w-auto"
                  onError={(e) => {
                    // fallback-to-png: If SVG fails, try PNG
                    const target = e.target as HTMLImageElement;
                    target.src = '/vaultlogo.png';
                  }}
                />
              </Link>
            </div>

            {/* desktop-navigation: Navigation links for desktop */}
            <nav className="hidden md:flex items-center space-x-6">
              <Link href="#features" className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors">
                Features
              </Link>
              <Link href="#how-it-works" className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors">
                How It Works
              </Link>

              <Link href="#" className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors">
                Support
              </Link>
            </nav>

            {/* desktop-cta-buttons: Action buttons for desktop */}
            <div className="hidden md:flex items-center space-x-3">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/auth/login">Log In</Link>
              </Button>
              
            </div>

            {/* mobile-menu-button: Hamburger menu for mobile */}
            <button
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6 text-gray-700" />
              ) : (
                <Menu className="h-6 w-6 text-gray-700" />
              )}
            </button>
          </div>

          {/* mobile-menu: Dropdown menu for mobile devices */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t py-4">
              <nav className="flex flex-col space-y-3">
                <Link 
                  href="#features" 
                  className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link 
                  href="#how-it-works" 
                  className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  How It Works
                </Link>
                <Link 
                  href="#" 
                  className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Support
                </Link>
                <div className="flex flex-col space-y-2 pt-2 border-t">
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <Link href="/auth/login" onClick={() => setMobileMenuOpen(false)}>Log In</Link>
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* beta-strip: Announcement banner */}
      <div className="w-full border-b bg-gradient-to-r from-emerald-50 to-blue-50">
        <div className="container mx-auto px-4 py-2 text-center text-sm">
          <Badge className="mr-2 bg-emerald-600 text-white hover:bg-emerald-600">BETA</Badge>
          <span className="text-gray-700">
            Introducing <span className="font-semibold">Credit Banc Vault</span> — Easy · Fast · Secure document collection.
          </span>
        </div>
      </div>

      {/* hero-section: Main landing section with headline and CTAs */}
      <section className="relative w-full bg-gradient-to-br from-emerald-200 via-emerald-300 to-blue-300">
        <div className="container mx-auto px-4 pt-20 pb-16 text-center text-white">
          <div className="max-w-4xl mx-auto">
            
            {/* headline: Main value proposition */}
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              Upload. Track. <span className="text-gray-900 bg-white/60 px-2 rounded">Get Funded.</span>
            </h1>
            
            {/* subheadline: Detailed description of the service */}
            <p className="text-xl mb-8 max-w-2xl mx-auto">
              A simple portal to upload your <b>6 bank statements</b>, <b>Driver's License</b>, <b>voided check</b>, 
              and more. Live progress and direct submission to underwriting in <b>24–48h</b>.
            </p>

            {/* cta-buttons: Primary and secondary call-to-action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" className="text-lg px-7 bg-white text-emerald-700 hover:bg-gray-100" asChild>
                <Link href="/client-signup">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="text-lg px-7 border-white text-white hover:bg-white/10" asChild>
                <Link href="#demo">
                  <Play className="mr-2 h-5 w-5" />
                  Watch Demo
                </Link>
              </Button>
            </div>

            {/* login-link: Link for existing users */}
            <div className="mt-4">
              <Link href="/auth/login" className="text-sm underline hover:text-white/90 transition-colors">
                Already have an account? Log in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* pillars-section: Three key value propositions */}
      <section id="features" className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-6">
          {pillars.map((p, i) => (
            <Card key={i} className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                {/* pillar-icon: Icon representing each value proposition */}
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <p.icon className="h-6 w-6 text-emerald-600" />
                </div>
                <CardTitle className="text-xl">{p.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">{p.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* how-it-works-section: Step-by-step process explanation */}
      <section id="how-it-works" className="bg-white py-14">
        <div className="container mx-auto px-4">
          {/* section-header: Title and subtitle for the steps section */}
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">How It Works</h2>
            <p className="text-lg text-gray-600">Three simple steps to complete your application</p>
          </div>

          {/* steps-grid: Interactive cards showing the process */}
          <div className="grid lg:grid-cols-3 gap-6">
            {steps.map((s, idx) => (
              <Card
                key={idx}
                className={`hover:shadow-lg transition-shadow ${activeStep === idx ? "ring-2 ring-emerald-500" : ""}`}
                onMouseEnter={() => setActiveStep(idx)}
                onFocus={() => setActiveStep(idx)}
              >
                <CardHeader className="space-y-3">
                  {/* step-header: Icon and title for each step */}
                  <div className="flex items-center space-x-3">
                    <div className="rounded-full bg-emerald-100 p-2">
                      <s.icon className="h-5 w-5 text-emerald-600" />
                    </div>
                    <CardTitle>{s.title}</CardTitle>
                  </div>
                  <CardDescription>{s.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* required-docs-callout: Highlighted information about required documents */}
          <div className="mt-8 max-w-3xl mx-auto rounded-xl border p-6 bg-emerald-50/60">
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-5 w-5 text-emerald-700 mt-1" />
              <p className="text-emerald-900 text-sm">
                Required docs to start: <b>6 months of bank statements</b>, <b>Driver's License (front & back)</b>,
                <b> voided business check</b>, and if applicable, <b>Debt Schedule</b>. The checklist will guide you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* final-cta-section: Last call-to-action before footer */}
      <section className="container mx-auto px-4 py-16 text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Ready to Upload?</h2>
          <p className="text-lg text-gray-600 mb-6">
            Create your profile in minutes and start uploading documents with the Credit Banc Vault.
          </p>
          <Button size="lg" className="text-lg px-8 py-3" asChild>
            <Link href="/client-signup">
              Start Now
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <div className="mt-3">
            <Link href="/auth/login" className="text-sm text-emerald-700 hover:underline">
              Already registered? Log in
            </Link>
          </div>
        </div>
      </section>

      {/* footer: Site footer with links and copyright */}
      <footer className="bg-gray-900 text-white py-10">
        <div className="container mx-auto px-4 text-center">
          {/* footer-links: Navigation links */}
          <div className="flex justify-center gap-6 text-gray-400 text-sm mb-4">
            <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-white transition-colors">Terms</Link>
            <Link href="#" className="hover:text-white transition-colors">Support</Link>
          </div>
          {/* copyright: Copyright notice */}
          <p className="text-gray-400">© {new Date().getFullYear()} Credit Banc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}