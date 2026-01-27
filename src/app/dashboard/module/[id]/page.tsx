'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Play, Download, BookOpen, PartyPopper, FileText } from 'lucide-react'
import Confetti from 'react-confetti'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import VideoPlayer from '@/components/video-player'
import PDFViewer from '@/components/pdf/pdf-viewer'
import CreditRepairCTA from '@/components/credit-repair-cta'

interface Lesson {
  id: string
  title: string
  description: string | null
  lesson_type: 'video' | 'pdf' | 'embed' | 'checklist' | 'pitch' | 'assistant'
  resource_url: string
  display_order: number
}

interface Module {
  id: string
  title: string
  description: string
  is_free: boolean
  created_at: string
}

export default function ModulePage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [userId, setUserId] = useState<string | null>(null)
  const [module, setModule] = useState<Module | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0)
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set())
  const [nextModule, setNextModule] = useState<Module | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const currentLesson = lessons[currentLessonIndex]
  
  // Memoize progress calculation
  const progressPercent = useMemo(() => {
    return lessons.length ? (completedLessons.size / lessons.length) * 100 : 0
  }, [completedLessons.size, lessons.length])

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        setUserId(user.id)

        const [{ data: moduleData }, { data: lessonsData }, { data: progressData }] = await Promise.all([
          supabase.from('academy_modules').select('*').eq('id', id).single(),
          supabase
            .from('academy_lessons')
            .select('id, title, description, lesson_type, resource_url, display_order')
            .eq('module_id', id)
            .order('display_order', { ascending: true }),
          supabase
            .from('user_progress')
            .select('lesson_id')
            .eq('user_id', user.id)
            .eq('module_id', id),
        ])

        if (moduleData) setModule(moduleData)
        if (lessonsData) setLessons(lessonsData)
        if (progressData) {
          const completedSet = new Set(progressData.map((r) => r.lesson_id))
          setCompletedLessons(completedSet)
        }
      } catch (error) {
        console.error('Error fetching module data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (id) fetchData()
  }, [id])

  // Check for module completion and fetch next module
  useEffect(() => {
    const checkCompletion = async () => {
      if (progressPercent === 100 && userId && module) {
        setShowCelebration(true)

        const { data: nextModules } = await supabase
          .from('academy_modules')
          .select('*')
          .gt('created_at', module.created_at)
          .order('created_at', { ascending: true })
          .limit(1)

        if (nextModules && nextModules.length > 0) {
          setNextModule(nextModules[0])
        }
      }
    }

    checkCompletion()
  }, [progressPercent, userId, module])

  const markLessonComplete = async (lessonId: string) => {
    if (!userId || !id || completedLessons.has(lessonId)) return

    try {
      await supabase.from('user_progress').upsert({
        user_id: userId,
        module_id: id,
        lesson_id: lessonId,
        completed: true,
        completed_at: new Date().toISOString(),
      })

      setCompletedLessons((prev) => new Set(prev).add(lessonId))
    } catch (error) {
      console.error('Error marking lesson complete:', error)
    }
  }

  const goToLesson = async (index: number) => {
    setCurrentLessonIndex(index)
    const lesson = lessons[index]
    await markLessonComplete(lesson.id)
  }

  const navigateBack = async () => {
    const { data: prevModules } = await supabase
      .from('academy_modules')
      .select('*')
      .lt('created_at', module?.created_at)
      .order('created_at', { ascending: false })
      .limit(1)

    if (prevModules && prevModules.length > 0) {
      router.push(`/dashboard/module/${prevModules[0].id}`)
    } else {
      router.push('/dashboard')
    }
  }

  const getLessonIcon = (type: string) => {
    switch (type) {
      case 'video':
        return <Play className="h-4 w-4" />
      case 'pdf':
        return <Download className="h-4 w-4" />
      case 'embed':
        return <BookOpen className="h-4 w-4" />
      default:
        return <FileText className="h-4 w-4" />
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading module...</p>
        </div>
      </div>
    )
  }

  if (!module || !lessons.length) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Modal Celebration */}
      <Dialog open={showCelebration} onOpenChange={setShowCelebration}>
        <DialogContent className="text-center sm:max-w-md">
          {typeof window !== 'undefined' && (
            <Confetti 
              width={window.innerWidth} 
              height={window.innerHeight}
              recycle={false}
              numberOfPieces={500}
            />
          )}
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-emerald-600 flex items-center justify-center gap-2">
              <PartyPopper className="h-6 w-6" />
              Congratulations!
            </DialogTitle>
            <p className="text-sm text-slate-600 mt-2">
              You've completed the <strong>{module.title}</strong> module!
            </p>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            {nextModule && (
              <Button
                onClick={() => router.push(`/dashboard/module/${nextModule.id}`)}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                Continue to: {nextModule.title}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard')}
              className="w-full"
            >
              Back to Dashboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-slate-900"
                onClick={navigateBack}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>

              <div>
                <h1 className="text-xl font-bold text-slate-900">{module.title}</h1>
                <p className="text-sm text-slate-600">{module.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {progressPercent === 100 && nextModule && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => router.push(`/dashboard/module/${nextModule.id}`)}
                >
                  Next: {nextModule.title}
                </Button>
              )}

              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1">
                {Math.round(progressPercent)}% Complete
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="container mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar - Lessons List */}
        <div className="lg:col-span-1">
          <Card className="bg-white/80 border-slate-200 shadow-sm sticky top-24">
            <CardHeader>
              <CardTitle className="text-lg">Lessons</CardTitle>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-slate-500 mt-1">
                {completedLessons.size} of {lessons.length} completed
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                {lessons.map((lesson, i) => {
                  const isCompleted = completedLessons.has(lesson.id)
                  const isCurrent = i === currentLessonIndex
                  
                  return (
                    <div
                      key={lesson.id}
                      onClick={() => goToLesson(i)}
                      className={`p-4 border-l-4 cursor-pointer transition-all ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-50'
                          : isCompleted
                          ? 'border-green-500 bg-green-50/50'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                          isCurrent 
                            ? 'bg-emerald-500 text-white' 
                            : isCompleted
                            ? 'bg-green-500 text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}>
                          {getLessonIcon(lesson.lesson_type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-slate-900 truncate">
                            {lesson.title}
                          </h4>
                          <p className="text-xs text-slate-600 capitalize">
                            {lesson.lesson_type}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content - Lesson Viewer */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="bg-white/80 border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-emerald-500" />
                {currentLesson.title}
              </CardTitle>
              <CardDescription className="text-slate-600">
                {currentLesson.lesson_type === 'video' && 'Watch the video lesson below'}
                {currentLesson.lesson_type === 'pdf' && 'Review the PDF resource'}
                {currentLesson.lesson_type === 'embed' && 'Interactive content'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentLesson.lesson_type === 'video' && (
                <VideoPlayer 
                  videoUrl={currentLesson.resource_url} 
                  title={currentLesson.title}
                  description={currentLesson.description}
                />
              )}
              {currentLesson.lesson_type === 'pdf' && (
                <PDFViewer 
                  pdfUrl={currentLesson.resource_url} 
                  title={currentLesson.title}
                />
              )}
              {currentLesson.lesson_type === 'embed' && (
                <iframe
                  src={currentLesson.resource_url}
                  className="w-full h-[600px] border rounded-md"
                  allow="clipboard-write; clipboard-read"
                  title={currentLesson.title}
                />
              )}
            </CardContent>
          </Card>

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              disabled={currentLessonIndex === 0}
              onClick={() => goToLesson(currentLessonIndex - 1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </Button>
            
            <span className="text-sm text-slate-600">
              Lesson {currentLessonIndex + 1} of {lessons.length}
            </span>

            <Button
              className="bg-emerald-600 hover:bg-emerald-700 gap-2"
              disabled={currentLessonIndex === lessons.length - 1}
              onClick={() => goToLesson(currentLessonIndex + 1)}
            >
              Next Lesson
              <Play className="h-4 w-4" />
            </Button>
          </div>

          {/* Module Complete Banner */}
          {progressPercent === 100 && nextModule && !showCelebration && (
            <Card className="bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200">
              <CardContent className="pt-6">
                <div className="text-center">
                  <h3 className="text-lg font-bold text-emerald-700 mb-2 flex justify-center items-center gap-2">
                    <PartyPopper className="w-5 h-5" /> 
                    Module Complete!
                  </h3>
                  <p className="text-slate-600 mb-4">
                    Great job! You've completed all lessons in this module.
                  </p>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => router.push(`/dashboard/module/${nextModule.id}`)}
                  >
                    Continue to: {nextModule.title}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* CTA */}
          <div className="mt-8">
            <CreditRepairCTA />
          </div>
        </div>
      </div>
    </div>
  )
}