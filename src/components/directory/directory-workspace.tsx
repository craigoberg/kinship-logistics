import { useMemo, useState } from "react";
import { Pencil, Search, UserPlus, Mail, Phone, BadgeCheck, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useStaffRegistry,
  useCarersRegistry,
  useParticipants,
} from "@/hooks/use-supabase-data";
import type { Carer, StaffMember } from "@/lib/data-store";
import { StaffFormSheet } from "./staff-form-sheet";
import { CarerFormSheet } from "./carer-form-sheet";

const EXPIRY_WARN_DAYS = 30;

type CertStatus = "permanent" | "valid" | "expiring" | "expired";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function certStatus(expiry: string | null | undefined): CertStatus {
  if (!expiry) return "permanent";
  const d = daysUntil(expiry);
  if (d === null) return "permanent";
  if (d < 0) return "expired";
  if (d <= EXPIRY_WARN_DAYS) return "expiring";
  return "valid";
}

const STATUS_BADGE: Record<CertStatus, { label: string; cls: string }> = {
  permanent: { label: "Permanent / Active", cls: "bg-emerald-600 text-white hover:bg-emerald-600" },
  valid: { label: "Valid", cls: "bg-emerald-600 text-white hover:bg-emerald-600" },
  expiring: { label: "Expiring Soon", cls: "bg-amber-500 text-black hover:bg-amber-500" },
  expired: { label: "Expired", cls: "bg-red-600 text-white hover:bg-red-600" },
};

export function DirectoryWorkspace() {
  const [tab, setTab] = useState<"staff" | "carers">("staff");
  const [staffQuery, setStaffQuery] = useState("");
  const [carerQuery, setCarerQuery] = useState("");
  const [staffOpen, setStaffOpen] = useState(false);
  const [carerOpen, setCarerOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null);
  const [editCarer, setEditCarer] = useState<Carer | null>(null);

  const { data: staff = [], isLoading: staffLoading, error: staffErr } = useStaffRegistry();
  const { data: carers = [], isLoading: carersLoading, error: carersErr } = useCarersRegistry();
  const { data: participants = [] } = useParticipants();

  const participantMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of participants) m.set(p.id, p.fullName);
    return m;
  }, [participants]);

  const filteredStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      [s.fullName, s.role ?? "", s.email ?? "", s.phone ?? "", s.personnelType ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [staff, staffQuery]);

  const filteredCarers = useMemo(() => {
    const q = carerQuery.trim().toLowerCase();
    if (!q) return carers;
    return carers.filter((c) => {
      const linked = c.participantId ? participantMap.get(c.participantId) ?? "" : "";
      return [c.fullName, c.relationship ?? "", c.email ?? "", c.phone ?? "", linked]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [carers, carerQuery, participantMap]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "staff" | "carers")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="staff">Staff &amp; Volunteers</TabsTrigger>
            <TabsTrigger value="carers">Carers &amp; Support Networks</TabsTrigger>
          </TabsList>
          {tab === "staff" ? (
            <Button
              onClick={() => {
                setEditStaff(null);
                setStaffOpen(true);
              }}
              className="gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              Add personnel
            </Button>
          ) : (
            <Button
              onClick={() => {
                setEditCarer(null);
                setCarerOpen(true);
              }}
              className="gap-1.5"
            >
              <UserPlus className="h-4 w-4" />
              Add carer
            </Button>
          )}
        </div>

        <TabsContent value="staff" className="mt-4 space-y-3">
          <SearchBar
            value={staffQuery}
            onChange={setStaffQuery}
            placeholder="Search personnel by name, role, contact…"
            count={filteredStaff.length}
          />
          {staffErr && <ErrorBox message={(staffErr as Error).message} />}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Full Name</TableHead>
                  <TableHead>Role / Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Certifications</TableHead>
                  <TableHead className="w-10 text-right" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffLoading ? (
                  <EmptyRow colSpan={6} label="Loading personnel…" />
                ) : filteredStaff.length === 0 ? (
                  <EmptyRow colSpan={6} label="No personnel found." />
                ) : (
                  filteredStaff.map((s) => {
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.fullName}</TableCell>
                        <TableCell>
                          <div className="text-sm">{s.role ?? "—"}</div>
                          {s.personnelType && (
                            <div className="text-xs text-muted-foreground">{s.personnelType}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <ContactCell phone={s.phone} email={s.email} />
                        </TableCell>
                        <TableCell>
                          {s.active ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Active</Badge>
                          ) : (
                            <Badge className="bg-slate-500 text-white hover:bg-slate-500">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <CertBadges certs={s.certifications} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditStaff(s);
                              setStaffOpen(true);
                            }}
                            aria-label={`Edit ${s.fullName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="carers" className="mt-4 space-y-3">
          <SearchBar
            value={carerQuery}
            onChange={setCarerQuery}
            placeholder="Search carers by name, relationship, linked client…"
            count={filteredCarers.length}
          />
          {carersErr && <ErrorBox message={(carersErr as Error).message} />}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Full Name</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Supports</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10 text-right" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {carersLoading ? (
                  <EmptyRow colSpan={6} label="Loading carers…" />
                ) : filteredCarers.length === 0 ? (
                  <EmptyRow colSpan={6} label="No carers recorded yet." />
                ) : (
                  filteredCarers.map((c) => {
                    const linked = c.participantId ? participantMap.get(c.participantId) : null;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.fullName}</TableCell>
                        <TableCell>{c.relationship ?? "—"}</TableCell>
                        <TableCell>
                          <ContactCell phone={c.phone} email={c.email} />
                        </TableCell>
                        <TableCell>
                          {linked ? (
                            <span className="font-medium text-foreground">{linked}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.isPrimaryContact ? (
                            <Badge className="bg-indigo-600 text-white hover:bg-indigo-600">Primary</Badge>
                          ) : (
                            <Badge variant="outline">Secondary</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditCarer(c);
                              setCarerOpen(true);
                            }}
                            aria-label={`Edit ${c.fullName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <StaffFormSheet open={staffOpen} onOpenChange={setStaffOpen} staff={editStaff} />
      <CarerFormSheet open={carerOpen} onOpenChange={setCarerOpen} carer={editCarer} />
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      <span className="text-xs text-muted-foreground">{count} record{count === 1 ? "" : "s"}</span>
    </div>
  );
}

function ContactCell({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 text-sm">
      {phone && (
        <div className="flex items-center gap-1.5 text-foreground">
          <Phone className="h-3 w-3 text-muted-foreground" />
          {phone}
        </div>
      )}
      {email && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Mail className="h-3 w-3" />
          {email}
        </div>
      )}
    </div>
  );
}

function CertBadges({ certs }: { certs: StaffCertification[] }) {
  if (!certs || certs.length === 0) {
    return <span className="text-xs text-muted-foreground">None on file</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {certs.map((c, i) => {
        const status = certStatus(c.expiry);
        const cfg = STATUS_BADGE[status];
        const Icon = status === "permanent" || status === "valid" ? BadgeCheck : AlertTriangle;
        return (
          <Badge key={i} className={`gap-1 ${cfg.cls}`} title={c.name || "Certification"}>
            <Icon className="h-3 w-3" />
            <span className="max-w-[140px] truncate">{c.name || "Certification"}</span>
            <span className="opacity-90">· {cfg.label}</span>
          </Badge>
        );
      })}
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-sm text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}
