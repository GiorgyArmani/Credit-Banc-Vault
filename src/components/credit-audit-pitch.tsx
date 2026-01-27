"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Clock, TrendingUp, FileText, Star } from "lucide-react"

export default function CreditAuditPitch() {
  return (
    <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            30-Minute Credit Repairing Audit
          </CardTitle>
          <Badge className="bg-emerald-600 text-white">Limited Time</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Value Proposition */}
          <div className="text-center">
            <div className="text-3xl font-bold text-emerald-700 mb-2">$297 Value - FREE</div>
            <p className="text-slate-700 text-lg">
              Get a comprehensive credit analysis and personalized repair strategy
            </p>
          </div>

          {/* What's Included */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              What You'll Receive:
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-start space-x-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Complete Credit Analysis</span>
                  <p className="text-sm text-slate-600">Deep dive into all 3 credit reports</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Custom Repair Strategy</span>
                  <p className="text-sm text-slate-600">Tailored plan for your situation</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Priority Dispute Letters</span>
                  <p className="text-sm text-slate-600">Professional templates ready to send</p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">90-Day Action Plan</span>
                  <p className="text-sm text-slate-600">Step-by-step improvement roadmap</p>
                </div>
              </div>
            </div>
          </div>

          {/* Social Proof */}
          <div className="bg-white/60 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-900">Client Results</h4>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-emerald-700">127</div>
                <div className="text-xs text-slate-600">Avg. Point Increase</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-700">89%</div>
                <div className="text-xs text-slate-600">Success Rate</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-700">45</div>
                <div className="text-xs text-slate-600">Days Avg. Results</div>
              </div>
            </div>
          </div>

          {/* Urgency */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-slate-600 mb-3">
              <Clock className="h-4 w-4" />
              <span>Only 5 spots available this week</span>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              Our financial advisors are booking up fast. Secure your spot now to get priority access to our credit
              repair specialists.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
