"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { KanbanColumn } from "./_components/kanban-column";
import { PipelineDealCard } from "./_components/pipeline-card";
import { getBulkLatestStatus, updateLoanStatus, type LoanStatus } from "@/app/actions/pipeline";
import { toast } from "sonner";
import { Loader2, Filter, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Deal {
  id: string;
  user_id: string;
  client_name: string;
  company_name: string;
  client_email: string;
  client_phone: string;
  capital_requested: number;
  pipeline_status: LoanStatus;
  document_count: number;
  total_required_docs: number;
}

const STAGE_MAP: { label: string; status: LoanStatus; color: string }[] = [
  { label: "New Lead", status: "created", color: "bg-slate-400" },
  { label: "Docs Requested", status: "onboarding", color: "bg-blue-400" },
  { label: "Pending Docs", status: "documents_requested", color: "bg-amber-400" },
  { label: "Docs Received", status: "documents_received", color: "bg-cyan-400" },
  { label: "Underwriting", status: "under_review", color: "bg-purple-400" },
  { label: "Offer Received", status: "lender_matched", color: "bg-indigo-400" },
  { label: "Deal Funded", status: "funded", color: "bg-emerald-500" },
  { label: "Closed Lost", status: "declined", color: "bg-red-500" },
];

export default function AdvisorPipelinePage() {
  const supabase = createClient();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchDeals = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: advisor } = await supabase
        .from("advisors")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!advisor) return;

      const { data: clients, error } = await supabase
        .from("client_data_vault")
        .select(`id, user_id, client_name, client_email, client_phone, company_name, capital_requested`)
        .eq("advisor_id", advisor.id);

      if (error) throw error;

      // Fetch statuses and doc counts
      const vaultIds = clients.map(c => c.id);
      const [statusMap, { data: coreDocs }] = await Promise.all([
        getBulkLatestStatus(vaultIds),
        supabase.from("required_documents").select("code").eq("is_core", true)
      ]);

      const coreCodes = coreDocs?.map(d => d.code) || [];

      const enrichedDeals = await Promise.all(clients.map(async (client) => {
        // Doc count logic
        const { data: dynamicDocs } = await supabase
          .from("client_dynamic_documents")
          .select(`required_documents (code)`)
          .eq("user_id", client.user_id)
          .eq("is_active", true);

        const dynamicCodes = (dynamicDocs as any)?.map((d: any) => d.required_documents?.code).filter(Boolean) || [];
        const allRequiredCodes = new Set([...coreCodes, ...dynamicCodes]);

        const { data: uploadedDocs } = await supabase
          .from("user_documents")
          .select("category, doc_code")
          .eq("user_id", client.user_id);

        const uploadedCodes = new Set([
          ...(uploadedDocs?.map(d => d.category).filter(Boolean) || []),
          ...(uploadedDocs?.map(d => d.doc_code).filter(Boolean) || [])
        ]);

        const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;

        return {
          ...client,
          pipeline_status: statusMap.get(client.id) || "created",
          document_count: satisfied,
          total_required_docs: allRequiredCodes.size,
        };
      }));

      setDeals(enrichedDeals);
    } catch (error: any) {
      toast.error("Failed to load pipeline: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeals();
  }, []);

  const filteredDeals = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return deals.filter(deal => 
      deal.client_name.toLowerCase().includes(query) ||
      deal.company_name.toLowerCase().includes(query)
    );
  }, [deals, searchQuery]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("dealId", id);
  };

  const handleDrop = async (dealId: string, newStatus: string) => {
    const oldDeals = [...deals];
    
    // Optimistic Update
    setDeals(prev => prev.map(d => 
      d.id === dealId ? { ...d, pipeline_status: newStatus as LoanStatus } : d
    ));

    try {
      const result = await updateLoanStatus(dealId, newStatus as LoanStatus, `Moved in Pipeline`);
      if (!result.success) throw new Error(result.error);
      toast.success("Deal status updated!");
    } catch (error: any) {
      setDeals(oldDeals);
      toast.error("Failed to update status: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Synchronizing Pipeline...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 font-headline tracking-tight">Funding Pipeline</h1>
          <p className="text-slate-500 text-sm mt-1">Managing {deals.length} active deals across the underwriting lifecycle.</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search deals..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl"
            />
          </div>
          <Button variant="outline" className="rounded-xl gap-2 border-slate-200 dark:border-slate-800">
            <Filter className="h-4 w-4" /> Filter
          </Button>
        </div>
      </div>

      <div className="flex-1 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-4 md:gap-2 w-full px-2">
          {STAGE_MAP.map((stage) => (
            <KanbanColumn
              key={stage.status}
              title={stage.label}
              stage={stage.status}
              colorClass={stage.color}
              count={filteredDeals.filter(d => d.pipeline_status === stage.status).length}
              onDrop={handleDrop}
            >
              {filteredDeals
                .filter(d => d.pipeline_status === stage.status)
                .map(deal => (
                  <PipelineDealCard
                    key={deal.id}
                    deal={deal}
                    onDragStart={handleDragStart}
                  />
                ))}
            </KanbanColumn>
          ))}
        </div>
      </div>
    </div>
  );
}
