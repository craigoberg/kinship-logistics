import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParticipantTable } from "@/components/participants/participant-table";
import { CareProfileModal } from "@/components/participants/care-profile-modal";
import { AddParticipantModal } from "@/components/participants/add-participant-modal";
import { MedicationAdminModal } from "@/components/medication/medication-admin-modal";
import { useParticipants } from "@/hooks/use-supabase-data";
import type { Participant } from "@/lib/data-store";

export const Route = createFileRoute("/participants")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Participants — Yada Connect" },
      { name: "description", content: "Search and manage participant care profiles, NDIS IDs, and IDDSI status." },
    ],
  }),
  component: ParticipantsPage,
});

const DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Days" },
  { value: "DAY-MON", label: "Monday" },
  { value: "DAY-TUE", label: "Tuesday" },
  { value: "DAY-WED", label: "Wednesday" },
  { value: "DAY-THU", label: "Thursday" },
  { value: "DAY-FRI", label: "Friday" },
];

function ParticipantsPage() {
  const { data: participants = [], isLoading, error } = useParticipants();
  const [selected, setSelected] = useState<Participant | null>(null);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [medOpen, setMedOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dayFilter, setDayFilter] = useState("all");

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Participants directory</h2>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${participants.length} active · tap a row to open the care profile.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setMedOpen(true)} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Record medication admin
          </Button>
          <Button onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" />
            Add new participant
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or NDIS number…"
            className="h-11 pl-9"
            aria-label="Search participants"
          />
        </div>
        <Select value={dayFilter} onValueChange={setDayFilter}>
          <SelectTrigger className="h-11 w-40" aria-label="Filter by day">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load participants: {(error as Error).message}
        </div>
      )}

      <ParticipantTable
        participants={participants}
        search={search}
        dayFilter={dayFilter}
        onSelect={(p) => {
          setSelected(p);
          setOpen(true);
        }}
      />

      <CareProfileModal
        participant={selected}
        open={open}
        onOpenChange={setOpen}
      />

      <AddParticipantModal open={addOpen} onOpenChange={setAddOpen} />
      <MedicationAdminModal open={medOpen} onOpenChange={setMedOpen} participant={selected} />
    </div>
  );
}
