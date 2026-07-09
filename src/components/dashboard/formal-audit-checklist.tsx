import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import {
  listChecklistItems,
  type ChecklistItem,
  type ChecklistResponseRow,
  type ChecklistStatus,
} from "@/lib/api/checklists";
import { listStaffRegistry, type StaffMember } from "@/lib/data-store";

export interface FormalAuditState {
  /** Item id -> response. */
  responses: Record<string, { status: ChecklistStatus | null; notes: string }>;
  auditorStaffId: string;
  auditorPin: string;
  auditorPinVerified: boolean;
  witnessStaffId: string;
  witnessPin: string;
  witnessPinVerified: boolean;
}

export const emptyFormalAuditState: FormalAuditState = {
  responses: {},
  auditorStaffId: "",
  auditorPin: "",
  auditorPinVerified: false,
  witnessStaffId: "",
  witnessPin: "",
  witnessPinVerified: false,
};

interface Props {
  category: string;
  value: FormalAuditState;
  onChange: (next: FormalAuditState) => void;
  /** Reports the loaded items + a validity summary up to the parent for submit gating. */
  onItemsLoaded?: (items: ChecklistItem[]) => void;
}

export function FormalAuditChecklist({
  category,
  value,
  onChange,
  onItemsLoaded,
}: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listChecklistItems(category), listStaffRegistry()])
      .then(([its, st]) => {
        if (cancelled) return;
        setItems(its);
        setStaff(st.filter((s) => s.active));
        onItemsLoaded?.(its);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const setResponse = (
    itemId: string,
    patch: Partial<{ status: ChecklistStatus; notes: string }>,
  ) => {
    const current = value.responses[itemId] ?? { status: null, notes: "" };
    onChange({
      ...value,
      responses: {
        ...value.responses,
        [itemId]: { ...current, ...patch },
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading audit checklist…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
        Failed to load checklist: {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        No active checklist items configured for <code>{category}</code>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label className="text-sm font-semibold">Audit Checklist</Label>
        <div className="rounded-md border border-border">
          {items.map((item, idx) => {
            const resp =
              value.responses[item.id] ?? { status: null, notes: "" };
            const needsNotes = resp.status === "fail";
            const notesTooShort = needsNotes && resp.notes.trim().length < 6;
            return (
              <div
                key={item.id}
                className={cn(
                  "space-y-1.5 px-3 py-2",
                  idx !== items.length - 1 && "border-b border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium leading-tight">
                    {item.label}
                  </span>
                  <RadioGroup
                    value={resp.status ?? ""}
                    onValueChange={(v) =>
                      setResponse(item.id, { status: v as ChecklistStatus })
                    }
                    className="flex shrink-0 gap-1"
                  >
                    {(
                      [
                        { v: "pass", label: "Pass", cls: "emerald" },
                        { v: "fail", label: "Fail", cls: "rose" },
                        { v: "na", label: "N/A", cls: "slate" },
                      ] as { v: ChecklistStatus; label: string; cls: string }[]
                    ).map((opt) => (
                      <label
                        key={opt.v}
                        htmlFor={`ci-${item.id}-${opt.v}`}
                        className={cn(
                          "flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
                          resp.status === opt.v
                            ? opt.v === "pass"
                              ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                              : opt.v === "fail"
                                ? "border-rose-600 bg-rose-50 dark:bg-rose-950/30"
                                : "border-slate-500 bg-slate-100 dark:bg-slate-800/50"
                            : "border-border",
                        )}
                      >
                        <RadioGroupItem
                          id={`ci-${item.id}-${opt.v}`}
                          value={opt.v}
                          className="h-3 w-3"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
                {needsNotes && (
                  <Textarea
                    rows={2}
                    value={resp.notes}
                    onChange={(e) =>
                      setResponse(item.id, { notes: e.target.value })
                    }
                    placeholder="Describe the issue (min 6 chars, required for Fail)…"
                    className={cn(
                      "resize-none text-xs",
                      notesTooShort && "border-destructive",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Dual-PIN sign-off */}
      <div className="grid gap-2 sm:grid-cols-2">
        <PinBlock
          title="Auditor"
          staff={staff}
          staffId={value.auditorStaffId}
          pinVerified={value.auditorPinVerified}
          onChangeStaffId={(id) =>
            onChange({
              ...value,
              auditorStaffId: id,
              auditorPin: "",
              auditorPinVerified: false,
            })
          }
          onPinVerified={(pin) =>
            onChange({ ...value, auditorPin: pin, auditorPinVerified: true })
          }
          excludeStaffId={value.witnessStaffId}
        />
        <PinBlock
          title="Witness"
          staff={staff}
          staffId={value.witnessStaffId}
          pinVerified={value.witnessPinVerified}
          onChangeStaffId={(id) =>
            onChange({
              ...value,
              witnessStaffId: id,
              witnessPin: "",
              witnessPinVerified: false,
            })
          }
          onPinVerified={(pin) =>
            onChange({ ...value, witnessPin: pin, witnessPinVerified: true })
          }
          excludeStaffId={value.auditorStaffId}
        />
      </div>
      {value.auditorStaffId &&
        value.witnessStaffId &&
        value.auditorStaffId === value.witnessStaffId && (
          <p className="text-[11px] font-medium text-destructive">
            Auditor and Witness must be different staff members.
          </p>
        )}
    </div>
  );
}

function PinBlock({
  title,
  staff,
  staffId,
  pinVerified,
  onChangeStaffId,
  onPinVerified,
  excludeStaffId,
}: {
  title: string;
  staff: StaffMember[];
  staffId: string;
  pinVerified: boolean;
  onChangeStaffId: (id: string) => void;
  onPinVerified: (pin: string) => void;
  excludeStaffId: string;
}) {
  return (
    <div className="grid gap-1.5 rounded-md border border-border p-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Label>
      <select
        value={staffId}
        onChange={(e) => onChangeStaffId(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">Select staff…</option>
        {staff
          .filter((s) => s.id !== excludeStaffId)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName} · {s.role}
            </option>
          ))}
      </select>
      <PinEntryTrigger
        label="Tap to enter PIN"
        verified={pinVerified}
        verifiedLabel={`${title} PIN verified`}
        length={4}
        title={`${title} sign-off`}
        description={`Verify ${title.toLowerCase()} PIN for this formal audit.`}
        disabled={!staffId}
        className="h-10 text-sm"
        onVerify={async (pin) => {
          await verifyManagerPin(staffId, pin);
        }}
        onSuccess={onPinVerified}
      />
    </div>
  );
}

/** Helper for the parent modal: turn the working state into the payload + validity. */
export function buildFormalAuditPayload(
  items: ChecklistItem[],
  state: FormalAuditState,
): { rows: ChecklistResponseRow[]; valid: boolean } {
  const rows: ChecklistResponseRow[] = items.map((it) => {
    const r = state.responses[it.id];
    return {
      itemId: it.id,
      label: it.label,
      status: (r?.status ?? "na") as ChecklistStatus,
      notes: r?.notes?.trim() ? r.notes.trim() : null,
    };
  });
  const allMarked = items.every(
    (it) => !!state.responses[it.id]?.status,
  );
  const failsHaveNotes = items.every((it) => {
    const r = state.responses[it.id];
    if (r?.status !== "fail") return true;
    return (r.notes ?? "").trim().length >= 6;
  });
  const pinsOk =
    !!state.auditorStaffId &&
    !!state.witnessStaffId &&
    state.auditorStaffId !== state.witnessStaffId &&
    state.auditorPinVerified &&
    state.witnessPinVerified &&
    /^\d{4}$/.test(state.auditorPin) &&
    /^\d{4}$/.test(state.witnessPin);
  const valid = items.length > 0 && allMarked && failsHaveNotes && pinsOk;
  return { rows, valid };
}
