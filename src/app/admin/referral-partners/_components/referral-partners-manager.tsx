"use client";

import { useState, useTransition } from "react";
import { Plus, Check, X, Pencil, Loader2, Search } from "lucide-react";
import {
  addReferralPartner,
  renameReferralPartner,
  setReferralPartnerActive,
} from "../actions";

export interface PartnerRow {
  id: string;
  name: string;
  active: boolean;
}

export function ReferralPartnersManager({ initial }: { initial: PartnerRow[] }) {
  const [rows, setRows] = useState<PartnerRow[]>(initial);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const activeCount = rows.filter((r) => r.active).length;

  function handleAdd() {
    const name = newName.replace(/\s+/g, " ").trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const res = await addReferralPartner(name);
      if (!res.success) {
        setError(res.error || "Failed to add partner");
        return;
      }
      const stored = res.name || name;
      // Reflect it locally without a full reload.
      setRows((prev) => {
        const existing = prev.find(
          (r) => r.name.toLowerCase() === stored.toLowerCase()
        );
        if (existing) {
          return prev
            .map((r) => (r.id === existing.id ? { ...r, active: true } : r))
            .sort((a, b) => a.name.localeCompare(b.name));
        }
        return [
          ...prev,
          { id: `tmp-${stored}`, name: stored, active: true },
        ].sort((a, b) => a.name.localeCompare(b.name));
      });
      setNewName("");
    });
  }

  function handleRename(id: string) {
    const name = editingName.replace(/\s+/g, " ").trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const res = await renameReferralPartner(id, name);
      if (!res.success) {
        setError(res.error || "Failed to rename");
        return;
      }
      setRows((prev) =>
        prev
          .map((r) => (r.id === id ? { ...r, name } : r))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
      setEditingName("");
    });
  }

  function handleToggle(id: string, active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setReferralPartnerActive(id, active);
      if (!res.success) {
        setError(res.error || "Failed to update");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)));
    });
  }

  return (
    <div className="max-w-2xl">
      {/* Add new */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add a referral partner…"
          className="flex-1 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending || !newName.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm font-semibold text-red-600">{error}</p>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none"
        />
      </div>

      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
        {activeCount} active · {rows.length} total
      </p>

      {/* List */}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden bg-white">
        {filtered.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            {editingId === r.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(r.id)}
                  className="flex-1 px-3 py-1.5 border border-emerald-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <button
                  onClick={() => handleRename(r.id)}
                  disabled={isPending}
                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                  title="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditingName("");
                  }}
                  className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg"
                  title="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <span
                  className={
                    r.active
                      ? "text-sm font-semibold text-slate-800"
                      : "text-sm font-semibold text-slate-400 line-through"
                  }
                >
                  {r.name}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(r.id);
                      setEditingName(r.name);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg"
                    title="Rename"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(r.id, !r.active)}
                    disabled={isPending}
                    className={
                      r.active
                        ? "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        : "px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600 hover:bg-emerald-50 rounded-lg"
                    }
                  >
                    {r.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-400">
            No partners found.
          </li>
        )}
      </ul>
    </div>
  );
}
