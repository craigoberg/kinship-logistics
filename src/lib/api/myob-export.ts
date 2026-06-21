import { supabase } from "@/integrations/supabase/client";
import { writeToLedger } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";

// ============================================================================
// MYOB Export pipeline — reads attendance_roster_logs flagged
// `billing_state='audited_ready_for_billing'`, emits a CSV, and flips rows
// to `exported` while recording a myob_export_batches row.
// ============================================================================

export interface MyobExportBatch {
  id: string;
  exportedAt: string;
  exportedBy: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  rowCount: number;
}

export async function getLastExportedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("myob_export_batches")
    .select("exported_at")
    .order("exported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.exported_at as string | undefined) ?? null;
}

export interface BillingReadyRow {
  logId: string;
  rosterDate: string;
  participantId: string;
  participantName: string;
  serviceCode: string;
  hours: number;
  rate: number;
  total: number;
  ndisCancellationReason: string | null;
}

interface BillingReadyDbRow {
  id: string;
  roster_date: string;
  participant_id: string;
  expected_service: string;
  ndis_cancellation_reason: string | null;
  billing_state: string | null;
  // Joined participant
  participants: { id: string; full_name: string } | null;
}

/**
 * Load billing-ready rows in the inclusive date range. Hours/rate/total are
 * not stored on attendance_roster_logs — they default to 1h × $0 until a
 * pricing table is wired. Override before export if needed.
 */
export async function listBillingReadyRows(
  rangeStart: string,
  rangeEnd: string,
): Promise<BillingReadyRow[]> {
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .select(
      "id, roster_date, participant_id, expected_service, ndis_cancellation_reason, billing_state, participants:participant_id ( id, full_name )",
    )
    .eq("billing_state", "audited_ready_for_billing")
    .gte("roster_date", rangeStart)
    .lte("roster_date", rangeEnd)
    .order("roster_date", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as BillingReadyDbRow[]).map((r) => ({
    logId: r.id,
    rosterDate: r.roster_date,
    participantId: r.participant_id,
    participantName: r.participants?.full_name ?? "Unknown",
    serviceCode: r.expected_service ?? "",
    hours: 1,
    rate: 0,
    total: 0,
    ndisCancellationReason: r.ndis_cancellation_reason ?? null,
  }));
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  // RFC 4180: wrap in quotes if contains comma, quote, or newline; double-up inner quotes.
  if (/[,"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(rows: BillingReadyRow[]): string {
  const header = [
    "Date",
    "Participant ID",
    "Participant Name",
    "Service Code",
    "Hours",
    "Rate",
    "Total",
    "NDIS Cancellation Reason",
  ].join(",");
  const lines = rows.map((r) =>
    [
      csvEscape(r.rosterDate),
      csvEscape(r.participantId),
      csvEscape(r.participantName),
      csvEscape(r.serviceCode),
      csvEscape(r.hours),
      csvEscape(r.rate),
      csvEscape(r.total),
      csvEscape(r.ndisCancellationReason),
    ].join(","),
  );
  return [header, ...lines].join("\r\n");
}

export function downloadCsv(csv: string, filename: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface RecordExportResult {
  batchId: string;
  rowCount: number;
}

/**
 * Record a myob_export_batches row and flip every listed log id to
 * `billing_state='exported'`. Both writes happen sequentially; the batch
 * row is the source of truth even if the bulk flip partially succeeds.
 */
export async function recordExport(
  rangeStart: string,
  rangeEnd: string,
  logIds: string[],
): Promise<RecordExportResult> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data: batch, error: batchErr } = await supabase
    .from("myob_export_batches")
    .insert({
      exported_by: userId,
      range_start: rangeStart,
      range_end: rangeEnd,
      row_count: logIds.length,
    })
    .select("id")
    .single();
  if (batchErr) throw batchErr;
  const batchId = (batch as { id: string }).id;

  if (logIds.length > 0) {
    const { error: updErr } = await supabase
      .from("attendance_roster_logs")
      .update({
        billing_state: "exported",
        exported_at: new Date().toISOString(),
        exported_batch_id: batchId,
      })
      .in("id", logIds);
    if (updErr) throw updErr;
  }

  try {
    const staffId = await resolveStaffIdWithFallback();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "INFO",
      action_type: "site_day.myob_export",
      gps_lat: null,
      gps_lng: null,
      metadata: {
        batch_id: batchId,
        range_start: rangeStart,
        range_end: rangeEnd,
        row_count: logIds.length,
      },
    });
  } catch (err) {
    console.error("[recordExport] ledger failed", err);
  }

  return { batchId, rowCount: logIds.length };
}

/**
 * Flip every finalized attendance row for today to
 * `audited_ready_for_billing`. "Finalized" = anything other than Pending.
 * Returns the number of affected rows.
 */
export async function finalizeTodaysBilling(): Promise<number> {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .update({ billing_state: "audited_ready_for_billing" })
    .eq("roster_date", today)
    .neq("actual_status", "Pending")
    .is("exported_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}
