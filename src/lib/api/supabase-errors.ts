/** PostgreSQL / PostgREST errors when SQL migrations are not applied yet. */
export function isSchemaMismatchError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204"
  ) {
    return true;
  }
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("schema cache")
  );
}
