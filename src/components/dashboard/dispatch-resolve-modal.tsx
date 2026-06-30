import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ComplianceAsset } from "@/lib/api/compliance-assets";

interface Props {
  asset: ComplianceAsset;
  open: boolean;
  onClose: () => void;
  onEditRegistry?: () => void;
}

/**
 * Shown when a compliance_assets row points at a fleet/staff subject that
 * no longer exists. Previously this failed silently (modal open={false}).
 */
export function MissingComplianceSubjectDialog({
  asset,
  open,
  onClose,
  onEditRegistry,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Linked subject not found
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{asset.name}</span> expects a
            linked {asset.action_module.startsWith("vehicle") ? "vehicle" : "staff member"}{" "}
            (<span className="font-mono text-xs">{asset.subject_id ?? "—"}</span>) that is
            missing from the registry.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Open <strong>Manage</strong> from the Governance Hub to fix the registry link, or
          use generic fallback resolve when the shell offers it.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {onEditRegistry && (
            <Button onClick={onEditRegistry}>Edit registry…</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated Use ManageComplianceAssetDialog — kept for legacy imports. */
export function ResolveDispatcher({
  asset,
  onClose,
}: {
  asset: ComplianceAsset | null;
  onClose: () => void;
  onResolved?: () => void;
}) {
  if (!asset) return null;
  return (
    <MissingComplianceSubjectDialog
      asset={asset}
      open
      onClose={onClose}
    />
  );
}
