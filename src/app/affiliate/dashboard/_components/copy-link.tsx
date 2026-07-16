"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

// Small client island: shows the affiliate's referral link with a copy button.
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — user can still select the text manually.
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch gap-3">
      <div className="flex-1 rounded-2xl border border-emerald-200 bg-white px-5 py-4 font-bold text-emerald-900 truncate">
        {url}
      </div>
      <Button
        onClick={copy}
        className="h-auto px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-lg shadow-emerald-500/20"
      >
        {copied ? (
          <span className="flex items-center gap-2"><Check className="w-5 h-5" /> Copied</span>
        ) : (
          <span className="flex items-center gap-2"><Copy className="w-5 h-5" /> Copy link</span>
        )}
      </Button>
    </div>
  );
}
