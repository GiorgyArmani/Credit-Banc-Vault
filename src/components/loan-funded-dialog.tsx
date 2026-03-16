"use client";

import { useState } from "react";
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
import { DollarSign, Calendar, User, Hash, FileText, Send, Loader2 } from "lucide-react";
import { fundLoanAction } from "@/app/underwriting/dashboard/actions";
import { toast } from "sonner";

interface LoanFundedDialogProps {
    clientId: string;
    clientName: string;
    onSuccess?: () => void;
}

export function LoanFundedDialog({ clientId, clientName, onSuccess }: LoanFundedDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const [formData, setFormData] = useState({
        fileSinopsis: "",
        termOfFundedLoan: "",
        totalAmountFunded: "",
        useOfProceeds: "",
        slackChannel: "",
        salesRepFunded: "",
        dateFunded: "",
        lenderFunded: "",
        dateOfSubmission: "",
        fundingDate: "",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const result = await fundLoanAction(clientId, formData);
            if (result.success) {
                toast.success("Loan Funded successfully!");
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
                <Button className="h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-xl shadow-emerald-500/10 px-6 font-black uppercase tracking-widest text-xs">
                    <DollarSign className="w-4 h-4 mr-2" />
                    Loan Funded
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="lenderFunded" className="text-xs font-black uppercase tracking-widest text-slate-400">Lender that Funded</Label>
                            <div className="relative">
                                <FileText className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="lenderFunded"
                                    name="lenderFunded"
                                    placeholder="Lender Name"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.lenderFunded}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
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
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="fundingDate"
                                    name="fundingDate"
                                    type="date"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.fundingDate}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="dateFunded" className="text-xs font-black uppercase tracking-widest text-slate-400">Date they were Funded</Label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="dateFunded"
                                    name="dateFunded"
                                    type="date"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.dateFunded}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="dateOfSubmission" className="text-xs font-black uppercase tracking-widest text-slate-400">Date of Submission</Label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="dateOfSubmission"
                                    name="dateOfSubmission"
                                    type="date"
                                    className="pl-10 rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={formData.dateOfSubmission}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
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
            </DialogContent>
        </Dialog>
    );
}
