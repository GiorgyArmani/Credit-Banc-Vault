// creditbanc-agent/src/components/capital-readiness-assessment.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  FileText,
  CreditCard,
  Building,
  // Si tu versión de lucide no exporta PresentationIcon, usa: import { Presentation } from "lucide-react"
  PresentationIcon as PresentationChart,
  Target,
  ArrowRight,
  BookOpen,
  Download,
  Trophy,
  Star,
  Zap,
  Rocket,
  Crown,
  Gift,
  PartyPopper,
} from "lucide-react"
import { useCapitalReadiness } from "@/hooks/use-capital-readiness"

// ====== TIPOS ======
type Priority = "high" | "medium" | "low"

interface ChecklistItem {
  id: string
  title: string
  description: string
  category: string
  priority: Priority
  actionItems: string[]
  relatedCourses?: string[]
  relatedTemplates?: string[]
}

interface AssessmentProps {
  mode: "full" | "widget" | "compact"
  onScoreChange?: (score: number) => void
}

// ====== LISTA ESTABLE (FUERA DEL COMPONENTE) ======
const CHECKLIST_ITEMS: ChecklistItem[] = [
  // Business Structure & Legal
  { id: "business-entity", title: "Business Entity Formed (LLC, S-Corp, or C-Corp)", description: "Legal business structure established and registered with state", category: "legal", priority: "high", actionItems: ["Choose appropriate business structure for your needs","File Articles of Incorporation/Organization with state","Obtain Certificate of Good Standing"], relatedCourses: ["funding-fundamentals"], relatedTemplates: ["business-model-canvas"] },
  { id: "ein-registered", title: "EIN Registered with IRS", description: "Federal tax identification number obtained", category: "legal", priority: "high", actionItems: ["Apply for EIN through IRS website or Form SS-4","Receive EIN confirmation letter","Update all business accounts with EIN"] },
  { id: "licenses-permits", title: "Business Licenses & Permits Secured", description: "All required federal, state, and local permits obtained", category: "legal", priority: "high", actionItems: ["Research required licenses for your industry","Apply for federal, state, and local permits","Maintain current status on all licenses"] },
  { id: "operating-agreement", title: "Operating Agreement or Corporate Bylaws in Place", description: "Internal governance documents properly executed", category: "legal", priority: "medium", actionItems: ["Draft operating agreement or bylaws","Have documents reviewed by attorney","Execute and store properly"] },
  { id: "naics-code", title: "NAICS/SIC Code Matched to Low-Risk Industry", description: "Business classified in appropriate industry category", category: "legal", priority: "medium", actionItems: ["Research appropriate NAICS codes","Select code that best matches your business","Update all registrations with correct code"] },

  // Credit & Compliance
  { id: "duns-number", title: "D-U-N-S Number Registered", description: "Dun & Bradstreet business identifier obtained", category: "credit", priority: "high", actionItems: ["Apply for free D-U-N-S number through Dun & Bradstreet","Verify business information is accurate","Monitor D-U-N-S profile regularly"], relatedCourses: ["business-credit-fundamentals"] },
  { id: "credit-agencies", title: "Business Listed with Credit Agencies (Experian, Equifax, SBFE)", description: "Business credit profiles established with major bureaus", category: "credit", priority: "high", actionItems: ["Register with Experian Business","Create profiles with Equifax and SBFE","Verify all business information is consistent"], relatedCourses: ["business-credit-fundamentals"] },
  { id: "net30-vendors", title: "3+ Net-30 Vendors Reporting", description: "Trade credit relationships established and reporting", category: "credit", priority: "high", actionItems: ["Identify vendors offering Net-30 terms","Apply for trade credit accounts","Make timely payments to build credit history"], relatedCourses: ["business-credit-fundamentals"] },
  { id: "business-bank", title: "Business Bank Account Opened & Active 6+ Months", description: "Dedicated business banking relationship established", category: "credit", priority: "high", actionItems: ["Open business checking account","Maintain consistent activity for 6+ months","Keep personal and business finances separate"] },
  { id: "contact-consistency", title: "Business Address, Phone, Email & Website All Match", description: "Consistent business contact information across all platforms", category: "credit", priority: "medium", actionItems: ["Audit all business listings and profiles","Update inconsistent information","Maintain professional business website"] },

  // Financial Documentation
  { id: "monthly-bookkeeping", title: "Monthly Bookkeeping (Updated P&L and Balance Sheet)", description: "Current financial statements maintained monthly", category: "financial", priority: "high", actionItems: ["Set up accounting software (QuickBooks, Xero, etc.)","Maintain monthly P&L and Balance Sheet","Reconcile accounts monthly"], relatedCourses: ["financial-literacy-basics","cash-flow-mastery"], relatedTemplates: ["cash-flow-forecast"] },
  { id: "tax-returns", title: "Two Years of Filed Business Tax Returns", description: "Complete tax filing history available", category: "financial", priority: "high", actionItems: ["File all required business tax returns","Maintain copies of filed returns","Ensure returns show business activity"] },
  { id: "debt-schedule", title: "Debt Schedule with Current Balances & Terms", description: "Complete inventory of all business debts", category: "financial", priority: "high", actionItems: ["List all business debts and obligations","Document current balances and terms","Calculate debt-to-income ratios"], relatedTemplates: ["budget-planner"] },
  { id: "bank-statements", title: "Business Bank Statements Ready (Last 3–6 Months)", description: "Recent banking history available for review", category: "financial", priority: "high", actionItems: ["Gather 3-6 months of bank statements","Ensure statements show consistent activity","Prepare explanations for any unusual transactions"] },
  { id: "dscr-margins", title: "1.25+ DSCR or Strong Gross Margins", description: "Debt service coverage ratio above 1.25 or strong profitability", category: "financial", priority: "high", actionItems: ["Calculate current DSCR","Improve cash flow if below 1.25","Document gross margin improvements"], relatedCourses: ["financial-analysis"] },

  // Personal Credit & Guarantees
  { id: "personal-fico", title: "Personal FICO Score Above 680", description: "Strong personal credit score for business owner", category: "personal", priority: "high", actionItems: ["Check personal credit score","Pay down high balances if needed","Dispute any errors on credit report"], relatedCourses: ["credit-repair-strategies"] },
  { id: "credit-utilization", title: "Credit Utilization Below 30%", description: "Personal credit card balances kept low", category: "personal", priority: "high", actionItems: ["Calculate current utilization across all cards","Pay down balances to below 30%","Consider increasing credit limits"] },
  { id: "no-derogatory", title: "No Recent Derogatory Marks or Collections", description: "Clean recent credit history", category: "personal", priority: "high", actionItems: ["Review credit reports for negative items","Pay off any collections","Avoid new derogatory marks"] },
  { id: "dispute-plan", title: "Dispute Plan or Payoff Strategy Implemented (if needed)", description: "Active plan to address credit issues", category: "personal", priority: "medium", actionItems: ["Identify items to dispute or pay off","Create timeline for credit improvement","Monitor progress monthly"], relatedCourses: ["credit-repair-strategies"] },
  { id: "guarantee-strategy", title: "Personal Guarantee Strategy Defined (if applicable)", description: "Clear understanding of personal guarantee implications", category: "personal", priority: "medium", actionItems: ["Understand personal guarantee requirements","Assess personal risk tolerance","Consider alternatives to personal guarantees"] },

  // Presentation & Planning
  { id: "lender-deck", title: "Lender-Ready Deck or Executive Summary Prepared", description: "Professional presentation materials ready", category: "presentation", priority: "high", actionItems: ["Create executive summary","Develop lender presentation deck","Include all key business metrics"], relatedCourses: ["investor-pitch-secrets"], relatedTemplates: ["marketing-plan"] },
  { id: "capital-use", title: "Capital Use Plan Defined (How Funds Will Be Used)", description: "Clear plan for how funding will be deployed", category: "presentation", priority: "high", actionItems: ["Detail specific use of funds","Show expected ROI for each use","Create timeline for fund deployment"] },
  { id: "exit-strategy", title: "Exit or Repayment Strategy Documented", description: "Clear plan for loan repayment or investor exit", category: "presentation", priority: "high", actionItems: ["Document repayment plan","Show cash flow projections","Consider multiple exit scenarios"] },
  { id: "business-valuation", title: "Business Valuation or Exit Scorecard Completed", description: "Understanding of current business value", category: "presentation", priority: "medium", actionItems: ["Complete business valuation","Understand key value drivers","Identify areas for value improvement"] },
  { id: "growth-plan", title: "90-Day Strategic Growth Plan Mapped Out", description: "Short-term strategic plan post-funding", category: "presentation", priority: "medium", actionItems: ["Create detailed 90-day plan","Set measurable milestones","Identify key success metrics"], relatedTemplates: ["90-day-plan"] },
]

// ====== COMPONENTE ======
export function CapitalReadinessAssessment({ mode = "full", onScoreChange }: AssessmentProps) {
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [showCelebration, setShowCelebration] = useState(false)
  const [achievementUnlocked, setAchievementUnlocked] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)

  const achievements = [
    { id: "first-step", title: "First Step!", description: "Completed your first item", threshold: 1, icon: Star },
    { id: "quarter-way", title: "Getting Started", description: "25% complete - You're on your way!", threshold: 25, icon: Zap },
    { id: "halfway-hero", title: "Halfway Hero", description: "50% complete - Halfway to funding ready!", threshold: 50, icon: Trophy },
    { id: "three-quarters", title: "Almost There", description: "75% complete - So close to funding ready!", threshold: 75, icon: Rocket },
    { id: "funding-ready", title: "🎉 FUNDING READY! 🎉", description: "100% complete - You're ready to secure funding!", threshold: 100, icon: Crown },
  ]

  const checkMilestoneAchievements = (previousScore: number, newScore: number) => {
    const newAchievements = achievements.filter(
      (achievement) => newScore >= achievement.threshold && previousScore < achievement.threshold,
    )
    if (newAchievements.length > 0) {
      const latest = newAchievements[newAchievements.length - 1]
      setAchievementUnlocked(latest.id)
      if (newScore === 100) {
        setShowCelebration(true)
        setShowConfetti(true)
        setTimeout(() => setShowConfetti(false), 5000)
      }
      setTimeout(() => setAchievementUnlocked(null), 4000)
    }
  }

  const getMotivationalMessage = (score: number) => {
    if (score === 100) return "🎉 CONGRATULATIONS! You're 100% funding ready! Time to secure that capital! 🚀"
    if (score >= 90) return "🔥 Almost perfect! Just a few more items and you'll be funding ready!"
    if (score >= 80) return "💪 Great progress! You're in the final stretch!"
    if (score >= 60) return "⚡ You're building momentum! Keep going!"
    if (score >= 40) return "🎯 Good start! You're making real progress!"
    if (score >= 20) return "🌟 Every step counts! You're on your way!"
    return "🚀 Ready to get funding ready? Let's do this!"
  }

  // Arrays estables
  const checklistItems = CHECKLIST_ITEMS
  const itemIds = useMemo(() => checklistItems.map((i) => i.id), [checklistItems])

  const categories = useMemo(
    () => [
      { id: "all", name: "All Items", icon: Target, count: checklistItems.length },
      { id: "legal", name: "Legal & Structure", icon: Building, count: checklistItems.filter((i) => i.category === "legal").length },
      { id: "credit", name: "Credit & Compliance", icon: CreditCard, count: checklistItems.filter((i) => i.category === "credit").length },
      { id: "financial", name: "Financial Docs", icon: FileText, count: checklistItems.filter((i) => i.category === "financial").length },
      { id: "personal", name: "Personal Credit", icon: TrendingUp, count: checklistItems.filter((i) => i.category === "personal").length },
      { id: "presentation", name: "Presentation", icon: PresentationChart, count: checklistItems.filter((i) => i.category === "presentation").length },
    ],
    [checklistItems]
  )

  // Hook Supabase
  const {
    loading,
    checked,
    setItemChecked,
    completedCount,
    totalCount,
    completionPercentage,
    previousPercentRef,
  } = useCapitalReadiness(itemIds)

  // Logros + notificar al padre
  useEffect(() => {
    if (loading) return
    const prev = previousPercentRef.current
    if (completionPercentage > prev) {
      checkMilestoneAchievements(prev, completionPercentage)
    }
    previousPercentRef.current = completionPercentage
    onScoreChange?.(completionPercentage)
  }, [completionPercentage, loading, onScoreChange, previousPercentRef])

  const filteredItems =
    selectedCategory === "all" ? checklistItems : checklistItems.filter((item) => item.category === selectedCategory)

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600"
    if (score >= 60) return "text-yellow-600"
    return "text-red-600"
  }
  const getScoreLabel = (score: number) => {
    if (score === 100) return "🏆 FUNDING READY - Congratulations!"
    if (score >= 90) return "🔥 Excellent - Almost Perfect!"
    if (score >= 80) return "💪 Good - Minor Improvements Needed"
    if (score >= 60) return "⚡ Fair - Moderate Work Required"
    if (score >= 40) return "🎯 Getting Started - Keep Going!"
    return "🚀 Just Starting - You Got This!"
  }

  const CelebrationModal = () => {
    if (!showCelebration) return null
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-100 via-green-100 to-blue-100 opacity-50"></div>
          <div className="relative z-10">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-3xl font-bold text-green-600 mb-2">FUNDING READY!</h2>
            <p className="text-lg mb-4">You've completed all 25 items!</p>
            <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white p-4 rounded-lg mb-6">
              <Trophy className="h-8 w-8 mx-auto mb-2" />
              <p className="font-bold">Achievement Unlocked:</p>
              <p className="text-sm">Capital Readiness Master</p>
            </div>
            <div className="space-y-3 mb-6">
              <Button className="w-full bg-green-600 hover:bg-green-700" asChild>
                <a href="/module/1">
                  <Rocket className="h-4 w-4 mr-2" />
                  Explore Advanced Funding Courses
                </a>
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <a href="/templates">
                  <Gift className="h-4 w-4 mr-2" />
                  Download Premium Templates
                </a>
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setShowCelebration(false)}>
              Continue Celebrating! 🎊
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const AchievementNotification = () => {
    if (!achievementUnlocked) return null
    const achievement = achievements.find((a) => a.id === achievementUnlocked)
    if (!achievement) return null
    const Icon = achievement.icon
    return (
      <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right duration-500">
        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white p-4 rounded-lg shadow-lg max-w-sm">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-2 rounded-full">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-sm">Achievement Unlocked!</p>
              <p className="text-sm">{achievement.title}</p>
              <p className="text-xs opacity-90">{achievement.description}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (mode === "compact") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Capital Readiness</CardTitle>
            <Badge variant={completionPercentage >= 80 ? "default" : "secondary"}>
              {completedCount}/{totalCount}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Progress value={completionPercentage} className="h-2" />
            <div className="flex items-center justify-between text-sm">
              <span className={getScoreColor(completionPercentage)}>{completionPercentage}% Complete</span>
              <Button variant="outline" size="sm" asChild>
                <a href="/assessment">
                  View Full Assessment
                  <ArrowRight className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (mode === "widget") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Target className="h-5 w-5 mr-2" />
            Capital Readiness Assessment
          </CardTitle>
          <CardDescription>Track your progress toward funding readiness</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Overall Progress</span>
              <span className={`text-sm font-bold ${getScoreColor(completionPercentage)}`}>{completionPercentage}%</span>
            </div>
            <Progress value={completionPercentage} className="h-3" />
            <p className={`text-sm ${getScoreColor(completionPercentage)}`}>{getScoreLabel(completionPercentage)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {categories.slice(1).map((category) => {
              const categoryItems = checklistItems.filter((item) => item.category === category.id)
              const categoryCompleted = categoryItems.filter((item) => checked[item.id]).length
              const categoryPercentage = Math.round((categoryCompleted / categoryItems.length) * 100)

              return (
                <div key={category.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <span className="truncate">{category.name}</span>
                  <span className={`font-medium ${getScoreColor(categoryPercentage)}`}>{categoryPercentage}%</span>
                </div>
              )
            })}
          </div>

          <Button className="w-full" asChild>
            <a href="/assessment">
              Complete Full Assessment
              <ArrowRight className="h-4 w-4 ml-2" />
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Full mode
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Capital Readiness Assessment</h1>
        <p className="text-muted-foreground mb-4">25-Point Lender Scorecard to Prepare Your Business for Funding</p>

        {loading && <div className="mb-4 text-sm text-muted-foreground">Loading your assessment…</div>}

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{completedCount}</p>
                  <p className="text-sm text-muted-foreground">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold">{totalCount - completedCount}</p>
                  <p className="text-sm text-muted-foreground">Remaining</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            {completionPercentage === 100 && (
              <div className="absolute inset-0 bg-gradient-to-r from-green-100 via-yellow-100 to-green-100 opacity-50"></div>
            )}
            <CardContent className="p-6 relative z-10">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Overall Readiness Score</span>
                  <div className="flex items-center space-x-2">
                    {completionPercentage === 100 && <Crown className="h-5 w-5 text-yellow-500" />}
                    <span className={`text-2xl font-bold ${getScoreColor(completionPercentage)}`}>{completionPercentage}%</span>
                  </div>
                </div>
                <Progress value={completionPercentage} className="h-4" />
                <div className="text-center">
                  <p className={`font-medium ${getScoreColor(completionPercentage)}`}>{getScoreLabel(completionPercentage)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{getMotivationalMessage(completionPercentage)}</p>
                </div>

                {completionPercentage === 100 && (
                  <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white p-4 rounded-lg text-center">
                    <PartyPopper className="h-6 w-6 mx-auto mb-2" />
                    <p className="font-bold">🎉 Ready to secure funding! 🎉</p>
                    <p className="text-sm opacity-90">You've mastered all 25 funding readiness criteria!</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
          <TabsList className="grid w-full grid-cols-6 mb-6">
            {categories.map((category) => (
              <TabsTrigger key={category.id} value={category.id} className="text-xs">
                <category.icon className="h-4 w-4 mr-1" />
                {category.name} ({category.count})
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={selectedCategory}>
            <div className="space-y-4">
              {filteredItems.map((item) => (
                <ChecklistItemCard
                  key={item.id}
                  item={item}
                  checked={Boolean(checked[item.id])}
                  onCheck={(val) => setItemChecked(item.id, val === true || val === "true")}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <CelebrationModal />
        <AchievementNotification />
      </div>
    </div>
  )
}

function ChecklistItemCard({
  item,
  checked,
  onCheck,
}: {
  item: ChecklistItem
  checked: boolean
  onCheck: (checked: boolean | string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800"
      case "medium":
        return "bg-yellow-100 text-yellow-800"
      case "low":
        return "bg-green-100 text-green-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <Card className={`transition-all ${checked ? "bg-green-50 border-green-200" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start space-x-3">
          <Checkbox checked={checked} onCheckedChange={(value) => onCheck(value)} className="mt-1" />
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <CardTitle className={`text-lg ${checked ? "line-through text-muted-foreground" : ""}`}>{item.title}</CardTitle>
              <Badge className={getPriorityColor(item.priority)}>{item.priority} priority</Badge>
            </div>
            <CardDescription>{item.description}</CardDescription>
          </div>
        </div>
      </CardHeader>

      {!checked && (
        <CardContent className="pt-0">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="mb-3">
            {expanded ? "Hide" : "Show"} Action Items
            <ArrowRight className={`h-4 w-4 ml-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </Button>

          {expanded && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Action Items:</h4>
                <ul className="space-y-1">
                  {item.actionItems.map((action, index) => (
                    <li key={index} className="text-sm text-muted-foreground flex items-start">
                      <span className="mr-2">•</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {(item.relatedCourses || item.relatedTemplates) && (
                <div className="flex gap-2 flex-wrap">
                  {item.relatedCourses?.map((courseId) => (
                    <Button key={courseId} variant="outline" size="sm" asChild>
                      <a href="/courses">
                        <BookOpen className="h-3 w-3 mr-1" />
                        Related Course
                      </a>
                    </Button>
                  ))}
                  {item.relatedTemplates?.map((templateId) => (
                    <Button key={templateId} variant="outline" size="sm" asChild>
                      <a href="/templates">
                        <Download className="h-3 w-3 mr-1" />
                        Template
                      </a>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
