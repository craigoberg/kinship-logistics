import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { TestOnly } from "./test-only";
import { supabase } from "@/integrations/supabase/client";

interface IssueRow {
  id: string;
  session_id: string;
  severity: string;
  status: string;
  issue_description: string;
  workaround_plan: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface EscalationRow {
  id: string;
  source_issue_id: string | null;
  status: string;
  resolution_notes: string | null;
  resolved_at: string | null;
  claimed_by: string | null;
}

interface RowDiagnosis {
  issue: IssueRow;
  escalation: EscalationRow | null;
  blocking: boolean;
  reason: string;
}

function diagnose(issue: IssueRow, esc: EscalationRow | null): RowDiagnosis {
  if (issue.status === "resolved") {
    return { issue, escalation: esc, blocking: false, reason: "Issue resolved" };
  }
  if (issue.status === "workaround_accepted") {
    return {
      issue,
      escalation: esc,
      blocking: false,
      reason: "Issue status = workaround_accepted",
    };
  }
  if (issue.workaround_plan?.trim()) {
    return {
      issue,
      escalation: esc,
      blocking: false,
      reason: "Issue row has workaround_plan stored",
    };
  }
  if (esc && esc.status === "resolved_approved" && esc.resolution_notes?.trim()) {
    return {
      issue,
      escalation: esc,
      blocking: false,
      reason:
        "CARRIED — linked escalation is resolved_approved with notes (fallback workaround source). Issue row was not updated, but Day Centre now treats this as carried.",
    };
  }
  return {
    issue,
    escalation: esc,
    blocking: true,
    reason: `BLOCKING — issue status='${issue.status}', no workaround_plan, linked escalation status='${esc?.status ?? "none"}'`,
  };
}

export function DayBlockingDiagnostic({ sessionId }: { sessionId: string | null }) {
  const q = useQuery({
    queryKey: ["diag-day-blocking", sessionId ?? "none"],
    refetchInterval: 10_000,
    queryFn: async (): Promise<RowDiagnosis[]> => {
      const { data: issues, error: ierr } = await supabase
        .from("site_issues_register")
        .select(
          "id, session_id, severity, status, issue_description, workaround_plan, resolved_at, created_at",
        )
        .eq("severity", "red")
        .neq("status", "resolved")
        .order("created_at", { ascending: false });
      if (ierr) throw ierr;
      const rows = (issues ?? []) as IssueRow[];

      const ids = rows.map((r) => r.id);
      let escs: EscalationRow[] = [];
      if (ids.length) {
        const { data: e, error: eerr } = await supabase
          .from("operational_escalations")
          .select("id, source_issue_id, status, resolution_notes, resolved_at, claimed_by")
          .in("source_issue_id", ids)
          .eq("source_kind", "site_day_red")
          .order("created_at", { ascending: false });
        if (eerr) throw eerr;
        escs = (e ?? []) as EscalationRow[];
      }

      const latestByIssue = new Map<string, EscalationRow>();
      for (const e of escs) {
        if (e.source_issue_id && !latestByIssue.has(e.source_issue_id)) {
          latestByIssue.set(e.source_issue_id, e);
        }
      }

      const results = rows.map((r) => diagnose(r, latestByIssue.get(r.id) ?? null));
      // Compact console table for quick scanning
      // eslint-disable-next-line no-console
      console.table(
        results.map((r) => ({
          issue_id: r.issue.id.slice(0, 8),
          status: r.issue.status,
          workaround: r.issue.workaround_plan ? "yes" : "no",
          esc_status: r.escalation?.status ?? "—",
          esc_notes: r.escalation?.resolution_notes ? "yes" : "no",
          blocking: r.blocking ? "BLOCK" : "carry",
        })),
      );
      return results;
    },
  });

  const rows = q.data ?? [];

  return (
    <TestOnly>
      <Card className="space-y-3 border-2 border-dashed border-amber-500/60 bg-amber-500/5 p-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold uppercase tracking-wider text-amber-700">
            Diagnostic · Day Centre RED blocking
          </div>
          <div className="text-[10px] text-muted-foreground">
            session: {sessionId ?? "(none)"} · refreshes every 10s
          </div>
        </div>

        {q.isLoading && <div>Loading diagnostic…</div>}
        {q.isError && (
          <div className="text-rose-600">Error: {(q.error as Error).message}</div>
        )}
        {!q.isLoading && rows.length === 0 && (
          <div className="text-emerald-700">
            No unresolved RED issues found anywhere. Nothing should be blocking
            Start of Day.
          </div>
        )}

        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.issue.id}
              className={`rounded-md border p-2 ${
                r.blocking
                  ? "border-rose-600/50 bg-rose-600/5"
                  : "border-emerald-600/50 bg-emerald-600/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                    r.blocking ? "bg-rose-600" : "bg-emerald-600"
                  }`}
                >
                  {r.blocking ? "BLOCKING" : "CARRIED"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  issue {r.issue.id.slice(0, 8)}
                </span>
              </div>
              <div className="mt-1 font-semibold">{r.issue.issue_description}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
                <div>issue.status</div>
                <div>{r.issue.status}</div>
                <div>issue.workaround_plan</div>
                <div>{r.issue.workaround_plan ?? "null"}</div>
                <div>issue.session_id</div>
                <div className="truncate">{r.issue.session_id}</div>
                <div>esc.status</div>
                <div>{r.escalation?.status ?? "—"}</div>
                <div>esc.resolution_notes</div>
                <div className="truncate">
                  {r.escalation?.resolution_notes ?? "—"}
                </div>
                <div>esc.id</div>
                <div className="truncate">{r.escalation?.id ?? "—"}</div>
              </div>
              <div className="mt-1.5 text-[11px] font-semibold">
                Why: <span className="font-normal">{r.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </TestOnly>
  );
}
