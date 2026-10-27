// The consent page address the connect function sends the browser to carries the request id in the URL's HASH, not its query:
//   https://uselai.com/app/#/connect/consent?request=<uuid>      (CONNECT_CONSENT_URL, supabase/README.md "Consent page")
// URL.searchParams only sees the part before the '#', so reading it alone finds no id there. This reads the hash route first, then
// the query (a proof project may be set up with a plain query address). Only a full UUID is accepted; anything else is null.
export function requestIdFromLocation(loc, base) {
  let u;
  try { u = new URL(loc, base); } catch { return null; }
  const fromHash = u.hash.includes('?') ? new URLSearchParams(u.hash.slice(u.hash.indexOf('?') + 1)).get('request') : null;
  const id = fromHash ?? u.searchParams.get('request');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '') ? id : null;
}
