"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, X, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";

import {
    listClientFollowers,
    listAssignableAdvisors,
    addClientFollower,
    removeClientFollower,
    type FollowerRow,
    type AssignableAdvisor,
} from "../follower-actions";

interface Props {
    clientId: string;
    canManage: boolean;
}

function initials(first: string, last: string) {
    return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "??";
}

function Avatar({
    first,
    last,
    url,
    size = "md",
}: { first: string; last: string; url: string | null; size?: "sm" | "md" }) {
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
                "rounded-full bg-emerald-100 text-emerald-800 font-black flex items-center justify-center flex-shrink-0"
            )}
        >
            {initials(first, last)}
        </div>
    );
}

export function ClientFollowersCard({ clientId, canManage }: Props) {
    const [followers, setFollowers] = useState<FollowerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [assignable, setAssignable] = useState<AssignableAdvisor[]>([]);
    const [loadingAssignable, setLoadingAssignable] = useState(false);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [removeTarget, setRemoveTarget] = useState<FollowerRow | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        const res = await listClientFollowers(clientId);
        if (res.success && res.followers) {
            setFollowers(res.followers);
        } else if (res.error) {
            toast.error(res.error);
        }
        setLoading(false);
    }, [clientId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const openAddDialog = async () => {
        setDialogOpen(true);
        setLoadingAssignable(true);
        const res = await listAssignableAdvisors(clientId);
        if (res.success && res.advisors) {
            setAssignable(res.advisors);
        } else if (res.error) {
            toast.error(res.error);
        }
        setLoadingAssignable(false);
    };

    const handleAdd = async (advisorId: string) => {
        setPendingId(advisorId);
        const res = await addClientFollower(clientId, advisorId);
        setPendingId(null);
        if (res.success) {
            if (res.warning) toast.warning(res.warning);
            else toast.success("Follower added");
            setDialogOpen(false);
            refresh();
        } else {
            toast.error(res.error ?? "Failed to add follower");
        }
    };

    const confirmRemove = async () => {
        if (!removeTarget) return;
        const advisorId = removeTarget.advisor_id;
        setPendingId(advisorId);
        setRemoveTarget(null);
        const res = await removeClientFollower(clientId, advisorId);
        setPendingId(null);
        if (res.success) {
            if (res.warning) toast.warning(res.warning);
            else toast.success("Follower removed");
            refresh();
        } else {
            toast.error(res.error ?? "Failed to remove follower");
        }
    };

    return (
        <section className="p-6">
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Users className="h-4 w-4 text-emerald-700" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                        {loading ? "…" : `${followers.length} follower${followers.length === 1 ? "" : "s"}`}
                    </span>
                </div>
                {canManage && (
                    <button
                        type="button"
                        onClick={openAddDialog}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                        <UserPlus className="h-3.5 w-3.5" />
                        Add follower
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                </div>
            ) : followers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center mb-2.5">
                        <Users className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">No followers yet</p>
                    {canManage && (
                        <p className="text-xs text-slate-300 mt-1">
                            Assign another advisor to collaborate on this client
                        </p>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {followers.map((f) => {
                        const name = `${f.first_name} ${f.last_name}`.trim();
                        const isPending = pendingId === f.advisor_id;
                        return (
                            <div
                                key={f.advisor_id}
                                className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                <Avatar
                                    first={f.first_name}
                                    last={f.last_name}
                                    url={f.profile_pic_url}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-900 truncate">
                                        {name}
                                    </p>
                                    <p className="text-[11px] text-slate-400 truncate">
                                        {f.email}
                                    </p>
                                </div>
                                {canManage && (
                                    <button
                                        type="button"
                                        onClick={() => setRemoveTarget(f)}
                                        disabled={isPending}
                                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                                        title="Remove follower"
                                    >
                                        {isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <X className="h-4 w-4" />
                                        )}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <AlertDialog
                open={!!removeTarget}
                onOpenChange={(open) => {
                    if (!open) setRemoveTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove follower?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {removeTarget && (
                                <>
                                    <span className="font-semibold text-slate-700">
                                        {`${removeTarget.first_name} ${removeTarget.last_name}`.trim()}
                                    </span>{" "}
                                    will lose access to this client and will be removed as a follower on the GHL contact.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmRemove}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            Remove follower
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="p-0 gap-0 max-w-md">
                    <DialogHeader className="p-4 pb-2">
                        <DialogTitle>Add follower</DialogTitle>
                        <DialogDescription>
                            Followers get full access to this client and are added on the GHL contact.
                        </DialogDescription>
                    </DialogHeader>
                    <Command className="border-t">
                        <CommandInput placeholder="Search advisors..." />
                        <CommandList className="max-h-80">
                            {loadingAssignable ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                                </div>
                            ) : (
                                <>
                                    <CommandEmpty>No advisors available.</CommandEmpty>
                                    <CommandGroup>
                                        {assignable.map((a) => {
                                            const name = `${a.first_name} ${a.last_name}`.trim();
                                            const isPending = pendingId === a.id;
                                            return (
                                                <CommandItem
                                                    key={a.id}
                                                    value={`${name} ${a.email}`}
                                                    onSelect={() => !isPending && handleAdd(a.id)}
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
                                                    {isPending && (
                                                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                                    )}
                                                    {!a.ghl_user_id && !isPending && (
                                                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                                            NO GHL
                                                        </span>
                                                    )}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </>
                            )}
                        </CommandList>
                    </Command>
                </DialogContent>
            </Dialog>
        </section>
    );
}
