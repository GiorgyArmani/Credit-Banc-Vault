"use client";

import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidUsPhone } from "@/lib/phone";
import type { OwnerInput, Owner1Input } from "@/lib/owners";

export interface OwnersDraft {
    owner1: Owner1Input & { ssn_last4?: string | null };
    // ownership_pct is nullable here (unlike OwnerInput's required `number`) so a
    // cleared/partial input can be represented without ever falling back to NaN.
    // A null share is NOT a valid submission — it's a required field, flagged by
    // findOwnersDraftErrors below and by the server's validateOwners.
    owners: Array<Omit<OwnerInput, "ownership_pct"> & { ownership_pct: number | null; ssn_last4?: string | null }>;
}

/**
 * Client-side mirror of the server's "ownership % is required" rule, so a
 * blank share is caught before submit instead of silently saving as 0%
 * (validateOwners in src/lib/owners.ts is the source of truth; this only
 * blocks the obvious case early). Only checked when co-owners are being
 * saved (`available`) — when they're not, owners 2-5 are dropped anyway.
 */
export function findOwnersDraftErrors(draft: OwnersDraft, available: boolean): string[] {
    const errors: string[] = [];
    if (draft.owner1.ownership_pct === null) {
        errors.push("Owner 1: ownership % is required.");
    }
    if (available) {
        for (const o of draft.owners) {
            if (o.ownership_pct === null || o.ownership_pct === undefined || !Number.isFinite(o.ownership_pct)) {
                errors.push(`Owner ${o.position}: ownership % is required.`);
            }
            // Same rule as the server (normalizeOwnerPhone): a partial number
            // would otherwise be stored as bare digits and fail every lender.
            if (o.phone && o.phone.trim() && !isValidUsPhone(o.phone)) {
                errors.push(`Owner ${o.position}: phone must be 10 digits.`);
            }
        }
    }
    return errors;
}

const EMPTY_OWNER = {
    full_name: "",
    ownership_pct: null as number | null,
    dob: "",
    ssn: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    email: "",
    phone: "",
};

const inputClass = "h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold";
const labelClass = "text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1";

/** Empty string clears the field (null); anything that doesn't parse to a finite
 * number is ignored rather than committed as NaN (e.g. a bare "-" or "." while typing). */
function toPercentOrNull(raw: string): number | null {
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

export function OwnersEditor({
    value,
    onChange,
    available,
    error,
    loading,
}: {
    value: OwnersDraft;
    onChange: (next: OwnersDraft) => void;
    available: boolean;
    error?: string | null;
    /** Owners are still being fetched — render a neutral loading state and
     * accept no edits, so nothing is committed against a draft that isn't
     * really loaded yet. */
    loading?: boolean;
}) {
    const setOwner1 = (patch: Partial<OwnersDraft["owner1"]>) =>
        onChange({ ...value, owner1: { ...value.owner1, ...patch } });
    const setOwner = (position: number, patch: Partial<OwnersDraft["owners"][number]>) =>
        onChange({
            ...value,
            owners: value.owners.map((o) => (o.position === position ? { ...o, ...patch } : o)),
        });
    const nextPosition = [2, 3, 4, 5].find((p) => !value.owners.some((o) => o.position === p));

    const ssnPlaceholder = (last4?: string | null) =>
        last4 ? `On file ••••${last4} — leave blank to keep` : "9 digits";

    if (loading) {
        return (
            <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                    <Users className="w-3 h-3" />
                    Owners
                </h3>
                <p className="text-[11px] font-bold text-emerald-900/40 -mt-2">
                    Owners are shared by all of this client&apos;s businesses.
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 text-sm font-bold text-emerald-900/50">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading owners…
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                <Users className="w-3 h-3" />
                Owners
            </h3>
            <p className="text-[11px] font-bold text-emerald-900/40 -mt-2">
                Owners are shared by all of this client&apos;s businesses.
            </p>

            {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
                    {error} Owners will not be saved until this is resolved.
                </p>
            )}

            <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900/40 ml-1">
                    Owner 1 (the client)
                </p>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className={labelClass}>Ownership %</Label>
                        <Input
                            type="number"
                            min={0}
                            max={100}
                            value={value.owner1.ownership_pct ?? ""}
                            onChange={(e) => setOwner1({ ownership_pct: toPercentOrNull(e.target.value) })}
                            className={inputClass}
                        />
                        {value.owner1.ownership_pct === null && (
                            <p className="text-sm font-medium text-destructive">Ownership % is required.</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label className={labelClass}>Date of Birth</Label>
                        <Input
                            type="date"
                            value={value.owner1.dob ?? ""}
                            onChange={(e) => setOwner1({ dob: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className={labelClass}>SSN</Label>
                        <Input
                            type="password"
                            autoComplete="off"
                            placeholder={ssnPlaceholder(value.owner1.ssn_last4)}
                            value={value.owner1.ssn ?? ""}
                            onChange={(e) => setOwner1({ ssn: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className={labelClass}>Home Street</Label>
                        <Input
                            value={value.owner1.street ?? ""}
                            onChange={(e) => setOwner1({ street: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label className={labelClass}>City</Label>
                        <Input
                            value={value.owner1.city ?? ""}
                            onChange={(e) => setOwner1({ city: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className={labelClass}>State</Label>
                        <Input
                            maxLength={2}
                            value={value.owner1.state ?? ""}
                            onChange={(e) => setOwner1({ state: e.target.value.toUpperCase() })}
                            className={`${inputClass} uppercase`}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className={labelClass}>Zip</Label>
                        <Input
                            value={value.owner1.zip ?? ""}
                            onChange={(e) => setOwner1({ zip: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                </div>
            </div>

            {!available ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                    Co-owner details can&apos;t be saved yet (database update pending). Owner 1 and the rest of the
                    profile still save.
                </p>
            ) : (
                <>
                    {value.owners.map((o) => (
                        <div
                            key={o.position}
                            className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/20 p-4"
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900/40">
                                    Owner {o.position}
                                </p>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        onChange({
                                            ...value,
                                            owners: value.owners.filter((x) => x.position !== o.position),
                                        })
                                    }
                                    className="h-8 px-3 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 hover:text-red-700"
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                                </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className={labelClass}>Full Name</Label>
                                    <Input
                                        value={o.full_name}
                                        onChange={(e) => setOwner(o.position, { full_name: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className={labelClass}>Ownership %</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={o.ownership_pct ?? ""}
                                        onChange={(e) =>
                                            setOwner(o.position, { ownership_pct: toPercentOrNull(e.target.value) })
                                        }
                                        className={inputClass}
                                    />
                                    {(o.ownership_pct === null || o.ownership_pct === undefined) && (
                                        <p className="text-sm font-medium text-destructive">Ownership % is required.</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className={labelClass}>Date of Birth</Label>
                                    <Input
                                        type="date"
                                        value={o.dob ?? ""}
                                        onChange={(e) => setOwner(o.position, { dob: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className={labelClass}>SSN</Label>
                                    <Input
                                        type="password"
                                        autoComplete="off"
                                        placeholder={ssnPlaceholder(o.ssn_last4)}
                                        value={o.ssn ?? ""}
                                        onChange={(e) => setOwner(o.position, { ssn: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className={labelClass}>Email</Label>
                                    <Input
                                        type="email"
                                        value={o.email ?? ""}
                                        onChange={(e) => setOwner(o.position, { email: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className={labelClass}>Phone</Label>
                                    <Input
                                        value={o.phone ?? ""}
                                        onChange={(e) => setOwner(o.position, { phone: e.target.value })}
                                        className={inputClass}
                                    />
                                    {!!o.phone?.trim() && !isValidUsPhone(o.phone) && (
                                        <p className="text-sm font-medium text-destructive">Phone must be 10 digits.</p>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className={labelClass}>Home Street</Label>
                                <Input
                                    value={o.street ?? ""}
                                    onChange={(e) => setOwner(o.position, { street: e.target.value })}
                                    className={inputClass}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label className={labelClass}>City</Label>
                                    <Input
                                        value={o.city ?? ""}
                                        onChange={(e) => setOwner(o.position, { city: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className={labelClass}>State</Label>
                                    <Input
                                        maxLength={2}
                                        value={o.state ?? ""}
                                        onChange={(e) =>
                                            setOwner(o.position, { state: e.target.value.toUpperCase() })
                                        }
                                        className={`${inputClass} uppercase`}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className={labelClass}>Zip</Label>
                                    <Input
                                        value={o.zip ?? ""}
                                        onChange={(e) => setOwner(o.position, { zip: e.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                    {nextPosition && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                onChange({
                                    ...value,
                                    owners: [...value.owners, { position: nextPosition, ...EMPTY_OWNER }],
                                })
                            }
                            className="h-10 px-4 border-2 border-emerald-100 rounded-xl font-black uppercase tracking-widest text-[10px]"
                        >
                            <Plus className="h-4 w-4 mr-1" /> Add Owner
                        </Button>
                    )}
                </>
            )}
        </div>
    );
}
