const test = require('node:test');
const assert = require('node:assert');
const C = require('../../web/calc.js');

test('midnight crossing', () => {
  assert.equal(C.spanMinutes('20:00', '08:30'), 750);
  assert.equal(C.spanMinutes('08:00', '16:00'), 480);
  assert.ok(C.crossesMidnight('20:00', '08:30'));
});
test('extra minutes and override', () => {
  assert.equal(C.shiftMinutes({ start_time: '20:00', end_time: '08:00', extra_minutes: 60 }), 780);
  assert.equal(C.shiftMinutes({ hours_override: 12.33 }), 740);
});
test('parse hours both formats', () => {
  assert.ok(Math.abs(C.parseHours('12:20') - 12.3333) < 0.001);
  assert.equal(C.parseHours('12.33'), 12.33);
  assert.equal(C.parseHours('12,5'), 12.5);
  assert.equal(C.parseHours('abc'), null);
});
test('format', () => {
  assert.equal(C.fmtHM(740), '12:20');
  assert.equal(C.fmtDec(740), '12.33');
  assert.equal(C.dayName('2026-10-21'), 'רביעי');
});
test('effective rate example', () => {
  const r = 13200 / 159.83;
  assert.equal(r.toFixed(2), '82.59');
});
test('split adds up exactly', () => {
  const rows = [{ key: 1, minutes: 3000 }, { key: 2, minutes: 2590 }, { key: 3, minutes: 4000 }];
  const out = C.splitAmount(13200, rows);
  assert.equal(Math.round(out.reduce((a, r) => a + r.share, 0) * 100), 1320000);
});
