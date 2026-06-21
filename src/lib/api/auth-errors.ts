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
 * True ONLY for explicit session-expiration or strict HTTP 401.
 * Postgres RLS / permission / configuration errors are NOT treated as
 * auth failures; they must surface as raw system errors instead.
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
  return status === 401;
}
