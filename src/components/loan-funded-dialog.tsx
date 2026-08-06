"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, User, Hash, FileText, Send, Loader2, RefreshCw } from "lucide-react";
import { fundLoanAction } from "@/app/underwriting/dashboard/actions";
import { toast } from "@/lib/toast";

interface LenderOption {
    assignmentId: string;
    lenderName: string;
    stateLabel: string;
}

interface LoanFundedDialogProps {
    clientId: string;
    clientName: string;
    onSuccess?: () => void;
    /** Override the trigger button styling so it can blend into its host. */
    triggerClassName?: string;
    /** Active business whose funding_deal receives the funded figures. */
    businessProfileId?: string | null;
    /** What was originally asked for — shown read-only next to the funded amount. */
    amountRequested?: number | null;
    /** Lenders that reached submission, sourced from the lender-selection pipeline. */
    lenderOptions?: LenderOption[];
    /** Pre-fills the Sales Rep field (typically the assigned advisor). */
    defaultSalesRep?: string;
    /** Pre-fills the Slack Channel field with the deal's channel name. */
    defaultSlackChannel?: string;
    /** True when this business's current round is already recorded as funded.
     *  The form is replaced with a prompt to open a new round — recording a
     *  second funding against a closed round is the mistake this prevents. */
    activeRoundFunded?: boolean;
    /** Lender on the already-funded round, named in the prompt for context. */
    activeRoundLender?: string | null;
}

const OTHER_LENDER = "__other__";

const today = () => new Date().toISOString().slice(0, 10);

export function LoanFundedDialog({
    clientId,
    clientName,
    onSuccess,
    triggerClassName,
    businessProfileId,
    amountRequested,
    lenderOptions = [],
    defaultSalesRep = "",
    defaultSlackChannel = "",
    activeRoundFunded = false,
    activeRoundLender = null,
}: LoanFundedDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Tracks which lender-selection row was picked (null when "Other" / free text).
    const [fundedAssignmentId, setFundedAssignmentId] = useState<string | null>(null);
    // Drives the lender <select> independently of the free-text lenderFunded.
    const [lenderChoice, setLenderChoice] = useState<string>("");

    const seed = () => ({
        fileSinopsis: "",
        termOfFundedLoan: "",
        totalAmountFunded: "",
        useOfProceeds: "",
        slackChannel: defaultSlackChannel,
        salesRepFunded: defaultSalesRep,
        lenderFunded: "",
        dateOfSubmission: "",
        fundingDate: today(),
    });

    const [formData, setFormData] = useState(seed);

    // Re-seed from the latest file data each time the modal opens so UW always
    // starts from what's already on the file rather than stale prior input.
    useEffect(() => {
        if (isOpen) {
            setFormData(seed());
            setFundedAssignmentId(null);
            setLenderChoice("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleLenderSelect = (value: string) => {
        setLenderChoice(value);
        if (value === OTHER_LENDER || value === "") {
            setFundedAssignmentId(null);
            setFormData((prev) => ({ ...prev, lenderFunded: "" }));
        } else {
            const picked = lenderOptions.find((o) => o.assignmentId === value);
            setFundedAssignmentId(value);
            setFormData((prev) => ({ ...prev, lenderFunded: picked?.lenderName ?? "" }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const result = await fundLoanAction(clientId, {
                ...formData,
                businessProfileId: businessProfileId ?? null,
                amountRequested: amountRequested ?? null,
                fundedAssignmentId,
            });
            if (result.success) {
                // A warning means the figures saved but the pipeline status was
                // refused — surfaced so UW doesn't assume the deal fully landed.
                if ("warning" in result && result.warning) {
                    toast.error(result.warning);
                } else {
                    toast.success("Loan Funded successfully!");
                }
                setIsOpen(false);
                if (onSuccess) onSuccess();
            } else {
                toast.error(result.error || "Failed to fund loan");
            }
        } catch (error) {
            toast.error("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button className={triggerClassName ?? "h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-xl shadow-emerald-500/10 px-6 font-black uppercase tracking-widest text-xs"}>
                    <DollarSign className="w-4 h-4 mr-2" />
                    Loan Funded
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
                {activeRoundFunded ? (
                    // Caught before a single field is typed. The server refuses
                    // this too (fundLoanAction guards before any side effect) —
                    // this is the version of the refusal that says what to do.
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                                <RefreshCw className="w-6 h-6 text-amber-500" />
                                Start a new round first
                            </DialogTitle>
                            <DialogDescription className="text-slate-500 font-bold">
                                This business&apos;s current funding round is already recorded as funded
                                {activeRoundLender ? ` by ${activeRoundLender}` : ""}.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <p className="text-sm text-slate-600 leading-relaxed">
                                Recording another funding against a closed round would overwrite its amount,
                                lender, term and date — the record of what actually happened on that deal.
                            </p>
                            <p className="text-sm text-slate-600 leading-relaxed">
                                Open a new round from the <strong>Funding Rounds</strong> card on this page,
                                then come back and record the funding against it. The previous round keeps
                                its figures and the client is re-asked for fresh statements.
                            </p>
                        </div>
                        <DialogFooter>
                            <Button
                                onClick={() => setIsOpen(false)}
                                className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-widest text-xs h-11 px-6"
                            >
                                Got it
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                <>
                <DialogHeader>
                    <DialogTitle className="text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                        <Send className="w-6 h-6 text-emerald-500" />
                        Loan Funded Details
                    </DialogTitle>
                    <DialogDescription className="text-slate-500 font-bold">
                        Populate GHL custom fields for <strong>{clientName}</strong> and tag them as "Loan Funded".
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 items-start">
                        <div className="space-y-2">
                            <Label htmlFor="totalAmountFunded" className="text-xs font-black uppercase tracking-widest text-slate-400">Total Amount Funded</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="totalAmountFunded"
                                    name="totalAmountFunded"
                                    placeholder="e.g. 50,000"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.totalAmountFunded}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                            {/* Hint sits BELOW the input, not between label and input —
                                above it, this line made the cell taller than the one
                                beside it and knocked the whole row out of alignment. */}
                            {amountRequested != null && (
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    Requested: <span className="text-slate-600">{amountRequested.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</span>
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="lenderChoice" className="text-xs font-black uppercase tracking-widest text-slate-400">Lender that Funded</Label>
                            <div className="relative">
                                <FileText className="absolute left-3 top-3 w-4 h-4 text-slate-400 z-10" />
                                <Select value={lenderChoice} onValueChange={handleLenderSelect}>
                                    {/* min-w-0 + a truncating value: lender names run long
                                        ("American Capital — Approved") and would otherwise
                                        push the trigger past its grid column. */}
                                    <SelectTrigger id="lenderChoice" className="w-full min-w-0 pl-10 h-10 rounded-2xl border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 [&>span]:truncate [&>span]:text-left">
                                        <SelectValue placeholder="Select lender…" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl max-w-[min(28rem,90vw)]">
                                        {lenderOptions.map((o) => (
                                            <SelectItem key={o.assignmentId} value={o.assignmentId}>
                                                {o.lenderName} — {o.stateLabel}
                                            </SelectItem>
                                        ))}
                                        <SelectItem value={OTHER_LENDER}>Other (type manually)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {lenderChoice === OTHER_LENDER && (
                                <Input
                                    id="lenderFunded"
                                    name="lenderFunded"
                                    placeholder="Lender Name"
                                    className="rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.lenderFunded}
                                    onChange={handleChange}
                                    required
                                />
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="termOfFundedLoan" className="text-xs font-black uppercase tracking-widest text-slate-400">Term of Funded Loan</Label>
                            <div className="relative">
                                <Hash className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="termOfFundedLoan"
                                    name="termOfFundedLoan"
                                    placeholder="e.g. 12 Months"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.termOfFundedLoan}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="salesRepFunded" className="text-xs font-black uppercase tracking-widest text-slate-400">Sales Rep</Label>
                            <div className="relative">
                                <User className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="salesRepFunded"
                                    name="salesRepFunded"
                                    placeholder="Rep Name"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.salesRepFunded}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fundingDate" className="text-xs font-black uppercase tracking-widest text-slate-400">Funding Date</Label>
                            {/* No leading icon on date inputs — the browser already
                                renders its own calendar button, and two calendars in
                                one field read as a glitch. */}
                            <Input
                                id="fundingDate"
                                name="fundingDate"
                                type="date"
                                className="rounded-2xl border-slate-200 focus:ring-emerald-500"
                                value={formData.fundingDate}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="dateOfSubmission" className="text-xs font-black uppercase tracking-widest text-slate-400">Date of Submission</Label>
                            <Input
                                id="dateOfSubmission"
                                name="dateOfSubmission"
                                type="date"
                                className="rounded-2xl border-slate-200 focus:ring-emerald-500"
                                value={formData.dateOfSubmission}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        {/* Odd field out — spans the full width instead of being
                            stranded alone in the left column. */}
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="slackChannel" className="text-xs font-black uppercase tracking-widest text-slate-400">Slack Channel</Label>
                            <div className="relative">
                                <Hash className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="slackChannel"
                                    name="slackChannel"
                                    placeholder="#channel-name"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.slackChannel}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="useOfProceeds" className="text-xs font-black uppercase tracking-widest text-slate-400">Use of Proceeds</Label>
                        <Textarea
                            id="useOfProceeds"
                            name="useOfProceeds"
                            placeholder="How will the funds be used?"
                            className="rounded-2xl border-slate-200 focus:ring-emerald-500 min-h-[80px]"
                            value={formData.useOfProceeds}
                            onChange={handleChange}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="fileSinopsis" className="text-xs font-black uppercase tracking-widest text-slate-400">File Synopsis</Label>
                        <Textarea
                            id="fileSinopsis"
                            name="fileSinopsis"
                            placeholder="Brief overview of the deal..."
                            className="rounded-2xl border-slate-200 focus:ring-emerald-500 min-h-[100px]"
                            value={formData.fileSinopsis}
                            onChange={handleChange}
                        />
                    </div>

                    <DialogFooter className="pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsOpen(false)}
                            className="rounded-xl font-bold"
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black shadow-lg shadow-emerald-500/20 px-8"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Funding...
                                </>
                            ) : (
                                "Confirm Funding"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
                </>
                )}
            </DialogContent>
        </Dialog>
    );
}
