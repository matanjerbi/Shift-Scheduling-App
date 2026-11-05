// Shifts API — Cloudflare Worker + D1.
// Every /api request needs the shared password in the X-App-Password header.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Password',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

const fail = (msg, status = 400) => json({ error: msg }, status);

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a || '');
  const y = enc.encode(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanShift(b) {
  const s = {
    date: String(b.date || ''),
    worker_id: Number(b.worker_id),
    start_time: b.start_time ? String(b.start_time) : null,
    end_time: b.end_time ? String(b.end_time) : null,
    extra_minutes: Math.round(Number(b.extra_minutes) || 0),
    hours_override:
      b.hours_override === null || b.hours_override === undefined || b.hours_override === ''
        ? null
        : Number(b.hours_override),
    note: b.note ? String(b.note).slice(0, 500) : null,
  };
  if (!DATE_RE.test(s.date)) return { error: 'תאריך לא תקין' };
  if (!Number.isInteger(s.worker_id) || s.worker_id <= 0) return { error: 'חסר עובד' };
  if (s.start_time && !TIME_RE.test(s.start_time)) return { error: 'שעת התחלה לא תקינה' };
  if (s.end_time && !TIME_RE.test(s.end_time)) return { error: 'שעת סיום לא תקינה' };
  if (s.hours_override === null && !(s.start_time && s.end_time))
    return { error: 'צריך שעת התחלה וסיום, או סך שעות ידני' };
  if (s.hours_override !== null && !(s.hours_override >= 0 && s.hours_override <= 48))
    return { error: 'סך שעות לא תקין' };
  if (Math.abs(s.extra_minutes) > 600) return { error: 'תוספת לא תקינה' };
  return { shift: s };
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function state(db) {
  const [workers, shifts, periods, settings] = await db.batch([
    db.prepare('SELECT * FROM workers ORDER BY id'),
    db.prepare('SELECT * FROM shifts ORDER BY date DESC, start_time DESC, id DESC'),
    db.prepare('SELECT * FROM periods ORDER BY closed_at DESC, id DESC'),
    db.prepare('SELECT * FROM settings'),
  ]);
  const s = {};
  for (const r of settings.results) s[r.key] = r.value;
  return {
    workers: workers.results,
    shifts: shifts.results,
    periods: periods.results,
    settings: { default_rate: Number(s.default_rate) || 0 },
  };
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const db = env.DB;

  if (path === '/api/state' && m === 'GET') return json(await state(db));

  // Workers
  if (path === '/api/workers' && m === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return fail('חסר שם');
    const rate = b.rate === '' || b.rate == null ? null : Number(b.rate);
    await db.prepare('INSERT INTO workers (name, rate) VALUES (?, ?)').bind(name, rate).run();
    return json(await state(db));
  }
  let mm = path.match(/^\/api\/workers\/(\d+)$/);
  if (mm && m === 'PUT') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return fail('חסר שם');
    const rate = b.rate === '' || b.rate == null ? null : Number(b.rate);
    await db
      .prepare('UPDATE workers SET name = ?, rate = ?, active = ? WHERE id = ?')
      .bind(name, rate, b.active === false || b.active === 0 ? 0 : 1, Number(mm[1]))
      .run();
    return json(await state(db));
  }

  // Shifts
  if (path === '/api/shifts' && m === 'POST') {
    const { shift: s, error } = cleanShift(await readBody(req));
    if (error) return fail(error);
    await db
      .prepare(
        `INSERT INTO shifts (date, worker_id, start_time, end_time, extra_minutes, hours_override, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(s.date, s.worker_id, s.start_time, s.end_time, s.extra_minutes, s.hours_override, s.note)
      .run();
    return json(await state(db));
  }
  mm = path.match(/^\/api\/shifts\/(\d+)$/);
  if (mm && m === 'PUT') {
    const { shift: s, error } = cleanShift(await readBody(req));
    if (error) return fail(error);
    await db
      .prepare(
        `UPDATE shifts SET date=?, worker_id=?, start_time=?, end_time=?, extra_minutes=?,
         hours_override=?, note=?, updated_at=datetime('now') WHERE id=?`
      )
      .bind(s.date, s.worker_id, s.start_time, s.end_time, s.extra_minutes, s.hours_override, s.note, Number(mm[1]))
      .run();
    return json(await state(db));
  }
  if (mm && m === 'DELETE') {
    await db.prepare('DELETE FROM shifts WHERE id = ?').bind(Number(mm[1])).run();
    return json(await state(db));
  }

  // Periods (closing a batch of shifts as paid)
  if (path === '/api/periods' && m === 'POST') {
    const b = await readBody(req);
    const ids = Array.isArray(b.shift_ids) ? b.shift_ids.map(Number).filter((n) => n > 0) : [];
    if (!ids.length) return fail('לא נבחרו משמרות');
    const name = String(b.name || '').trim() || 'תקופה';
    const amount = b.amount_received === '' || b.amount_received == null ? null : Number(b.amount_received);
    const res = await db
      .prepare('INSERT INTO periods (name, amount_received, note) VALUES (?, ?, ?)')
      .bind(name, amount, b.note ? String(b.note) : null)
      .run();
    const pid = res.meta.last_row_id;
    const marks = ids.map((id) =>
      db.prepare('UPDATE shifts SET period_id = ? WHERE id = ? AND period_id IS NULL').bind(pid, id)
    );
    await db.batch(marks);
    return json(await state(db));
  }
  mm = path.match(/^\/api\/periods\/(\d+)$/);
  if (mm && m === 'PUT') {
    const b = await readBody(req);
    const amount = b.amount_received === '' || b.amount_received == null ? null : Number(b.amount_received);
    await db
      .prepare('UPDATE periods SET name = ?, amount_received = ?, note = ? WHERE id = ?')
      .bind(String(b.name || 'תקופה'), amount, b.note ? String(b.note) : null, Number(mm[1]))
      .run();
    return json(await state(db));
  }
  if (mm && m === 'DELETE') {
    // Reopen: shifts go back to "waiting for payment"
    const id = Number(mm[1]);
    await db.batch([
      db.prepare('UPDATE shifts SET period_id = NULL WHERE period_id = ?').bind(id),
      db.prepare('DELETE FROM periods WHERE id = ?').bind(id),
    ]);
    return json(await state(db));
  }

  // Settings
  if (path === '/api/settings' && m === 'PUT') {
    const b = await readBody(req);
    const rate = Number(b.default_rate);
    if (!(rate >= 0)) return fail('תעריף לא תקין');
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('default_rate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(rate))
      .run();
    return json(await state(db));
  }

  return fail('לא נמצא', 404);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api')) return json({ ok: true, service: 'shifts-api' });
    if (!env.APP_PASSWORD) return fail('הסיסמה לא הוגדרה בשרת', 500);
    if (!safeEqual(req.headers.get('X-App-Password'), env.APP_PASSWORD)) return fail('סיסמה שגויה', 401);
    try {
      return await handle(req, env);
    } catch (e) {
      return fail('שגיאת שרת: ' + (e && e.message ? e.message : e), 500);
    }
  },
};
