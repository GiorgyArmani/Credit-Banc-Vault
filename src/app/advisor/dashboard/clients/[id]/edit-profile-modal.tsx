"use client";

import { useState } from "react";
import { useForm, SubmitHandler, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";
import { FUNDING_OPTIONS } from "@/data/loan-types";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UserCog, Building2, DollarSign, MapPin, CreditCard, Clock } from "lucide-react";
import { updateClientProfile, updateBusinessProfile } from "./actions";
import { toast } from "@/lib/toast";

// Constants from signup form for consistency
const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const CREDIT_SCORE_OPTIONS = [
    { value: '700+', label: '700+' },
    { value: '650 - 700', label: '650 - 700' },
    { value: '600 - 650', label: '600 - 650' },
    { value: '550 - 600', label: '550 - 600' },
    { value: 'Below 550', label: 'Below 550' },
];

const LEGAL_ENTITY_TYPES = ['LLC', 'C-Corp', 'S-Corp', 'Sole Prop', 'Other'];
const FUNDING_URGENCY = ['Immediately', '1–3 Weeks', '3 Weeks +'];

const formSchema = z.object({
    client_name: z.string().min(2, "Name must be at least 2 characters"),
    client_email: z.string().email("Invalid email address"),
    client_phone: z.string().refine(isValidUsPhone, "Enter a valid 10-digit US phone number"),
    company_name: z.string().min(1, "Company name is required"),
    company_city: z.string().min(1, "City is required"),
    company_state: z.string().min(1, "State is required"),
    company_zip_code: z.string().min(5, "ZIP code must be at least 5 digits"),
    capital_requested: z.coerce.number().positive("Amount must be positive"),
    avg_monthly_deposits: z.coerce.number().nonnegative("Amount cannot be negative"),
    avg_annual_revenue: z.coerce.number().nonnegative("Amount cannot be negative"),
    credit_score: z.string().min(1, "Credit score is required"),
    legal_entity_type: z.string().min(1, "Entity type is required"),
    business_start_date: z.string().min(1, "Start date is required"),
    loan_purpose: z.string().default(""),
    proposed_loan_types: z.array(z.string()),
    funding_eta: z.string().default(""),
    employees_count: z.coerce.number().nonnegative().default(0),
    is_home_based: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

interface EditProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    /**
     * When editing a NON-PRIMARY business tab, pass that business's id +
     * isPrimary=false. The save then targets business_profiles + funding_deals
     * for that business (shared client identity still goes to the client).
     * Omitted / isPrimary=true → legacy client_data_vault edit (primary).
     */
    businessProfileId?: string | null;
    isPrimary?: boolean;
    clientData: {
        id: string;
        client_name: string;
        client_email: string;
        client_phone: string;
        company_name: string;
        company_city: string;
        company_state: string;
        company_zip_code?: string;
        capital_requested: number;
        avg_monthly_deposits: number;
        avg_annual_revenue?: number;
        credit_score: string;
        legal_entity_type: string;
        business_start_date: string;
        loan_purpose?: string;
        proposed_loan_type?: string;
        funding_eta?: string;
        employees_count?: number;
        is_home_based?: boolean | null;
    };
}

export function EditProfileModal({ isOpen, onClose, onSuccess, clientData, businessProfileId, isPrimary = true }: EditProfileModalProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();
    const editingBusiness = !isPrimary && !!businessProfileId;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema) as Resolver<FormValues>,
        defaultValues: {
            client_name: clientData.client_name || "",
            client_email: clientData.client_email || "",
            client_phone: clientData.client_phone || "",
            company_name: clientData.company_name || "",
            company_city: clientData.company_city || "",
            company_state: clientData.company_state || "",
            company_zip_code: clientData.company_zip_code || "",
            capital_requested: clientData.capital_requested || 0,
            avg_monthly_deposits: clientData.avg_monthly_deposits || 0,
            avg_annual_revenue: clientData.avg_annual_revenue || 0,
            credit_score: clientData.credit_score || "",
            legal_entity_type: clientData.legal_entity_type || "",
            business_start_date: clientData.business_start_date || "",
            loan_purpose: clientData.loan_purpose || "",
            proposed_loan_types: clientData.proposed_loan_type 
                ? clientData.proposed_loan_type.split(",").map(t => t.trim()).filter(Boolean)
                : [],
            funding_eta: clientData.funding_eta || "",
            employees_count: clientData.employees_count || 0,
            is_home_based: !!clientData.is_home_based,
        },
    });

    const onSubmit: SubmitHandler<FormValues> = async (values) => {
        setIsSubmitting(true);
        try {
            // Serialize proposed_loan_types array back to comma-separated string
            const submissionValues = {
                ...values,
                proposed_loan_type: values.proposed_loan_types.join(", ")
            };
            
            const result = editingBusiness
                ? await updateBusinessProfile(clientData.id, businessProfileId!, submissionValues)
                : await updateClientProfile(clientData.id, submissionValues);
            if (result.success) {
                // A partial save (e.g. the funding ask skipped because the
                // business's latest round is already funded) reports itself
                // rather than passing as a clean success.
                const warning = (result as any).warning as string | undefined;
                if (warning) {
                    toast.warning(warning, { duration: 8000 });
                } else {
                    toast.success(editingBusiness ? "Business updated successfully" : "Client profile updated successfully");
                }
                if (onSuccess) onSuccess();
                router.refresh();
                onClose();
            } else {
                toast.error(result.error || "Failed to update profile");
            }
        } catch (error) {
            toast.error("An unexpected error occurred");
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto rounded-[2rem] border-emerald-50">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tighter text-emerald-950">
                        <UserCog className="h-6 w-6 text-emerald-500" />
                        {editingBusiness ? "Edit Business" : "Edit Client Profile"}
                    </DialogTitle>
                    <DialogDescription className="text-emerald-900/40 font-bold">
                        {editingBusiness
                            ? "Update this business's details and funding ask. Client identity (name, email, phone) is shared across all of this client's businesses."
                            : "Update the client's information. Changes will be synced to GoHighLevel and internal systems."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...(form as any)}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 py-4">
                        {/* 1. Contact Info */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                                <Building2 className="w-3 h-3" />
                                Contact & Company
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="client_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Client Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="client_email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Email Address</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="email" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="client_phone"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Phone Number</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    type="tel"
                                                    inputMode="tel"
                                                    maxLength={14}
                                                    value={formatPhoneInput(field.value ?? "")}
                                                    onChange={(e) => field.onChange(formatPhoneInput(e.target.value))}
                                                    className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="company_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Company Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {/* 2. Location */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                                <MapPin className="w-3 h-3" />
                                Location
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                <FormField
                                    control={form.control}
                                    name="company_city"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">City</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="company_state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">State</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold uppercase">
                                                        <SelectValue placeholder="State" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="max-h-[300px]">
                                                    {US_STATES.map((state) => (
                                                        <SelectItem key={state} value={state} className="font-bold">
                                                            {state}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="company_zip_code"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">ZIP Code</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {/* 3. Financials */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                                <DollarSign className="w-3 h-3" />
                                Financial Profile
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="capital_requested"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Capital Requested ($)</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="avg_monthly_deposits"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Avg Monthly Deposits ($)</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="avg_annual_revenue"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Avg Annual Revenue ($)</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="proposed_loan_types"
                                    render={({ field }) => (
                                        <FormItem className="col-span-2">
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Proposed Loan Types</FormLabel>
                                            <FormControl>
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4 bg-emerald-50/20 border border-emerald-100 rounded-2xl">
                                                    {FUNDING_OPTIONS.map((type) => {
                                                        const isSelected = field.value.includes(type);
                                                        return (
                                                            <div 
                                                                key={type}
                                                                onClick={() => {
                                                                    const current = new Set(field.value);
                                                                    if (current.has(type)) current.delete(type);
                                                                    else current.add(type);
                                                                    field.onChange(Array.from(current));
                                                                }}
                                                                className={`
                                                                    flex items-center justify-center p-2 rounded-xl border-2 cursor-pointer transition-all font-bold text-[10px] uppercase text-center h-full min-h-[40px] select-none
                                                                    ${isSelected 
                                                                        ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/10" 
                                                                        : "bg-white border-emerald-100 text-emerald-900/60 hover:border-emerald-200"
                                                                    }
                                                                `}
                                                            >
                                                                {type}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {/* 4. Credit Score (Numeric) */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                                <CreditCard className="w-3 h-3" />
                                Credit Score
                            </h3>
                            <FormField
                                control={form.control}
                                name="credit_score"
                                render={({ field }) => (
                                    <FormItem className="space-y-3">
                                        <FormControl>
                                            <Input 
                                                {...field} 
                                                placeholder="Enter FICO Score (e.g. 680)" 
                                                className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" 
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* 5. Business Structure */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/30 flex items-center gap-2">
                                <Clock className="w-3 h-3" />
                                Business & Timeline
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="legal_entity_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Entity Type</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold">
                                                        <SelectValue placeholder="Select type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {LEGAL_ENTITY_TYPES.map((type) => (
                                                        <SelectItem key={type} value={type} className="font-bold">
                                                            {type}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="business_start_date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Start Date</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="date" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="employees_count"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Employees Count</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="funding_eta"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Funding Urgency</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-12 rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold">
                                                        <SelectValue placeholder="Select urgency" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {FUNDING_URGENCY.map((urg) => (
                                                        <SelectItem key={urg} value={urg} className="font-bold">
                                                            {urg}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={form.control}
                                name="is_home_based"
                                render={({ field }) => (
                                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 bg-emerald-50/20 border border-emerald-50 rounded-xl">
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={(checked) => field.onChange(!!checked)}
                                            />
                                        </FormControl>
                                        <div className="space-y-1 leading-none">
                                            <FormLabel className="text-sm font-bold text-emerald-950">
                                                This is a home-based business
                                            </FormLabel>
                                        </div>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="loan_purpose"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-emerald-900/60 ml-1">Loan Purpose</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} className="rounded-xl border-emerald-100 bg-emerald-50/30 focus:bg-white font-bold" rows={3} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DialogFooter className="pt-4 gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="h-12 px-8 border-2 border-emerald-100 rounded-xl font-black uppercase tracking-widest text-[10px]"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="h-12 px-10 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 uppercase tracking-widest text-[10px]"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Synchronizing...
                                    </>
                                ) : (
                                    "Update Profile"
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
