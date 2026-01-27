'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ModuleCard from '@/components/module-card'
import { LogoutButton } from '@/components/logout-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp } from 'lucide-react'
import Link from 'next/link'
import CreditScoreWidget from '@/components/credit-score-widget'
import CreditGoalsWidget from '@/components/credit-goals-widget'
import DashboardProgressHero from '@/components/dashboard-progress-hero'

// % de capital readiness (25 items)
async function fetchCapitalReadinessPercent(
  supabase: ReturnType<typeof createClient>,
  totalItems = 25
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data, error } = await supabase
    .from('user_capital_readiness')
    .select('checked')
    .eq('user_id', user.id)
    .eq('checked', true)

  if (error) {
    console.error('readiness count error', error)
    return 0
  }
  const completed = data?.length ?? 0
  return Math.round((completed / totalItems) * 100)
}

export default function CourseDashboard() {
  const [creditScore, setCreditScore] = useState(720)
  const [targetScore, setTargetScore] = useState(750)
  const [userName, setUserName] = useState<string | null>(null)
  const [modules, setModules] = useState<any[]>([])

  // progresos
  const [courseProgress, setCourseProgress] = useState(0)
  const [capitalReadiness, setCapitalReadiness] = useState(0)
  const [programProgress, setProgramProgress] = useState<number | null>(null)
  const [nextModule, setNextModule] = useState<any | null>(null)

  // CTA directo a la lección actual
  const [nextLessonHref, setNextLessonHref] = useState<string | undefined>(undefined)
  const [nextLessonTitle, setNextLessonTitle] = useState<string | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()

    // ajusta si tu ruta real de lecciones es otra
    const buildLessonUrl = (moduleId: string, lessonId: string) =>
      `/module/${moduleId}?lesson=${lessonId}`

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const nameFromMetadata = user.user_metadata?.full_name || user.user_metadata?.name
        const fallback = user.email?.split('@')[0]
        setUserName(nameFromMetadata ?? fallback ?? 'User')
      }

      // ------- Módulos y Lecciones (ordenados) -------
      const { data: moduleData } = await supabase
        .from('academy_modules')
        .select('id, title, description, display_order')
        .order('display_order', { ascending: true })

      const { data: lessonsData } = await supabase
        .from('academy_lessons')
        .select('id, module_id, title, display_order')
        .order('display_order', { ascending: true })

      const { data: progressData } = await supabase
        .from('user_progress')
        .select('lesson_id, module_id, completed')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)

      let cp = 0
      let nm: any | null = null

      if (moduleData) {
        const modulesWithProgress = moduleData.map((mod) => {
          const lessons = (lessonsData || []).filter((l) => l.module_id === mod.id)
          const completed = (progressData || []).filter(
            (p) => p.completed && lessons.some((l) => l.id === p.lesson_id)
          )
          return {
            ...mod,
            total_lessons: lessons.length,
            completed_lessons: completed.length,
          }
        })

        setModules(modulesWithProgress)

        const totalLessons = modulesWithProgress.reduce((sum, m) => sum + m.total_lessons, 0)
        const completedLessons = modulesWithProgress.reduce((sum, m) => sum + m.completed_lessons, 0)
        cp = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0
        setCourseProgress(cp)

        // siguiente módulo con pendientes (primer módulo por display_order)
        nm = modulesWithProgress.find(m => m.completed_lessons < m.total_lessons) || null
        setNextModule(nm)

        // primera lección pendiente dentro de ese módulo (por display_order)
        if (nm) {
          const moduleLessons = (lessonsData || [])
            .filter(l => l.module_id === nm.id)
            .sort((a, b) => a.display_order - b.display_order)

          const completedSet = new Set(
            (progressData || []).filter(p => p.completed).map(p => p.lesson_id)
          )

          const pendingLesson = moduleLessons.find(l => !completedSet.has(l.id))
          if (pendingLesson) {
            setNextLessonHref(buildLessonUrl(nm.id, pendingLesson.id))
            setNextLessonTitle(pendingLesson.title)
          } else {
            setNextLessonHref(undefined)
            setNextLessonTitle(undefined)
          }
        } else {
          setNextLessonHref(undefined)
          setNextLessonTitle(undefined)
        }
      }

      // ------- Capital Readiness -------
      const readinessPercent = await fetchCapitalReadinessPercent(supabase, 25)
      setCapitalReadiness(readinessPercent)

      // ------- Blend 70/30 -------
      // ------- Blend 70/30 -------
      // const blended = Math.round((cp * 0.7) + (readinessPercent * 0.3))
      // setProgramProgress(blended)
      setProgramProgress(cp)
    }

    load()

      // realtime: refrescar cuando cambie readiness o progreso (solo del usuario actual)
      ; (async () => {
        const { data: { user } } = await supabase.auth.getUser()
        const uid = user?.id

        const chReadiness = supabase
          .channel('rt-capital-readiness')
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'user_capital_readiness', filter: `user_id=eq.${uid}` },
            load
          )
          .subscribe()

        const chProgress = supabase
          .channel('rt-user-progress')
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'user_progress', filter: `user_id=eq.${uid}` },
            load
          )
          .subscribe()

        return () => {
          supabase.removeChannel(chReadiness)
          supabase.removeChannel(chProgress)
        }
      })()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">FinanceAcademy</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                BETA Member
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">
            Welcome back{userName ? `, ${userName}` : ''}!
          </h2>
          <p className="text-slate-600">Master your credit and take control of your financial future</p>
        </div>

        {/*  Progress Hero */}
        <div className="mb-8">
          <DashboardProgressHero
            courseProgress={courseProgress}
            capitalReadiness={capitalReadiness}
            programProgress={programProgress}
            nextModule={nextModule}
            nextLessonHref={nextLessonHref}      //  botón directo a la lección
            nextLessonTitle={nextLessonTitle}
          />
        </div>

        {/* Credit Widgets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <CreditScoreWidget score={creditScore} range="FICO Score 8" onScoreUpdate={setCreditScore} />
          <CreditGoalsWidget currentScore={creditScore} targetScore={targetScore} onTargetUpdate={setTargetScore} />
        </div>

        {/* Modules */}
        <div className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-900 mb-6">Course Modules</h3>
          {modules.map((module) => (
            <ModuleCard key={module.id} module={module} />
          ))}
        </div>

        {/* Quick Actions */}
        <Card className="mt-8 bg-white/80 border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900">Quick Actions</CardTitle>
            <CardDescription className="text-slate-600">Access your resources and tools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/dashboard/chat">
                <Button variant="outline" className="w-full h-16">💬 AI Business Coach</Button>
              </Link>
              {/* <Link href="/dashboard/assessment">
                <Button variant="outline" className="w-full h-16">📋 Action Assessments</Button>
              </Link> */}
              <Link href="/dashboard/book-consultation">
                <Button className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 text-white">
                  📅 Book Financial Advisor Call
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
