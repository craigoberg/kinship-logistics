/** Live schema catalog embedded in Backup format v2 (discovered each backup). */

export interface SchemaEnumRow {
  enum_name: string;
  enum_value: string;
  sort_order: number;
}

export interface SchemaColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO" | string;
  column_default: string | null;
  ordinal_position?: number;
}

export interface SchemaConstraintRow {
  constraint_name: string;
  type: string; // p | u | c | f
  table_name: string;
  definition: string;
}

export interface SchemaIndexRow {
  tablename: string;
  indexname: string;
  indexdef: string;
}

export interface SchemaFunctionRow {
  function_name: string;
  args: string;
  definition: string;
}

export interface SchemaTriggerRow {
  table_name: string;
  trigger_name: string;
  definition: string;
}

export interface SchemaPolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[] | string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

export interface SchemaCatalog {
  exportedAt?: string;
  enums: SchemaEnumRow[];
  columns: SchemaColumnRow[];
  constraints: SchemaConstraintRow[];
  indexes: SchemaIndexRow[];
  functions: SchemaFunctionRow[];
  triggers: SchemaTriggerRow[];
  policies: SchemaPolicyRow[];
}

export function isSchemaCatalog(value: unknown): value is SchemaCatalog {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<SchemaCatalog>;
  return (
    Array.isArray(c.columns) &&
    Array.isArray(c.constraints) &&
    Array.isArray(c.indexes) &&
    Array.isArray(c.functions) &&
    Array.isArray(c.triggers) &&
    Array.isArray(c.policies) &&
    Array.isArray(c.enums)
  );
}

export function schemaCatalogSummary(catalog: SchemaCatalog | null | undefined): string {
  if (!catalog) return "no schema";
  return [
    `${catalog.enums.length} enum labels`,
    `${catalog.columns.length} columns`,
    `${catalog.constraints.length} constraints`,
    `${catalog.indexes.length} indexes`,
    `${catalog.functions.length} functions`,
    `${catalog.triggers.length} triggers`,
    `${catalog.policies.length} policies`,
  ].join(", ");
}
