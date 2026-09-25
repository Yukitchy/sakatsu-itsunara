// サ活いつなら？ ルーム共有API（Cloudflare Worker + KV）
// ponytail: read-modify-write（CASなし）。低頻度の家族利用が前提。競合が問題になったら
//   KVのバージョン番号を持たせてCASするか、Durable Objectへ上げる。
const PALETTE = ['#e2482d','#1a78cf','#2f9e6a','#caa62f','#8e5fd1','#d1548e','#3aa0a0','#c96b2e','#5a6a78','#2d6ae2'];
const GH_ORIGIN = 'https://yukitchy.github.io';

function corsHeaders(origin) {
  const allow = origin === GH_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin || '') ? origin : '';
  if (!allow) return {};
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function newRoom(id, name) {
  return {
    id, createdAt: Date.now(),
    people: [{ name, color: PALETTE[0] }],
    avail: { [name]: [] },
    ikitai: { [name]: [] },
    posts: [],
    target: null,
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('Origin'));
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (url.pathname === '/r' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) return json({ error: 'name required' }, 400);
      const id = typeof body.id === 'string' && /^[a-zA-Z0-9]{16}$/.test(body.id)
        ? body.id
        : crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const existing = await env.ROOMS.get(id);
      if (existing) return json(JSON.parse(existing));
      const room = newRoom(id, name);
      await env.ROOMS.put(id, JSON.stringify(room));
      return json(room);
    }

    const m = url.pathname.match(/^\/r\/([a-zA-Z0-9]{16})(\/op)?$/);
    if (!m) return json({ error: 'not found' }, 404);
    const id = m[1];

    if (req.method === 'GET' && !m[2]) {
      const raw = await env.ROOMS.get(id);
      if (!raw) return json({ error: 'not found' }, 404);
      return json(JSON.parse(raw));
    }

    if (req.method === 'POST' && m[2]) {
      const raw = await env.ROOMS.get(id);
      if (!raw) return json({ error: 'not found' }, 404);
      const room = JSON.parse(raw);
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const name = String(body.name || '').trim().slice(0, 20);
      const person = room.people.find(p => p.name === name);

      switch (body.type) {
        case 'join': {
          if (!name) return json({ error: 'name required' }, 400);
          if (!person) {
            if (room.people.length >= 10) return json({ error: 'room full' }, 400);
            room.people.push({ name, color: PALETTE[room.people.length % PALETTE.length] });
            room.avail[name] = []; room.ikitai[name] = [];
          }
          break;
        }
        case 'avail': {
          if (!person) return json({ error: 'join first' }, 400);
          const slot = String(body.slot || '').slice(0, 10);
          const set = new Set(room.avail[name] || []);
          body.on ? set.add(slot) : set.delete(slot);
          room.avail[name] = [...set];
          break;
        }
        case 'ikitai': {
          if (!person) return json({ error: 'join first' }, 400);
          const place = String(body.place || '').slice(0, 100);
          const set = new Set(room.ikitai[name] || []);
          body.on ? set.add(place) : set.delete(place);
          room.ikitai[name] = [...set];
          break;
        }
        case 'target': {
          room.target = body.place ? String(body.place).slice(0, 100) : null;
          break;
        }
        case 'post': {
          if (!person) return json({ error: 'join first' }, 400);
          const place = String(body.place || '').slice(0, 100);
          if (!place) return json({ error: 'place required' }, 400);
          const sets = String(body.sets || '').slice(0, 100);
          const note = String(body.note || '').slice(0, 100);
          const d = String(body.date || '').slice(0, 20);
          room.posts.unshift({ p: place, w: name, d, sets, t: note || '（ひとことなし）', ts: Date.now() });
          room.posts = room.posts.slice(0, 200);
          break;
        }
        default:
          return json({ error: 'unknown op' }, 400);
      }

      const out = JSON.stringify(room);
      if (out.length > 200000) return json({ error: 'room too large' }, 400);
      await env.ROOMS.put(id, out);
      return json(room);
    }

    return json({ error: 'not found' }, 404);
  },
};
