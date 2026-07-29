import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { downloadNdisAuditPack } from "@/lib/audit-pack/build-pack";
import {
  DEFAULT_AUDIT_SECTIONS,
  defaultAuditRange,
  type AuditPackSections,
} from "@/lib/audit-pack/types";
import { getActiveUserProfile } from "@/lib/data-store";
import { parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { useAuthReady } from "@/hooks/use-auth-ready";

export function AuditPackWorkspace() {
  const { user } = useAuthReady();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const signedIn = !!user || !!profile;

  const defaults = useMemo(() => defaultAuditRange(), []);
  const [rangeStart, setRangeStart] = useState(defaults.from);
  const [rangeEnd, setRangeEnd] = useState(defaults.to);
  const [sections, setSections] = useState<AuditPackSections>({
    ...DEFAULT_AUDIT_SECTIONS,
  });
  /** BL-093 — false = named (real); true = de-identified auditor copy. */
  const [deidentified, setDeidentified] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const rangeInvalid = !rangeStart || !rangeEnd || rangeStart > rangeEnd;

  async function runExport() {
    setBusy(true);
    setProgress("Starting…");
    try {
      const result = await downloadNdisAuditPack({
        range: { from: rangeStart, to: rangeEnd },
        sections,
        identityMode: deidentified ? "deid" : "named",
        onProgress: setProgress,
      });
      toast.success(`Downloaded ${result.filename}`, {
        description: `${deidentified ? "De-identified · " : "Named · "}${result.summary.tripCount} trips · ${result.summary.incidentCount} incidents · ${result.summary.daySessionCount} day sessions`,
      });
    } catch (err) {
      console.error("[AuditPack]", err);
      toast.error("Audit pack failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            NDIS Audit Pack
          </h3>
          <p className="text-sm text-muted-foreground">
            One-click ZIP for auditors (USB-ready): incidents, Day Centre, trip
            evidence, compliance, plus reserved folders for policies and
            onboarding. Default is named (authoritative). Optional de-identified
            copy for desktop / external USB preview.
          </p>
        </div>
        <Shield className="h-5 w-5 shrink-0 text-muted-foreground" />
      </div>

      <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
        <span className="space-y-0.5">
          <span className="block font-medium">
            {deidentified
              ? "De-identified auditor copy"
              : "Named (real) — authoritative"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {deidentified
              ? "P-/S- codes instead of names. Free-text may still identify people. ZIP suffix _deid."
              : "Full participant and staff names. Archive this as the evidence of record."}
          </span>
        </span>
        <Switch
          checked={deidentified}
          onCheckedChange={setDeidentified}
          disabled={busy}
          aria-label="De-identified auditor copy"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <DatePicker
            value={parseIsoDateLocal(rangeStart)}
            onChange={(d) => setRangeStart(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <DatePicker
            value={parseIsoDateLocal(rangeEnd)}
            onChange={(d) => setRangeEnd(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["incidents", "Incidents & complaints"],
            ["dayCentre", "Day Centre"],
            ["trips", "Trips (evidence pack)"],
            ["compliance", "Compliance register"],
            ["documentStubs", "Policy / onboarding stubs"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <span>{label}</span>
            <Switch
              checked={sections[key]}
              onCheckedChange={(v) =>
                setSections((prev) => ({ ...prev, [key]: v }))
              }
              disabled={busy}
            />
          </label>
        ))}
      </div>

      {progress && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!signedIn || rangeInvalid || busy}
          onClick={() => setPinOpen(true)}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Generate ZIP
        </Button>
        {!signedIn && (
          <span className="text-xs text-muted-foreground">
            Sign in (PIN or auth) required.
          </span>
        )}
        {rangeInvalid && (
          <span className="text-xs text-destructive">Invalid date range.</span>
        )}
      </div>

      <PinEntryDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title="Authorise audit pack export"
        description="Manager / coordinator PIN required before downloading the evidence pack."
        length={4}
        onVerify={async (pin) => {
          const staffId = profile?.staffId;
          if (!staffId) {
            throw new Error("Active staff profile required for PIN step-up.");
          }
          await verifyManagerPin(staffId, pin);
        }}
        onSuccess={() => {
          setPinOpen(false);
          void runExport();
        }}
      />
    </section>
  );
}
