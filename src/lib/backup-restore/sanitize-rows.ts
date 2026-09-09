interface PreparedRows {
  rows: Record<string, unknown>[];
  warnings: string[];
}

const CLEARANCE_ITEM_SEVERITIES = new Set(["green", "yellow", "red"]);

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * DEV CHECK `asset_clearance_items_severity_check` allows green|yellow|red (or NULL).
 * TEST walk-arounds historically persisted the local sentinel `red-verbal-cleared`.
 */
export function normalizeClearanceItemSeverity(value: unknown): {
  severity: "green" | "yellow" | "red" | null;
  changed: boolean;
  original: string | null;
} {
  if (value == null) {
    return { severity: null, changed: false, original: null };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { severity: null, changed: true, original: String(value) };
  }
  const n = raw.toLowerCase();
  if (n === "red-verbal-cleared" || n === "red_verbal_cleared") {
    return { severity: "red", changed: true, original: raw };
  }
  if (CLEARANCE_ITEM_SEVERITIES.has(n)) {
    return {
      severity: n as "green" | "yellow" | "red",
      changed: raw !== n,
      original: raw !== n ? raw : null,
    };
  }
  return { severity: null, changed: true, original: raw };
}

/** Validate / normalise rows before insert. Skips invalid records with warnings. */
export function prepareRowsForRestore(
  tableName: string,
  rows: Record<string, unknown>[],
): PreparedRows {
  const warnings: string[] = [];

  if (tableName === "asset_clearance_items") {
    const remapped: string[] = [];
    const normalised = rows.map((row) => {
      if (!("severity" in row)) return row;
      const result = normalizeClearanceItemSeverity(row.severity);
      if (result.changed && result.original != null) {
        remapped.push(
          `${String(row.id ?? "unknown")}: ${JSON.stringify(result.original)} → ${result.severity ?? "null"}`,
        );
      }
      return { ...row, severity: result.severity };
    });
    if (remapped.length) {
      warnings.push(
        `Normalised ${remapped.length} asset_clearance_items.severity value(s) to green|yellow|red|null — e.g. ${remapped[0]}`,
      );
    }
    return { rows: normalised, warnings };
  }

  if (tableName === "system_parameters") {
    const valid = rows.filter((row) => {
      const key = row.key;
      if (typeof key !== "string" || !key.trim()) {
        warnings.push("Skipped a system_parameters row with no key.");
        return false;
      }
      if (!isPresent(row.value)) {
        warnings.push(`Skipped system_parameters "${key}" — value was null or missing.`);
        return false;
      }
      if (typeof row.description !== "string" || !row.description.trim()) {
        warnings.push(`Skipped system_parameters "${key}" — description was missing.`);
        return false;
      }
      return true;
    });
    return { rows: valid, warnings };
  }

  return { rows, warnings };
}
