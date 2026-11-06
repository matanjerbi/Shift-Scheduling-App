/* Shifts app — single-page UI. Data lives in the Cloudflare Worker (shared by everyone). */
(function () {
  const C = window.Calc;
  const API = (window.API_URL || '').replace(/\/+$/, '');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  const S = {
    pass: LS.get('shifts.pass', ''),
    data: null,
    view: LS.get('shifts.view', 'home'),
    filterWorker: 'all',
    filterStatus: 'open',
    calc: { scope: 'open', mode: 'amount', amount: '', rate: '', exclude: [] },
    loading: false,
    syncedAt: null,
    blocked: false,
    device: (() => {
      let d = LS.get('shifts.device', '');
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(d)) {
        d = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '');
        LS.set('shifts.device', d);
      }
      return d;
    })(),
    admin: { pw: LS.get('shifts.admin', ''), tab: 'overview', overview: null, log: null, logType: 'all', logDevice: '', busy: false },
  };

  const $app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const N = (s) => `<span class="num">${s}</span>`;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---------- API ----------
  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-App-Password': S.pass, 'X-Device': S.device },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401) {
      S.pass = ''; LS.del('shifts.pass'); S.data = null; render();
      throw new Error('סיסמה שגויה');
    }
    if (res.status === 403 && data.error === 'המכשיר הזה נחסם') { S.blocked = true; render(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'שגיאה ' + res.status);
    if (data.workers) { S.data = data; S.syncedAt = new Date(); }
    return data;
  }

  async function act(method, path, body, okMsg) {
    try {
      await api(method, path, body);
      closeSheet();
      render();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  // first=true is a real app open and gets logged; refreshes are not
  async function load(first) {
    try {
      S.loading = true;
      if (first) await api('POST', '/api/hello', { event: 'open' });
      else await api('GET', '/api/state');
    } catch (e) {
      if (S.pass) toast(e.message);
    } finally {
      S.loading = false;
      render();
    }
  }

  // ---------- helpers on data ----------
  const workers = () => S.data.workers;
  const activeWorkers = () => S.data.workers.filter((w) => w.active);
  const workerById = (id) => S.data.workers.find((w) => w.id === Number(id));
  const wName = (id) => (workerById(id) || {}).name || '?';
  const rateOf = (w) => (w && w.rate !== null && w.rate !== undefined ? Number(w.rate) : S.data.settings.default_rate);
  const openShifts = () => S.data.shifts.filter((s) => !s.period_id);
  const periodShifts = (pid) => S.data.shifts.filter((s) => s.period_id === pid);
  const sumMin = (list) => list.reduce((a, s) => a + C.shiftMinutes(s), 0);
  const hoursTxt = (min) => `${N(C.fmtHM(min))} <span class="muted small">(${N(C.fmtDec(min))})</span>`;

  // ---------- toast & sheets ----------
  let toastT;
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastT);
    toastT = setTimeout(() => el.remove(), 2600);
  }
  function openSheet(html, onMount) {
    closeSheet();
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet">${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
    document.body.appendChild(bg);
    if (onMount) onMount(bg.querySelector('.sheet'));
  }
  function closeSheet() { document.querySelectorAll('.sheet-bg').forEach((b) => b.remove()); }

  // ---------- icons ----------
  const ic = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16"/></svg>',
    pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10v5M18 10v5"/></svg>',
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const TABS = [
    ['home', 'סיכום'], ['shifts', 'משמרות'], ['pay', 'תשלומים'], ['calc', 'מחשבון'], ['settings', 'הגדרות'],
  ];
  const TAB_ICON = { home: ic.home, shifts: ic.list, pay: ic.pay, calc: ic.calc, settings: ic.set };

  // ---------- render ----------
  function render() {
    if (!API) {
      $app.innerHTML = `<div class="login card"><h1>חסרה כתובת שרת</h1><p class="muted">הקובץ config.js לא הוגדר.</p></div>`;
      return;
    }
    if (S.blocked) {
      $app.innerHTML = `<div class="login card"><h1>אין גישה</h1><p class="muted">המכשיר הזה נחסם על ידי מנהל האפליקציה.</p></div>`;
      return;
    }
    if (!S.pass || !S.data) {
      if (S.pass && S.loading) { $app.innerHTML = `<div class="login"><p class="muted">טוען…</p></div>`; return; }
      return renderLogin();
    }
    const views = { home: viewHome, shifts: viewShifts, pay: viewPay, calc: viewCalc, settings: viewSettings, admin: viewAdmin };
    const body = (views[S.view] || viewHome)();
    const sync = S.syncedAt ? `עודכן ${S.syncedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
    $app.innerHTML = `
      <header><div class="row"><h1>משמרות</h1><span class="sync" onclick="App.reload()">${sync} ↻</span></div></header>
      <main>${body}</main>
      ${S.view === 'shifts' || S.view === 'home' ? `<button class="fab" onclick="App.newShift()"><span style="font-size:20px;line-height:1">+</span> משמרת</button>` : ''}
      <nav><div class="in">${TABS.map(([k, t]) => `<button class="${S.view === k || (k === 'settings' && S.view === 'admin') ? 'on' : ''}" onclick="App.go('${k}')">${TAB_ICON[k]}${t}</button>`).join('')}</div></nav>`;
    if (S.view === 'calc') bindCalc();
    if (S.view === 'admin') bindAdmin();
  }

  function renderLogin() {
    $app.innerHTML = `
      <div class="login">
        <img src="icon.svg" width="72" height="72" alt="">
        <h1>משמרות</h1>
        <p class="muted">הכניסו את הסיסמה המשותפת</p>
        <form id="lf" class="card" style="margin-top:18px">
          <input class="in" type="password" id="pw" placeholder="סיסמה" autocomplete="current-password" autofocus>
          <button class="btn primary block" style="margin-top:12px">כניסה</button>
        </form>
      </div>`;
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      S.pass = document.getElementById('pw').value.trim();
      if (!S.pass) return;
      try {
        await api('POST', '/api/hello', { event: 'login' });
        LS.set('shifts.pass', S.pass);
        render();
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- Home ----------
  function viewHome() {
    const open = openShifts();
    const openMin = sumMin(open);
    const paidMin = sumMin(S.data.shifts.filter((s) => s.period_id));
    let owed = 0;
    const per = activeWorkers().concat(workers().filter((w) => !w.active && S.data.shifts.some((s) => s.worker_id === w.id && !s.period_id)));
    const rows = per.map((w) => {
      const mine = S.data.shifts.filter((s) => s.worker_id === w.id);
      const o = sumMin(mine.filter((s) => !s.period_id));
      const p = sumMin(mine.filter((s) => s.period_id));
      const money = (o / 60) * rateOf(w);
      owed += money;
      const tot = o + p || 1;
      return `<div class="card">
        <div class="wrow">
          <div class="avatar">${esc(w.name[0] || '?')}</div>
          <div><div class="name">${esc(w.name)}</div><div class="meta">שולם ${N(C.fmtHM(p))} · תעריף ${N(C.fmtMoney(rateOf(w)))}</div></div>
          <div class="end"><div class="big" style="color:var(--open)">${N(C.fmtHM(o))}</div><div class="meta">≈ ${N(C.fmtMoney(money, 0))}</div></div>
        </div>
        <div class="bar"><i class="p" style="width:${(p / tot) * 100}%"></i><i class="o" style="width:${(o / tot) * 100}%"></i></div>
      </div>`;
    }).join('');

    const last = S.data.periods[0];
    let lastHtml = '';
    if (last) {
      const lm = sumMin(periodShifts(last.id));
      const eff = last.amount_received && lm ? last.amount_received / (lm / 60) : null;
      lastHtml = `<h2>תשלום אחרון</h2>
        <div class="card" onclick="App.period(${last.id})" style="cursor:pointer">
          <div class="wrow"><div><div class="name">${esc(last.name)}</div><div class="meta">${N(C.fmtDec(lm))} שעות</div></div>
          <div class="end"><div class="big">${N(C.fmtMoney(last.amount_received))}</div><div class="meta">${eff ? N(C.fmtMoney(eff, 2)) + ' לשעה' : 'לא הוזן סכום'}</div></div></div>
        </div>`;
    }

    return `
      <div class="hero">
        <div class="card stat open"><div class="lbl">ממתין לתשלום</div><div class="val">${N(C.fmtHM(openMin))}</div><div class="sub">${N(C.fmtDec(openMin))} שעות · ${N(open.length)} משמרות</div><div class="sub">≈ ${N(C.fmtMoney(owed, 0))} לפי תעריף</div></div>
        <div class="card stat paid"><div class="lbl">שולם עד היום</div><div class="val">${N(C.fmtHM(paidMin))}</div><div class="sub">${N(C.fmtDec(paidMin))} שעות</div><div class="sub">${N(S.data.periods.length)} תשלומים</div></div>
      </div>
      <h2>לפי עובד <span class="mini">· שעות פתוחות</span></h2>
      <div class="list">${rows || '<div class="empty">אין עובדים</div>'}</div>
      ${lastHtml}
      ${open.length ? `<div style="margin-top:16px"><button class="btn dark block" onclick="App.closePeriod()">סגירת תקופה — סימון כשולם</button></div>` : ''}`;
  }

  // ---------- Shifts ----------
  function shiftCard(s) {
    const min = C.shiftMinutes(s);
    const night = C.crossesMidnight(s.start_time, s.end_time);
    const time = s.hours_override !== null && s.hours_override !== undefined
      ? 'סך ידני'
      : `${N(s.start_time + '–' + s.end_time)}${night ? ' <span class="tag">לילה</span>' : ''}${s.extra_minutes ? ` <span class="tag">${s.extra_minutes > 0 ? '+' : ''}${N(C.fmtHM(s.extra_minutes))}</span>` : ''}`;
    return `<div class="card shift" onclick="App.editShift(${s.id})">
      <div class="avatar">${esc(wName(s.worker_id)[0] || '?')}</div>
      <div style="min-width:0"><div class="name">${esc(wName(s.worker_id))}</div>
        <div class="when">${time}</div>
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</div>
      <div class="hrs"><b>${N(C.fmtHM(min))}</b><div>${s.period_id ? '<span class="pill paid">שולם</span>' : '<span class="pill open">ממתין</span>'}</div></div>
    </div>`;
  }

  function viewShifts() {
    let list = S.data.shifts;
    if (S.filterWorker !== 'all') list = list.filter((s) => s.worker_id === Number(S.filterWorker));
    if (S.filterStatus === 'open') list = list.filter((s) => !s.period_id);
    if (S.filterStatus === 'paid') list = list.filter((s) => s.period_id);
    const byDate = {};
    for (const s of list) (byDate[s.date] = byDate[s.date] || []).push(s);
    const dates = Object.keys(byDate).sort().reverse();
    const total = sumMin(list);
    return `
      <div class="seg">${[['open', 'ממתין'], ['paid', 'שולם'], ['all', 'הכל']].map(([k, t]) => `<button class="${S.filterStatus === k ? 'on' : ''}" onclick="App.fs('${k}')">${t}</button>`).join('')}</div>
      <div class="chips" style="margin-top:10px">
        <button class="chip ${S.filterWorker === 'all' ? 'on' : ''}" onclick="App.fw('all')">כולם</button>
        ${workers().map((w) => `<button class="chip ${String(S.filterWorker) === String(w.id) ? 'on' : ''}" onclick="App.fw(${w.id})">${esc(w.name)}</button>`).join('')}
      </div>
      <div class="muted small" style="margin:12px 4px 0">${N(list.length)} משמרות · סה״כ ${hoursTxt(total)}</div>
      ${dates.length ? dates.map((d) => `<div class="day">${C.dayName(d)}, ${N(C.fmtDate(d))}</div><div class="list">${byDate[d].map(shiftCard).join('')}</div>`).join('') : '<div class="empty">אין משמרות כאן עדיין</div>'}`;
  }

  function shiftForm(s) {
    const isNew = !s;
    const last = LS.get('shifts.lastShift', {});
    s = s || { date: today(), worker_id: last.worker_id || (activeWorkers()[0] || {}).id, start_time: last.start_time || '20:00', end_time: last.end_time || '08:00', extra_minutes: 0, hours_override: null, note: '' };
    const manual = s.hours_override !== null && s.hours_override !== undefined;
    const ws = activeWorkers().concat(workers().filter((w) => !w.active && w.id === s.worker_id));
    const notes = ['תחילת הלילה', 'סוף הלילה', 'שעון חורף', 'שעון קיץ'];
    openSheet(`
      <h3>${isNew ? 'משמרת חדשה' : 'עריכת משמרת'}</h3>
      <div class="mini">היום נקבע לפי תחילת המשמרת</div>
      <label class="f">עובד</label>
      <div class="chips" id="wk">${ws.map((w) => `<button type="button" class="chip ${w.id === s.worker_id ? 'on' : ''}" data-id="${w.id}">${esc(w.name)}</button>`).join('')}</div>
      <label class="f">תאריך התחלה <span id="dn" class="muted"></span></label>
      <input class="in" type="date" id="dt" value="${esc(s.date)}">
      <div class="seg" style="margin-top:14px"><button type="button" id="m1" class="${manual ? '' : 'on'}">שעת התחלה וסיום</button><button type="button" id="m2" class="${manual ? 'on' : ''}">סך שעות ידני</button></div>
      <div id="times" style="${manual ? 'display:none' : ''}">
        <div class="row"><div><label class="f">התחלה</label><input class="in" type="time" id="st" value="${esc(s.start_time || '')}"></div>
        <div><label class="f">סיום</label><input class="in" type="time" id="en" value="${esc(s.end_time || '')}"></div></div>
        <label class="f">תוספת / הפחתה (למשל מעבר שעון)</label>
        <div class="chips" id="ex">${[[-60, '−1 שעה'], [0, 'בלי'], [60, '+1 שעה']].map(([v, t]) => `<button type="button" class="chip ${Number(s.extra_minutes) === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}
          <input class="in" id="exc" placeholder="אחר: 0:30" style="width:110px;padding:7px 10px" value="${[-60, 0, 60].includes(Number(s.extra_minutes)) ? '' : esc((s.extra_minutes < 0 ? '-' : '') + C.fmtHM(Math.abs(s.extra_minutes)))}"></div>
      </div>
      <div id="man" style="${manual ? '' : 'display:none'}">
        <label class="f">סך השעות — אפשר 12:20 או 12.33</label>
        <input class="in" id="ho" inputmode="decimal" placeholder="12:20" value="${manual ? esc(C.fmtHM(Math.round(s.hours_override * 60))) : ''}">
      </div>
      <div class="preview"><div><small>סה״כ למשמרת</small><div><b id="pv" class="num">—</b> <span id="pvd" class="muted small num"></span></div></div><div id="pvn" class="mini"></div></div>
      <label class="f">הערה</label>
      <div class="chips" id="nq" style="margin-bottom:8px">${notes.map((n) => `<button type="button" class="chip" data-n="${esc(n)}">${n}</button>`).join('')}</div>
      <textarea class="in" id="nt" placeholder="הערה חופשית">${esc(s.note || '')}</textarea>
      ${s.period_id ? `<p class="mini" style="margin-top:12px">המשמרת שייכת לתשלום סגור. עריכה תשנה את החישוב שלו.</p>` : ''}
      <div class="acts">
        ${isNew ? '' : `<button class="btn danger" id="del">מחיקה</button>`}
        <button class="btn ghost" onclick="App.close()">ביטול</button>
        <button class="btn primary" id="sv">שמירה</button>
      </div>`, (el) => {
      let worker = s.worker_id;
      let extra = Number(s.extra_minutes) || 0;
      let isManual = manual;
      const q = (id) => el.querySelector('#' + id);
      const readExtra = () => {
        const v = q('exc').value.trim();
        if (!v) return extra;
        const neg = v.startsWith('-') || v.startsWith('−');
        const h = C.parseHours(v.replace(/^[-−+]/, ''));
        return h === null ? extra : Math.round(h * 60) * (neg ? -1 : 1);
      };
      const current = () => ({
        date: q('dt').value,
        worker_id: worker,
        start_time: isManual ? null : q('st').value,
        end_time: isManual ? null : q('en').value,
        extra_minutes: isManual ? 0 : readExtra(),
        hours_override: isManual ? C.parseHours(q('ho').value) : null,
        note: q('nt').value.trim(),
      });
      const upd = () => {
        const c = current();
        q('dn').textContent = c.date ? '· יום ' + C.dayName(c.date) : '';
        const ok = isManual ? c.hours_override !== null : c.start_time && c.end_time;
        const min = ok ? C.shiftMinutes(c) : null;
        q('pv').textContent = min === null ? '—' : C.fmtHM(min);
        q('pvd').textContent = min === null ? '' : '(' + C.fmtDec(min) + ')';
        q('pvn').textContent = !isManual && C.crossesMidnight(c.start_time, c.end_time) ? 'עובר חצות ✓' : '';
      };
      el.querySelectorAll('#wk .chip').forEach((b) => b.onclick = () => { worker = Number(b.dataset.id); el.querySelectorAll('#wk .chip').forEach((x) => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('#ex .chip').forEach((b) => b.onclick = () => { extra = Number(b.dataset.v); q('exc').value = ''; el.querySelectorAll('#ex .chip').forEach((x) => x.classList.toggle('on', x === b)); upd(); });
      q('exc').oninput = () => { el.querySelectorAll('#ex .chip').forEach((x) => x.classList.remove('on')); upd(); };
      el.querySelectorAll('#nq .chip').forEach((b) => b.onclick = () => { const t = q('nt'); t.value = t.value ? t.value + ', ' + b.dataset.n : b.dataset.n; });
      q('m1').onclick = () => { isManual = false; q('m1').classList.add('on'); q('m2').classList.remove('on'); q('times').style.display = ''; q('man').style.display = 'none'; upd(); };
      q('m2').onclick = () => { isManual = true; q('m2').classList.add('on'); q('m1').classList.remove('on'); q('times').style.display = 'none'; q('man').style.display = ''; upd(); };
      ['dt', 'st', 'en', 'ho'].forEach((id) => q(id).addEventListener('input', upd));
      upd();
      q('sv').onclick = async () => {
        const c = current();
        if (!c.worker_id) return toast('בחרו עובד');
        if (isManual && c.hours_override === null) return toast('סך שעות לא תקין');
        q('sv').disabled = true;
        const ok = await act(isNew ? 'POST' : 'PUT', isNew ? '/api/shifts' : '/api/shifts/' + s.id, c, isNew ? 'המשמרת נשמרה' : 'עודכן');
        if (ok && isNew) LS.set('shifts.lastShift', { worker_id: c.worker_id, start_time: c.start_time || last.start_time, end_time: c.end_time || last.end_time });
        if (!ok) q('sv').disabled = false;
      };
      if (!isNew) q('del').onclick = () => { if (confirm('למחוק את המשמרת?')) act('DELETE', '/api/shifts/' + s.id, null, 'נמחק'); };
    });
  }

  // ---------- Payments ----------
  function periodSummary(p) {
    const list = periodShifts(p.id);
    const min = sumMin(list);
    const eff = p.amount_received && min ? p.amount_received / (min / 60) : null;
    return { list, min, eff };
  }

  function viewPay() {
    const open = openShifts();
    const ps = S.data.periods.map((p) => {
      const { list, min, eff } = periodSummary(p);
      const date = (p.closed_at || '').slice(0, 10);
      return `<div class="card" onclick="App.period(${p.id})" style="cursor:pointer">
        <div class="wrow"><div><div class="name">${esc(p.name)}</div><div class="meta">${date ? N(C.fmtDate(date)) + ' · ' : ''}${N(list.length)} משמרות · ${N(C.fmtDec(min))} שעות</div></div>
        <div class="end"><div class="big">${N(C.fmtMoney(p.amount_received))}</div><div class="meta">${eff ? N(C.fmtMoney(eff, 2)) + ' לשעה' : '—'}</div></div></div></div>`;
    }).join('');
    return `
      <div class="card">
        <div class="wrow"><div><div class="name">משמרות פתוחות</div><div class="meta">${N(open.length)} משמרות · ${hoursTxt(sumMin(open))}</div></div></div>
        <button class="btn dark block" style="margin-top:12px" ${open.length ? '' : 'disabled'} onclick="App.closePeriod()">סגירת תקופה — סימון כשולם</button>
      </div>
      <h2>תשלומים שהתקבלו</h2>
      <div class="list">${ps || '<div class="empty">עוד לא נסגרה אף תקופה</div>'}</div>`;
  }

  function splitTable(list, amount) {
    const byW = C.minutesByWorker(list);
    const rows = Object.keys(byW).map((id) => ({ key: Number(id), minutes: byW[id] }));
    const total = rows.reduce((a, r) => a + r.minutes, 0);
    const shares = amount ? C.splitAmount(amount, rows) : rows.map((r) => ({ ...r, share: null }));
    return `<table class="t"><thead><tr><th>עובד</th><th>שעות</th>${amount ? '<th class="right">חלק</th>' : ''}</tr></thead><tbody>
      ${shares.map((r) => `<tr><td>${esc(wName(r.key))}</td><td>${N(C.fmtHM(r.minutes))} <span class="muted small">${N(C.fmtDec(r.minutes))}</span></td>${amount ? `<td class="right">${N(C.fmtMoney(r.share, 2))}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot><tr><td>סה״כ</td><td>${N(C.fmtHM(total))} <span class="muted small">${N(C.fmtDec(total))}</span></td>${amount ? `<td class="right">${N(C.fmtMoney(amount, 2))}</td>` : ''}</tr></tfoot></table>`;
  }

  function closePeriodSheet() {
    const open = openShifts().slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!open.length) return toast('אין משמרות פתוחות');
    const first = open[0].date, lastD = open[open.length - 1].date;
    const defName = `${C.fmtDate(first)} – ${C.fmtDate(lastD)}`;
    openSheet(`
      <h3>סגירת תקופה</h3>
      <div class="mini">המשמרות שיסומנו יעברו ל"שולם". משמרות חדשות ייכנסו לתקופה הבאה.</div>
      <label class="f">שם התקופה</label>
      <input class="in" id="pn" value="${esc(defName)}">
      <label class="f">סכום שהתקבל בפועל (לא חובה)</label>
      <input class="in" id="pa" inputmode="decimal" placeholder="למשל 13200">
      <div class="preview"><div><small>תעריף אפקטיבי לשעה</small><div><b id="eff" class="num">—</b></div></div><div class="mini" id="hrs"></div></div>
      <label class="f">משמרות בתקופה</label>
      <div class="chips" style="margin-bottom:6px"><button type="button" class="chip" id="all">סמן הכל</button><button type="button" class="chip" id="none">נקה</button>
        ${workers().filter((w) => open.some((s) => s.worker_id === w.id)).map((w) => `<button type="button" class="chip" data-w="${w.id}">רק ${esc(w.name)}</button>`).join('')}</div>
      <div id="cl">${open.map((s) => `<label class="check"><input type="checkbox" checked data-id="${s.id}"><span class="grow">${esc(wName(s.worker_id))} · ${C.dayName(s.date)} ${N(C.fmtDate(s.date))}</span><span class="num">${C.fmtHM(C.shiftMinutes(s))}</span></label>`).join('')}</div>
      <div id="split" style="margin-top:14px"></div>
      <div class="acts"><button class="btn ghost" onclick="App.close()">ביטול</button><button class="btn primary" id="ok">סגירה ושמירה</button></div>`, (el) => {
      const q = (id) => el.querySelector('#' + id);
      const boxes = () => [...el.querySelectorAll('#cl input')];
      const sel = () => boxes().filter((b) => b.checked).map((b) => Number(b.dataset.id));
      const upd = () => {
        const ids = sel();
        const list = open.filter((s) => ids.includes(s.id));
        const min = sumMin(list);
        const amt = parseFloat(String(q('pa').value).replace(/,/g, ''));
        q('hrs').innerHTML = `${N(ids.length)} משמרות · ${N(C.fmtDec(min))} שעות`;
        q('eff').textContent = amt > 0 && min ? C.fmtMoney(amt / (min / 60), 2) : '—';
        q('split').innerHTML = list.length ? splitTable(list, amt > 0 ? amt : 0) : '';
        q('ok').textContent = `סגירה ושמירה (${ids.length})`;
      };
      el.querySelectorAll('#cl input').forEach((b) => b.onchange = upd);
      q('pa').oninput = upd;
      q('all').onclick = () => { boxes().forEach((b) => b.checked = true); upd(); };
      q('none').onclick = () => { boxes().forEach((b) => b.checked = false); upd(); };
      el.querySelectorAll('[data-w]').forEach((c) => c.onclick = () => {
        const wid = Number(c.dataset.w);
        boxes().forEach((b) => { const s = open.find((x) => x.id === Number(b.dataset.id)); b.checked = s.worker_id === wid; });
        upd();
      });
      upd();
      q('ok').onclick = () => {
        const ids = sel();
        if (!ids.length) return toast('לא נבחרו משמרות');
        const amt = parseFloat(String(q('pa').value).replace(/,/g, ''));
        act('POST', '/api/periods', { name: q('pn').value, amount_received: amt > 0 ? amt : null, shift_ids: ids }, 'התקופה נסגרה ✓');
      };
    });
  }

  function periodSheet(id) {
    const p = S.data.periods.find((x) => x.id === id);
    if (!p) return;
    const { list, min } = periodSummary(p);
    openSheet(`
      <h3>${esc(p.name)}</h3>
      <div class="mini">נסגר ב-${N(C.fmtDate((p.closed_at || '').slice(0, 10)))} · ${N(list.length)} משמרות</div>
      <label class="f">שם</label><input class="in" id="pn" value="${esc(p.name)}">
      <label class="f">סכום שהתקבל</label><input class="in" id="pa" inputmode="decimal" value="${p.amount_received ?? ''}" placeholder="לא הוזן">
      <label class="f">הערה</label><input class="in" id="pt" value="${esc(p.note || '')}">
      <div class="preview"><div><small>תעריף אפקטיבי לשעה</small><div><b id="eff" class="num">—</b></div></div><div class="mini">${N(C.fmtDec(min))} שעות</div></div>
      <div id="split" style="margin-top:14px"></div>
      <div class="acts"><button class="btn danger" id="re">פתיחה מחדש</button><button class="btn primary" id="sv">שמירה</button></div>`, (el) => {
      const q = (i) => el.querySelector('#' + i);
      const upd = () => {
        const amt = parseFloat(String(q('pa').value).replace(/,/g, ''));
        q('eff').textContent = amt > 0 && min ? C.fmtMoney(amt / (min / 60), 2) : '—';
        q('split').innerHTML = splitTable(list, amt > 0 ? amt : 0);
      };
      q('pa').oninput = upd; upd();
      q('sv').onclick = () => {
        const amt = parseFloat(String(q('pa').value).replace(/,/g, ''));
        act('PUT', '/api/periods/' + id, { name: q('pn').value, amount_received: amt > 0 ? amt : null, note: q('pt').value }, 'נשמר');
      };
      q('re').onclick = () => { if (confirm('לפתוח מחדש? המשמרות יחזרו ל"ממתין לתשלום".')) act('DELETE', '/api/periods/' + id, null, 'התקופה נפתחה מחדש'); };
    });
  }

  // ---------- Calculator ----------
  function calcScopeShifts() {
    const sc = S.calc.scope;
    let list = sc === 'open' ? openShifts() : sc === 'all' ? S.data.shifts : periodShifts(Number(sc));
    return list.filter((s) => !S.calc.exclude.includes(s.worker_id));
  }

  function viewCalc() {
    const c = S.calc;
    const ids = [...new Set((c.scope === 'open' ? openShifts() : c.scope === 'all' ? S.data.shifts : periodShifts(Number(c.scope))).map((s) => s.worker_id))];
    return `
      <div class="card">
        <label class="f" style="margin-top:0">על אילו משמרות</label>
        <select class="in" id="cs">
          <option value="open" ${c.scope === 'open' ? 'selected' : ''}>משמרות פתוחות (ממתין)</option>
          ${S.data.periods.map((p) => `<option value="${p.id}" ${String(c.scope) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          <option value="all" ${c.scope === 'all' ? 'selected' : ''}>כל המשמרות</option>
        </select>
        <label class="f">מי נכלל</label>
        <div class="chips" id="cw">${ids.map((id) => `<button class="chip ${c.exclude.includes(id) ? '' : 'on'}" data-id="${id}">${esc(wName(id))}</button>`).join('') || '<span class="muted small">אין משמרות</span>'}</div>
        <div class="seg" style="margin-top:16px"><button id="ma" class="${c.mode === 'amount' ? 'on' : ''}">יש לי סכום — לחלק</button><button id="mr" class="${c.mode === 'rate' ? 'on' : ''}">לפי תעריף לשעה</button></div>
        ${c.mode === 'amount'
          ? `<label class="f">הסכום לחלוקה</label><input class="in" id="ca" inputmode="decimal" placeholder="13200" value="${esc(c.amount)}">`
          : `<label class="f">תעריף לשעה (ריק = התעריף של כל עובד)</label><input class="in" id="cr" inputmode="decimal" placeholder="${S.data.settings.default_rate}" value="${esc(c.rate)}">`}
      </div>
      <div id="cout" style="margin-top:12px"></div>`;
  }

  function bindCalc() {
    const q = (i) => document.getElementById(i);
    const out = () => {
      const list = calcScopeShifts();
      const min = sumMin(list);
      const el = q('cout');
      if (!list.length) { el.innerHTML = '<div class="empty">אין משמרות בבחירה הזו</div>'; return; }
      if (S.calc.mode === 'amount') {
        const amt = parseFloat(String(S.calc.amount).replace(/,/g, ''));
        el.innerHTML = `<div class="hero"><div class="card stat"><div class="lbl">שעות</div><div class="val">${N(C.fmtDec(min))}</div><div class="sub">${N(C.fmtHM(min))}</div></div>
          <div class="card stat"><div class="lbl">תעריף אפקטיבי</div><div class="val">${amt > 0 ? N(C.fmtMoney(amt / (min / 60), 2)) : '—'}</div><div class="sub">לשעה</div></div></div>
          <div class="card" style="margin-top:10px">${splitTable(list, amt > 0 ? amt : 0)}</div>`;
      } else {
        const r = parseFloat(String(S.calc.rate).replace(/,/g, ''));
        const byW = C.minutesByWorker(list);
        let tot = 0;
        const rows = Object.keys(byW).map((id) => {
          const rate = r > 0 ? r : rateOf(workerById(id));
          const money = Math.round((byW[id] / 60) * rate * 100) / 100;
          tot += money;
          return `<tr><td>${esc(wName(id))}</td><td>${N(C.fmtDec(byW[id]))}</td><td>${N(C.fmtMoney(rate))}</td><td class="right">${N(C.fmtMoney(money, 2))}</td></tr>`;
        }).join('');
        el.innerHTML = `<div class="card"><table class="t"><thead><tr><th>עובד</th><th>שעות</th><th>תעריף</th><th class="right">מגיע</th></tr></thead><tbody>${rows}</tbody>
          <tfoot><tr><td>סה״כ</td><td>${N(C.fmtDec(min))}</td><td></td><td class="right">${N(C.fmtMoney(tot, 2))}</td></tr></tfoot></table></div>`;
      }
    };
    q('cs').onchange = (e) => { S.calc.scope = e.target.value; S.calc.exclude = []; render(); };
    document.querySelectorAll('#cw .chip').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.id);
      S.calc.exclude = S.calc.exclude.includes(id) ? S.calc.exclude.filter((x) => x !== id) : S.calc.exclude.concat(id);
      b.classList.toggle('on'); out();
    });
    q('ma').onclick = () => { S.calc.mode = 'amount'; render(); };
    q('mr').onclick = () => { S.calc.mode = 'rate'; render(); };
    if (q('ca')) q('ca').oninput = (e) => { S.calc.amount = e.target.value; out(); };
    if (q('cr')) q('cr').oninput = (e) => { S.calc.rate = e.target.value; out(); };
    out();
  }

  // ---------- Settings ----------
  function viewSettings() {
    return `
      <h2>תעריף ברירת מחדל</h2>
      <div class="card"><div class="row"><input class="in" id="dr" inputmode="decimal" value="${S.data.settings.default_rate}"><button class="btn primary" style="flex:none" onclick="App.saveRate()">שמירה</button></div>
        <div class="mini" style="margin-top:8px">לשעה, בשקלים. עובד עם תעריף משלו יחושב לפי התעריף שלו.</div></div>
      <h2>עובדים</h2>
      <div class="list">${workers().map((w) => `<div class="card wrow" onclick="App.worker(${w.id})" style="cursor:pointer">
        <div class="avatar">${esc(w.name[0] || '?')}</div><div><div class="name">${esc(w.name)}${w.active ? '' : ' <span class="tag">לא פעיל</span>'}</div>
        <div class="meta">${w.rate !== null && w.rate !== undefined ? 'תעריף אישי ' + N(C.fmtMoney(w.rate)) : 'תעריף ברירת מחדל'}</div></div></div>`).join('')}</div>
      <button class="btn ghost block" style="margin-top:10px" onclick="App.worker(0)">+ הוספת עובד</button>
      <h2>ניהול</h2>
      <div class="card"><button class="btn dark block" onclick="App.go('admin')">אזור ניהול — כניסות ולוגים</button></div>
      <h2>נתונים</h2>
      <div class="card stack">
        <button class="btn ghost block" onclick="App.csv()">ייצוא לאקסל (CSV)</button>
        <button class="btn danger block" onclick="App.logout()">התנתקות מהמכשיר הזה</button>
      </div>`;
  }

  function workerSheet(id) {
    const w = id ? workerById(id) : { name: '', rate: null, active: 1 };
    openSheet(`
      <h3>${id ? 'עריכת עובד' : 'עובד חדש'}</h3>
      <label class="f">שם</label><input class="in" id="wn" value="${esc(w.name)}">
      <label class="f">תעריף אישי לשעה (ריק = ברירת מחדל ${S.data.settings.default_rate})</label><input class="in" id="wr" inputmode="decimal" value="${w.rate ?? ''}">
      ${id ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="wa" ${w.active ? 'checked' : ''}><span class="grow">פעיל (מופיע בבחירת עובד)</span></label>` : ''}
      <div class="acts"><button class="btn ghost" onclick="App.close()">ביטול</button><button class="btn primary" id="sv">שמירה</button></div>`, (el) => {
      el.querySelector('#sv').onclick = () => {
        const body = { name: el.querySelector('#wn').value, rate: el.querySelector('#wr').value.trim(), active: id ? el.querySelector('#wa').checked : true };
        act(id ? 'PUT' : 'POST', id ? '/api/workers/' + id : '/api/workers', body, 'נשמר');
      };
    });
  }

  function exportCsv() {
    const periodName = (pid) => (S.data.periods.find((p) => p.id === pid) || {}).name || '';
    const rows = [['תאריך', 'יום', 'עובד', 'התחלה', 'סיום', 'תוספת (דקות)', 'שעות', 'שעות עשרוני', 'סטטוס', 'תקופה', 'הערה']];
    S.data.shifts.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((s) => {
      const m = C.shiftMinutes(s);
      rows.push([C.fmtDate(s.date), C.dayName(s.date), wName(s.worker_id), s.start_time || '', s.end_time || '', s.extra_minutes || 0, C.fmtHM(m), C.fmtDec(m), s.period_id ? 'שולם' : 'ממתין', periodName(s.period_id), s.note || '']);
    });
    const csv = '﻿' + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `shifts-${today()}.csv`;
    a.click();
  }

  // ---------- Admin ----------
  const A = S.admin;

  async function adminApi(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-App-Password': S.pass, 'X-Device': S.device, 'X-Admin-Password': A.pw },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 403 || res.status === 429) {
      if (res.status === 403) { A.pw = ''; LS.del('shifts.admin'); A.overview = null; A.log = null; }
      render();
      throw new Error(data.error || 'אין הרשאה');
    }
    if (!res.ok) throw new Error(data.error || 'שגיאה ' + res.status);
    return data;
  }

  function parseUA(ua) {
    ua = ua || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'מכשיר';
    const br = /SamsungBrowser/.test(ua) ? 'Samsung' : /EdgA?\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
      : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
    let model = '';
    const m = /Android [\d.]+; ([^;)]+)\)/.exec(ua);
    if (m && !/^K$/.test(m[1].trim())) model = m[1].trim();
    return { os, br, model, text: [os, model, br].filter(Boolean).join(' · ') };
  }
  const devMap = () => {
    const out = {};
    for (const d of (A.overview && A.overview.devices) || []) out[d.id] = d;
    return out;
  };
  function devName(id, ua) {
    if (!id) return 'מכשיר לא מזוהה';
    const d = devMap()[id];
    if (d && d.label) return d.label;
    const p = parseUA((d && d.user_agent) || ua);
    return p.text + ' #' + id.slice(0, 4);
  }
  const isMe = (id) => id === S.device;

  const toDate = (ts) => new Date(String(ts).replace(' ', 'T') + 'Z');
  function fmtTs(ts) {
    const d = toDate(ts);
    return d.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts) {
    const s = (Date.now() - toDate(ts).getTime()) / 1000;
    if (s < 60) return 'עכשיו';
    if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`;
    if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע׳`;
    if (s < 86400 * 7) return `לפני ${Math.floor(s / 86400)} ימים`;
    return fmtTs(ts);
  }

  const FIELD = {
    date: 'תאריך', worker_id: 'עובד', start_time: 'התחלה', end_time: 'סיום', extra_minutes: 'תוספת',
    hours_override: 'סך ידני', note: 'הערה', period_id: 'תשלום', name: 'שם', rate: 'תעריף', active: 'פעיל',
    amount_received: 'סכום', default_rate: 'תעריף ברירת מחדל',
  };
  function fieldVal(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'worker_id') return wName(v);
    if (k === 'date') return C.dayName(v) + ' ' + C.fmtDate(v);
    if (k === 'extra_minutes') return (v > 0 ? '+' : '') + C.fmtHM(v);
    if (k === 'hours_override') return C.fmtHM(Math.round(v * 60));
    if (k === 'period_id') return 'שולם';
    if (k === 'rate' || k === 'amount_received' || k === 'default_rate') return C.fmtMoney(Number(v));
    if (k === 'active') return v ? 'כן' : 'לא';
    return String(v);
  }
  function shiftLine(s) {
    if (!s) return '';
    const t = s.hours_override !== null && s.hours_override !== undefined ? 'סך ידני' : `${s.start_time}–${s.end_time}`;
    return `${wName(s.worker_id)} · ${C.dayName(s.date)} ${C.fmtDate(s.date)} · ${t} (${C.fmtHM(C.shiftMinutes(s))})`;
  }
  const VERB = { create: 'הוסיף', update: 'עדכן', delete: 'מחק', close: 'סגר', reopen: 'פתח מחדש', settings: 'שינה' };
  const NOUN = { shift: 'משמרת', worker: 'עובד', period: 'תקופת תשלום', settings: 'הגדרות', admin_password: 'סיסמת ניהול' };

  function describe(it) {
    if (it.kind === 'visit') {
      const ev = {
        open: ['פתח את האפליקציה', '●', 'var(--muted)'],
        login: ['נכנס עם סיסמה', '→', 'var(--paid)'],
        login_failed: ['ניסיון כניסה עם סיסמה שגויה', '!', 'var(--danger)'],
        admin_login: ['נכנס לאזור הניהול', '★', 'var(--accent)'],
        admin_failed: ['סיסמת ניהול שגויה', '!', 'var(--danger)'],
      }[it.action] || [it.action, '●', 'var(--muted)'];
      return { title: ev[0], sub: '', icon: ev[1], color: ev[2] };
    }
    const b = it.before_json ? JSON.parse(it.before_json) : null;
    const a = it.after_json ? JSON.parse(it.after_json) : null;
    let title = `${VERB[it.action] || it.action} ${NOUN[it.entity] || it.entity}`;
    let sub = '';
    if (it.entity === 'shift') sub = shiftLine(a || b);
    else if (it.entity === 'worker') sub = (a || b || {}).name || '';
    else if (it.entity === 'period') {
      const p = a || b || {};
      sub = `${p.name || ''}${p.amount_received ? ' · ' + C.fmtMoney(p.amount_received) : ''}${p.shift_ids ? ' · ' + p.shift_ids.length + ' משמרות' : ''}`;
    } else if (it.entity === 'settings' && a && b) {
      title = 'עדכן תעריף ברירת מחדל';
      sub = `${C.fmtMoney(b.default_rate)} ← ${C.fmtMoney(a.default_rate)}`;
    }
    if (it.action === 'update' && b && a && it.entity !== 'settings') {
      const ch = Object.keys(FIELD).filter((k) => k in a && String(a[k] ?? '') !== String(b[k] ?? ''));
      if (ch.length) sub += (sub ? ' · ' : '') + 'שונה: ' + ch.map((k) => FIELD[k]).join(', ');
    }
    const color = it.action === 'delete' || it.action === 'reopen' ? 'var(--danger)' : it.action === 'create' || it.action === 'close' ? 'var(--paid)' : 'var(--accent)';
    const icon = { create: '+', update: '✎', delete: '×', close: '✓', reopen: '↺', settings: '⚙' }[it.action] || '•';
    return { title, sub, icon, color };
  }

  async function adminLoad(what) {
    if (A.busy) return;
    A.busy = true;
    A.error = '';
    try {
      if (what !== 'log') A.overview = await adminApi('GET', '/api/admin/overview');
      if (what !== 'overview') {
        const q = `?type=${A.logType}&device=${encodeURIComponent(A.logDevice)}&limit=100`;
        A.log = await adminApi('GET', '/api/admin/log' + q);
        A.log.offset = A.log.items.length;
      }
    } catch (e) { A.error = e.message; toast(e.message); } finally { A.busy = false; if (S.view === 'admin') render(); }
  }

  function viewAdmin() {
    if (!A.pw) {
      return `<div class="card" style="max-width:420px;margin:20px auto 0">
        <h3 style="margin:0 0 4px">אזור ניהול</h3><div class="mini">כניסות, מכשירים ויומן שינויים</div>
        <form id="al"><input class="in" type="password" id="apw" placeholder="סיסמת ניהול" style="margin-top:14px" autocomplete="off">
        <button class="btn primary block" style="margin-top:12px">כניסה</button></form>
        <button class="btn ghost block" style="margin-top:8px" onclick="App.go('settings')">חזרה</button></div>`;
    }
    const tabs = [['overview', 'סקירה'], ['log', 'יומן'], ['devices', 'מכשירים']];
    const seg = `<div class="seg">${tabs.map(([k, t]) => `<button class="${A.tab === k ? 'on' : ''}" data-at="${k}">${t}</button>`).join('')}</div>`;
    if (!A.overview) return seg + (A.error && !A.busy ? `<div class="empty">${esc(A.error)}<br><button class="btn ghost" style="margin-top:10px" data-retry>נסו שוב</button></div>` : '<div class="empty">טוען…</div>');
    const body = A.tab === 'log' ? adminLogView() : A.tab === 'devices' ? adminDevicesView() : adminOverviewView();
    return seg + `<div style="margin-top:14px">${body}</div>`;
  }

  function adminOverviewView() {
    const t = A.overview.totals;
    const days = [];
    const byDay = {};
    for (const d of A.overview.daily) byDay[d.day] = d;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ k, ...(byDay[k] || { opens: 0, devices: 0, failed: 0 }) });
    }
    const max = Math.max(1, ...days.map((d) => d.opens));
    const bars = days.map((d) => `<div title="${C.fmtDate(d.k)}: ${d.opens} פתיחות, ${d.devices} מכשירים${d.failed ? ', ' + d.failed + ' כושלים' : ''}"
        style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;height:100%">
        ${d.failed ? `<i style="display:block;height:4px;border-radius:2px;background:var(--danger)"></i>` : ''}
        <i style="display:block;height:${(d.opens / max) * 100}%;min-height:${d.opens ? 3 : 0}px;border-radius:3px 3px 0 0;background:var(--accent)"></i></div>`).join('');
    const recent = A.overview.devices.slice(0, 5).map(devRow).join('');
    return `
      <div class="hero">
        <div class="card stat"><div class="lbl">פתיחות ב-24 שעות</div><div class="val">${N(t.opens24)}</div><div class="sub">${N(t.opens)} מאז ההתחלה</div></div>
        <div class="card stat"><div class="lbl">מכשירים פעילים בשבוע</div><div class="val">${N(t.active7)}</div><div class="sub">${N(t.devices)} מכשירים בסך הכל</div></div>
        <div class="card stat"><div class="lbl">שינויים בשבוע</div><div class="val">${N(t.changes7)}</div><div class="sub">${N(t.changes)} בסך הכל</div></div>
        <div class="card stat ${t.failed7 ? 'open' : ''}"><div class="lbl">סיסמה שגויה בשבוע</div><div class="val" style="${t.failed7 ? 'color:var(--danger)' : ''}">${N(t.failed7)}</div><div class="sub">ניסיונות כושלים</div></div>
      </div>
      <h2>פתיחות ב-30 הימים האחרונים</h2>
      <div class="card"><div style="display:flex;gap:2px;height:110px;align-items:stretch">${bars}</div>
        <div class="mini" style="display:flex;justify-content:space-between;margin-top:6px"><span class="num">${C.fmtDate(days[0].k)}</span><span>היום</span></div></div>
      <h2>נראו לאחרונה</h2>
      <div class="list">${recent || '<div class="empty">אין עדיין כניסות</div>'}</div>
      <h2>הגדרות ניהול</h2>
      <div class="card stack">
        <button class="btn ghost block" id="apch">שינוי סיסמת ניהול</button>
        <button class="btn danger block" id="aout">יציאה מאזור הניהול</button>
      </div>`;
  }

  function devRow(d) {
    const p = parseUA(d.user_agent);
    return `<div class="card wrow" data-dev="${esc(d.id)}" style="cursor:pointer">
      <div class="avatar" style="${d.blocked ? 'background:var(--open-soft);color:var(--danger)' : ''}">${/iPhone|Android|iPad/.test(p.os) ? '📱' : '💻'}</div>
      <div style="min-width:0"><div class="name">${esc(devName(d.id))}${isMe(d.id) ? ' <span class="tag">המכשיר הזה</span>' : ''}${d.blocked ? ' <span class="tag" style="color:var(--danger)">חסום</span>' : ''}</div>
        <div class="meta">${d.label ? esc(p.text) + ' · ' : ''}${esc(d.last_city || '')}${d.last_city ? ' · ' : ''}${ago(d.last_seen)}</div></div>
      <div class="end"><div class="big">${N(d.opens)}</div><div class="meta">${N(d.opens7)} השבוע${d.changes ? ' · ' + N(d.changes) + ' שינויים' : ''}</div></div>
    </div>`;
  }

  function adminDevicesView() {
    const ds = A.overview.devices;
    return `<div class="mini" style="margin:0 4px 10px">כל דפדפן שנכנס לאפליקציה מקבל מזהה משלו. לחיצה על מכשיר: מתן שם, צפייה בפעילות שלו או חסימה.</div>
      <div class="list">${ds.map(devRow).join('') || '<div class="empty">אין עדיין מכשירים</div>'}</div>`;
  }

  function adminLogView() {
    const types = [['all', 'הכל'], ['visits', 'כניסות'], ['changes', 'שינויים'], ['failed', 'כושלים']];
    const filt = `<div class="chips">${types.map(([k, t]) => `<button class="chip ${A.logType === k ? 'on' : ''}" data-lt="${k}">${t}</button>`).join('')}</div>
      ${A.logDevice ? `<div class="chips" style="margin-top:8px"><button class="chip on" id="ldx">${esc(devName(A.logDevice))} ✕</button></div>` : ''}`;
    if (!A.log) return filt + '<div class="empty">טוען…</div>';
    let lastDay = '';
    const rows = A.log.items.map((it, i) => {
      const d = describe(it);
      const day = toDate(it.ts).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
      const head = day !== lastDay ? `<div class="day">${day}</div>` : '';
      lastDay = day;
      const time = toDate(it.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      return `${head}<div class="card shift" data-li="${i}" style="padding:11px 14px;margin-top:6px">
        <div class="avatar" style="width:32px;height:32px;font-size:15px;background:none;border:1.5px solid ${d.color};color:${d.color}">${d.icon}</div>
        <div style="min-width:0;flex:1"><div style="font-weight:500">${esc(d.title)}</div>
          ${d.sub ? `<div class="note">${esc(d.sub)}</div>` : ''}
          <div class="note">${esc(devName(it.device_id, it.user_agent))}${it.city ? ' · ' + esc(it.city) : ''}</div></div>
        <div class="hrs"><div class="num">${time}</div></div></div>`;
    }).join('');
    return filt + (rows || '<div class="empty">אין רשומות</div>') +
      (A.log.more ? `<button class="btn ghost block" id="lmore" style="margin-top:12px">טען עוד</button>` : '');
  }

  function logItemSheet(it) {
    const d = describe(it);
    let detail = '';
    if (it.kind === 'change') {
      const b = it.before_json ? JSON.parse(it.before_json) : null;
      const a = it.after_json ? JSON.parse(it.after_json) : null;
      const keys = Object.keys(FIELD).filter((k) => (a && k in a) || (b && k in b));
      const rowsHtml = keys.map((k) => {
        const bv = b ? fieldVal(k, b[k]) : null;
        const av = a ? fieldVal(k, a[k]) : null;
        const changed = b && a && bv !== av;
        return `<tr><td class="muted">${FIELD[k]}</td>${b ? `<td style="${changed ? 'color:var(--danger);text-decoration:line-through' : ''}">${esc(bv)}</td>` : ''}${a ? `<td style="${changed ? 'color:var(--paid);font-weight:600' : ''}">${esc(av)}</td>` : ''}</tr>`;
      }).join('');
      detail = keys.length ? `<table class="t" style="margin-top:14px"><thead><tr><th></th>${b ? '<th>לפני</th>' : ''}${a ? '<th>אחרי</th>' : ''}</tr></thead><tbody>${rowsHtml}</tbody></table>` : '';
    }
    const dev = devMap()[it.device_id];
    openSheet(`
      <h3>${esc(d.title)}</h3>
      ${d.sub ? `<div class="mini">${esc(d.sub)}</div>` : ''}
      ${detail}
      <div style="margin-top:14px">
        <div class="kv"><span>זמן</span><span class="num">${toDate(it.ts).toLocaleString('he-IL')}</span></div>
        <div class="kv"><span>מכשיר</span><span>${esc(devName(it.device_id, it.user_agent))}</span></div>
        ${dev || it.user_agent ? `<div class="kv"><span>דפדפן</span><span>${esc(parseUA((dev && dev.user_agent) || it.user_agent).text)}</span></div>` : ''}
        ${it.city || it.country ? `<div class="kv"><span>מיקום</span><span>${esc([it.city, it.country].filter(Boolean).join(', '))}</span></div>` : ''}
        ${it.ip ? `<div class="kv"><span>IP</span><span class="num">${esc(it.ip)}</span></div>` : ''}
      </div>
      <div class="acts">${it.device_id && dev ? `<button class="btn ghost" id="sdev">המכשיר</button>` : ''}<button class="btn primary" onclick="App.close()">סגירה</button></div>`, (el) => {
      const b = el.querySelector('#sdev');
      if (b) b.onclick = () => deviceSheet(it.device_id);
    });
  }

  function deviceSheet(id) {
    const d = devMap()[id];
    if (!d) return;
    const p = parseUA(d.user_agent);
    openSheet(`
      <h3>${esc(devName(id))}</h3>
      <div class="mini">${esc(p.text)}${isMe(id) ? ' · המכשיר שאתה משתמש בו עכשיו' : ''}</div>
      <label class="f">שם למכשיר (רק אתה רואה)</label>
      <input class="in" id="dl" placeholder="למשל: הטלפון של יחזקאל" value="${esc(d.label || '')}">
      <div style="margin-top:14px">
        <div class="kv"><span>נראה לראשונה</span><span class="num">${fmtTs(d.first_seen)}</span></div>
        <div class="kv"><span>נראה לאחרונה</span><span>${ago(d.last_seen)}</span></div>
        <div class="kv"><span>פתיחות</span><span class="num">${d.opens} (${d.opens7} השבוע)</span></div>
        <div class="kv"><span>שינויים בנתונים</span><span class="num">${d.changes}</span></div>
        ${d.last_city ? `<div class="kv"><span>מיקום אחרון</span><span>${esc(d.last_city)}</span></div>` : ''}
        ${d.last_ip ? `<div class="kv"><span>IP אחרון</span><span class="num">${esc(d.last_ip)}</span></div>` : ''}
      </div>
      ${isMe(id) ? '' : `<label class="check" style="margin-top:10px"><input type="checkbox" id="db" ${d.blocked ? 'checked' : ''}><span class="grow">חסימת המכשיר<div class="mini">חסימה מלאה של מישהו: להחליף את הסיסמה המשותפת</div></span></label>`}
      <div class="acts"><button class="btn ghost" id="dlog">הפעילות שלו</button><button class="btn primary" id="dsv">שמירה</button></div>`, (el) => {
      el.querySelector('#dsv').onclick = async () => {
        try {
          const bl = el.querySelector('#db');
          A.overview = await adminApi('PUT', '/api/admin/devices/' + encodeURIComponent(id), { label: el.querySelector('#dl').value, blocked: bl ? bl.checked : false });
          closeSheet(); render(); toast('נשמר');
        } catch (e) { toast(e.message); }
      };
      el.querySelector('#dlog').onclick = () => { closeSheet(); A.tab = 'log'; A.logDevice = id; A.log = null; render(); adminLoad('log'); };
    });
  }

  function passwordSheet() {
    openSheet(`<h3>שינוי סיסמת ניהול</h3>
      <label class="f">סיסמה חדשה (לפחות 6 תווים)</label><input class="in" type="password" id="np" autocomplete="new-password">
      <div class="acts"><button class="btn ghost" onclick="App.close()">ביטול</button><button class="btn primary" id="nps">שמירה</button></div>`, (el) => {
      el.querySelector('#nps').onclick = async () => {
        const pw = el.querySelector('#np').value;
        try {
          await adminApi('PUT', '/api/admin/password', { password: pw });
          A.pw = pw; LS.set('shifts.admin', pw); closeSheet(); toast('הסיסמה עודכנה');
        } catch (e) { toast(e.message); }
      };
    });
  }

  function bindAdmin() {
    const q = (sel) => $app.querySelector(sel);
    const f = q('#al');
    if (f) {
      f.onsubmit = async (e) => {
        e.preventDefault();
        A.pw = q('#apw').value;
        try {
          await adminApi('POST', '/api/admin/login');
          LS.set('shifts.admin', A.pw);
          render(); adminLoad();
        } catch (err) { toast(err.message); }
      };
      return;
    }
    const rt = q('[data-retry]'); if (rt) rt.onclick = () => adminLoad();
    if (!A.overview && !A.busy && !A.error) { adminLoad(); return; }
    $app.querySelectorAll('[data-at]').forEach((b) => b.onclick = () => {
      A.tab = b.dataset.at; render();
      if (A.tab === 'log' && !A.log) adminLoad('log');
    });
    $app.querySelectorAll('[data-dev]').forEach((b) => b.onclick = () => deviceSheet(b.dataset.dev));
    $app.querySelectorAll('[data-lt]').forEach((b) => b.onclick = () => { A.logType = b.dataset.lt; A.log = null; render(); adminLoad('log'); });
    $app.querySelectorAll('[data-li]').forEach((b) => b.onclick = () => logItemSheet(A.log.items[Number(b.dataset.li)]));
    const x = q('#ldx'); if (x) x.onclick = () => { A.logDevice = ''; A.log = null; render(); adminLoad('log'); };
    const more = q('#lmore');
    if (more) more.onclick = async () => {
      more.disabled = true;
      try {
        const r = await adminApi('GET', `/api/admin/log?type=${A.logType}&device=${encodeURIComponent(A.logDevice)}&limit=100&offset=${A.log.offset}`);
        A.log.items = A.log.items.concat(r.items); A.log.more = r.more; A.log.offset += r.items.length; render();
      } catch (e) { toast(e.message); more.disabled = false; }
    };
    const ch = q('#apch'); if (ch) ch.onclick = passwordSheet;
    const out = q('#aout'); if (out) out.onclick = () => { A.pw = ''; LS.del('shifts.admin'); A.overview = null; A.log = null; App.go('settings'); };
    if (A.tab === 'log' && !A.log && !A.busy && !A.error) adminLoad('log');
  }

  // ---------- public handlers ----------
  window.App = {
    go(v) { S.view = v; LS.set('shifts.view', v); render(); window.scrollTo(0, 0); },
    reload() { if (S.view === 'admin' && A.pw) { A.error = ''; adminLoad(); } else load(); },
    newShift() { shiftForm(null); },
    editShift(id) { shiftForm(S.data.shifts.find((s) => s.id === id)); },
    fs(v) { S.filterStatus = v; render(); },
    fw(v) { S.filterWorker = v; render(); },
    closePeriod() { closePeriodSheet(); },
    period(id) { periodSheet(id); },
    worker(id) { workerSheet(id); },
    close: closeSheet,
    saveRate() { act('PUT', '/api/settings', { default_rate: document.getElementById('dr').value }, 'התעריף נשמר'); },
    csv: exportCsv,
    logout() { if (confirm('להתנתק?')) { LS.del('shifts.pass'); S.pass = ''; S.data = null; render(); } },
  };

  // Refresh when returning to the tab, so everyone sees others' updates
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pass && S.data && !document.querySelector('.sheet-bg')) load(); });

  render();
  if (S.pass) load(true);
})();
