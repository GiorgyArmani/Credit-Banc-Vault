"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Phone, CheckCircle, Clock } from "lucide-react"
import Link from "next/link"

interface CreditRepairCTAProps {
  title?: string
  description?: string
}

export default function CreditRepairCTA({
  title = "Need Professional Help?",
  description = "Connect with a certified credit repair specialist for personalized assistance",
}: CreditRepairCTAProps) {
  return (
    <div className="flex flex-col gap-4 mt-6">
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-emerald-200">
        <CardHeader>
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-700 mb-4">{description}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-slate-700">Expert Analysis</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-slate-700">Dispute Letters</span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-slate-700">Ongoing Support</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/dashboard/book-consultation" className="flex-1">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                <Phone className="h-4 w-4 mr-2" />
                Book Free Consultation
              </Button>
            </Link>
            <div className="flex items-center text-sm text-slate-600">
              <Clock className="h-4 w-4 mr-1" />
              <span>15-min call</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Items Ad */}
      {/* Action Items Ad */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-slate-900 text-lg">
            Ready to take your business to the next level? Start our course
          </CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href="https://creditbanc.app.clientclub.net/courses/offers/cd8dafa0-13d7-4beb-85d8-20c774bc8f9b"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full transition-transform hover:scale-[1.01]"
          >
            <img
              src="/action items.svg"
              alt="Action Items"
              className="w-full rounded-xl border border-slate-200 shadow-sm"
            />
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
