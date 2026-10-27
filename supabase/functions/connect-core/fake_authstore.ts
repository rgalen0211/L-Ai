// An in-memory AuthStore with the same rules as the SQL (PKCE S256, single-use codes, rotating refresh tokens, exact redirect addresses),
// for tests that drive the HTTP face with a real MCP client. The SQL is the authority and has its own tests (supabase/tests/test_connect.py);
// this exists so the HTTP behaviour can be proven end to end in Node.
import type { AuthStore } from "./authstore.ts";
import type { FakeWorld } from "./fake.ts";
import type { Principal } from "./types.ts";

const bad = { error: "invalid_grant" };
const dberr = (m: string) => Object.assign(new Error(m), { code: "PT400" });

export class FakeAuthStore {
  allowed = new Set<string>();
  clients = new Map<string, { name: string; uris: string[] }>();
  requests = new Map<string, { client: string; uri: string; state: string | null; challenge: string; scopes: string[]; issuer: string }>();
  codes = new Map<string, { owner: Principal; client: string; uri: string; challenge: string; used: boolean; scopes: string[] }>();
  refreshes = new Map<string, { owner: Principal; client: string; used: boolean; scopes: string[] }>();
  n = 0;
  hits = new Map<string, number>();
  private world: FakeWorld;
  private owner: Principal;
  constructor(world: FakeWorld, owner: Principal) { this.world = world; this.owner = owner; }

  store(): AuthStore {
    return {
      registerClient: async (name, uris) => {
        for (const u of uris) if (!this.allowed.has(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) throw dberr("invalid_redirect_uri");
        const id = "rgc_" + ++this.n; this.clients.set(id, { name, uris }); return id;
      },
      beginAuthorization: async (a) => {
        const c = this.clients.get(a.clientId);
        if (!c) throw dberr("invalid_client");
        if (!c.uris.includes(a.redirectUri)) throw dberr("invalid_redirect_uri");
        if (a.method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(a.codeChallenge)) throw dberr("invalid_request");
        const id = "00000000-0000-4000-8000-" + String(++this.n).padStart(12, "0");
        this.requests.set(id, { client: a.clientId, uri: a.redirectUri, state: a.state, challenge: a.codeChallenge, scopes: ["read", "write", "render_free"], issuer: a.issuer });
        return id;
      },
      exchangeCode: async (a) => {
        const k = this.codes.get(a.codeHash);
        if (!k) return bad;
        if (k.used) return bad;
        k.used = true;
        const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.verifier)))))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        if (k.client !== a.clientId || k.uri !== a.redirectUri || challenge !== k.challenge) return bad;
        this.world.issueHash(a.accessHash, k.owner, k.scopes);
        this.refreshes.set(a.refreshHash, { owner: k.owner, client: k.client, used: false, scopes: k.scopes });
        return { scope: k.scopes.join(" "), expires_in: 3600 };
      },
      refresh: async (a) => {
        const r = this.refreshes.get(a.refreshHash);
        if (!r || r.used || r.client !== a.clientId) return bad;
        r.used = true;
        this.world.issueHash(a.accessHash, r.owner, r.scopes);
        this.refreshes.set(a.newRefreshHash, { ...r, used: false });
        return { scope: r.scopes.join(" "), expires_in: 3600 };
      },
      revoke: async () => {},
      hit: async (caller, bucket, max) => { const k = caller + bucket; this.hits.set(k, (this.hits.get(k) ?? 0) + 1); return (this.hits.get(k) ?? 0) <= max; },
    };
  }

  /** The consent page's job: the person presses Allow or Deny. Returns the address the browser is sent to. */
  async decide(requestId: string, approve: boolean): Promise<string> {
    const r = this.requests.get(requestId);
    if (!r) throw new Error("unknown request");
    const sep = r.uri.includes("?") ? "&" : "?";
    const st = (r.state === null ? "" : "&state=" + encodeURIComponent(r.state)) + "&iss=" + encodeURIComponent(r.issuer);
    if (!approve) return `${r.uri}${sep}error=access_denied${st}`;
    const code = crypto.randomUUID() + crypto.randomUUID();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))), (b) => b.toString(16).padStart(2, "0")).join("");
    this.codes.set(hash, { owner: this.owner, client: r.client, uri: r.uri, challenge: r.challenge, used: false, scopes: r.scopes });
    return `${r.uri}${sep}code=${code}${st}`;
  }
}
