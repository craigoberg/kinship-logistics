import { useEffect, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { isActiveUserManager } from "@/lib/data-store";

/**
 * Menu Access Control matrix — placeholder UI.
 *
 * Lists every top-level menu/screen against the six operational roles. Permission
 * cells are intentionally left as inert checkboxes; the wiring to a real
 * `role_menu_access` table will be added once the role/permission model is
 * finalised. Manager-only by gate.
 */

import { ACCESS_ROLES } from "@/lib/access-roles";

const ROLES = ACCESS_ROLES;


const MENUS: { key: string; label: string; description: string }[] = [
  { key: "dashboard", label: "Operations Dashboard", description: "Live exception hub and escalation pool" },
  { key: "day", label: "Day Centre", description: "Site-day workflow, anomalies, handshakes" },
  { key: "manifest", label: "Bus Manifest", description: "Driver walkaround, run sheet, dual-PIN" },
  { key: "transport", label: "Transport", description: "Ad-hoc run requests and mileage logging" },
  { key: "participants", label: "Participants", description: "Care profiles, IDDSI, medications" },
  { key: "staff", label: "Personnel Directory", description: "Staff, carers, certifications" },
  { key: "events", label: "Events & Trips", description: "Roster bookings, milestones, finance" },
  { key: "governance", label: "Governance Hub", description: "Unified issues, incident ledger, NDIS" },
  { key: "admin", label: "Admin Configuration", description: "Lookups, parameters, access matrix" },
  { key: "sync", label: "Sync Queue", description: "Offline reconciliation and replay" },
];

export function MenuAccessMatrix() {
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    setIsManager(isActiveUserManager());
  }, []);

  if (!isManager) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
        <Lock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Manager-only area</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The Menu Access Control matrix is restricted to users with the Manager role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Menu Access Control</h2>
          <p className="text-sm text-muted-foreground">
            Map each operational role to the menus they can reach. Permissions
            are placeholders for now — flesh out per role once the access model
            is signed off.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <ShieldCheck className="h-3.5 w-3.5" /> Manager-only
        </Badge>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px] sticky left-0 bg-card">Menu / Screen</TableHead>
              {ROLES.map((role) => (
                <TableHead key={role.key} className="text-center whitespace-nowrap">
                  {role.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {MENUS.map((menu) => (
              <TableRow key={menu.key}>
                <TableCell className="sticky left-0 bg-card align-top">
                  <div className="font-medium">{menu.label}</div>
                  <div className="text-xs text-muted-foreground">{menu.description}</div>
                </TableCell>
                {ROLES.map((role) => (
                  <TableCell key={role.key} className="text-center">
                    <Checkbox
                      aria-label={`${role.label} can access ${menu.label}`}
                      defaultChecked={role.key === "manager"}
                      disabled
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Editing is disabled until the permission schema is finalised. Reach out
        to the architect to wire this matrix to <code>role_menu_access</code>.
      </p>
    </div>
  );
}
