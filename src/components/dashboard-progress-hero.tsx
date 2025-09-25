'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { Sparkles, Target, CheckCircle2, PlayCircle } from 'lucide-react'
import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import clsx from 'clsx'

type NextModule = { id: string; title?: string; total_lessons?: number; completed_lessons?: number }

export default function DashboardProgressHero({
  courseProgress,
  capitalReadiness,
  programProgress,          // si no lo pasas, se calcula como 70/30
  nextModule,
  nextLessonHref,           // URL directa a la lección actual (opcional)
  nextLessonTitle,          // título de la lección (opcional)
  totalAssessmentItems = 25,
}: {
  courseProgress: number
  capitalReadiness: number
  programProgress?: number | null
  nextModule?: NextModule | null
  nextLessonHref?: string
  nextLessonTitle?: string
  totalAssessmentItems?: number
}) {
  const blended = Math.round((programProgress ?? Math.round(courseProgress * 0.7 + capitalReadiness * 0.3)))

  const remainingAssessment = Math.max(0, totalAssessmentItems - Math.round((capitalReadiness / 100) * totalAssessmentItems))
  const courseLessonsRemaining = Math.max(0, (nextModule?.total_lessons ?? 0) - (nextModule?.completed_lessons ?? 0))

  // --- URLs y labels del curso ---
  const started = courseProgress > 0
  const startOrContinueLabel = started
    ? (nextLessonHref
        ? `Continue: ${nextLessonTitle ?? 'Current lesson'}`
        : nextModule
          ? `Continue: ${nextModule.title ?? 'Next Module'}`
          : 'Open Academy')
    : 'Start Course'

  const courseHref =
    nextLessonHref
      ? nextLessonHref
      : nextModule
        ? `/module/${nextModule.id}`
        : '/dashboard'

  // Prioridad dinámica: si assessment va más bajo que el curso, lo mostramos como primario
  const assessmentIsPriority = capitalReadiness < courseProgress

  const primary = assessmentIsPriority
    ? { label: 'Complete Assessment', href: '/dashboard/assessment', icon: Target }
    : { label: startOrContinueLabel, href: courseHref, icon: started ? Sparkles : PlayCircle }

  const secondary = assessmentIsPriority
    ? { label: startOrContinueLabel, href: courseHref, icon: started ? Sparkles : PlayCircle }
    : { label: 'Complete Assessment', href: '/dashboard/assessment', icon: Target }

  const PrimaryIcon = primary.icon
  const SecondaryIcon = secondary.icon

  const data = [
    { name: 'Track', value: 100, fill: 'rgba(16,185,129,0.12)' },
    { name: 'Progress', value: blended, fill: '#10B981' },
  ]
  const milestones = [0, 25, 50, 75, 100]

  return (
    <Card className="bg-white/80 border-slate-200 shadow-sm">
      <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <CardTitle className="text-slate-900">Your Growth Journey</CardTitle>
          <CardDescription className="text-slate-600">One focus. One button. Keep momentum.</CardDescription>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            Course {courseProgress}%
          </Badge>
          <Badge variant="secondary" className="bg-teal-50 text-teal-700 border-teal-200">
            Assessment {capitalReadiness}%
          </Badge>
        </div>
      </CardHeader>

      {/* Layout: centro = ring + milestones; derecha = botones apilados */}
     <CardContent className="grid grid-cols-1 md:grid-cols-[220px_1fr_220px] items-start gap-6 md:gap-8">
  {/* Columna fantasma para simetría (mismo ancho que la botonera) */}
  <div className="hidden md:block" aria-hidden />

  {/* ── COLUMNA CENTRAL: Ring + Milestones + Counters ── */}
  <div className="w-full flex flex-col items-center justify-self-center">
    {/* Ring centrado */}
    <div className="relative h-56 md:h-64 w-full max-w-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" barSize={14} data={data} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" background={{}} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <div className="text-4xl font-extrabold text-slate-900">{blended}%</div>
        <div className="text-xs uppercase tracking-wider text-slate-500">Program Progress</div>
      </div>
    </div>

    {/* Milestones debajo del ring */}
    <div className="mt-6 w-full max-w-md">
      <div className="flex justify-between text-xs text-slate-500 mb-2">
        <span>Milestones</span>
        <span>Next: {milestones.find(m => m > blended) ?? '—'}%</span>
      </div>
      <div className="relative h-2 bg-slate-200 rounded">
        <div className="absolute h-2 bg-emerald-500 rounded" style={{ width: `${blended}%` }} />
        {milestones.map((m, i) => (
          <div
            key={i}
            className={clsx(
              'absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border',
              m <= blended ? 'bg-emerald-500 border-emerald-600' : 'bg-white border-slate-300'
            )}
            style={{ left: `calc(${m}% - 6px)` }}
            title={`${m}%`}
          />
        ))}
      </div>
    </div>

    {/* Contadores compactos */}
    <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-md">
      <div className="p-3 rounded-lg border border-slate-200 bg-white">
        <div className="text-xs text-slate-500 mb-1">Assessment</div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <div className="text-sm">{remainingAssessment} item{remainingAssessment === 1 ? '' : 's'} left</div>
        </div>
      </div>
      <div className="p-3 rounded-lg border border-slate-200 bg-white">
        <div className="text-xs text-slate-500 mb-1">Next Module</div>
        <div className="text-sm">
          {nextModule ? `${Math.max(courseLessonsRemaining, 0)} lesson${courseLessonsRemaining === 1 ? '' : 's'} left` : 'All caught up'}
        </div>
      </div>
    </div>
  </div>

  {/* ── COLUMNA DERECHA: Botones apilados ── */}
  <div className="w-full md:w-[220px] justify-self-end flex flex-col items-stretch gap-2">
    <div className="hidden md:flex self-end items-center gap-1 text-xs text-emerald-700">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M9 11.5l2 2L20 5l2 2-11 11-5-5 2-2z"/></svg>
      <span>Recommended next step</span>
    </div>

    <Link href={primary.href} aria-label={primary.label}>
      <Button className="h-11 w-full rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-[0_10px_20px_rgba(16,185,129,.20)] ring-1 ring-emerald-500/20 justify-center">
        <PrimaryIcon className="h-5 w-5 mr-2" />
        {primary.label}
      </Button>
    </Link>

    <Link href={secondary.href} aria-label={secondary.label}>
      <Button variant="outline" className="h-11 w-full rounded-full border-slate-300 text-slate-700 hover:bg-slate-50 justify-center">
        <SecondaryIcon className="h-5 w-5 mr-2" />
        {secondary.label}
      </Button>
    </Link>

    {nextLessonHref && (
      <Link href={nextLessonHref} className="self-end">
        <Button variant="ghost" className="h-10 px-4 rounded-full text-slate-600 hover:text-slate-800">
          Go to current lesson
        </Button>
      </Link>
    )}
  </div>
</CardContent>
    </Card>
  )
}
