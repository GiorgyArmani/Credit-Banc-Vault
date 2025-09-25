"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle, Clock, Shield, Bell, TrendingUp, Star, Phone } from "lucide-react"
import Link from "next/link"

export default function CreditMonitoringPitch() {
  return (
    <Card className="bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <Shield className="h-6 w-6 text-purple-600" />
            Done For You Credit Monitoring Setup
          </CardTitle>
          <Badge className="bg-purple-600 text-white">Premium Service</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Value Proposition */}
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-700 mb-2">Complete Monitoring Solution</div>
            <p className="text-slate-700 text-lg">
              Let our experts set up and manage your entire credit monitoring system
            </p>
          </div>

          {/* What's Included */}
          <div>
            <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-purple-600" />
              What We Set Up For You:
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Multi-Bureau Monitoring</span>
                  <p className="text-sm text-slate-600">All 3 credit bureaus tracked 24/7</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Instant Alert System</span>
                  <p className="text-sm text-slate-600">Real-time notifications for any changes</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Identity Theft Protection</span>
                  <p className="text-sm text-slate-600">Dark web monitoring & fraud alerts</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Monthly Score Updates</span>
                  <p className="text-sm text-slate-600">Detailed progress reports delivered</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Custom Dashboard</span>
                  <p className="text-sm text-slate-600">Personalized monitoring portal</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-900">Expert Support</span>
                  <p className="text-sm text-slate-600">Direct access to credit specialists</p>
                </div>
              </div>
            </div>
          </div>

          {/* Benefits */}
          <div className="bg-white/60 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              Why Choose Done-For-You?
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-700">5 Min</div>
                <div className="text-xs text-slate-600">Setup Time</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-700">24/7</div>
                <div className="text-xs text-slate-600">Monitoring</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-700">0</div>
                <div className="text-xs text-slate-600">Effort Required</div>
              </div>
            </div>
          </div>

          {/* Social Proof */}
          <div className="bg-white/60 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-900">Client Satisfaction</h4>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-purple-700">98%</div>
                <div className="text-xs text-slate-600">Satisfaction Rate</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-700">2.3x</div>
                <div className="text-xs text-slate-600">Faster Results</div>
              </div>
              <div className="text-2xl font-bold text-purple-700">$0</div>
              <div className="text-xs text-slate-600">Hidden Fees</div>
            </div>
          </div>

          {/* Pricing */}
          <div className="text-center bg-white/80 rounded-lg p-6">
            <div className="mb-4">
              <div className="text-sm text-slate-600 line-through">Regular Price: $197/month</div>
              <div className="text-3xl font-bold text-purple-700">$97/month</div>
              <div className="text-sm text-slate-600">Limited time offer</div>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-600 mb-4">
              <Clock className="h-4 w-4" />
              <span>Setup completed within 24 hours</span>
            </div>
          </div>

          {/* CTA */}
          <div className="text-center">
            <Link href="/book-consultation">
              <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white mb-3">
                <Phone className="h-4 w-4 mr-2" />
                Get Your Done-For-You Setup
              </Button>
            </Link>
            <p className="text-xs text-slate-600">30-day money-back guarantee • Cancel anytime • No setup fees</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
