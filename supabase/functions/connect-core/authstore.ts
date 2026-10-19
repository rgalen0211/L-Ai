// What the authorization server needs from the database. The real one calls the connect_* functions as connect_runner
// (connect/db.ts); tests use the in-memory one in fake_authstore.ts.
export interface AuthStore {
  registerClient(name: string, redirectUris: string[]): Promise<string>;
  /** Client ID Metadata Document identity: the client_id is the (allowlisted) https address itself. The database checks the allowlist and the redirect addresses again. */
  registerCimdClient?(clientId: string, redirectUris: string[]): Promise<void>;
  beginAuthorization(a: { clientId: string; redirectUri: string; state: string | null; codeChallenge: string; method: string | null;
                          scope: string | null; resource: string | null; issuer: string }): Promise<string>;
  exchangeCode(a: { codeHash: string; clientId: string; redirectUri: string; verifier: string; accessHash: string; refreshHash: string }): Promise<Record<string, unknown>>;
  refresh(a: { refreshHash: string; clientId: string; accessHash: string; newRefreshHash: string }): Promise<Record<string, unknown>>;
  revoke(hash: string): Promise<void>;
  /** Per-caller limit for the open endpoints; the caller is a salted hash of the address, never the address. true = allowed. */
  hit(caller: string, bucket: string, max: number, windowSeconds: number): Promise<boolean>;
}
