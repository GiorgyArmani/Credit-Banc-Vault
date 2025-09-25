'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, Users, Play, MessageSquare, CheckSquare } from 'lucide-react'
import Link from 'next/link'

const getModuleIcon = (type: string) => {
  switch (type) {
    case 'video':
      return <Play className="h-4 w-4" />
    case 'pdf':
      return <MessageSquare className="h-4 w-4" />
    case 'checklist':
      return <CheckSquare className="h-4 w-4" />
    default:
      return <Play className="h-4 w-4" />
  }
}

export default function ModuleCard({ module }: { module: any }) {
  const progressPercent = module.total_lessons
    ? Math.round((module.completed_lessons / module.total_lessons) * 100)
    : 0

  const isCompleted = progressPercent === 100
  const isStarted = progressPercent > 0

  return (
    <Card
      className={`bg-white/80 border-slate-200 shadow-sm hover:bg-slate-50 transition-all duration-200 ${
        isStarted && !isCompleted ? 'ring-2 ring-blue-500/50' : ''
      }`}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div
              className={`h-12 w-12 rounded-lg flex items-center justify-center ${
                isCompleted
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : isStarted
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {getModuleIcon(module.type)}
            </div>
            <div>
              <h4 className="text-lg font-semibold text-slate-900 mb-1">{module.title}</h4>
              <p className="text-slate-600 text-sm mb-2">{module.description}</p>
              <div className="flex items-center space-x-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {module.total_lessons} lessons
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {module.duration || '—'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {isCompleted && (
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Completed</Badge>
            )}
            {isStarted && !isCompleted && (
              <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">In Progress</Badge>
            )}
            <Link href={`/dashboard/module/${module.id}`}>
              <Button
                variant={isStarted ? 'default' : 'outline'}
                className={
                  isCompleted
                    ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                    : isStarted
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : ''
                }
              >
                {isCompleted ? 'Review' : isStarted ? 'Continue' : 'Start'}
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
