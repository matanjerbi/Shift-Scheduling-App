// Shifts API — Cloudflare Worker + D1.
// Every /api request needs the shared password in X-App-Password.
// Each browser sends a random device id in X-Device; opens, logins and every change are logged.
// /api/admin/* also needs the admin password (stored hashed in the settings table).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Password,X-Device,X-Admin-Password',
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

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEV_RE = /^[a-zA-Z0-9_-]{8,64}$/;

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

// ---------- logging ----------
function context(req) {
  const dev = req.headers.get('X-Device') || '';
  const cf = req.cf || {};
  return {
    device: DEV_RE.test(dev) ? dev : null,
    ip: req.headers.get('CF-Connecting-IP') || null,
    city: cf.city || null,
    country: cf.country || null,
    ua: (req.headers.get('User-Agent') || '').slice(0, 300),
  };
}

function visitStmt(db, ctx, event) {
  return db
    .prepare('INSERT INTO visits (event, device_id, ip, city, country, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(event, ctx.device, ctx.ip, ctx.city, ctx.country, ctx.ua);
}

function deviceStmt(db, ctx) {
  return db
    .prepare(
      `INSERT INTO devices (id, user_agent, last_ip, last_city) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now'), user_agent = excluded.user_agent,
         last_ip = excluded.last_ip, last_city = excluded.last_city`
    )
    .bind(ctx.device, ctx.ua, ctx.ip, ctx.city);
}

async function logVisit(db, ctx, event) {
  const stmts = [visitStmt(db, ctx, event)];
  if (ctx.device) stmts.push(deviceStmt(db, ctx));
  await db.batch(stmts);
}

async function audit(db, ctx, action, entity, id, before, after) {
  await db
    .prepare(
      'INSERT INTO audit (device_id, ip, action, entity, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      ctx.device,
      ctx.ip,
      action,
      entity,
      id ?? null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    )
    .run();
}

const row = (db, table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();

async function state(db) {
  const [workers, shifts, periods, settings] = await db.batch([
    db.prepare('SELECT * FROM workers ORDER BY id'),
    db.prepare('SELECT * FROM shifts ORDER BY date DESC, start_time DESC, id DESC'),
    db.prepare('SELECT * FROM periods ORDER BY closed_at DESC, id DESC'),
    db.prepare("SELECT * FROM settings WHERE key NOT LIKE 'admin_%'"),
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

// ---------- admin ----------
async function adminCheck(db, ctx, pw) {
  const r = await db.prepare("SELECT key, value FROM settings WHERE key IN ('admin_salt','admin_hash')").all();
  const s = {};
  for (const x of r.results) s[x.key] = x.value;
  if (!s.admin_hash) return { error: 'סיסמת ניהול לא הוגדרה', status: 500 };
  // Slow down guessing: at most 10 wrong admin attempts per IP per 15 minutes
  const recent = await db
    .prepare("SELECT COUNT(*) n FROM visits WHERE event = 'admin_failed' AND ip IS ? AND ts > datetime('now', '-15 minutes')")
    .bind(ctx.ip)
    .first();
  if (recent && recent.n >= 10) return { error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה', status: 429 };
  const h = await sha256(s.admin_salt + ':' + (pw || ''));
  if (!safeEqual(h, s.admin_hash)) {
    await logVisit(db, ctx, 'admin_failed');
    return { error: 'סיסמת ניהול שגויה', status: 403 };
  }
  return { ok: true };
}

async function adminOverview(db) {
  const [devices, daily, totals] = await db.batch([
    db.prepare(
      `SELECT d.*,
         (SELECT COUNT(*) FROM visits v WHERE v.device_id = d.id AND v.event IN ('open','login')) AS opens,
         (SELECT COUNT(*) FROM visits v WHERE v.device_id = d.id AND v.event IN ('open','login') AND v.ts > datetime('now','-7 days')) AS opens7,
         (SELECT COUNT(*) FROM audit a WHERE a.device_id = d.id) AS changes
       FROM devices d ORDER BY d.last_seen DESC`
    ),
    db.prepare(
      `SELECT date(ts, '+2 hours') AS day,
         SUM(event IN ('open','login')) AS opens,
         COUNT(DISTINCT CASE WHEN event IN ('open','login') THEN device_id END) AS devices,
         SUM(event IN ('login_failed','admin_failed')) AS failed
       FROM visits WHERE ts > datetime('now','-30 days') GROUP BY day ORDER BY day`
    ),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM devices) AS devices,
         (SELECT COUNT(*) FROM visits WHERE event IN ('open','login')) AS opens,
         (SELECT COUNT(*) FROM visits WHERE event IN ('open','login') AND ts > datetime('now','-1 day')) AS opens24,
         (SELECT COUNT(DISTINCT device_id) FROM visits WHERE event IN ('open','login') AND ts > datetime('now','-7 days')) AS active7,
         (SELECT COUNT(*) FROM visits WHERE event IN ('login_failed','admin_failed') AND ts > datetime('now','-7 days')) AS failed7,
         (SELECT COUNT(*) FROM audit) AS changes,
         (SELECT COUNT(*) FROM audit WHERE ts > datetime('now','-7 days')) AS changes7`
    ),
  ]);
  return { devices: devices.results, daily: daily.results, totals: totals.results[0] };
}

async function adminLog(db, url) {
  const type = url.searchParams.get('type') || 'all';
  const dev = url.searchParams.get('device') || '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 300);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const parts = [];
  const binds = [];
  if (type === 'all' || type === 'visits' || type === 'failed') {
    let w = type === 'failed' ? "event IN ('login_failed','admin_failed')" : '1=1';
    if (dev) { w += ' AND device_id = ?'; binds.push(dev); }
    parts.push(
      `SELECT 'visit' AS kind, id, ts, device_id, ip, event AS action, NULL AS entity, NULL AS entity_id,
         NULL AS before_json, NULL AS after_json, city, country, user_agent FROM visits WHERE ${w}`
    );
  }
  if (type === 'all' || type === 'changes') {
    let w = '1=1';
    if (dev) { w += ' AND device_id = ?'; binds.push(dev); }
    parts.push(
      `SELECT 'change' AS kind, id, ts, device_id, ip, action, entity, entity_id, before_json, after_json,
         NULL AS city, NULL AS country, NULL AS user_agent FROM audit WHERE ${w}`
    );
  }
  const sql = parts.join(' UNION ALL ') + ' ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?';
  const r = await db.prepare(sql).bind(...binds, limit + 1, offset).all();
  const items = r.results.slice(0, limit);
  return { items, more: r.results.length > limit };
}

async function handleAdmin(req, env, ctx, path, m, url) {
  const db = env.DB;
  const chk = await adminCheck(db, ctx, req.headers.get('X-Admin-Password'));
  if (chk.error) return fail(chk.error, chk.status);

  if (path === '/api/admin/login' && m === 'POST') {
    await logVisit(db, ctx, 'admin_login');
    return json({ ok: true });
  }
  if (path === '/api/admin/overview' && m === 'GET') return json(await adminOverview(db));
  if (path === '/api/admin/log' && m === 'GET') return json(await adminLog(db, url));

  let mm = path.match(/^\/api\/admin\/devices\/([a-zA-Z0-9_-]+)$/);
  if (mm && m === 'PUT') {
    const b = await readBody(req);
    const label = b.label ? String(b.label).trim().slice(0, 60) : null;
    await db
      .prepare('UPDATE devices SET label = ?, blocked = ? WHERE id = ?')
      .bind(label, b.blocked ? 1 : 0, mm[1])
      .run();
    return json(await adminOverview(db));
  }
  if (path === '/api/admin/password' && m === 'PUT') {
    const b = await readBody(req);
    const pw = String(b.password || '');
    if (pw.length < 6) return fail('לפחות 6 תווים');
    const salt = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('admin_salt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(salt),
      db.prepare("INSERT INTO settings (key, value) VALUES ('admin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(await sha256(salt + ':' + pw)),
    ]);
    await audit(db, ctx, 'settings', 'admin_password', null, null, null);
    return json({ ok: true });
  }
  return fail('לא נמצא', 404);
}

// ---------- main API ----------
async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const db = env.DB;

  if (path.startsWith('/api/admin/')) return handleAdmin(req, env, ctx, path, m, url);

  // Called once per app open (event "open") and on a successful password entry (event "login")
  if (path === '/api/hello' && m === 'POST') {
    const b = await readBody(req);
    await logVisit(db, ctx, b.event === 'login' ? 'login' : 'open');
    return json(await state(db));
  }

  if (path === '/api/state' && m === 'GET') return json(await state(db));

  // Workers
  if (path === '/api/workers' && m === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return fail('חסר שם');
    const rate = b.rate === '' || b.rate == null ? null : Number(b.rate);
    const res = await db.prepare('INSERT INTO workers (name, rate) VALUES (?, ?)').bind(name, rate).run();
    const id = res.meta.last_row_id;
    await audit(db, ctx, 'create', 'worker', id, null, await row(db, 'workers', id));
    return json(await state(db));
  }
  let mm = path.match(/^\/api\/workers\/(\d+)$/);
  if (mm && m === 'PUT') {
    const id = Number(mm[1]);
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return fail('חסר שם');
    const rate = b.rate === '' || b.rate == null ? null : Number(b.rate);
    const before = await row(db, 'workers', id);
    await db
      .prepare('UPDATE workers SET name = ?, rate = ?, active = ? WHERE id = ?')
      .bind(name, rate, b.active === false || b.active === 0 ? 0 : 1, id)
      .run();
    await audit(db, ctx, 'update', 'worker', id, before, await row(db, 'workers', id));
    return json(await state(db));
  }

  // Shifts
  if (path === '/api/shifts' && m === 'POST') {
    const { shift: s, error } = cleanShift(await readBody(req));
    if (error) return fail(error);
    const res = await db
      .prepare(
        `INSERT INTO shifts (date, worker_id, start_time, end_time, extra_minutes, hours_override, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(s.date, s.worker_id, s.start_time, s.end_time, s.extra_minutes, s.hours_override, s.note)
      .run();
    const id = res.meta.last_row_id;
    await audit(db, ctx, 'create', 'shift', id, null, await row(db, 'shifts', id));
    return json(await state(db));
  }
  mm = path.match(/^\/api\/shifts\/(\d+)$/);
  if (mm && m === 'PUT') {
    const id = Number(mm[1]);
    const { shift: s, error } = cleanShift(await readBody(req));
    if (error) return fail(error);
    const before = await row(db, 'shifts', id);
    await db
      .prepare(
        `UPDATE shifts SET date=?, worker_id=?, start_time=?, end_time=?, extra_minutes=?,
         hours_override=?, note=?, updated_at=datetime('now') WHERE id=?`
      )
      .bind(s.date, s.worker_id, s.start_time, s.end_time, s.extra_minutes, s.hours_override, s.note, id)
      .run();
    await audit(db, ctx, 'update', 'shift', id, before, await row(db, 'shifts', id));
    return json(await state(db));
  }
  if (mm && m === 'DELETE') {
    const id = Number(mm[1]);
    const before = await row(db, 'shifts', id);
    await db.prepare('DELETE FROM shifts WHERE id = ?').bind(id).run();
    if (before) await audit(db, ctx, 'delete', 'shift', id, before, null);
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
    const after = { ...(await row(db, 'periods', pid)), shift_ids: ids };
    await audit(db, ctx, 'close', 'period', pid, null, after);
    return json(await state(db));
  }
  mm = path.match(/^\/api\/periods\/(\d+)$/);
  if (mm && m === 'PUT') {
    const id = Number(mm[1]);
    const b = await readBody(req);
    const amount = b.amount_received === '' || b.amount_received == null ? null : Number(b.amount_received);
    const before = await row(db, 'periods', id);
    await db
      .prepare('UPDATE periods SET name = ?, amount_received = ?, note = ? WHERE id = ?')
      .bind(String(b.name || 'תקופה'), amount, b.note ? String(b.note) : null, id)
      .run();
    await audit(db, ctx, 'update', 'period', id, before, await row(db, 'periods', id));
    return json(await state(db));
  }
  if (mm && m === 'DELETE') {
    // Reopen: shifts go back to "waiting for payment"
    const id = Number(mm[1]);
    const before = await row(db, 'periods', id);
    const shiftIds = (await db.prepare('SELECT id FROM shifts WHERE period_id = ?').bind(id).all()).results.map((r) => r.id);
    await db.batch([
      db.prepare('UPDATE shifts SET period_id = NULL WHERE period_id = ?').bind(id),
      db.prepare('DELETE FROM periods WHERE id = ?').bind(id),
    ]);
    if (before) await audit(db, ctx, 'reopen', 'period', id, { ...before, shift_ids: shiftIds }, null);
    return json(await state(db));
  }

  // Settings
  if (path === '/api/settings' && m === 'PUT') {
    const b = await readBody(req);
    const rate = Number(b.default_rate);
    if (!(rate >= 0)) return fail('תעריף לא תקין');
    const before = await db.prepare("SELECT value FROM settings WHERE key = 'default_rate'").first();
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('default_rate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(rate))
      .run();
    await audit(db, ctx, 'update', 'settings', null, { default_rate: Number(before && before.value) }, { default_rate: rate });
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
    const ctx = context(req);
    try {
      if (!safeEqual(req.headers.get('X-App-Password'), env.APP_PASSWORD)) {
        // Log only real password attempts (the login form), not every stale request
        if (url.pathname === '/api/hello') await logVisit(env.DB, ctx, 'login_failed');
        return fail('סיסמה שגויה', 401);
      }
      if (ctx.device) {
        const d = await env.DB.prepare('SELECT blocked FROM devices WHERE id = ?').bind(ctx.device).first();
        if (d && d.blocked && !url.pathname.startsWith('/api/admin/')) return fail('המכשיר הזה נחסם', 403);
      }
      return await handle(req, env, ctx);
    } catch (e) {
      return fail('שגיאת שרת: ' + (e && e.message ? e.message : e), 500);
    }
  },
};
