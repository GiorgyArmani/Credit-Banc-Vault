"use client";

/**
 * Create / edit / delete a lead group.
 *
 * Opened from `+ New group` pre-filled with whatever the underwriter was
 * already looking at (tab and search), because the moment someone wants to save
 * a filter is the moment they have just built one by hand.
 *
 * THE EMPTY-CRITERIA NOTICE is the important piece of copy here. Empty criteria
 * match nothing, which is correct and load-bearing (it is what makes a purely
 * hand-picked list possible) but reads as broken if you saved a group expecting
 * it to hold everything. So the dialog says out loud what an empty rule set
 * will do before it is saved.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PIPELINE_STEPS } from "@/components/loan-pipeline-status";
import { createGroup, updateGroup, deleteGroup } from "../group-actions";
import {
  LEAD_BUCKETS,
  isEmptyCriteria,
  type GroupCriteria,
  type LeadBucket,
} from "@/lib/lead-groups";
import type { GroupWithMembers } from "./group-chip-rail";
import type { LoanStatus } from "@/app/actions/pipeline";

const BUCKET_LABELS: Record<LeadBucket, string> = {
  ready: "Ready",
  active: "Vaults",
  funded: "Funded",
  declined: "Declined",
};

export function GroupEditorDialog({
  open,
  group,
  initialCriteria,
  advisorOptions,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  group: GroupWithMembers | null;
  initialCriteria?: GroupCriteria;
  advisorOptions: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (groupId: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [isShared, setIsShared] = useState(group?.is_shared ?? false);
  const [criteria, setCriteria] = useState<GroupCriteria>(
    group?.criteria ?? initialCriteria ?? {}
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pinCount = useMemo(
    () => group?.members.filter(m => m.mode === "pin").length ?? 0,
    [group]
  );
  const noRules = isEmptyCriteria(criteria);

  function set<K extends keyof GroupCriteria>(key: K, value: GroupCriteria[K]) {
    setCriteria(prev => {
      const next = { ...prev };
      // Undefined means "no rule". Storing an empty string or NaN instead would
      // fail zod on save and read as a rule to isEmptyCriteria.
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function toggleIn<T extends string>(key: keyof GroupCriteria, value: T) {
    const current = (criteria[key] as T[] | undefined) ?? [];
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    set(key, next as GroupCriteria[typeof key]);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Give the group a name.");
      return;
    }
    setSaving(true);
    const res = group
      ? await updateGroup(group.id, { name, criteria, isShared })
      : await createGroup({ name, criteria, isShared });
    setSaving(false);

    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(group ? "Group updated." : "Group created.");
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!group) return;
    setDeleting(true);
    const res = await deleteGroup(group.id);
    setDeleting(false);

    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Group deleted.");
    onDeleted(group.id);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto rounded-2xl border-outline-variant/30 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-headline text-xl font-extrabold tracking-tighter text-on-secondary-fixed">
            {group ? "Edit group" : "New group"}
          </DialogTitle>
          <DialogDescription className="text-on-surface-variant">
            Rules pick leads automatically. You can also add or remove individual
            files from the list itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Big asks, nothing reviewed"
              maxLength={60}
              autoFocus
              className="rounded-xl"
            />
          </Field>

          <Field label="Buckets">
            <ChipGroup>
              {LEAD_BUCKETS.map(b => (
                <Chip
                  key={b}
                  active={criteria.buckets?.includes(b) ?? false}
                  onClick={() => toggleIn("buckets", b)}
                >
                  {BUCKET_LABELS[b]}
                </Chip>
              ))}
            </ChipGroup>
          </Field>

          <Field label="Stage">
            <ChipGroup>
              {PIPELINE_STEPS.map(step => (
                <Chip
                  key={step.status}
                  active={criteria.stages?.includes(step.status) ?? false}
                  onClick={() => toggleIn<LoanStatus>("stages", step.status)}
                >
                  {step.shortLabel}
                </Chip>
              ))}
            </ChipGroup>
          </Field>

          {advisorOptions.length > 0 && (
            <Field label="Advisor">
              <ChipGroup>
                {advisorOptions.map(a => (
                  <Chip
                    key={a.id}
                    active={criteria.advisorIds?.includes(a.id) ?? false}
                    onClick={() => toggleIn("advisorIds", a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </ChipGroup>
            </Field>
          )}

          <Field label="Capital requested">
            <NumberRange
              min={criteria.askMin}
              max={criteria.askMax}
              onMin={v => set("askMin", v)}
              onMax={v => set("askMax", v)}
              placeholderMin="No minimum"
              placeholderMax="No maximum"
            />
          </Field>

          <Field label="Documents approved (%)">
            <NumberRange
              min={criteria.docsApprovedPctMin}
              max={criteria.docsApprovedPctMax}
              onMin={v => set("docsApprovedPctMin", v)}
              onMax={v => set("docsApprovedPctMax", v)}
              placeholderMin="0"
              placeholderMax="100"
            />
            <p className="mt-1 text-[11px] text-outline">
              Files with no documents requested yet are never matched by this rule.
            </p>
          </Field>

          <Field label="At least this many documents awaiting review">
            <Input
              type="number"
              min={0}
              value={criteria.awaitingReviewMin ?? ""}
              onChange={e => set("awaitingReviewMin", parseNumber(e.target.value))}
              placeholder="Any"
              className="rounded-xl"
            />
          </Field>

          <Field label="Age (days)">
            <NumberRange
              min={criteria.ageDaysMin}
              max={criteria.ageDaysMax}
              onMin={v => set("ageDaysMin", v)}
              onMax={v => set("ageDaysMax", v)}
              placeholderMin="Newer"
              placeholderMax="Older"
            />
          </Field>

          <Field label="Text match">
            <Input
              value={criteria.search ?? ""}
              onChange={e => set("search", e.target.value || undefined)}
              placeholder="Business, owner, email or advisor"
              maxLength={200}
              className="rounded-xl"
            />
          </Field>

          <Field label="State">
            <Input
              value={(criteria.states ?? []).join(", ")}
              onChange={e => set("states", splitList(e.target.value))}
              placeholder="TX, FL"
              className="rounded-xl"
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-bright p-3">
            <div>
              <p className="text-sm font-semibold text-on-secondary-fixed">
                Share with underwriting
              </p>
              <p className="text-[11px] text-outline">
                The team can see it. Only you can change it.
              </p>
            </div>
            <Switch checked={isShared} onCheckedChange={setIsShared} />
          </div>

          {noRules && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
              {pinCount > 0
                ? `No rules set. This group holds only the ${pinCount} file${
                    pinCount === 1 ? "" : "s"
                  } you added by hand.`
                : "No rules set. This group stays empty until you add files to it from the list."}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {group ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-error hover:bg-error/10 hover:text-error"
            >
              {deleting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" aria-hidden />
              )}
              Delete
            </Button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting}
              className="bg-on-secondary-fixed text-primary-fixed hover:bg-on-secondary-fixed/90"
            >
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              {group ? "Save" : "Create group"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Small form pieces ───────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-outline">
        {label}
      </p>
      {children}
    </div>
  );
}

function ChipGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
        active
          ? "border-primary bg-primary-container/40 text-on-primary-container"
          : "border-outline-variant/40 text-on-surface-variant hover:border-primary/50"
      )}
    >
      {children}
    </button>
  );
}

function NumberRange({
  min,
  max,
  onMin,
  onMax,
  placeholderMin,
  placeholderMax,
}: {
  min?: number;
  max?: number;
  onMin: (v: number | undefined) => void;
  onMax: (v: number | undefined) => void;
  placeholderMin: string;
  placeholderMax: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        value={min ?? ""}
        onChange={e => onMin(parseNumber(e.target.value))}
        placeholder={placeholderMin}
        className="rounded-xl"
      />
      <span className="text-xs text-outline">to</span>
      <Input
        type="number"
        min={0}
        value={max ?? ""}
        onChange={e => onMax(parseNumber(e.target.value))}
        placeholder={placeholderMax}
        className="rounded-xl"
      />
    </div>
  );
}

/** "" → undefined (no rule), never NaN or 0. */
function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}
