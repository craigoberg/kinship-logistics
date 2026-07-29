/**
 * BL-093 — Named vs de-identified auditor pack identity.
 * Default is named (real). De-id uses stable pack-local codes for joinable CSVs.
 * Free-text notes are not scrubbed in v1 — README warns.
 */

export type AuditIdentityMode = "named" | "deid";

export class AuditIdentityBook {
  readonly mode: AuditIdentityMode;
  private participantCodes = new Map<string, string>();
  private staffCodes = new Map<string, string>();
  private participantSeq = 0;
  private staffSeq = 0;

  private constructor(mode: AuditIdentityMode) {
    this.mode = mode;
  }

  static create(mode: AuditIdentityMode = "named"): AuditIdentityBook {
    return new AuditIdentityBook(mode);
  }

  get isDeid(): boolean {
    return this.mode === "deid";
  }

  participantLabel(id: string | null | undefined, realName: string): string {
    const key = (id ?? "").trim();
    if (!key) return this.isDeid ? "P-unknown" : realName;
    if (!this.isDeid) return realName || key;
    return this.ensureParticipant(key);
  }

  staffLabel(id: string | null | undefined, realName: string): string {
    const key = (id ?? "").trim();
    if (!key) return this.isDeid ? "S-unknown" : realName;
    if (!this.isDeid) return realName || key;
    return this.ensureStaff(key);
  }

  /** CSV id column — UUID in named mode, stable code in de-id. */
  participantKey(id: string | null | undefined): string {
    const key = (id ?? "").trim();
    if (!key) return "";
    if (!this.isDeid) return key;
    return this.ensureParticipant(key);
  }

  staffKey(id: string | null | undefined): string {
    const key = (id ?? "").trim();
    if (!key) return "";
    if (!this.isDeid) return key;
    return this.ensureStaff(key);
  }

  private ensureParticipant(id: string): string {
    let code = this.participantCodes.get(id);
    if (!code) {
      this.participantSeq += 1;
      code = `P-${String(this.participantSeq).padStart(3, "0")}`;
      this.participantCodes.set(id, code);
    }
    return code;
  }

  private ensureStaff(id: string): string {
    let code = this.staffCodes.get(id);
    if (!code) {
      this.staffSeq += 1;
      code = `S-${String(this.staffSeq).padStart(3, "0")}`;
      this.staffCodes.set(id, code);
    }
    return code;
  }
}

let activeBook = AuditIdentityBook.create("named");

/** Run a pack build under a given identity mode (restores previous on exit). */
export async function withAuditIdentity<T>(
  mode: AuditIdentityMode,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = activeBook;
  activeBook = AuditIdentityBook.create(mode);
  try {
    return await fn();
  } finally {
    activeBook = prev;
  }
}

export function auditIdentity(): AuditIdentityBook {
  return activeBook;
}
