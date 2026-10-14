// src/app/admin/webinars/_components/webinar-admin-list.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Pencil, PlayCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatBytes, formatSessionDate, type AdminWebinarView } from "@/lib/webinars-shared";
import { deleteWebinar, setWebinarPublished, updateWebinar } from "../actions";

export function WebinarAdminList({ webinars }: { webinars: AdminWebinarView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "", session_date: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminWebinarView | null>(null);

  function run(fn: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) {
    startTransition(async () => {
      // A thrown action (network drop, deploy mid-request) would otherwise go
      // to the error boundary and blank the page.
      let res: { success: boolean; error?: string };
      try {
        res = await fn();
      } catch (err) {
        toast.error(`Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!res.success) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  }

  if (webinars.length === 0) {
    return <p className="text-sm text-cb-gray">No webinars uploaded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {webinars.map((w) => (
        <div key={w.id} className="flex gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="h-20 w-36 shrink-0 overflow-hidden rounded-lg bg-cb-navy">
            {w.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable
              <img src={w.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-cb-mint">
                <PlayCircle className="h-8 w-8" />
              </div>
            )}
          </div>

          {editingId === w.id ? (
            <div className="flex-1 space-y-2">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
              <Input type="date" value={draft.session_date} onChange={(e) => setDraft({ ...draft, session_date: e.target.value })} />
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {editError && <p className="text-xs font-semibold text-red-600">{editError}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      let res: { success: boolean; error?: string };
                      try {
                        res = await updateWebinar({ id: w.id, ...draft });
                      } catch (err) {
                        return setEditError(
                          `Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`
                        );
                      }
                      if (!res.success) return setEditError(res.error ?? "Couldn't save.");
                      toast.success("Webinar updated");
                      setEditingId(null);
                      router.refresh();
                    })
                  }
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{w.title}</p>
                {!w.video_url && (
                  <span
                    title="The video file couldn't be found in storage. Delete this entry and re-upload."
                    className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700"
                  >
                    File missing
                  </span>
                )}
                {!w.is_published && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                    Hidden
                  </span>
                )}
              </div>
              <p className="text-xs text-cb-gray">
                {[formatSessionDate(w.session_date), formatBytes(w.size_bytes)].filter(Boolean).join(" · ")}
              </p>
              {w.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{w.description}</p>}
            </div>
          )}

          {editingId !== w.id && (
            <div className="flex shrink-0 items-start gap-1">
              <Button
                size="icon"
                variant="ghost"
                title="Edit"
                onClick={() => {
                  setEditError(null);
                  setDraft({ title: w.title, description: w.description ?? "", session_date: w.session_date ?? "" });
                  setEditingId(w.id);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={pending}
                title={w.is_published ? "Hide from partners" : "Show to partners"}
                onClick={() =>
                  run(() => setWebinarPublished(w.id, !w.is_published), w.is_published ? "Hidden from partners" : "Visible to partners")
                }
              >
                {w.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" title="Delete" disabled={pending} onClick={() => setToDelete(w)}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          )}
        </div>
      ))}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The recording is removed for every partner and can’t be recovered. To take it down temporarily, hide it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                const id = toDelete!.id;
                setToDelete(null);
                run(() => deleteWebinar(id), "Webinar deleted");
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
