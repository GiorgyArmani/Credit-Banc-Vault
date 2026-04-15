"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import clsx from "clsx";

interface SearchResult {
    id: string;
    client_name: string;
    company_name: string;
}

export function GlobalSearch() {
    const supabase = createClient();
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [clients, setClients] = useState<SearchResult[]>([]);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    // Initial fetch of clients for the current advisor
    useEffect(() => {
        async function fetchClients() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: advisorData } = await supabase
                .from('advisors')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (!advisorData) return;

            const { data } = await supabase
                .from('client_data_vault')
                .select('id, client_name, company_name')
                .eq('advisor_id', advisorData.id);

            if (data) setClients(data as SearchResult[]);
        }
        fetchClients();
    }, []);

    // Filter results as user types
    useEffect(() => {
        if (query.trim() === "") {
            setResults([]);
            setIsOpen(false);
            return;
        }

        const filtered = clients.filter(c => 
            c.client_name.toLowerCase().includes(query.toLowerCase()) || 
            c.company_name.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 8); // Limit to top 8 results

        setResults(filtered);
        setIsOpen(filtered.length > 0);
        setActiveIndex(-1);
    }, [query, clients]);

    // Handle click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (clientId: string) => {
        router.push(`/advisor/dashboard/clients/${clientId}`);
        setQuery("");
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            setActiveIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === "Enter" && activeIndex >= 0) {
            handleSelect(results[activeIndex].id);
        } else if (e.key === "Escape") {
            setIsOpen(false);
        }
    };

    const updateUrlAndSync = (val: string) => {
        setQuery(val);
        const params = new URLSearchParams(window.location.search);
        if (val) params.set('q', val);
        else params.delete('q');
        
        const newPath = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState(null, '', newPath);
        window.dispatchEvent(new Event('search_updated'));
    };

    return (
        <div className="relative w-full max-w-md" ref={containerRef} onKeyDown={handleKeyDown}>
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
            <input
                className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400 font-manrope font-medium"
                placeholder="Search client ledger..."
                type="text"
                value={query}
                onChange={(e) => updateUrlAndSync(e.target.value)}
                onFocus={() => query.trim() !== "" && results.length > 0 && setIsOpen(true)}
            />

            {/* Results Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-2">
                        {results.map((client, index) => (
                            <div
                                key={client.id}
                                onClick={() => handleSelect(client.id)}
                                className={clsx(
                                    "px-4 py-3 rounded-xl cursor-pointer transition-all flex items-center justify-between group",
                                    index === activeIndex ? "bg-emerald-50 dark:bg-emerald-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-sm">person</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
                                            {client.client_name}
                                        </p>
                                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                                            {client.company_name}
                                        </p>
                                    </div>
                                </div>
                                <span className={clsx(
                                    "material-symbols-outlined text-sm transition-all",
                                    index === activeIndex ? "text-emerald-500 translate-x-1" : "text-transparent group-hover:text-slate-300 group-hover:translate-x-1"
                                )}>
                                    arrow_forward_ios
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 border-t border-slate-100 dark:border-slate-800">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-center">
                            Press / to search · Enter to view
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
