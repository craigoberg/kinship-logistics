import type { AuditPackFile } from "./types";

const POLICIES_README = `05 — Policies & Procedures
==========================

This folder is reserved for the organisation's approved NDIS Practice Standards
policies and procedures (Word/PDF).

Status: NOT LOADED YET
Backlog: BL-092 (review / version / SharePoint home via BL-051)

When the policy library is approved, the Audit Pack dump will include the
current approved set here. Do not invent placeholder policy content.
`;

const ONBOARDING_README = `06 — Onboarding & Training
==========================

Reserved for:
  • Signed onboarding artefacts (clients, staff, volunteers/carers)
  • Induction / training packs and registers

Status: NOT LOADED YET
Backlog: BL-065 (onboarding workflow) + BL-051 (SharePoint taxonomy)

Subfolders:
  Clients/
  Staff/
  Volunteers_Carers/

Until onboarding ships, these directories remain empty placeholders so the USB
folder shape stays stable for auditors.
`;

/** Emit reserved document library stubs (stable ZIP shape). */
export function assembleDocumentStubs(): AuditPackFile[] {
  return [
    { path: "05_Policies_Procedures/README.txt", content: POLICIES_README },
    { path: "06_Onboarding_Training/README.txt", content: ONBOARDING_README },
    { path: "06_Onboarding_Training/Clients/.gitkeep", content: "" },
    { path: "06_Onboarding_Training/Staff/.gitkeep", content: "" },
    { path: "06_Onboarding_Training/Volunteers_Carers/.gitkeep", content: "" },
  ];
}
