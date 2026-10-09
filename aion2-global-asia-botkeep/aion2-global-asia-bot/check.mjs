import fs from 'node:fs';
import assert from 'node:assert/strict';
const d = JSON.parse(fs.readFileSync(new URL('./events.json', import.meta.url), 'utf8'));
assert.equal(d.timezone, 'UTC');
assert.equal(d.region, 'global-asia');
assert.equal(d.events.length, 9);
assert.equal(new Set(d.events.map(e=>e.id)).size, 9);
for (const e of d.events) {
 assert.ok(e.days.length && e.times.length, e.id);
 assert.ok(e.days.every(x=>Number.isInteger(x)&&x>=0&&x<=6),e.id);
 assert.ok(e.times.every(x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(x)),e.id);
}
const dt = new Date('2026-10-09T16:00:00Z');
assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(dt),'23:00');
console.log('PASS: 9 events, UTC times, unique IDs, Vietnam timezone conversion');
