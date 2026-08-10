"use client";

import { useState } from "react";
import { Copy, Check, Mail, MessageCircle, Share2, Send } from "lucide-react";

// Client island: a partner's referral link with a copy button + one-tap share to
// the channels partners actually use. All share targets open the platform's
// native compose window prefilled with the link.
//
// Shared by both referral programs — the public affiliate dashboard and the
// Level-2 referral-partner portal. They point at different URLs (an affiliate's
// /r/<code> on the vault vs a partner's creditbanc.io/referral-partner?…) and
// speak to different audiences, so the pitch is a prop. Styling assumes a dark
// panel; both dashboards render it inside the navy card.
const DEFAULT_MESSAGE =
  "Need business funding? Apply through my link and get funded fast with Credit Banc:";

export function CopyLink({
  url,
  message = DEFAULT_MESSAGE,
  subject = "Get funded with Credit Banc",
}: {
  url: string;
  message?: string;
  subject?: string;
}) {
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

  const nativeShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Credit Banc", text: message, url });
      } else {
        copy();
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const msg = encodeURIComponent(`${message} ${url}`);
  const channels = [
    { label: "Email", icon: Mail, href: `mailto:?subject=${encodeURIComponent(subject)}&body=${msg}` },
    { label: "WhatsApp", icon: MessageCircle, href: `https://wa.me/?text=${msg}` },
    { label: "SMS", icon: Send, href: `sms:?&body=${msg}` },
    { label: "X", icon: Share2, href: `https://twitter.com/intent/tweet?text=${msg}` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-medium text-white/90 text-sm truncate">
          {url}
        </div>
        <button
          onClick={copy}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold rounded-xl shadow-lg shadow-cb-mint/20 transition-all active:scale-95"
        >
          {copied ? (
            <><Check className="w-5 h-5" /> Copied</>
          ) : (
            <><Copy className="w-5 h-5" /> Copy link</>
          )}
        </button>
      </div>

      {/* one-tap share channels */}
      <div>
        <span className="block text-xs font-bold uppercase tracking-[0.15em] text-white/40 mb-2">Share via</span>
        <div className="grid grid-cols-2 gap-2">
          {channels.map(({ label, icon: Icon, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Share via ${label}`}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4" />
              {label}
            </a>
          ))}
        </div>
        <button
          onClick={nativeShare}
          aria-label="Share"
          className="sm:hidden w-full mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white transition-colors"
        >
          <Share2 className="w-4 h-4" />
          More options
        </button>
      </div>
    </div>
  );
}
