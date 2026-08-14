"use client";

/**
 * DocumentGroupPicker — "which group does this file belong to?"
 *
 * Rendered by every surface that uploads a document: the client's vault, the
 * advisor/admin workspace, and the underwriting file. Whoever pushes the file
 * is the person who knows which account, year or person it came from, so all
 * four roles get the same control rather than leaving underwriting to sort it
 * out afterwards.
 *
 * ONE COMPONENT, EVERY FIELD. What the inputs are CALLED, which of them appear
 * and what counts as valid all come from the field's config in
 * @/lib/document-groups — bank statements ask for a bank name and a required
 * four digits, tax returns ask for a year, an unconfigured field asks for a
 * name. Adding a field is a content change there, never a change here.
 *
 * Two jobs in one component, because splitting them would mean a user who
 * doesn't see their group in the list has to abandon the upload:
 *   1. pick an existing group, and
 *   2. add one inline, without leaving the upload flow.
 *
 * Deliberately unstyled beyond layout. It drops into the client vault's emerald
 * palette and the staff dashboards' slate one, so colour comes from `tone` and
 * everything else inherits.
 */

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import clsx from "clsx";
import {
  formatGroupLabel,
  getGroupConfig,
  groupsForDocCode,
  validateGroupInput,
  type DocumentGroup,
} from "@/lib/document-groups";

interface DocumentGroupPickerProps {
  /** The field being uploaded to. Drives every label in this component. */
  docCode: string;
  businessProfileId: string | null | undefined;
  /** Present on surfaces that know it; lets client-scoped fields be grouped
   *  before a business tab has resolved. */
  clientVaultId?: string | null;
  /** ALL groups on the file — this component slices to `docCode` itself. */
  groups: DocumentGroup[];
  /** Selected group id, or null for "not specified". */
  value: string | null;
  onChange: (groupId: string | null) => void;
  /** Called with the created group so the parent can add it to its list. */
  onGroupCreated: (group: DocumentGroup) => void;
  disabled?: boolean;
  /** Surface palette. `emerald` for the client vault, `slate` for staff. */
  tone?: "emerald" | "slate";
  /** Overrides the config's help text. Pass null to suppress it entirely. */
  helpText?: string | null;
  className?: string;
}

export function DocumentGroupPicker({
  docCode,
  businessProfileId,
  clientVaultId,
  groups,
  value,
  onChange,
  onGroupCreated,
  disabled = false,
  tone = "slate",
  helpText,
  className,
}: DocumentGroupPickerProps) {
  const [is_adding, set_is_adding] = useState(false);
  const [name, set_name] = useState("");
  const [identifier, set_identifier] = useState("");
  const [subtype, set_subtype] = useState("");
  const [nickname, set_nickname] = useState("");
  const [is_saving, set_is_saving] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const config = getGroupConfig(docCode);

  // Retired groups stay out of the picker but keep holding the files already
  // filed under them — see groupDocuments.
  const selectable = groupsForDocCode(groups, docCode).filter((g) => g.is_active);

  const accent =
    tone === "emerald"
      ? {
          label: "text-emerald-900/50",
          select: "border-emerald-100 focus:border-emerald-300",
          button: "text-emerald-600 hover:text-emerald-700",
          save: "bg-emerald-500 hover:bg-emerald-600 text-white",
          panel: "border-emerald-100 bg-emerald-50/30",
        }
      : {
          label: "text-slate-400",
          select: "border-slate-200 focus:border-slate-400",
          button: "text-slate-600 hover:text-slate-900",
          save: "bg-slate-900 hover:bg-slate-800 text-white",
          panel: "border-slate-200 bg-slate-50",
        };

  function reset_form() {
    set_name("");
    set_identifier("");
    // Pre-select the first option so a field with a subtype list never posts an
    // empty one the validator then rejects.
    set_subtype(config.subtypes?.[0]?.value ?? "");
    set_nickname("");
    set_error(null);
  }

  async function handle_create() {
    if (!businessProfileId && !clientVaultId) {
      set_error("No business selected");
      return;
    }

    const payload = {
      name: name.trim(),
      identifier: identifier.trim() || null,
      subtype: subtype.trim() || null,
      nickname: nickname.trim() || null,
    };

    // The same validator the API runs, so the message here is the message
    // there. Catching it client-side just saves the round trip.
    const invalid = validateGroupInput(docCode, payload);
    if (invalid) {
      set_error(invalid);
      return;
    }

    set_is_saving(true);
    set_error(null);
    try {
      const res = await fetch("/api/document-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          doc_code: docCode,
          business_profile_id: businessProfileId ?? null,
          client_vault_id: clientVaultId ?? null,
        }),
      });
      const result = await res.json().catch(() => null);

      if (!res.ok || !result?.group) {
        set_error(result?.error || `Could not add the ${config.noun.toLowerCase()}`);
        return;
      }

      // The API returns the existing row on a duplicate rather than an error,
      // so this path also covers "someone else just added the same group" —
      // select it and move on.
      onGroupCreated(result.group as DocumentGroup);
      onChange(result.group.id);
      reset_form();
      set_is_adding(false);
    } catch (e: any) {
      console.error("document group create failed:", e);
      set_error(`Could not add the ${config.noun.toLowerCase()}`);
    } finally {
      set_is_saving(false);
    }
  }

  const help = helpText === undefined ? config.helpText : helpText;

  return (
    <div className={clsx("space-y-2", className)}>
      <label
        className={clsx("block text-[10px] font-black uppercase tracking-widest", accent.label)}
      >
        {config.noun}
      </label>

      {!is_adding && (
        <div className="flex items-center gap-2">
          <select
            value={value ?? ""}
            disabled={disabled || (!businessProfileId && !clientVaultId)}
            onChange={(e) => onChange(e.target.value || null)}
            className={clsx(
              "flex-1 min-w-0 rounded-xl border bg-white px-3 py-2 text-sm outline-none transition-colors disabled:opacity-60",
              accent.select
            )}
          >
            {/* Never a blocking requirement. Someone who doesn't know which
                group a file belongs to must still be able to send it — an
                ungrouped document is worth more than no document. */}
            <option value="">Not specified</option>
            {selectable.map((group) => (
              <option key={group.id} value={group.id}>
                {formatGroupLabel(group)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={disabled || (!businessProfileId && !clientVaultId)}
            onClick={() => {
              reset_form();
              set_is_adding(true);
            }}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50",
              accent.button
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      )}

      {is_adding && (
        <div className={clsx("space-y-3 rounded-xl border p-3", accent.panel)}>
          <div className="flex items-center justify-between">
            <span
              className={clsx("text-[10px] font-black uppercase tracking-widest", accent.label)}
            >
              New {config.noun.toLowerCase()}
            </span>
            <button
              type="button"
              onClick={() => {
                reset_form();
                set_is_adding(false);
              }}
              className="text-slate-400 transition-colors hover:text-slate-700"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Single column when the field only asks for a name, so a lone input
              doesn't sit in half a grid looking like something is missing. */}
          <div
            className={clsx(
              "grid grid-cols-1 gap-2",
              (config.identifier || config.subtypes || config.nicknameLabel) && "sm:grid-cols-2"
            )}
          >
            <input
              value={name}
              onChange={(e) => set_name(e.target.value)}
              placeholder={config.namePlaceholder}
              aria-label={config.nameLabel}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />

            {config.identifier && (
              <input
                value={identifier}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Digits-only fields cannot hold a full account number even if
                  // someone pastes one — we store the last four deliberately.
                  const cleaned = config.identifier!.digitsOnly ? raw.replace(/\D/g, "") : raw;
                  set_identifier(
                    config.identifier!.maxLength
                      ? cleaned.slice(0, config.identifier!.maxLength)
                      : cleaned
                  );
                }}
                placeholder={config.identifier.placeholder}
                aria-label={config.identifier.label}
                inputMode={config.identifier.digitsOnly ? "numeric" : undefined}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            )}

            {config.subtypes && (
              <select
                value={subtype}
                onChange={(e) => set_subtype(e.target.value)}
                aria-label={config.subtypeLabel ?? "Type"}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              >
                {config.subtypes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}

            {config.nicknameLabel && (
              <input
                value={nickname}
                onChange={(e) => set_nickname(e.target.value)}
                placeholder={config.nicknamePlaceholder ?? `${config.nicknameLabel} (optional)`}
                aria-label={config.nicknameLabel}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            )}
          </div>

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={handle_create}
            disabled={is_saving}
            className={clsx(
              "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-60",
              accent.save
            )}
          >
            {is_saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {is_saving ? "Adding…" : `Add ${config.noun.toLowerCase()}`}
          </button>
        </div>
      )}

      {help && !is_adding && (
        <p className="text-[11px] leading-relaxed text-slate-400">{help}</p>
      )}
    </div>
  );
}
