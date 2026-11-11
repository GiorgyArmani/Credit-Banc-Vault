// src/app/admin/resources/_components/resource-admin-list.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Eye, EyeOff, FileText, Pencil, Trash2 } from "lucide-react";
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
import {
  RESOURCE_TITLE_MAX,
  formatFileSize,
  resourceTypeLabel,
  type PartnerResourceRow,
} from "@/lib/partner-resources-shared";
import { deleteResource, setResourcePublished, updateResource } from "../actions";

type ActionResult = { success: boolean; error?: string };

export function ResourceAdminList({ resources }: { resources: PartnerResourceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PartnerResourceRow | null>(null);

  function run(fn: () => Promise<ActionResult>, ok: string, onError: (msg: string) => void, after?: () => void) {
    startTransition(async () => {
      // A thrown action (network drop, deploy mid-request) would otherwise go
      // to the error boundary and blank the page.
      let res: ActionResult;
      try {
        res = await fn();
      } catch (err) {
        onError(`Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!res.success) {
        onError(res.error ?? "Something went wrong");
        return;
      }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  }

  if (resources.length === 0) {
    return <p className="text-sm text-cb-gray">No resources uploaded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {resources.map((r) => (
        <div key={r.id} className="flex gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cb-navy text-cb-mint">
            <FileText className="h-5 w-5" />
          </div>

          {editingId === r.id ? (
            <div className="flex-1 space-y-2">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={RESOURCE_TITLE_MAX}
              />
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
                    run(() => updateResource({ id: r.id, ...draft }), "Resource updated", setEditError, () =>
                      setEditingId(null)
                    )
                  }
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{r.title}</p>
                {!r.is_published && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
                    Hidden
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-cb-gray">
                {resourceTypeLabel(r.file_name)} · {formatFileSize(r.size_bytes)} · {r.file_name}
              </p>
              {r.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.description}</p>}
            </div>
          )}

          {editingId !== r.id && (
            <div className="flex shrink-0 items-start gap-1">
              <Button size="icon" variant="ghost" title="Open file" asChild>
                <a href={`/partner/resources/${r.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Edit"
                onClick={() => {
                  setEditError(null);
                  setDraft({ title: r.title, description: r.description ?? "" });
                  setEditingId(r.id);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={pending}
                title={r.is_published ? "Hide from partners" : "Show to partners"}
                onClick={() =>
                  run(
                    () => setResourcePublished(r.id, !r.is_published),
                    r.is_published ? "Hidden from partners" : "Visible to partners",
                    toast.error
                  )
                }
              >
                {r.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" title="Delete" disabled={pending} onClick={() => setToDelete(r)}>
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
              The file is removed for every partner and can’t be recovered. To take it down temporarily, hide it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                const id = toDelete!.id;
                setToDelete(null);
                run(() => deleteResource(id), "Resource deleted", toast.error);
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
