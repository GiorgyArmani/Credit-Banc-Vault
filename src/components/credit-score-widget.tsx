"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Edit2, Check, X } from "lucide-react"

interface CreditScoreWidgetProps {
  score: number
  range: string
  onScoreUpdate?: (newScore: number) => void
}

export default function CreditScoreWidget({ score, range, onScoreUpdate }: CreditScoreWidgetProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editScore, setEditScore] = useState(score.toString())

  const handleSave = () => {
    const newScore = Number.parseInt(editScore)
    if (newScore >= 300 && newScore <= 850) {
      onScoreUpdate?.(newScore)
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setEditScore(score.toString())
    setIsEditing(false)
  }

  const getScoreColor = (score: number) => {
    if (score >= 800) return "text-green-600"
    if (score >= 740) return "text-emerald-600"
    if (score >= 670) return "text-yellow-600"
    if (score >= 580) return "text-orange-600"
    return "text-red-600"
  }

  const getScoreLabel = (score: number) => {
    if (score >= 800) return "Exceptional"
    if (score >= 740) return "Very Good"
    if (score >= 670) return "Good"
    if (score >= 580) return "Fair"
    return "Poor"
  }

  const getProgressColor = (score: number) => {
    if (score >= 800) return "bg-green-500"
    if (score >= 740) return "bg-emerald-500"
    if (score >= 670) return "bg-yellow-500"
    if (score >= 580) return "bg-orange-500"
    return "bg-red-500"
  }

  return (
    <Card className="bg-white border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-slate-900 text-lg flex items-center justify-between">
          <span>Credit Score</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal text-slate-600">{range}</span>
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
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-center">
            {!isEditing ? (
              <>
                <div className={`text-4xl font-bold ${getScoreColor(score)}`}>{score}</div>
                <div className="text-sm text-slate-600 mt-1">{getScoreLabel(score)}</div>
              </>
            ) : (
              <div className="space-y-2">
                <Input
                  value={editScore}
                  onChange={(e) => setEditScore(e.target.value)}
                  className="text-center text-2xl font-bold w-24 mx-auto"
                  type="number"
                  min="300"
                  max="850"
                />
                <div className="text-xs text-slate-500">Enter score (300-850)</div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>300</span>
              <span>850</span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full ${getProgressColor(score)} transition-all duration-500`}
                style={{ width: `${((score - 300) / 550) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
