// The page's side of the film API (WEB, 2026-11-13): turns the database client and the storage link into the three functions CONNECT's makeFilmApi (assets/app-film-api.js) is handed, and reads a bundle's
// manifest.json without inflating anything (the worker stores it uncompressed). The film API then gives the editor { plan(), window('A:B', { onProgress }) } (assets/app-editor-film.js).
//
//   build({ client, fileUrl, project }) -> { plan(), window(text, { onProgress }) }
//     client   the signed-in database client (rpc, from)
//     fileUrl  (path) -> Promise<signed link>   (the data layer's own fileUrl: the artifact bucket, the owner's file)
//     project  the editor's address: a version id, or a project id (then its newest version is used)
// Nothing here is shown to a person except words that came from the database's own refusals; no key, address or film data lives in this file.
(() => {
  const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  class GlueError extends Error {}
  const fail = (m, props) => { const e = new GlueError(m); Object.assign(e, props || {}); throw e; };

  // manifest.json out of a stored (uncompressed) zip entry: the central directory is read from the end; a deflated or missing manifest is refused in words.
  function manifestOf(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) fail('That is not a part of a film.');
    const count = view.getUint16(eocd + 10, true); let p = view.getUint32(eocd + 16, true);
    for (let i = 0; i < count && i < 64; i++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true), csize = view.getUint32(p + 20, true), nlen = view.getUint16(p + 28, true), elen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      if (name === 'manifest.json') {
        if (method !== 0) fail('The manifest of this part of your film is packed in a way this page does not read.');
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + csize > bytes.length || csize > 1024 * 1024) fail('The manifest of this part of your film is damaged.');
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + csize))); } catch { fail('The manifest of this part of your film is damaged.'); }
      }
      p += 46 + nlen + elen + clen;
    }
    fail('This part of your film has no manifest.');
    return null;
  }

  function build({ client, fileUrl, project, tools = window.ryagramFilmApiTools, fetchImpl = (...a) => fetch(...a) }) {
    if (!tools || typeof tools.makeFilmApi !== 'function') fail('The film reader is not loaded.');
    if (!client || typeof client.rpc !== 'function' || typeof fileUrl !== 'function') fail('The film API needs a database client and a file link.');
    let api = null;
    // The version: an address that is a version id is used as it is; otherwise it is a project, and its newest version is asked for.
    async function versionId() {
      if (typeof project !== 'string' || !UUID.test(project)) fail('Your film could not be found.');
      const own = await client.from('versions').select('id').eq('id', project).limit(1);
      if (!own.error && Array.isArray(own.data) && own.data.length) return own.data[0].id;
      const r = await client.from('versions').select('id, number').eq('project_id', project).order('number', { ascending: false }).limit(1);
      if (r.error || !Array.isArray(r.data) || !r.data.length) fail('Your film could not be found.');
      return r.data[0].id;
    }
    async function ensure() {
      if (api) return api;
      const vid = await versionId();
      api = tools.makeFilmApi({
        versionId: vid,
        request: async (v, text) => {
          const r = await client.rpc('request_film_bundle', { p_version_id: v, p_seconds: text });
          if (r.error) { const e = new Error(r.error.message || 'This part of your film could not be asked for.'); e.code = r.error.code || null; throw e; }
          return Array.isArray(r.data) ? r.data[0] : r.data;
        },
        fileUrl,
        fetchBytes: async url => { const res = await fetchImpl(url); if (!res.ok) throw new Error('This part of your film could not be downloaded.'); return new Uint8Array(await res.arrayBuffer()); },
        readManifest: manifestOf,
        jobProgress: async jobId => {                                                    // the owner's own job row: the number the worker writes while it draws (0..1), or nothing
          const r = await client.from('jobs').select('progress').eq('id', jobId).limit(1);
          const v = !r.error && Array.isArray(r.data) && r.data.length ? r.data[0].progress : null;
          return typeof v === 'number' ? v : null;
        }
      });
      return api;
    }
    return { plan: async () => (await ensure()).plan(), window: async (text, o) => (await ensure()).window(text, o) };
  }

  window.ryagramFilmGlue = { build, manifestOf, GlueError };
})();
