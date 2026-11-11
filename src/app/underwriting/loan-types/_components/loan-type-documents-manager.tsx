// src/app/underwriting/loan-types/_components/loan-type-documents-manager.tsx
"use client";

// Loan types on the left, the selected one's document list on the right.
//
// The list is always editable — remove, reorder, add from the catalog — and
// nothing is written until Save. Unsaved edits are kept per loan type, so
// switching to another one to compare doesn't throw work away.
//
// Two things here DO write straight away, each from its own dialog: adding a
// loan type and adding a document type. Both create something other screens
// use, so they are not part of a list's unsaved draft.

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, FilePlus2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  BANK_STATEMENTS_DOC_CODE,
  BANK_STATEMENT_MONTH_OPTIONS,
  DEFAULT_BANK_STATEMENT_MONTHS,
} from "@/lib/document-scope";
import {
  DOCUMENT_DESCRIPTION_MAX,
  DOCUMENT_LABEL_MAX,
  LOAN_TYPE_NAME_MAX,
  validateLoanTypeName,
  validateNewDocumentType,
} from "@/lib/document-packages-shared";
import {
  createDocumentType,
  createLoanType,
  removeDocumentPackage,
  saveDocumentPackage,
} from "@/app/actions/document-packages";

export type CatalogDoc = { code: string; label: string };

export type LoanTypeEntry = {
  loan_type: string;
  /** The list in force (a saved edit, else the built-in list). */
  codes: string[];
  statement_months: number | null;
  /** A loan type staff added here, as opposed to a built-in one. */
  added: boolean;
  /** Size of the built-in list; 0 when the loan type has none. */
  built_in_count: number;
  /** Set when a saved row is in force — who last changed it and when. */
  edited: { on: string | null; by: string | null } | null;
};

type Draft = { codes: string[]; months: number | null };
type ActionResult = { success: boolean; error?: string };

/** The month count only means something while bank statements are on the list. */
function months_of(d: Draft): number | null {
  return d.codes.includes(BANK_STATEMENTS_DOC_CODE) ? d.months : null;
}

function same(a: Draft, b: Draft): boolean {
  return (
    months_of(a) === months_of(b) &&
    a.codes.length === b.codes.length &&
    a.codes.every((code, i) => code === b.codes[i])
  );
}

const count_label = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
const unreachable = (err: unknown) =>
  `Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`;

export function LoanTypeDocumentsManager({
  entries,
  catalog,
  baseline_codes,
}: {
  entries: LoanTypeEntry[];
  catalog: CatalogDoc[];
  /** What a file is asked for when its loan type has no list. */
  baseline_codes: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(entries[0]?.loan_type ?? "");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [add_open, setAddOpen] = useState(false);
  const [confirm_remove, setConfirmRemove] = useState(false);

  // "New loan type" dialog
  const [type_open, setTypeOpen] = useState(false);
  const [type_name, setTypeName] = useState("");
  const [type_error, setTypeError] = useState<string | null>(null);

  // "New document type" dialog
  const [doc_open, setDocOpen] = useState(false);
  const [doc_label, setDocLabel] = useState("");
  const [doc_description, setDocDescription] = useState("");
  const [doc_multiple, setDocMultiple] = useState(true);
  const [doc_error, setDocError] = useState<string | null>(null);
  // Document types created in this visit, so they are usable before the page
  // data refreshes.
  const [created_docs, setCreatedDocs] = useState<CatalogDoc[]>([]);

  const all_docs = useMemo(() => {
    const known = new Set(catalog.map((d) => d.code));
    return [...catalog, ...created_docs.filter((d) => !known.has(d.code))];
  }, [catalog, created_docs]);
  const label_by_code = useMemo(() => new Map(all_docs.map((d) => [d.code, d.label])), [all_docs]);

  // A loan type that was just added or deleted isn't in `entries` until the
  // refresh lands; show the first one meanwhile instead of nothing.
  const entry = entries.find((e) => e.loan_type === selected) ?? entries[0];
  if (!entry) return null;
  const current = entry.loan_type;

  const saved: Draft = { codes: entry.codes, months: entry.statement_months };
  const draft = drafts[current] ?? saved;
  const dirty = current in drafts;
  const addable = all_docs.filter((d) => !draft.codes.includes(d.code));

  function select(loan_type: string) {
    setError(null);
    setAddOpen(false);
    setSelected(loan_type);
  }

  /** Editing back to the saved list clears the draft rather than leaving a no-op one. */
  function update(next: Draft) {
    setError(null);
    setDrafts((prev) => {
      const rest = { ...prev };
      if (same(next, saved)) delete rest[current];
      else rest[current] = next;
      return rest;
    });
  }

  function discard(loan_type: string) {
    setDrafts((prev) => {
      const rest = { ...prev };
      delete rest[loan_type];
      return rest;
    });
  }

  function move(index: number, by: -1 | 1) {
    const codes = [...draft.codes];
    const target = index + by;
    if (target < 0 || target >= codes.length) return;
    [codes[index], codes[target]] = [codes[target], codes[index]];
    update({ ...draft, codes });
  }

  function add(code: string) {
    update({
      codes: [...draft.codes, code],
      months:
        code === BANK_STATEMENTS_DOC_CODE && draft.months == null
          ? DEFAULT_BANK_STATEMENT_MONTHS
          : draft.months,
    });
  }

  /** Save or remove the list on screen. */
  function run(fn: () => Promise<ActionResult>, ok: string) {
    setError(null);
    startTransition(async () => {
      // A thrown action (network drop, deploy mid-request) would otherwise go
      // to the error boundary and blank the page.
      let res: ActionResult;
      try {
        res = await fn();
      } catch (err) {
        setError(unreachable(err));
        return;
      }
      if (!res.success) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      toast.success(ok);
      discard(current);
      router.refresh();
    });
  }

  const save = () =>
    run(
      () =>
        saveDocumentPackage({
          loan_type: current,
          document_codes: draft.codes,
          statement_months: months_of(draft),
        }),
      `${current} list saved`,
    );

  function submit_loan_type(e: FormEvent) {
    e.preventDefault();
    const name = validateLoanTypeName(type_name, entries.map((x) => x.loan_type));
    if (!name.ok) {
      setTypeError(name.error);
      return;
    }
    setTypeError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof createLoanType>>;
      try {
        res = await createLoanType(name.value);
      } catch (err) {
        setTypeError(unreachable(err));
        return;
      }
      if (!res.success) {
        setTypeError(res.error ?? "Something went wrong");
        return;
      }
      toast.success(`${name.value} added`);
      setTypeOpen(false);
      setTypeName("");
      setSelected(res.loan_type ?? name.value);
      router.refresh();
    });
  }

  function submit_document_type(e: FormEvent) {
    e.preventDefault();
    const input = { label: doc_label, description: doc_description, allow_multiple: doc_multiple };
    const checked = validateNewDocumentType(input, all_docs);
    if (!checked.ok) {
      setDocError(checked.error);
      return;
    }
    setDocError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof createDocumentType>>;
      try {
        res = await createDocumentType(input);
      } catch (err) {
        setDocError(unreachable(err));
        return;
      }
      if (!res.success || !res.document) {
        setDocError(res.error ?? "Something went wrong");
        return;
      }
      const created = res.document;
      toast.success(`${created.label} added to the catalog`);
      setCreatedDocs((prev) => [...prev, created]);
      add(created.code);
      setDocOpen(false);
      setDocLabel("");
      setDocDescription("");
      setDocMultiple(true);
      router.refresh();
    });
  }

  const new_loan_type_button = (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={() => {
        setTypeError(null);
        setTypeOpen(true);
      }}
    >
      <Plus className="mr-2 h-4 w-4" />
      New loan type
    </Button>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Loan type picker — a select on small screens, a list beside the editor on large ones. */}
      <div className="space-y-2 lg:hidden">
        <Select value={current} onValueChange={select}>
          <SelectTrigger aria-label="Loan type" className="h-11 bg-white font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entries.map((e) => (
              <SelectItem key={e.loan_type} value={e.loan_type}>
                {e.loan_type}
                {e.loan_type in drafts ? " (unsaved)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {new_loan_type_button}
      </div>

      <nav aria-label="Loan types" className="hidden self-start rounded-2xl border border-black/5 bg-white p-2 lg:block">
        <ul className="space-y-0.5">
          {entries.map((e) => {
            const active = e.loan_type === current;
            const unsaved = e.loan_type in drafts;
            const size = (drafts[e.loan_type]?.codes ?? e.codes).length;
            const tag = unsaved ? "Unsaved" : e.added ? "Added" : e.edited ? "Edited" : null;
            return (
              <li key={e.loan_type}>
                <button
                  type="button"
                  onClick={() => select(e.loan_type)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-cb-navy text-white" : "text-cb-navy hover:bg-cb-cream"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{e.loan_type}</span>
                    <span className={`block text-xs tabular-nums ${active ? "text-white/70" : "text-cb-gray"}`}>
                      {size === 0 ? "No list" : count_label(size)}
                    </span>
                  </span>
                  {tag && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                        unsaved
                          ? "bg-amber-100 text-amber-700"
                          : active
                            ? "bg-cb-mint text-cb-navy"
                            : "bg-cb-mint/20 text-cb-navy"
                      }`}
                    >
                      {tag}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 border-t border-black/5 pt-2">{new_loan_type_button}</div>
      </nav>

      {/* Editor */}
      <section aria-label={`${current} documents`} className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-headline text-xl font-extrabold tracking-tight text-cb-navy">{current}</h2>
            <p className="mt-0.5 text-sm text-cb-gray">
              {entry.edited
                ? `${entry.added ? "Added here. Last changed" : "Edited"}${entry.edited.by ? ` by ${entry.edited.by}` : ""}${entry.edited.on ? ` on ${entry.edited.on}` : ""}.`
                : entry.built_in_count > 0
                  ? "Original list — nobody has changed it."
                  : "No list of its own."}
            </p>
          </div>
          {entry.edited && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmRemove(true)}>
              {entry.added ? (
                <>
                  <Trash2 className="mr-2 h-3.5 w-3.5 text-red-600" />
                  Delete loan type
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  Restore original list
                </>
              )}
            </Button>
          )}
        </div>

        {draft.codes.length === 0 ? (
          <div className="mt-5 rounded-xl bg-cb-cream px-4 py-3 text-sm text-cb-navy">
            <p className="font-semibold">Nothing is listed for this loan type.</p>
            {entry.codes.length === 0 && (
              <p className="mt-1 text-on-surface-variant">
                A file created with only {current} is asked for the basics:{" "}
                {baseline_codes.map((c) => label_by_code.get(c) ?? c).join(", ")}. Add documents
                below to give it a list of its own.
              </p>
            )}
          </div>
        ) : (
          <ol className="mt-5 space-y-2">
            {draft.codes.map((code, i) => {
              const label = label_by_code.get(code);
              const name = label ?? code;
              return (
                <li key={code} className="flex items-center gap-2 rounded-xl border border-black/5 bg-cb-cream px-3 py-1.5 sm:gap-3">
                  <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-cb-gray">{i + 1}</span>
                  <div className="min-w-0 flex-1 py-1">
                    <p className="truncate text-sm font-semibold text-cb-navy">{name}</p>
                    {!label && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Not in the document catalog, so it is never requested. Remove it.
                      </p>
                    )}
                  </div>

                  {code === BANK_STATEMENTS_DOC_CODE && (
                    <Select
                      value={String(draft.months ?? "")}
                      onValueChange={(v) => update({ ...draft, months: Number(v) })}
                    >
                      <SelectTrigger aria-label="Months of bank statements" className="h-9 w-[7.5rem] shrink-0 bg-white text-xs font-semibold">
                        <SelectValue placeholder="Months" />
                      </SelectTrigger>
                      <SelectContent>
                        {BANK_STATEMENT_MONTH_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {m} months
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <div className="flex shrink-0 items-center">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move ${name} up`}
                      title="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={i === draft.codes.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move ${name} down`}
                      title="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => update({ ...draft, codes: draft.codes.filter((c) => c !== code) })}
                      aria-label={`Remove ${name}`}
                      title="Remove"
                    >
                      <X className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {/* Add from the catalog. Stays open so several can be added in a row. */}
          <Popover open={add_open} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add a document
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search documents…" />
                <CommandList>
                  <CommandEmpty>
                    {addable.length === 0
                      ? "Every document is already on this list."
                      : "No document matches. Close this and use New document type to create it."}
                  </CommandEmpty>
                  <CommandGroup>
                    {addable.map((d) => (
                      <CommandItem key={d.code} value={`${d.label} ${d.code}`} onSelect={() => add(d.code)}>
                        <Plus className="mr-2 h-4 w-4 text-cb-gray" />
                        {d.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Not in the catalog yet — create it. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAddOpen(false);
              setDocError(null);
              setDocOpen(true);
            }}
          >
            <FilePlus2 className="mr-2 h-4 w-4" />
            New document type
          </Button>
        </div>

        <div className="mt-6 border-t border-black/5 pt-4">
          {error && (
            <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          {dirty ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={pending} onClick={save}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  discard(current);
                }}
              >
                Discard changes
              </Button>
              <p className="text-xs text-cb-gray">
                Applies to files created from now on. Files already open keep what they were asked for.
              </p>
            </div>
          ) : (
            <p className="text-xs text-cb-gray">
              No unsaved changes. Edits apply to files created from now on; files already open keep
              what they were asked for.
            </p>
          )}
        </div>
      </section>

      {/* New loan type */}
      <Dialog open={type_open} onOpenChange={(o) => !pending && setTypeOpen(o)}>
        <DialogContent>
          <form onSubmit={submit_loan_type} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New loan type</DialogTitle>
              <DialogDescription>
                It appears in the loan type pickers straight away and opens with the basic
                documents, which you can then change.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="new-loan-type-name">Name</Label>
              <Input
                id="new-loan-type-name"
                value={type_name}
                onChange={(e) => setTypeName(e.target.value)}
                maxLength={LOAN_TYPE_NAME_MAX}
                placeholder="e.g. Franchise Loan"
                autoFocus
                aria-invalid={!!type_error}
                aria-describedby={type_error ? "new-loan-type-error" : undefined}
              />
              {type_error && (
                <p id="new-loan-type-error" role="alert" className="text-xs font-semibold text-red-600">
                  {type_error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setTypeOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add loan type"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New document type */}
      <Dialog open={doc_open} onOpenChange={(o) => !pending && setDocOpen(o)}>
        <DialogContent>
          <form onSubmit={submit_document_type} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New document type</DialogTitle>
              <DialogDescription>
                It joins the document catalog straight away, so it can be requested on any file,
                and is added to the {current} list for you to save.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="new-document-label">Name</Label>
              <Input
                id="new-document-label"
                value={doc_label}
                onChange={(e) => setDocLabel(e.target.value)}
                maxLength={DOCUMENT_LABEL_MAX}
                placeholder="e.g. Franchise Agreement"
                autoFocus
                aria-invalid={!!doc_error}
                aria-describedby={doc_error ? "new-document-error" : undefined}
              />
              <p className="text-xs text-cb-gray">The client sees this name on their checklist.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-document-description">Instructions for the client (optional)</Label>
              <Textarea
                id="new-document-description"
                value={doc_description}
                onChange={(e) => setDocDescription(e.target.value)}
                maxLength={DOCUMENT_DESCRIPTION_MAX}
                rows={2}
                placeholder="e.g. The signed copy, all pages."
              />
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="new-document-multiple"
                checked={doc_multiple}
                onCheckedChange={(v) => setDocMultiple(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="new-document-multiple" className="font-normal leading-snug">
                The client can upload more than one file for it
              </Label>
            </div>
            {doc_error && (
              <p id="new-document-error" role="alert" className="text-xs font-semibold text-red-600">
                {doc_error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setDocOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add document type"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Restore a built-in list, or delete a loan type that was added here. */}
      <AlertDialog open={confirm_remove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {entry.added ? `Delete the ${current} loan type?` : `Restore the original ${current} list?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {entry.added
                ? `${current} disappears from the loan type pickers. Files already created with it keep it, and keep the documents they were asked for.`
                : entry.built_in_count > 0
                  ? `The saved edits are removed and new ${current} files go back to the original ${count_label(entry.built_in_count)}. Files already open are not changed.`
                  : `The saved edits are removed and ${current} goes back to having no list of its own. Files already open are not changed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={entry.added ? "bg-red-600 text-white hover:bg-red-700" : undefined}
              onClick={() => {
                setConfirmRemove(false);
                run(
                  () => removeDocumentPackage(current),
                  entry.added ? `${current} deleted` : `${current} list restored`,
                );
              }}
            >
              {entry.added ? "Delete" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
