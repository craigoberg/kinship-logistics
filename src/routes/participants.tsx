import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ParticipantTable } from "@/components/participants/participant-table";
import { CareProfileModal } from "@/components/participants/care-profile-modal";
import { listParticipants, type Participant } from "@/lib/data-store";

export const Route = createFileRoute("/participants")({
  head: () => ({
    meta: [
      { title: "Participants — Yada Connect" },
      { name: "description", content: "Search and manage participant care profiles, NDIS IDs, and IDDSI status." },
    ],
  }),
  component: ParticipantsPage,
});

function ParticipantsPage() {
  const [participants, setParticipants] = useState<Participant[]>(() => listParticipants());
  const [selected, setSelected] = useState<Participant | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Participants directory</h2>
        <p className="text-sm text-muted-foreground">
          {participants.length} active · tap a row to open the care profile.
        </p>
      </header>

      <ParticipantTable
        participants={participants}
        onSelect={(p) => {
          setSelected(p);
          setOpen(true);
        }}
      />

      <CareProfileModal
        participant={selected}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => setParticipants(listParticipants())}
      />
    </div>
  );
}
