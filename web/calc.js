// Pure calculation helpers — shared by the page and the tests.
(function (root) {
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function toMin(t) {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  // Accepts "12:20", "12.33", "12,33", "12" → hours as a number (or null)
  function parseHours(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(',', '.');
    if (!s) return null;
    let m = /^(\d{1,2}):([0-5]?\d)$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    m = /^\d+(\.\d+)?$/.exec(s);
    if (m) return Number(s);
    return null;
  }

  // Minutes between start and end; an end at/before start means the shift passed midnight.
  function spanMinutes(start, end) {
    const a = toMin(start);
    const b = toMin(end);
    if (a === null || b === null) return null;
    let d = b - a;
    if (d <= 0) d += 24 * 60;
    return d;
  }

  function crossesMidnight(start, end) {
    const a = toMin(start);
    const b = toMin(end);
    return a !== null && b !== null && b <= a;
  }

  function shiftMinutes(s) {
    if (s.hours_override !== null && s.hours_override !== undefined && s.hours_override !== '') {
      return Math.round(Number(s.hours_override) * 60);
    }
    const span = spanMinutes(s.start_time, s.end_time);
    if (span === null) return 0;
    return span + (Number(s.extra_minutes) || 0);
  }

  function fmtHM(min) {
    const neg = min < 0;
    min = Math.abs(Math.round(min));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return (neg ? '-' : '') + h + ':' + String(m).padStart(2, '0');
  }

  function fmtDec(min) {
    return (Math.round((min / 60) * 100) / 100).toFixed(2);
  }

  function fmtMoney(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const d = digits === undefined ? (Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2) : digits;
    return '₪' + Number(n).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function dayName(dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    return DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  }

  function fmtDate(dateStr) {
    const [y, mo, d] = dateStr.split('-');
    return Number(d) + '.' + Number(mo) + '.' + y;
  }

  // Split `amount` across rows [{key, minutes}] in proportion to minutes,
  // rounded to agorot so the parts add up to exactly the amount.
  function splitAmount(amount, rows) {
    const total = rows.reduce((a, r) => a + r.minutes, 0);
    const agorot = Math.round(amount * 100);
    if (!total || !agorot) return rows.map((r) => ({ ...r, share: 0 }));
    const raw = rows.map((r) => (agorot * r.minutes) / total);
    const floors = raw.map(Math.floor);
    let left = agorot - floors.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < order.length && left > 0; k++, left--) floors[order[k][1]]++;
    return rows.map((r, i) => ({ ...r, share: floors[i] / 100 }));
  }

  // Sum minutes per worker for a list of shifts
  function minutesByWorker(shifts) {
    const out = {};
    for (const s of shifts) out[s.worker_id] = (out[s.worker_id] || 0) + shiftMinutes(s);
    return out;
  }

  const api = {
    DAYS, toMin, parseHours, spanMinutes, crossesMidnight, shiftMinutes,
    fmtHM, fmtDec, fmtMoney, dayName, fmtDate, splitAmount, minutesByWorker,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
