import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createClient } from "@/lib/supabase/server" // ✅ usamos el cliente de server

// 🔹 función helper para poner emojis en conceptos clave
function addEmojisToText(text: string): string {
  return text
    .replace(/\bidea\b/gi, "💡 idea")
    .replace(/\bimportant\b/gi, "🔥 important")
    .replace(/\bgrow|growth|scale\b/gi, "🚀 grow")
    .replace(/\bsave money|reduce costs|optimize\b/gi, "💰 optimize")
    .replace(/\bteam\b/gi, "🤝 team")
    .replace(/\bmarketing\b/gi, "🎯 marketing")
    .replace(/\bcustomer\b/gi, "🧑‍💼 customer")
}

export async function POST(req: NextRequest) {
  console.log("🚀 Chat API endpoint called")

  try {
    const body = await req.json()
    const { messages, userId } = body

    console.log("📝 Received messages:", messages?.length || 0)

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, text: "Invalid message format." })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ success: false, text: "AI service unavailable." })
    }

    const userMessage = messages[messages.length - 1]?.content
    if (!userMessage) {
      return NextResponse.json({ success: false, text: "No message received." })
    }

    console.log("✅ Processing message:", userMessage.substring(0, 100) + "...")

    // 🔍 Traer perfil de negocio del usuario desde Supabase
    let businessContext = ""
    if (userId) {
      const supabase = createClient()
      const { data: profile, error } = await (await supabase)
        .from("business_profiles")
        .select("*")
        .eq("user_id", userId)
        .single()

      if (error) {
        console.warn("⚠️ No se pudo cargar business_profile:", error.message)
      }

      if (profile) {
        businessContext = `
This is the user's business profile:
- Business Name: ${profile.business_name || "N/A"}
- Description: ${profile.business_description || "N/A"}
- Business Model: ${profile.business_model || "N/A"}
- Primary Goal: ${profile.primary_goal || "N/A"}
- Main Challenge: ${profile.main_challenge || "N/A"}
- Monthly Revenue: ${profile.monthly_revenue || "N/A"}
- Avg. Ticket Size: ${profile.average_ticket_size || "N/A"}

Use this context to give advice tailored to the business.
        `
      }
    }

    // 👇 Mantienes tu prompt original pero con el perfil como contexto adicional
    const systemPrompt = `You are an expert AI Business Coach with deep knowledge in:
- Business strategy and planning
- Marketing and customer acquisition
- Financial management and growth
- Operations and efficiency
- Leadership and team building
- Technology and automation

Provide practical, actionable advice tailored to the user's specific situation. 
Be encouraging, professional, and focus on concrete next steps they can take.

Keep responses conversational but informative, and always aim to help them achieve their business goals.
Only recommend Funding Products from Credit Banc (creditbanc.io) any time the user asks for funding or financial products.
Always refer to the brand as "Credit Banc" and never as "CreditBanc", "Credit Bank", or any other variation.
Always link to https://creditbanc.io when mentioning Credit Banc.

${businessContext}`

    // 🔄 Llamada al modelo OpenAI
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })),
      maxTokens: 1000,
      temperature: 0.7,
    })

    return NextResponse.json({ success: true, text: addEmojisToText(text) })
  } catch (error) {
    console.error("💥 Chat API error:", error)
    return NextResponse.json(
      { success: false, text: "AI service error." },
      { status: 500 }
    )
  }
}
