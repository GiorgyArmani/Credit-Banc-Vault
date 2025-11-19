"use client"

import { useState } from "react"
import Link from "next/link"
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
} from "lucide-react"

export function LandingPage() {
  const [activeStep, setActiveStep] = useState(1)

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
    { icon: FolderCheck, title: "Track", desc: "Follow your checklist and see what’s missing." },
    { icon: Send, title: "Submit", desc: "Lock and send everything when complete." },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Thin beta strip */}
      <div className="w-full border-b">
        <div className="container mx-auto px-4 py-2 text-center text-sm">
          <Badge className="mr-2 bg-emerald-600 text-white hover:bg-emerald-600">BETA</Badge>
          <span className="text-gray-700">
            Introducing <span className="font-semibold">Credit Banc Vault</span> — Easy · Fast · Secure document collection.
          </span>
        </div>
      </div>

     {/* HERO */}
<section className="relative w-full bg-gradient-to-br from-emerald-200 via-emerald-300 to-blue-300">
  <div className="container mx-auto px-4 pt-20 pb-16 text-center text-white">
    <div className="max-w-4xl mx-auto">
      <Badge className="mb-4 bg-white/20 text-white">The Credit Banc Vault</Badge>
      <h1 className="text-5xl md:text-6xl font-bold mb-6">
        Upload. Track. <span className="text-gray-900 bg-white/60 px-2 rounded">Get Funded.</span>
      </h1>
      <p className="text-xl mb-8 max-w-2xl mx-auto">
        A simple portal to upload your <b>6 bank statements</b>, <b>Driver’s License</b>, <b>voided check</b>, 
        and more. Live progress and direct submission to underwriting in <b>24–48h</b>.
      </p>

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

      <div className="mt-4">
        <Link href="/auth/login" className="text-sm underline">
          Already have an account? Log in
        </Link>
      </div>
    </div>
  </div>
</section>

      {/* PILLARS */}
      <section className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-6">
          {pillars.map((p, i) => (
            <Card key={i} className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
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

      {/* HOW IT WORKS */}
      <section className="bg-white py-14">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">How It Works</h2>
            <p className="text-lg text-gray-600">Three simple steps to complete your application</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {steps.map((s, idx) => (
              <Card
                key={idx}
                className={`hover:shadow-lg transition-shadow ${activeStep === idx ? "ring-2 ring-emerald-500" : ""}`}
                onMouseEnter={() => setActiveStep(idx)}
                onFocus={() => setActiveStep(idx)}
              >
                <CardHeader className="space-y-3">
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

          <div className="mt-8 max-w-3xl mx-auto rounded-xl border p-6 bg-emerald-50/60">
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-5 w-5 text-emerald-700 mt-1" />
              <p className="text-emerald-900 text-sm">
                Required docs to start: <b>6 months of bank statements</b>, <b>Driver’s License (front & back)</b>,
                <b> voided business check</b>, and if applicable, <b>Debt Schedule</b>. The checklist will guide you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-16 text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Ready to Upload?</h2>
          <p className="text-lg text-gray-600 mb-6">
            Create your profile in minutes and start uploading documents with the CreditBanc Vault.
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

      {/* FOOTER */}
      <footer className="bg-gray-900 text-white py-10">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center gap-6 text-gray-400 text-sm mb-4">
            <Link href="#" className="hover:text-white">Privacy</Link>
            <Link href="#" className="hover:text-white">Terms</Link>
            <Link href="#" className="hover:text-white">Support</Link>
          </div>
          <p className="text-gray-400">© {new Date().getFullYear()} CreditBanc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
