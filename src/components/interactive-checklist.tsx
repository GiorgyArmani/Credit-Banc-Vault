"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, TrendingUp } from "lucide-react"

interface ChecklistItem {
  id: number
  title: string
  description: string
  completed: boolean
}

interface InteractiveChecklistProps {
  title: string
}

export default function InteractiveChecklist({ title }: InteractiveChecklistProps) {
  const getCreditChecklistItems = (title: string): ChecklistItem[] => {
    if (title.includes("Credit Building Action Plan")) {
      return [
        {
          id: 1,
          title: "Check your current credit score",
          description: "Get your free credit score from a reliable source",
          completed: false,
        },
        {
          id: 2,
          title: "Review all three credit reports",
          description: "Obtain reports from Experian, Equifax, and TransUnion",
          completed: false,
        },
        {
          id: 3,
          title: "Identify negative items",
          description: "Mark any late payments, collections, or errors on your reports",
          completed: false,
        },
        {
          id: 4,
          title: "Set up payment reminders",
          description: "Create automatic reminders for all bill due dates",
          completed: false,
        },
        {
          id: 5,
          title: "Calculate credit utilization",
          description: "Determine your current credit card utilization ratio",
          completed: false,
        },
        {
          id: 6,
          title: "Create a debt paydown plan",
          description: "Prioritize which debts to pay off first",
          completed: false,
        },
      ]
    } else if (title.includes("Credit Report Analysis")) {
      return [
        {
          id: 1,
          title: "Verify personal information",
          description: "Check name, address, SSN, and employment info for accuracy",
          completed: false,
        },
        {
          id: 2,
          title: "Review account details",
          description: "Verify all accounts belong to you and details are correct",
          completed: false,
        },
        {
          id: 3,
          title: "Check payment history",
          description: "Look for any incorrect late payment markings",
          completed: false,
        },
        {
          id: 4,
          title: "Verify credit limits and balances",
          description: "Ensure all reported balances and limits are accurate",
          completed: false,
        },
        {
          id: 5,
          title: "Review hard inquiries",
          description: "Check that all credit inquiries were authorized by you",
          completed: false,
        },
        {
          id: 6,
          title: "Document any errors found",
          description: "Create a list of all inaccuracies to dispute",
          completed: false,
        },
      ]
    } else if (title.includes("Monthly Monitoring Routine")) {
      return [
        {
          id: 1,
          title: "Check credit score updates",
          description: "Review monthly credit score changes and trends",
          completed: false,
        },
        {
          id: 2,
          title: "Review new account alerts",
          description: "Verify any new accounts opened in your name",
          completed: false,
        },
        {
          id: 3,
          title: "Monitor credit utilization",
          description: "Track your credit card balances and utilization ratios",
          completed: false,
        },
        {
          id: 4,
          title: "Check for new inquiries",
          description: "Review any new hard inquiries on your credit reports",
          completed: false,
        },
        {
          id: 5,
          title: "Update personal information",
          description: "Ensure your contact information is current with creditors",
          completed: false,
        },
        {
          id: 6,
          title: "Review identity monitoring alerts",
          description: "Check for any suspicious activity or identity theft warnings",
          completed: false,
        },
      ]
    } else if (title.includes("Credit Monitoring Checklist")) {
      return [
        {
          id: 1,
          title: "Set up credit monitoring service",
          description: "Choose and activate a comprehensive credit monitoring service",
          completed: false,
        },
        {
          id: 2,
          title: "Configure alert preferences",
          description: "Set up email, SMS, and app notifications for credit changes",
          completed: false,
        },
        {
          id: 3,
          title: "Add identity monitoring",
          description: "Enable dark web monitoring and identity theft protection",
          completed: false,
        },
        {
          id: 4,
          title: "Set up score tracking",
          description: "Configure monthly credit score updates and trend analysis",
          completed: false,
        },
        {
          id: 5,
          title: "Create monitoring calendar",
          description: "Schedule regular check-ins and review dates",
          completed: false,
        },
        {
          id: 6,
          title: "Test alert system",
          description: "Verify all notifications are working properly",
          completed: false,
        },
        {
          id: 7,
          title: "Set up family monitoring",
          description: "Add spouse/family members to monitoring system if applicable",
          completed: false,
        },
        {
          id: 8,
          title: "Configure fraud alerts",
          description: "Set up fraud alerts with all three credit bureaus",
          completed: false,
        },
        {
          id: 9,
          title: "Create response plan",
          description: "Prepare action steps for different types of credit alerts",
          completed: false,
        },
        {
          id: 10,
          title: "Document login credentials",
          description: "Securely store all monitoring service login information",
          completed: false,
        },
      ]
    }

    // Default fallback
    return [
      {
        id: 1,
        title: "Complete the lesson content",
        description: "Watch all videos and review materials",
        completed: false,
      },
      {
        id: 2,
        title: "Take notes on key concepts",
        description: "Document important information for future reference",
        completed: false,
      },
      {
        id: 3,
        title: "Apply what you learned",
        description: "Implement the strategies in your own credit journey",
        completed: false,
      },
    ]
  }

  const [items, setItems] = useState<ChecklistItem[]>(getCreditChecklistItems(title))

  const toggleItem = (id: number) => {
    setItems(items.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)))
  }

  const completedCount = items.filter((item) => item.completed).length
  const progress = (completedCount / items.length) * 100

  const handleSaveProgress = async () => {
    // Here you would make an API call to GoHighLevel or your backend
    const progressData = {
      userId: "user-123", // Get from auth context
      checklistId: title,
      items: items,
      completedCount: completedCount,
      progress: progress,
      timestamp: new Date().toISOString(),
    }

    try {
      // Example API call to save progress
      const response = await fetch("/api/save-progress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(progressData),
      })

      if (response.ok) {
        console.log("Progress saved successfully")
      }
    } catch (error) {
      console.error("Error saving progress:", error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            Progress Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Completed Tasks</span>
              <span className="text-emerald-400 font-medium">
                {completedCount} of {items.length}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="text-center">
              <span className="text-2xl font-bold text-slate-900">{Math.round(progress)}%</span>
              <p className="text-slate-600 text-sm">Complete</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Checklist Items */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-lg border transition-all ${
                  item.completed ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id={`item-${item.id}`}
                    checked={item.completed}
                    onCheckedChange={() => toggleItem(item.id)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor={`item-${item.id}`}
                      className={`block font-medium cursor-pointer ${
                        item.completed ? "text-emerald-700 line-through" : "text-slate-900"
                      }`}
                    >
                      {item.title}
                    </label>
                    <p className={`text-sm mt-1 ${item.completed ? "text-emerald-600" : "text-slate-600"}`}>
                      {item.description}
                    </p>
                  </div>
                  {item.completed && <CheckCircle className="h-5 w-5 text-emerald-600 mt-1" />}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-center">
            <Button onClick={handleSaveProgress} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Save Progress
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
