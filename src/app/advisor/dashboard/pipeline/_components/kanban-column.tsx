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
        "flex flex-col flex-1 min-w-[140px] rounded-xl bg-slate-50 dark:bg-slate-900/50 border-2 transition-all duration-200",
        isOver
          ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-xl"
          : "border-transparent"
      )}
    >
      {/* Column Header */}
      <div className="p-2.5 flex items-center justify-between border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", colorClass)} />
          <h3 className="font-headline font-bold text-slate-800 dark:text-slate-200 text-xs md:text-[10px] uppercase tracking-wider truncate">
            {title}
          </h3>
        </div>
        <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] md:text-[9px] font-black px-2 py-0.5 md:px-1.5 md:py-0.5 rounded-full flex-shrink-0">
          {count}
        </span>
      </div>

      {/* Cards Area */}
      <div className="flex-1 p-2 space-y-2 md:overflow-y-auto md:max-h-[calc(100vh-280px)] scrollbar-hide">
        {children}
        {count === 0 && (
          <div className="h-20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-center">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Empty</p>
          </div>
        )}
      </div>
    </div>
  );
}
