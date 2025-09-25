'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import {
  Bot, Loader2, Send, ArrowDown, ArrowUp, User,
  Plus, ChevronDown, Sparkles, Star, Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import ReactMarkdown from 'react-markdown'
import clsx from 'clsx'

function cleanMarkdown(content: string): string {
  return content
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  id: string
}

interface ChatSession {
  id: string
  user_id: string
  created_at: string
  title?: string | null
  starred?: boolean | null
}

type BusinessProfile = {
  business_name?: string | null
  business_description?: string | null
  business_model?: string | null
  years_in_business?: string | null
  industry?: string | null
  primary_goal?: string | null
  secondary_goal?: string | null
  main_challenge?: string | null
  annual_revenue_last_year?: string | null
  monthly_revenue?: string | null
}

export function AIChatInterface() {
  const supabase = createClient()
  const { toast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true)

  // Messages
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // UI
  const [isAtBottom, setIsAtBottom] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Business profile
  const [profile, setProfile] = useState<BusinessProfile | null>(null)

  // --- Welcome & Quick Prompts ---
  const welcomeText = useMemo(() => {
    const name = profile?.business_name?.trim()
    const industry = profile?.industry
    const goal = profile?.primary_goal

    if (profile) {
      return [
        `Hey${name ? `, ${name}` : ''}! I’m your AI Business Coach. 👋`,
        industry ? `I see you’re in **${industry}**.` : '',
        goal ? `Top priority noted: **${goal}**.` : '',
        `How can I help today? I can brainstorm growth ideas, review your strategy, or outline next steps.`
      ].filter(Boolean).join(' ')
    }

    return `Hey! I’m your AI Business Coach. 👋  
If you complete your business profile, I’ll tailor advice to your goals.  
How can I help today? I can brainstorm growth ideas, review your strategy, or outline next steps.`
  }, [profile])

  const quickPrompts = useMemo(() => {
    if (profile) {
      const model = profile.business_model || 'my business'
      const industry = profile.industry || 'my industry'
      const goal = profile.primary_goal || 'grow revenue'
      return [
        `Give me 5 practical ways to ${goal} in ${industry}.`,
        `Outline a 90-day plan to improve ${goal} for a ${model}.`,
        `Audit my marketing funnel and suggest quick wins.`,
        `What KPIs should a ${model} track monthly?`,
      ]
    }
    return [
      'Help me write a simple marketing plan.',
      'What are the fastest ways to get my first 100 customers?',
      'How do I validate a business idea before I invest?',
      'Create a weekly routine to improve my operations.',
    ]
  }, [profile])

  // --- Init: user, profile, sessions, and first session/messages ---
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.id) return
      setUserId(user.id)

      // Profile
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
      setProfile(biz || null)

      // Sessions (starred first, then newest)
      setLoadingSessions(true)
      const { data: existingSessions, error: sErr } = await supabase
        .from('chat_sessions')
        .select('id,user_id,created_at,title,starred')
        .eq('user_id', user.id)
        .order('starred', { ascending: false })
        .order('created_at', { ascending: false })

      if (sErr) {
        console.error(sErr)
        setLoadingSessions(false)
        return
      }

      let sessionsList = existingSessions || []
      if (!sessionsList.length) {
        // Create first session
        const { data: created, error: cErr } = await supabase
          .from('chat_sessions')
          .insert({ user_id: user.id })
          .select('id,user_id,created_at,title,starred')
        if (cErr) {
          console.error(cErr)
          setLoadingSessions(false)
          return
        }
        sessionsList = created || []
      }

      // local sort fallback
      sessionsList.sort((a, b) => {
        const sa = a.starred ? 1 : 0
        const sb = b.starred ? 1 : 0
        if (sa !== sb) return sb - sa
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      setSessions(sessionsList)
      const active = sessionsList[0]
      setSessionId(active.id)
      setLoadingSessions(false)

      await loadMessages(active.id, { injectWelcomeIfEmpty: true })
    }

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    init()
  }, [])

  // Load messages; optionally inject welcome if empty
  const loadMessages = async (targetSessionId: string, opts?: { injectWelcomeIfEmpty?: boolean }) => {
    const { data: storedMessages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', targetSessionId)
      .order('timestamp', { ascending: true })

    const mapped: Message[] = (storedMessages ?? []).map((m) => ({
      id: m.id,
      content: m.content,
      role: m.role,
      timestamp: new Date(m.timestamp),
    }))

    const shouldInjectWelcome = opts?.injectWelcomeIfEmpty && (error || mapped.length === 0)
    if (shouldInjectWelcome) {
      const welcome: Message = {
        id: `assistant-welcome-${Date.now()}`,
        role: 'assistant',
        content: welcomeText,
        timestamp: new Date(),
      }
      setMessages([welcome])

      // try to persist; ignore failure if RLS not ready yet
      const ins = await supabase.from('chat_messages').insert({
        session_id: targetSessionId,
        role: 'assistant',
        content: welcome.content,
      })
      if (ins.error) console.warn('Welcome insert failed:', ins.error)
      return
    }

    if (error) {
      console.error(error)
      setMessages([])
      return
    }

    setMessages(mapped)
  }

  // New chat
  const handleNewChat = async () => {
    if (!userId) return
    const { data: created, error } = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId })
      .select('id,user_id,created_at,title,starred')
      .single()
    if (error || !created) {
      toast({ title: 'Error', description: 'Could not start a new chat.', variant: 'destructive' })
      return
    }
    const next = [created, ...sessions]
    next.sort((a, b) => {
      const sa = a.starred ? 1 : 0
      const sb = b.starred ? 1 : 0
      if (sa !== sb) return sb - sa
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    setSessions(next)
    setSessionId(created.id)
    await loadMessages(created.id, { injectWelcomeIfEmpty: true })
  }

  // Switch chat session
  const handleSwitchSession = async (id: string) => {
    if (!id || id === sessionId) return
    setSessionId(id)
    await loadMessages(id, { injectWelcomeIfEmpty: true })
  }

  // Toggle star (pin/unpin) current session
  const toggleStarCurrent = async () => {
    if (!sessionId) return
    const current = sessions.find(s => s.id === sessionId)
    if (!current) return
    const nextStar = !Boolean(current.starred)

    // optimistic UI
    setSessions(prev => {
      const updated = prev.map(s => s.id === sessionId ? { ...s, starred: nextStar } : s)
      updated.sort((a, b) => {
        const sa = a.starred ? 1 : 0
        const sb = b.starred ? 1 : 0
        if (sa !== sb) return sb - sa
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      return updated
    })

    const { error } = await supabase
      .from('chat_sessions')
      .update({ starred: nextStar })
      .eq('id', sessionId)

    if (error) {
      // revert if fail
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, starred: current.starred } : s))
      toast({ title: 'Error', description: 'Could not update star.', variant: 'destructive' })
    }
  }

  // Delete current session
  const handleDeleteCurrent = async () => {
    if (!sessionId) return
    const confirm = window.confirm('Delete this chat? This action will remove all its messages.')
    if (!confirm) return

    // optimistic remove from UI first
    const prevSessions = sessions
    const idx = prevSessions.findIndex(s => s.id === sessionId)
    const nextSessions = prevSessions.filter(s => s.id !== sessionId)
    setSessions(nextSessions)
    setMessages([])

    // pick next active session (prev sibling if exists, else first, else create new)
    const pickNext =
      (idx > 0 && nextSessions[idx - 1]?.id) ||
      nextSessions[0]?.id ||
      null
    setSessionId(pickNext)

    // delete in DB (messages cascade)
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId)

    if (error) {
      // rollback UI if failed
      toast({ title: 'Error', description: 'Could not delete this chat.', variant: 'destructive' })
      setSessions(prevSessions)
      setSessionId(sessionId)
      await loadMessages(sessionId, { injectWelcomeIfEmpty: true })
      return
    }

    // if nothing left, start a fresh one
    if (!pickNext) {
      await handleNewChat()
      return
    }

    await loadMessages(pickNext, { injectWelcomeIfEmpty: true })
  }

  // --- Scrolling ---
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isAtBottom])

  const handleScroll = () => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50
    setIsAtBottom(atBottom)
  }

  // --- Send message ---
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || !sessionId || !userId) return

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
      id: `user-${Date.now()}`,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: userMessage.content,
    })

    // Auto-title: first user message becomes title
    const current = sessions.find(s => s.id === sessionId)
    if (current && (!current.title || current.title.trim().toLowerCase() === 'untitled session')) {
      const newTitle = userMessage.content.slice(0, 60)
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s))
      await supabase.from('chat_sessions').update({ title: newTitle }).eq('id', sessionId)
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        }),
      })

      const data = await response.json()

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.text || 'Something went wrong.',
        timestamp: new Date(),
        id: `assistant-${Date.now()}`,
      }

      setMessages((prev) => [...prev, assistantMessage])

      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        role: 'assistant',
        content: assistantMessage.content,
      })
    } catch (err) {
      toast({
        title: 'Error',
        description: 'There was a problem talking to the assistant.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Quick prompt -> send immediately
  const sendQuickPrompt = async (text: string) => {
    if (!text.trim()) return
    setInput(text)
    setTimeout(() => {
      const form = document.getElementById('chat-form') as HTMLFormElement | null
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }, 0)
  }

  const activeSession = sessions.find(s => s.id === sessionId)
  const isActiveStarred = Boolean(activeSession?.starred)

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-white sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center shadow-md">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">AI Business Coach</h3>
            <p className="text-sm text-gray-500">
              {profile?.business_name ? `Coaching for ${profile.business_name}` : 'Your strategic business partner'}
            </p>
          </div>
        </div>

        {/* Session Switcher + Actions */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              className="appearance-none pr-8 pl-3 py-2 border rounded-md text-sm bg-white hover:bg-gray-50"
              disabled={loadingSessions || sessions.length === 0}
              value={sessionId || ''}
              onChange={(e) => handleSwitchSession(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.starred ? '★ ' : '') + (s.title?.trim() || `Chat ${new Date(s.created_at).toLocaleDateString()} ${new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-gray-500" />
          </div>

          <Button
            size="icon"
            variant={isActiveStarred ? 'default' : 'outline'}
            className={clsx('h-9 w-9', isActiveStarred ? 'bg-amber-500 hover:bg-amber-600 text-white' : '')}
            onClick={toggleStarCurrent}
            title={isActiveStarred ? 'Unpin chat' : 'Pin chat'}
          >
            <Star className={clsx('h-4 w-4', isActiveStarred ? 'fill-current' : '')} />
          </Button>

          <Button size="icon" variant="outline" className="h-9 w-9" onClick={handleDeleteCurrent} title="Delete chat">
            <Trash2 className="h-4 w-4" />
          </Button>

          <Button size="sm" variant="outline" onClick={handleNewChat}>
            <Plus className="h-4 w-4 mr-1" /> New chat
          </Button>
        </div>
      </div>

      {/* Quick Prompts — only show when conversation is fresh */}
      <div
        className={clsx(
          'px-6 py-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60',
          messages.length > 1 && 'hidden'
        )}
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Try a quick prompt:
          </div>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((qp) => (
              <Button
                key={qp}
                size="sm"
                variant="outline"
                className="rounded-full border-gray-300 hover:bg-emerald-50"
                onClick={() => sendQuickPrompt(qp)}
              >
                {qp}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 scrollbar-thin relative"
      >
        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <Avatar className="w-9 h-9 bg-emerald-600 shadow-md">
                  <AvatarFallback className="text-black"><Bot className="w-4 h-4" /></AvatarFallback>
                </Avatar>
              )}
              <div
                className={`rounded-2xl px-5 py-3 text-[15px] leading-relaxed shadow-sm
                  ${m.role === 'user'
                    ? 'bg-emerald-600 text-white max-w-[75%]'
                    : 'bg-white border border-gray-200 text-gray-800 max-w-[75%]'}`}
              >
                <ReactMarkdown
                  components={{
                    a: ({ node, ...props }) => (
                      <a
                        {...props}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:underline font-medium"
                      />
                    ),
                  }}
                >
                  {cleanMarkdown(m.content)}
                </ReactMarkdown>
                <div className="text-[11px] mt-2 opacity-60 text-right">
                  {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              {m.role === 'user' && (
                <Avatar className="w-9 h-9 bg-gray-600 shadow-md">
                  <AvatarFallback className="text-black"><User className="w-4 h-4" /></AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <Avatar className="w-9 h-9 bg-emerald-600 shadow-md">
                <AvatarFallback className="text-black"><Bot className="w-4 h-4" /></AvatarFallback>
              </Avatar>
              <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3 shadow-sm text-gray-600 flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-300"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll Button */}
      {messages.length > 0 && (
        <div className="fixed bottom-28 right-6 z-20">
          <Button
            variant="outline"
            size="icon"
            className="bg-white border shadow-lg rounded-full hover:bg-emerald-50 transition-all"
            onClick={() => {
              const scroller = scrollContainerRef.current
              if (!scroller) return
              if (isAtBottom) {
                scroller.scrollTo({ top: 0, behavior: 'smooth' })
              } else {
                scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
              }
            }}
          >
            {isAtBottom ? (
              <ArrowUp className="h-5 w-5 text-emerald-600" />
            ) : (
              <ArrowDown className="h-5 w-5 text-emerald-600" />
            )}
          </Button>
        </div>
      )}

      {/* Composer */}
      <div className="sticky bottom-0 w-full border-t bg-white backdrop-blur-md shadow-inner">
        <form
          id="chat-form"
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-4 py-4 max-w-3xl mx-auto"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask me anything about your business..."
            className="flex-1 min-h-[60px] max-h-32 resize-none rounded-xl border border-gray-300 focus:border-emerald-500 focus:ring focus:ring-emerald-100 px-4 py-3 text-sm"
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-full p-3 bg-emerald-600 hover:bg-emerald-700 shadow-md"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-white" />
            ) : (
              <Send className="w-5 h-5 text-white" />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default AIChatInterface
