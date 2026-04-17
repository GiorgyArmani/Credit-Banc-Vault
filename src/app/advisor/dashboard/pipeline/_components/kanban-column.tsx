"use client";

import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";

interface KanbanColumnProps {
  title: string;
  count: number;
  stage: string;
  colorClass: string;
  onDrop: (dealId: string, newStage: string) => void;
  children: ReactNode;
}

export function KanbanColumn({ title, count, stage, colorClass, onDrop, children }: KanbanColumnProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const dealId = e.dataTransfer.getData("dealId");
    if (dealId) {
      onDrop(dealId, stage);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col w-full md:flex-1 md:min-w-[200px] xl:min-w-[150px] rounded-2xl bg-slate-50 dark:bg-slate-900/50 border-2 transition-all duration-300",
        isOver
          ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-2xl"
          : "border-transparent shadow-sm hover:shadow-md"
      )}
    >
      {/* Column Header */}
      <div className="p-3 md:p-4 flex items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("w-1.5 h-1.5 md:w-2 md:h-2 rounded-full flex-shrink-0 animate-pulse", colorClass)} />
          <h3 className="font-headline font-black text-slate-800 dark:text-slate-200 text-[10px] md:text-xs uppercase tracking-widest truncate">
            {title}
          </h3>
        </div>
        <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full flex-shrink-0 tabular-nums">
          {count}
        </span>
      </div>

      {/* Cards Area */}
      <div className="flex-1 p-2 md:p-3 space-y-2 md:space-y-3 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-hide">
        {children}
        {count === 0 && (
          <div className="h-32 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center bg-slate-100/30 dark:bg-slate-900/10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Empty Stage</p>
          </div>
        )}
      </div>
    </div>
  );
}
