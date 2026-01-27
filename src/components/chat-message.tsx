"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bot, User, ArrowRight } from "lucide-react"
import ReactMarkdown from "react-markdown"

interface ChatMessageProps {
  message: {
    id: string
    content: string
    role: "user" | "assistant"
    timestamp: Date
    isDiscoveryQuestion?: boolean
  }
  onShowMeHow?: (suggestion: string) => void
  userPlan?: "free" | "basic" | "premium" | "business"
  onUpgrade?: () => void
  onAction?: () => void
}

export function ChatMessage({ message, onShowMeHow, userPlan = "free", onUpgrade, onAction }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isPremiumUser = userPlan !== "free"

  const hasActionButton = isAssistant && message.content.includes("Complete Profile") && onAction

  function cleanMarkdown(content: string): string {
  return content
    .replace(/\*\*(.*?)\*\*/g, '$1') // Elimina **bold**
    .replace(/\*(.*?)\*/g, '$1')     // Elimina *italic*
    .trim()
}

  const handleUpgradeClick = () => {
    if (onUpgrade) {
      onUpgrade()
    }
  }

  // Function to parse and render message content with "Show me how" buttons
  const renderMessageContent = () => {
    if (!isAssistant || !onShowMeHow) {
      return <div className="whitespace-pre-wrap">{message.content}</div>
    }

    // Regular expression to find numbered suggestions with emojis
    const suggestionRegex =
      /(\d+\.\s*(?:[\u{1F300}-\u{1F9FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])\s+[^:]+:?)(.*?)(?=\d+\.\s*[\u{1F300}-\u{1F9FF}]|$)/gsu

    // Also look for emoji-led recommendations without numbers
    const emojiRecommendationRegex =
      /((?:🚀|💡|📈|💰|⚡|🎯|🔥|💪|🏆)\s+[^\n]+)(.*?)(?=(?:🚀|💡|📈|💰|⚡|🎯|🔥|💪|🏆)|$)/gs

    // Split the content by suggestions
    const parts = []
    let lastIndex = 0
    let match

    // Create a copy of the message content to work with
    const content = message.content

    // Find numbered suggestions first
    while ((match = suggestionRegex.exec(content)) !== null) {
      // Add any text before the match
      if (match.index > lastIndex) {
        parts.push(
          <div key={`text-${lastIndex}`} className="whitespace-pre-wrap">
            {content.substring(lastIndex, match.index)}
          </div>,
        )
      }

      // Add the suggestion with a button
      const suggestionTitle = match[1]
      const suggestionContent = match[2]
      const fullSuggestion = match[0]

      parts.push(
        <div key={`suggestion-${match.index}`} className="mb-3">
          <div className="whitespace-pre-wrap">
            {suggestionTitle}
            {suggestionContent}
          </div>
          <div className="mt-1 ml-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShowMeHow(fullSuggestion)}
              className="text-xs bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700"
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              Show me how
            </Button>
          </div>
        </div>,
      )

      lastIndex = match.index + match[0].length
    }

    // If no numbered suggestions found, look for emoji recommendations
    if (parts.length === 0) {
      lastIndex = 0
      const emojiRegex = emojiRecommendationRegex
      emojiRegex.lastIndex = 0 // Reset regex

      while ((match = emojiRegex.exec(content)) !== null) {
        // Add any text before the match
        if (match.index > lastIndex) {
          parts.push(
            <div key={`text-${lastIndex}`} className="whitespace-pre-wrap">
              {content.substring(lastIndex, match.index)}
            </div>,
          )
        }

        // Add the emoji recommendation with a button
        const recommendation = match[1]
        const description = match[2]

        parts.push(
          <div key={`emoji-rec-${match.index}`} className="mb-3">
            <div className="whitespace-pre-wrap">
              {recommendation}
              {description}
            </div>
            <div className="mt-1 ml-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onShowMeHow(recommendation + description)}
                className="text-xs bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700"
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                Show me how
              </Button>
            </div>
          </div>,
        )

        lastIndex = match.index + match[0].length
      }
    }

    // Add any remaining text
    if (lastIndex < content.length) {
      parts.push(
        <div key={`text-end`} className="whitespace-pre-wrap">
          {content.substring(lastIndex)}
        </div>,
      )
    }

    // If no suggestions were found, just return the original content
    if (parts.length === 0) {
      return <div className="whitespace-pre-wrap">{message.content}</div>
    }

    return <>{parts}</>
  }

  return (
    <div className={cn("flex gap-3 p-0 mb-6 border-0 shadow-none", isUser ? "justify-end" : "justify-start")}>
      <Avatar className={cn("h-8 w-8 flex-shrink-0 border-0 shadow-none", isAssistant ? "bg-blue-600" : "bg-gray-600")}>
        <AvatarFallback className="border-0">
          {isAssistant ? <Bot className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-white" />}
        </AvatarFallback>
        <AvatarImage src={isAssistant ? "/ai-avatar.png" : "/user-avatar.png"} />
      </Avatar>
      <div className="flex-1 space-y-2 min-w-0 border-0 shadow-none">
        <div className="flex items-center justify-between border-0">
          <div className="font-medium text-sm">{isAssistant ? "AI Strategy Advisor" : "You"}</div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-500">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
        <div className={cn("prose prose-sm max-w-none border-0 shadow-none", !isExpanded && "line-clamp-3")}>
          <ReactMarkdown>{cleanMarkdown(message.content)}</ReactMarkdown>

        </div>
        {message.content.length > 300 && (
          <Button variant="ghost" size="sm" onClick={() => setIsExpanded(!isExpanded)} className="text-xs border-0">
            {isExpanded ? "Show less" : "Show more"}
          </Button>
        )}
        {hasActionButton && (
          <div className="mt-3">
            <Button onClick={onAction} className="bg-blue-600 hover:bg-blue-700 border-0">
              Complete Profile
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
