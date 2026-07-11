interface PreparedRows {
  rows: Record<string, unknown>[];
  warnings: string[];
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Validate / normalise rows before insert. Skips invalid records with warnings. */
export function prepareRowsForRestore(
  tableName: string,
  rows: Record<string, unknown>[],
): PreparedRows {
  const warnings: string[] = [];

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
