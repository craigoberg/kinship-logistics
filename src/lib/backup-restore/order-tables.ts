import type { SchemaCatalog, SchemaConstraintRow } from "@/lib/backup-restore/schema-catalog";

/** Parse parent table from `FOREIGN KEY (...) REFERENCES parent(col)...` */
export function parentTableFromFkDefinition(definition: string): string | null {
  const m = /REFERENCES\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(/i.exec(
    definition,
  );
  return m?.[1] ?? null;
}

/**
 * Kahn topological order: parents before children using FK edges from the
 * backup schema catalog (self-learning — each backup carries the graph).
 */
export function orderTablesBySchemaCatalog(
  tables: string[],
  catalog: SchemaCatalog | null | undefined,
): string[] {
  const set = new Set(tables);
  if (!catalog?.constraints?.length) {
    return [...tables].sort((a, b) => a.localeCompare(b));
  }

  // edge: child depends on parent → parent must come first
  const dependents = new Map<string, Set<string>>(); // parent -> children
  const indegree = new Map<string, number>();
  for (const t of tables) {
    indegree.set(t, 0);
    dependents.set(t, new Set());
  }

  const fks = catalog.constraints.filter(
    (c: SchemaConstraintRow) => c.type === "f" || c.type === "FOREIGN KEY",
  );

  for (const fk of fks) {
    const child = fk.table_name;
    const parent = parentTableFromFkDefinition(fk.definition);
    if (!child || !parent || !set.has(child) || !set.has(parent) || child === parent) {
      continue;
    }
    const kids = dependents.get(parent)!;
    if (kids.has(child)) continue;
    kids.add(child);
    indegree.set(child, (indegree.get(child) ?? 0) + 1);
  }

  const queue = [...tables]
    .filter((t) => (indegree.get(t) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const ordered: string[] = [];

  while (queue.length) {
    const next = queue.shift()!;
    ordered.push(next);
    const kids = [...(dependents.get(next) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const child of kids) {
      const d = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, d);
      if (d === 0) queue.push(child);
    }
    queue.sort((a, b) => a.localeCompare(b));
  }

  // Cycles / leftover — append alphabetically
  if (ordered.length < tables.length) {
    const seen = new Set(ordered);
    for (const t of [...tables].sort((a, b) => a.localeCompare(b))) {
      if (!seen.has(t)) ordered.push(t);
    }
  }

  return ordered;
}
