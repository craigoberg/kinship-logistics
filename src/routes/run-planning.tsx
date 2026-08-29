import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { RunRoutePanel } from "@/components/participants/run-route-panel";
import { RunPlanningPeopleTable } from "@/components/run-planning/run-planning-people-table";
import { CareProfileModal } from "@/components/participants/care-profile-modal";
import { StaffFormSheet } from "@/components/directory/staff-form-sheet";
import { CarerFormSheet } from "@/components/directory/carer-form-sheet";
import {
  useCarersRegistry,
  useParticipants,
  useStaffRegistry,
} from "@/hooks/use-supabase-data";
import type { RunPlanningPerson } from "@/lib/api/run-planning";
import { parseRoutePersonKey } from "@/lib/support-person";
import type { Carer, Participant, StaffMember } from "@/lib/data-store";

export const Route = createFileRoute("/run-planning")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Run Planning — Yada Connect" },
      {
        name: "description",
        content:
          "Office view of everyone on Day Centre buses — participants, staff, volunteers and carers.",
      },
    ],
  }),
  component: RunPlanningPage,
});

function RunPlanningPage() {
  const { data: participants = [] } = useParticipants();
  const { data: staff = [] } = useStaffRegistry();
  const { data: carers = [] } = useCarersRegistry();

  const [editParticipant, setEditParticipant] = useState<Participant | null>(null);
  const [participantOpen, setParticipantOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [editCarer, setEditCarer] = useState<Carer | null>(null);
  const [carerOpen, setCarerOpen] = useState(false);

  const onEdit = (person: RunPlanningPerson) => {
    const parsed = parseRoutePersonKey(person.personKey);
    if (person.personKind === "participant") {
      const hit = participants.find((p) => p.id === parsed.id) ?? null;
      if (!hit) {
        toast.error("Could not open that participant record");
        return;
      }
      setEditParticipant(hit);
      setParticipantOpen(true);
      return;
    }
    if (person.personKind === "carer") {
      const hit = carers.find((c) => c.id === parsed.id) ?? null;
      if (!hit) {
        toast.error("Could not open that carer record");
        return;
      }
      setEditCarer(hit);
      setCarerOpen(true);
      return;
    }
    const hit = staff.find((s) => s.id === parsed.id) ?? null;
    if (!hit) {
      toast.error("Could not open that staff record");
      return;
    }
    setEditStaff(hit);
    setStaffOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Run Planning</h2>
        <p className="text-sm text-muted-foreground">
          Everyone who comes in and out — clients, staff, volunteers and carers.
          Pencil opens the person&apos;s record to change IN/OUT. Drag the run order
          below. Ad-hoc medical runs stay on{" "}
          <Link to="/transport" className="underline underline-offset-2">
            Transport
          </Link>
          .
        </p>
      </header>

      <RunPlanningPeopleTable onEdit={onEdit} />
      <RunRoutePanel />

      <CareProfileModal
        participant={editParticipant}
        open={participantOpen}
        onOpenChange={setParticipantOpen}
        initialTab="attendance"
      />
      <StaffFormSheet open={staffOpen} onOpenChange={setStaffOpen} staff={editStaff} />
      <CarerFormSheet open={carerOpen} onOpenChange={setCarerOpen} carer={editCarer} />
    </div>
  );
}
