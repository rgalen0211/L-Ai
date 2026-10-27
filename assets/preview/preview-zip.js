// Reads the scene bundle WORKER serves: ONE zip (stored or deflated entries) holding scene.json.gz and fonts/*.woff2.
// Browser-only decoding (DecompressionStream, Chrome 103+, Safari 16.4+, Firefox 113+); there is no fallback inflate, so an
// older browser gets a plain "update your browser" message from the panel instead of a half-working preview.
// Everything is checked before it is trusted: entry count, names (the same allow-list the worker packs by), sizes, CRC-32.
(() => {
  const MAX_ENTRIES = 64;
  const MAX_TOTAL = 120 * 1024 * 1024;           // all entries together, after decompression
  const MAX_SCENE = 200 * 1024 * 1024;           // the scene JSON after gunzip (a gzip bomb stops here)
  const NAME_OK = /^(scene\.json\.gz|fonts\/[A-Za-z0-9._-]{1,80}\.woff2)$/;

  class BundleError extends Error {}
  const fail = msg => { throw new BundleError(msg); };

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function inflate(format, bytes, limit) {
    if (typeof DecompressionStream !== 'function') fail('This browser can’t open the preview. Update it, or use a recent Chrome, Edge, Safari or Firefox.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { try { await reader.cancel(); } catch { /* already stopping */ } fail('The preview file is larger than expected.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // The central directory, read from the end of the file. No zip64, no encryption, no multi-disk: the worker writes none of them.
  function directory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('That isn’t a preview file.');
    const count = view.getUint16(eocd + 10, true);
    const size = view.getUint32(eocd + 12, true);
    const offset = view.getUint32(eocd + 16, true);
    if (count > MAX_ENTRIES) fail('The preview file has too many parts.');
    if (offset + size > eocd) fail('The preview file is damaged.');
    const entries = [];
    let p = offset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) fail('The preview file is damaged.');
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const csize = view.getUint32(p + 20, true);
      const usize = view.getUint32(p + 24, true);
      const nlen = view.getUint16(p + 28, true);
      const xlen = view.getUint16(p + 30, true);
      const clen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      if (flags & 1) fail('The preview file is encrypted.');
      if (method !== 0 && method !== 8) fail('The preview file uses a packing this page doesn’t know.');
      if (!NAME_OK.test(name)) fail(`The preview file holds something unexpected (${name.slice(0, 40)}).`);
      if (entries.some(e => e.name === name)) fail('The preview file repeats a part.');
      entries.push({ name, method, crc, csize, usize, local });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }

  // -> { 'scene.json.gz': Uint8Array, 'fonts/x.woff2': Uint8Array, ... } (still gzipped for the scene).
  async function read(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const entries = directory(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = {};
    let total = 0;
    for (const e of entries) {
      if (e.local + 30 > bytes.length || view.getUint32(e.local, true) !== 0x04034b50) fail('The preview file is damaged.');
      const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
      if (start + e.csize > bytes.length) fail('The preview file is cut short.');
      total += e.usize;
      if (total > MAX_TOTAL) fail('The preview file is larger than expected.');
      const raw = bytes.subarray(start, start + e.csize);
      const data = e.method === 0 ? raw.slice() : await inflate('deflate-raw', raw, e.usize + 1);
      if (data.length !== e.usize) fail('The preview file is damaged.');
      if (crc32(data) !== e.crc) fail('The preview file is damaged (checksum).');
      out[e.name] = data;
    }
    if (!out['scene.json.gz']) fail('The preview file has no scene in it.');
    return out;
  }

  async function sceneJson(gz) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await inflate('gzip', gz, MAX_SCENE));
    try { return JSON.parse(text); } catch { fail('The preview scene is damaged.'); }
    return null;
  }

  window.ryagramZip = { read, sceneJson, crc32, BundleError, NAME_OK };
})();
