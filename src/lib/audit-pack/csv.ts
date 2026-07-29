/** Generic CSV helpers for audit pack exports. */

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(
  headers: string[],
  rows: Array<Record<string, unknown> | Array<unknown>>,
): string {
  const lines = rows.map((row) => {
    if (Array.isArray(row)) {
      return row.map(csvEscape).join(",");
    }
    return headers.map((h) => csvEscape(row[h])).join(",");
  });
  return [headers.map(csvEscape).join(","), ...lines].join("\r\n");
}
