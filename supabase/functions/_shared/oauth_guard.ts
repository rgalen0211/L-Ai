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
