/**
 * BL-084 A / A.1 — Manager infectious exclusion (Day Centre + Event Deliver).
 * If participant is checked_in on this surface → home-safe disposition + handover required.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldAlert } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import {
  getActiveUserProfile,
  isActiveUserManager,
  listParticipants,
} from "@/lib/data-store";
import {
  CERT_RECOMMENDED_CATEGORIES,
  declareInfectiousExclusion,
  getInfectiousInCareState,
  HOME_SAFE_DISPOSITIONS,
  INFECTION_CATEGORY_LABELS,
  type HomeSafeDisposition,
  type InfectionCategory,
  type InfectiousSurface,
} from "@/lib/api/infectious-exclusion";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { MIN_EVIDENCE, MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import { cn } from "@/lib/utils";

const CATEGORIES = Object.keys(INFECTION_CATEGORY_LABELS) as InfectionCategory[];

export type InfectiousExclusionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | {
      surface: "centre";
      siteDaySessionId: string;
      eventId?: never;
      eventDaySessionId?: never;
    }
  | {
      surface: "trip";
      eventId: string;
      eventDaySessionId: string;
      siteDaySessionId?: never;
    }
);

export function InfectiousExclusionSheet(props: InfectiousExclusionSheetProps) {
  const { open, onOpenChange, surface } = props;
  const siteDaySessionId =
    surface === "centre" ? props.siteDaySessionId : null;
  const eventId = surface === "trip" ? props.eventId : null;
  const eventDaySessionId =
    surface === "trip" ? props.eventDaySessionId : null;

  const qc = useQueryClient();
  const profile = getActiveUserProfile();
  const managerStaffId = profile?.staffId ?? "";
  const canDeclare = isActiveUserManager() && !!managerStaffId;

  const [participantId, setParticipantId] = useState<string | null>(null);
  const [category, setCategory] = useState<InfectionCategory | null>(null);
  const [notes, setNotes] = useState("");
  const [excludeCentre, setExcludeCentre] = useState(surface === "centre");
  const [excludeTrips, setExcludeTrips] = useState(surface === "trip" || true);
  const [homeDisposition, setHomeDisposition] =
    useState<HomeSafeDisposition | null>(null);
  const [handoverTo, setHandoverTo] = useState("");
  const [homeNote, setHomeNote] = useState("");
  const [pinVerified, setPinVerified] = useState(false);

  // Trip entry defaults both scopes on; centre entry defaults centre + trips.
  useEffect(() => {
    if (!open) return;
    if (surface === "centre") {
      setExcludeCentre(true);
      setExcludeTrips(true);
    } else {
      setExcludeCentre(true);
      setExcludeTrips(true);
    }
  }, [open, surface]);

  const participantsQ = useQuery({
    queryKey: ["participants-infectious-exclude"],
    queryFn: listParticipants,
    enabled: open,
    staleTime: 60_000,
  });

  const selected = useMemo(
    () => (participantsQ.data ?? []).find((p) => p.id === participantId) ?? null,
    [participantsQ.data, participantId],
  );

  const inCareQ = useQuery({
    queryKey: [
      "infectious-in-care",
      surface,
      participantId,
      siteDaySessionId,
      eventDaySessionId,
    ],
    queryFn: () =>
      getInfectiousInCareState({
        participantId: participantId!,
        surface: surface as InfectiousSurface,
        siteDaySessionId,
        eventDaySessionId,
      }),
    enabled: open && !!participantId,
    staleTime: 10_000,
  });

  const inCare = !!inCareQ.data?.inCare;
  const certRecommended =
    category != null && CERT_RECOMMENDED_CATEGORIES.has(category);

  const notesOk = notes.trim().length >= MIN_TIMELINE_NOTE;
  const handoverOk = !inCare || handoverTo.trim().length >= MIN_EVIDENCE;
  const homeOk = !inCare || (!!homeDisposition && handoverOk);
  const canSubmit =
    canDeclare &&
    !!selected &&
    !!category &&
    notesOk &&
    (excludeCentre || excludeTrips) &&
    homeOk &&
    pinVerified &&
    !inCareQ.isFetching;

  function reset() {
    setParticipantId(null);
    setCategory(null);
    setNotes("");
    setHomeDisposition(null);
    setHandoverTo("");
    setHomeNote("");
    setPinVerified(false);
  }

  const declareMut = useMutation({
    mutationFn: async () => {
      if (!selected || !category) throw new Error("Complete all fields.");
      return declareInfectiousExclusion({
        participantId: selected.id,
        participantName: selected.fullName,
        category,
        notes,
        excludeCentre,
        excludeTrips,
        surface,
        siteDaySessionId,
        eventId,
        eventDaySessionId,
        homeSafe: inCare
          ? {
              disposition: homeDisposition!,
              handoverTo,
              note: homeNote.trim() || null,
            }
          : null,
      });
    },
    onSuccess: (row) => {
      toast.success("Infectious exclusion recorded", {
        description: inCare
          ? `${row.participantName ?? "Participant"} — home safe attested; Hub Health & Safety opened.`
          : `${row.participantName ?? "Participant"} — Hub Health & Safety issue opened.`,
      });
      invalidateIssueCaches(qc, {
        sessionId: siteDaySessionId ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ["infectious-exclusions-active"] });
      qc.invalidateQueries({ queryKey: ["hub-human-incidents-feed"] });
      if (siteDaySessionId) {
        qc.invalidateQueries({
          queryKey: ["client-attendance-roll", siteDaySessionId],
        });
      }
      if (eventDaySessionId) {
        qc.invalidateQueries({
          queryKey: ["event-attendance-log", eventDaySessionId],
        });
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "event-deliver-status" });
      }
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error("Could not declare exclusion", { description: e.message });
    },
  });

  const surfaceLabel = surface === "centre" ? "Day Centre" : "Trip";
  const sheetTitle = selected
    ? `Infectious Exclusion — ${selected.fullName}`
    : "Infectious Exclusion";

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={
        <span className="inline-flex min-w-0 items-start gap-2">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <span className="text-left text-lg font-semibold leading-snug break-words">
            {sheetTitle}
          </span>
        </span>
      }
      description={`Manager only · ${surfaceLabel}. Marks not expected until Hub clearance. If they are in care now, you must attest home safe (how they left — not a route plan).`}
    >
      <div className="space-y-4">
        {!canDeclare && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Only a signed-in manager/coordinator can declare an infectious exclusion.
          </p>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Participant</Label>
          <div className="rounded-md border">
            <Command>
              <CommandInput placeholder="Search participants…" />
              <CommandList className="max-h-40">
                <CommandEmpty>No match.</CommandEmpty>
                <CommandGroup>
                  {(participantsQ.data ?? []).map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.fullName} ${p.ndisNumber}`}
                      onSelect={() => {
                        setParticipantId(p.id);
                        setHomeDisposition(null);
                        setHandoverTo("");
                        setHomeNote("");
                        setPinVerified(false);
                      }}
                      className={cn(participantId === p.id && "bg-primary/10")}
                    >
                      {p.fullName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
          {selected && (
            <p className="text-sm text-muted-foreground">
              {inCareQ.isFetching
                ? "Checking care status…"
                : inCare
                  ? "Currently in care — home safe required below."
                  : "Not in care on this floor — exclude only (no home-safe step)."}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Infection category</Label>
          <div className="grid gap-2">
            {CATEGORIES.map((c) => (
              <MobileFieldButton
                key={c}
                title={INFECTION_CATEGORY_LABELS[c]}
                active={category === c}
                onClick={() => setCategory(c)}
                tone="neutral"
              />
            ))}
          </div>
          {certRecommended && (
            <p className="text-xs text-amber-800">
              Medical certificate recommended for this category. Carer attestation
              is still allowed if policy/auditor accepts it.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Exclude from</Label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={excludeCentre}
              onCheckedChange={(v) => setExcludeCentre(v === true)}
            />
            Day Centre
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={excludeTrips}
              onCheckedChange={(v) => setExcludeTrips(v === true)}
            />
            Trips / outings
          </label>
        </div>

        <CharacterCountedTextarea
          label="Notes"
          value={notes}
          onValueChange={setNotes}
          minChars={MIN_TIMELINE_NOTE}
          rows={3}
          placeholder="Symptoms, exposure, carer advice…"
        />

        {inCare && (
          <div className="space-y-3 rounded-lg border border-emerald-300/60 bg-emerald-50/40 p-3">
            <p className="text-sm font-medium text-emerald-950">
              Home safe — they are leaving our care now
            </p>
            <p className="text-xs text-muted-foreground">
              Attest the outcome, not the route. PIN confirms a safe handover has
              occurred.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">How they left</Label>
              <div className="grid gap-2">
                {HOME_SAFE_DISPOSITIONS.map((d) => (
                  <MobileFieldButton
                    key={d.value}
                    title={d.label}
                    subtitle={d.subtitle}
                    active={homeDisposition === d.value}
                    onClick={() => setHomeDisposition(d.value)}
                    tone="success"
                  />
                ))}
              </div>
            </div>
            <CharacterCountedInput
              label="Who has them now"
              value={handoverTo}
              onValueChange={setHandoverTo}
              minChars={MIN_EVIDENCE}
              placeholder="e.g. Mum — Jane Smith"
            />
            <CharacterCountedTextarea
              label="Home-safe note (optional)"
              value={homeNote}
              onValueChange={setHomeNote}
              minChars={0}
              required={false}
              rows={2}
              placeholder="Optional detail — taxi to mum, met at gate…"
            />
          </div>
        )}

        <PinEntryTrigger
          label={
            inCare
              ? "Manager PIN — declare + home safe"
              : "Manager PIN to declare"
          }
          verified={pinVerified}
          verifiedLabel="Manager PIN verified"
          length={4}
          title="Declare infectious exclusion"
          description={
            inCare
              ? "Manager PIN confirms exclusion and that a safe handover has occurred."
              : "Manager PIN confirms this Health & Safety exclusion."
          }
          disabled={
            !canDeclare ||
            !selected ||
            !category ||
            !notesOk ||
            !homeOk ||
            inCareQ.isFetching
          }
          onVerify={async (pin) => {
            await verifyManagerPin(managerStaffId, pin);
          }}
          onSuccess={() => setPinVerified(true)}
        />

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!canSubmit || declareMut.isPending}
            onClick={() => declareMut.mutate()}
          >
            {declareMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {inCare ? "Declare + home safe" : "Declare exclusion"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
