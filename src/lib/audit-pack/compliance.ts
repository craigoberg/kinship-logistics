import { listComplianceAssets } from "@/lib/api/compliance-assets";
import { listOperationalLedgerInRange } from "@/lib/api/ledger";
import { rowsToCsv } from "./csv";
import { auditDate, auditDateTime } from "./format";
import {
  createAuditPdf,
  pdfAddHeading,
  pdfAddKeyValues,
  pdfAddLines,
  pdfToBytes,
} from "./pdf";
import { auditIdentity } from "./identity";
import { resolveStaffNames } from "./staff-names";
import type { AuditDateRange, AuditPackFile } from "./types";

const RESOLUTION_ACTIONS = [
  "CERTIFICATION_RESOLVED",
  "COMPLIANCE_ASSET_RESOLVED",
  "VEHICLE_MAINTENANCE_RESOLVED",
  "VEHICLE_FORMAL_AUDIT",
];

export async function assembleComplianceSection(
  range: AuditDateRange,
): Promise<{ files: AuditPackFile[]; assetCount: number }> {
  const assets = await listComplianceAssets();
  const assetsCsv = rowsToCsv(
    [
      "id",
      "category",
      "type",
      "name",
      "status",
      "expiryDate",
      "nextActionAt",
      "subjectTable",
      "subjectId",
      "updatedAt",
    ],
    assets.map((a) => ({
      id: a.id,
      category: a.category,
      type: a.type,
      name: a.name,
      status: a.status,
      expiryDate: auditDate(a.expiry_date),
      nextActionAt: auditDateTime(a.next_action_at) || auditDate(a.next_action_at),
      subjectTable: a.subject_table ?? "",
      subjectId: a.subject_id ?? "",
      updatedAt: auditDateTime(a.updated_at),
    })),
  );

  const ledger = await listOperationalLedgerInRange(
    range.from,
    range.to,
    RESOLUTION_ACTIONS,
  );
  const staffNames = await resolveStaffNames(ledger.map((r) => r.staff_id));
  const ledgerCsv = rowsToCsv(
    ["createdAt", "staff", "actionType", "severity", "metadata"],
    ledger.map((r) => ({
      createdAt: auditDateTime(r.created_at),
      staff: staffNames.get(r.staff_id) ?? auditIdentity().staffKey(r.staff_id),
      actionType: r.action_type,
      severity: r.severity,
      metadata: JSON.stringify(r.metadata ?? {}),
    })),
  );

  const overdue = assets.filter((a) => {
    if (!a.expiry_date) return false;
    return a.expiry_date < range.to && a.status !== "archived";
  });

  const doc = createAuditPdf("04 — Compliance & renewals");
  let y = 32;
  y = pdfAddKeyValues(
    doc,
    [
      [
        "Date range (resolutions)",
        `${auditDate(range.from)} → ${auditDate(range.to)}`,
      ],
      ["Assets in register", String(assets.length)],
      ["Expired / past expiry (vs pack end)", String(overdue.length)],
      ["Resolution ledger rows", String(ledger.length)],
    ],
    y,
  );
  y = pdfAddHeading(doc, "Assets (sample)", y + 2);
  const lines = assets.slice(0, 50).map(
    (a) =>
      `${a.category} · ${a.name} · ${a.status} · expiry ${auditDate(a.expiry_date) || "—"}`,
  );
  pdfAddLines(doc, lines.length ? lines : ["No compliance assets."], y);

  return {
    assetCount: assets.length,
    files: [
      { path: "04_Compliance/assets_register.csv", content: assetsCsv },
      { path: "04_Compliance/ledger_resolutions.csv", content: ledgerCsv },
      {
        path: "04_Compliance/compliance_summary.pdf",
        content: pdfToBytes(doc),
      },
    ],
  };
}
