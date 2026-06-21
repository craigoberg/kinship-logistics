// Shared helpers for spotting auth/permission failures coming from Supabase /
// PostgREST so UI layers can surface a "re-enter your PIN" recovery flow
// instead of a generic red toast.

export class AuthExpiredError extends Error {
  constructor(message = "Session expired — please re-enter your PIN.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}

/**
 * True when the error looks like an authentication / authorisation failure:
 * - HTTP 401 from PostgREST or fetch
 * - Postgres RLS rejection (SQLSTATE 42501)
 * - JWT expiry / missing claim messages
 */
export function isAuthError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof AuthExpiredError) return true;

  const anyErr = err as Record<string, unknown>;
  const status =
    typeof anyErr.status === "number"
      ? (anyErr.status as number)
      : typeof anyErr.statusCode === "number"
        ? (anyErr.statusCode as number)
        : undefined;
  if (status === 401 || status === 403) return true;

  const code = typeof anyErr.code === "string" ? anyErr.code : undefined;
  if (code === "42501" || code === "PGRST301" || code === "PGRST302") return true;

  const message =
    typeof anyErr.message === "string" ? anyErr.message.toLowerCase() : "";
  if (!message) return false;
  return (
    message.includes("row-level security") ||
    message.includes("row level security") ||
    message.includes("jwt") ||
    message.includes("unauthorized") ||
    message.includes("not authenticated")
  );
}
