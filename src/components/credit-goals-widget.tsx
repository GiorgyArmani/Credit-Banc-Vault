"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Edit2, Check, X } from "lucide-react"

interface CreditGoalsWidgetProps {
  currentScore: number
  targetScore: number
  onTargetUpdate?: (newTarget: number) => void
}

export default function CreditGoalsWidget({ currentScore, targetScore, onTargetUpdate }: CreditGoalsWidgetProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTarget, setEditTarget] = useState(targetScore.toString())

  const progress = Math.min((currentScore / targetScore) * 100, 100)
  const pointsAway = Math.max(targetScore - currentScore, 0)

  const handleSave = () => {
    const newTarget = Number.parseInt(editTarget)
    if (newTarget >= currentScore && newTarget <= 850) {
      onTargetUpdate?.(newTarget)
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setEditTarget(targetScore.toString())
    setIsEditing(false)
  }

  return (
    <Card className="bg-white/80 border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-slate-900 text-lg flex items-center justify-between">
          Credit Goals
          {!isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          ) : (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-slate-600 text-sm">Target Score</span>
            {!isEditing ? (
              <span className="font-semibold text-slate-900">{targetScore}+</span>
            ) : (
              <Input
                value={editTarget}
                onChange={(e) => setEditTarget(e.target.value)}
                className="w-20 h-8 text-right text-sm"
                type="number"
                min={currentScore}
                max="850"
              />
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-600 text-sm">Progress</span>
            <span className="text-emerald-600 font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="text-xs text-slate-500 mt-2">
            {pointsAway > 0 ? `You're ${pointsAway} points away from your goal!` : "🎉 Goal achieved!"}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
