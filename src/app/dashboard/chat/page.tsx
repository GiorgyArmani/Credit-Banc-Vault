// src/app/dashboard/chat/page.tsx
import { AIChatInterface } from "@/components/ai-chat-interface";

export default function ChatPage() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <AIChatInterface />
    </div>
  );
}
