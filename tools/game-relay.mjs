// GAMES 11-27: a TEST-ONLY relay for the "Guess the next line" room (assets/game-room.js, kind 'relay'). It lets two browsers or test clients ON THIS COMPUTER talk as if they were
// in a live room, without Supabase. It is NEVER used on uselai.com: it listens on 127.0.0.1 only, and the page script refuses to use it unless the page is on this computer too.
// GET  /stream?room=CODE&sid=SID  a Server-Sent Events stream of every message sent in that room (the sender's own included; the client drops those by sid).
// POST /send?room=CODE&sid=SID    a JSON body up to 8192 bytes, passed on to every stream in the room as data: {"sid":..., "payload":...}.
// Rooms are in memory only: nothing is written anywhere, and they are gone when the relay stops. No dependencies.
// Run: node tools/game-relay.mjs [port]   (port 0 or none = any free port; it prints "RELAY <port>"). Stops on Ctrl+C (SIGINT) or SIGTERM.
import http from 'node:http';

const MAX_BODY = 8192;
const ROOM = /^[A-Z]{8}$/;          // GAMES 11-27: a room code is 8 letters (made from the host's key, assets/game-room.js codeOf; was 6 until the launch holds)
const SID = /^[A-Za-z0-9]{8,32}$/;
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/;
const rooms = new Map();                                   // room code -> Set of open stream responses

function cors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && LOCAL_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
}
const end = (res, status, text = '') => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(text); };

const server = http.createServer((req, res) => {
  cors(req, res);
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return end(res, 400, 'bad address'); }
  if (req.method === 'OPTIONS') return end(res, 204);
  const room = url.searchParams.get('room') || '', sid = url.searchParams.get('sid') || '';
  if ((url.pathname === '/stream' || url.pathname === '/send') && (!ROOM.test(room) || !SID.test(sid))) return end(res, 400, 'room and sid are needed');

  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': open\n\n');
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(res);
    const drop = () => { const set = rooms.get(room); if (!set) return; set.delete(res); if (!set.size) rooms.delete(room); };
    req.on('close', drop); res.on('close', drop);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    const parts = []; let size = 0, tooBig = false;
    req.on('data', chunk => {
      if (tooBig) return;
      size += chunk.length;
      if (size > MAX_BODY) { tooBig = true; end(res, 413, 'message too large'); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return;
      let payload;
      try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return end(res, 400, 'not JSON'); }
      const line = `data: ${JSON.stringify({ sid, payload })}\n\n`;
      for (const s of rooms.get(room) || []) s.write(line);
      end(res, 204);
    });
    return;
  }
  end(res, 404, 'not found');
});

server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => { console.log(`RELAY ${server.address().port}`); });

function stop() {
  for (const set of rooms.values()) for (const s of set) s.destroy();
  rooms.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
