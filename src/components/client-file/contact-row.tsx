// src/components/client-file/contact-row.tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { Copy } from "lucide-react";
import { copy_to_clipboard } from "@/lib/clipboard";
import { toast } from "@/lib/toast";

export function ContactRow({
  icon: Icon,
  value,
  href,
  copy_label,
}: {
  icon: LucideIcon;
  value: string | null | undefined;
  href: string;
  copy_label: string;
}) {
  if (!value) {
    return (
      <p className="flex items-center gap-2 text-sm text-cb-ink/30">
        <Icon className="h-4 w-4" /> —
      </p>
    );
  }
  return (
    <div className="group flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-cb-ink/40" />
      <a href={href} className="min-w-0 flex-1 truncate text-sm font-medium text-cb-ink hover:text-emerald-700" title={value}>
        {value}
      </a>
      <button
        type="button"
        aria-label={copy_label}
        onClick={async () => {
          if (await copy_to_clipboard(value)) toast.success("Copied");
          else toast.info("Couldn't copy. Select it manually.");
        }}
        className="rounded-md p-1 text-cb-ink/30 transition hover:bg-black/5 hover:text-cb-ink focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
