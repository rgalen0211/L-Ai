// One chokepoint for Edge Functions that sign a PERSON in from a bearer token.
//
// A token issued through Ryagram's OAuth server (the AI connections) is an ordinary Supabase JWT with one extra
// claim, client_id (proved on a throwaway project, CONNECT-DESIGN.md "PROOF RESULT"). Supabase Auth's own
// /auth/v1/user accepts it, so without this check an AI vendor's stored token could reach delete-account,
// stripe-checkout, ai-editor or film-page. Every function that authenticates a user must call verifyAppUser,
// never service.auth.getUser directly; tests/connect-oauth-guard.test.mjs lists the functions and fails when one
// is missed or when a new function is added without a decision.

/** The claims of a JWT without verifying it (Supabase verifies it afterwards). null when it is not a JWT. */
export function unverifiedClaims(jwt: string): Record<string, unknown> | null {
  const parts = String(jwt).split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}

/** True for a token issued to an OAuth client (an AI connection). An app session never has client_id. */
export const isOAuthToken = (jwt: string): boolean => {
  const c = unverifiedClaims(jwt);
  return !!c && c.client_id !== undefined && c.client_id !== null;
};

export interface AuthLike {
  getUser(jwt: string): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }>;
}

/** The signed-in PERSON for an app session, or null: for an OAuth token, an invalid token, or no user. */
export async function verifyAppUser(auth: AuthLike, jwt: string): Promise<{ id: string; email: string } | null> {
  if (isOAuthToken(jwt)) return null;                 // refused before Supabase is even asked
  const { data, error } = await auth.getUser(jwt);
  return error || !data?.user ? null : { id: data.user.id, email: data.user.email ?? "" };
}

/** What the Edge Functions ask the database about a person (the service role runs public.account_is_active). */
export interface ActiveGate { isActive(userId: string): Promise<boolean> }

/** The gate over a supabase-js service client. Fails CLOSED: an error or an odd answer is "not open". */
export function activeGate(service: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }): ActiveGate {
  return {
    async isActive(userId: string) {
      const { data, error } = await service.rpc("account_is_active", { p_user: userId });
      return !error && data === true;
    },
  };
}

/**
 * The signed-in PERSON for an app session whose account is OPEN (not on the waiting list), or null: everything verifyAppUser refuses, plus a WAITING account.
 * Every Edge Function a WAITING person must NOT reach calls this instead of verifyAppUser. The two that they may reach (delete-account, claim-invite) keep verifyAppUser;
 * tests/connect-oauth-guard.test.mjs lists both groups. The database has its own gate; this one stops the service-role code paths, which the database cannot see.
 */
export async function verifyActiveUser(auth: AuthLike, jwt: string, gate: ActiveGate): Promise<{ id: string; email: string } | null> {
  const u = await verifyAppUser(auth, jwt);
  if (!u) return null;
  try { return (await gate.isActive(u.id)) ? u : null; } catch { return null; }
}
