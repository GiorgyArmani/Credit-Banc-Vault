"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Card } from "@/components/ui/card"

interface FAQItem {
  question: string
  answer: string
  category?: string
}

interface FAQAccordionProps {
  items: FAQItem[]
}

export function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0) // First item open by default

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <Card
          key={index}
          className="border dark:border-gray-700 dark:bg-gray-800/50 overflow-hidden transition-all duration-200 hover:shadow-md"
        >
          <button
            onClick={() => toggleItem(index)}
            className="w-full text-left p-6 flex items-start justify-between gap-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            aria-expanded={openIndex === index}
          >
            <div className="flex-1">
              {item.category && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-2 block">
                  {item.category}
                </span>
              )}
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white pr-4">
                {item.question}
              </h3>
            </div>
            <ChevronDown
              className={`h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 transition-transform duration-200 ${
                openIndex === index ? "rotate-180" : ""
              }`}
            />
          </button>
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              openIndex === index ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="px-6 pb-6">
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {item.answer}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}