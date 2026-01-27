'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bot, User } from "lucide-react"
import ReactMarkdown from "react-markdown"

interface ChatMessageDisplayProps {
  message: {
    id: string
    content: string
    role: "user" | "assistant"
    timestamp: Date
    isDiscoveryQuestion?: boolean
  }
  onAction?: () => void
}

// Limpia contenido con asteriscos sueltos y saltos mal renderizados
function sanitizeMarkdown(content: string): string {
  return content
    .replace(/^\*{1,2}(.+?)\*{1,2}$/gm, '$1')   // línea completa envuelta en * o **
    .replace(/(?<!\w)\*{1,2}(.+?)\*{1,2}(?!\w)/g, '$1') // palabras envueltas en * o **
    .replace(/\\n/g, '\n') // si llega con "\\n" lo vuelve salto real
    .trim()
}

export function ChatMessageDisplay({ message, onAction }: ChatMessageDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const cleanedContent = sanitizeMarkdown(message.content)
  const hasActionButton = isAssistant && message.content.includes("Complete Profile") && onAction

  return (
    <div className="flex gap-3 p-4 rounded-lg bg-white shadow-sm border border-gray-100">
      <Avatar className={isAssistant ? "bg-blue-600" : "bg-gray-600"}>
        <AvatarFallback>
          {isAssistant ? <Bot className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-white" />}
        </AvatarFallback>
        <AvatarImage src={isAssistant ? "/ai-avatar.png" : "/user-avatar.png"} />
      </Avatar>
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">{isAssistant ? "AI Strategy Advisor" : "You"}</div>
          <div className="text-xs text-gray-500">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        <div className={!isExpanded ? "line-clamp-3" : ""}>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
            <ReactMarkdown>{cleanedContent}</ReactMarkdown>
          </div>
        </div>

        {message.content.length > 300 && (
          <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)} className="text-xs">
            {isExpanded ? "Show less" : "Show more"}
          </Button>
        )}

        {hasActionButton && (
          <div className="mt-3">
            <Button onClick={onAction} className="bg-blue-600 hover:bg-blue-700">
              Complete Profile
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
