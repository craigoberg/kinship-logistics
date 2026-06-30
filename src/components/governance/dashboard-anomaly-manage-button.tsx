import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureDashboardAnomalyIncident } from "@/lib/api/dashboard-anomalies";
import { ManageIssueDialog } from "@/components/admin/resolve-issue-dialog";
import type { UnifiedIssue } from "@/lib/api/unified-issues";

interface Props {
  anomalyKey: string;
  title: string;
  detail: string;
}

export function DashboardAnomalyManageButton({ anomalyKey, title, detail }: Props) {
  const [issue, setIssue] = useState<UnifiedIssue | null>(null);

  const mut = useMutation({
    mutationFn: () => ensureDashboardAnomalyIncident({ anomalyKey, title, detail }),
    onSuccess: (i) => setIssue(i),
    onError: (e: Error) =>
      toast.error("Could not open Hub manage", { description: e.message }),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
      >
        {mut.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
        )}
        Manage
      </Button>

      {issue && (
        <ManageIssueDialog
          key={issue.key}
          issue={issue}
          open
          onOpenChange={(o) => {
            if (!o) setIssue(null);
          }}
        />
      )}
    </>
  );
}
