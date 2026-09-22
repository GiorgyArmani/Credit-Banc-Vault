// src/components/client-file/panel-card.tsx
import type React from "react";
import { cn } from "@/lib/utils";

export function PanelCard({
  title,
  description,
  accessory,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  description?: string;
  accessory?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-black/5 bg-white shadow-sm", className)}>
      {(title || accessory) && (
        <header className="flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h3 className="font-manrope text-sm font-bold text-cb-ink">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-cb-ink/50">{description}</p>}
          </div>
          {accessory}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
