"use client";

import { useState } from "react";
import { UserPlus, X, Users } from "lucide-react";
import clsx from "clsx";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";

export interface PickerAdvisor {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    profile_pic_url?: string | null;
    ghl_user_id?: string | null;
}

interface Props {
    advisors: PickerAdvisor[];
    selectedIds: string[];
    excludeIds?: string[];
    onAdd: (id: string) => void;
    onRemove: (id: string) => void;
    title?: string;
    description?: string;
}

function initials(first: string, last: string) {
    return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "??";
}

function Avatar({
    first,
    last,
    url,
    size = "md",
}: { first: string; last: string; url?: string | null; size?: "sm" | "md" }) {
    const dims = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
    if (url) {
        return (
            <img
                src={url}
                alt={`${first} ${last}`}
                className={clsx(dims, "rounded-full object-cover flex-shrink-0")}
            />
        );
    }
    return (
        <div
            className={clsx(
                dims,
                "rounded-full bg-emerald-100 text-emerald-800 font-black flex items-center justify-center flex-shrink-0",
            )}
        >
            {initials(first, last)}
        </div>
    );
}

export function FollowersPicker({
    advisors,
    selectedIds,
    excludeIds = [],
    onAdd,
    onRemove,
    title = "Followers",
    description = "Followers receive every email this client gets — credentials, document reminders, upload alerts, and all other notifications.",
}: Props) {
    const [dialogOpen, setDialogOpen] = useState(false);

    const advisorById = new Map(advisors.map(a => [a.id, a]));
    const selected = selectedIds
        .map(id => advisorById.get(id))
        .filter((a): a is PickerAdvisor => !!a);

    const excluded = new Set([...excludeIds, ...selectedIds]);
    const assignable = advisors.filter(a => !excluded.has(a.id));

    const handleAdd = (id: string) => {
        onAdd(id);
        setDialogOpen(false);
    };

    return (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Users className="h-4 w-4 text-emerald-700" />
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
                    <span className="ml-1 text-[11px] font-bold text-slate-400 tabular-nums">
                        {selected.length}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setDialogOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
                >
                    <UserPlus className="h-3.5 w-3.5" />
                    Add follower
                </button>
            </div>

            {description && (
                <p className="text-xs text-slate-400 -mt-3 mb-4">{description}</p>
            )}

            {selected.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center mb-2.5">
                        <Users className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">No followers yet</p>
                    <p className="text-xs text-slate-300 mt-1">
                        Assign another advisor to collaborate on this client
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {selected.map(f => {
                        const name = `${f.first_name} ${f.last_name}`.trim();
                        return (
                            <div
                                key={f.id}
                                className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                <Avatar
                                    first={f.first_name}
                                    last={f.last_name}
                                    url={f.profile_pic_url}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-900 truncate">{name}</p>
                                    <p className="text-[11px] text-slate-400 truncate">{f.email}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(f.id)}
                                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    title="Remove follower"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="p-0 gap-0 max-w-md">
                    <DialogHeader className="p-4 pb-2">
                        <DialogTitle>Add follower</DialogTitle>
                        <DialogDescription>
                            Followers will receive every email this client gets, just like the primary advisor.
                        </DialogDescription>
                    </DialogHeader>
                    <Command className="border-t">
                        <CommandInput placeholder="Search advisors..." />
                        <CommandList className="max-h-80">
                            <CommandEmpty>No advisors available.</CommandEmpty>
                            <CommandGroup>
                                {assignable.map(a => {
                                    const name = `${a.first_name} ${a.last_name}`.trim();
                                    return (
                                        <CommandItem
                                            key={a.id}
                                            value={`${name} ${a.email}`}
                                            onSelect={() => handleAdd(a.id)}
                                            className="gap-3"
                                        >
                                            <Avatar
                                                first={a.first_name}
                                                last={a.last_name}
                                                url={a.profile_pic_url}
                                                size="sm"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-900 truncate">
                                                    {name}
                                                </p>
                                                <p className="text-[11px] text-slate-400 truncate">
                                                    {a.email}
                                                </p>
                                            </div>
                                            {!a.ghl_user_id && (
                                                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                    NO GHL
                                                </span>
                                            )}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </section>
    );
}
