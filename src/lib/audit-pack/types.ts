/** NDIS Audit Pack — shared types (BL-061 / BL-087). */

export interface AuditDateRange {
  /** Inclusive YYYY-MM-DD */
  from: string;
  /** Inclusive YYYY-MM-DD */
  to: string;
}

export interface AuditPackSections {
  incidents: boolean;
  dayCentre: boolean;
  trips: boolean;
  compliance: boolean;
  /** Always emits stub folders; flag reserved for future real doc pull. */
  documentStubs: boolean;
}

export const DEFAULT_AUDIT_SECTIONS: AuditPackSections = {
  incidents: true,
  dayCentre: true,
  trips: true,
  compliance: true,
  documentStubs: true,
};

export type AuditPackProgressFn = (message: string) => void;

export interface AuditPackFile {
  /** Path inside ZIP, e.g. `01_Incidents_Complaints/register.csv` */
  path: string;
  content: string | Uint8Array | ArrayBuffer;
}

export interface AuditPackBuildResult {
  files: AuditPackFile[];
  filename: string;
  summary: {
    incidentCount: number;
    daySessionCount: number;
    tripCount: number;
    complianceAssetCount: number;
    documentsComplete: boolean;
  };
}

export function defaultAuditRange(): AuditDateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 3600 * 1000);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 48) || "trip"
  );
}
