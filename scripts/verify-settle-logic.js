/**
 * Verification for the watcher's settle-detection / re-report decision.
 *
 * The userscript is a single IIFE, so `npm test` cannot reach this logic. Rather
 * than re-implement it (which would test nothing), this script EXTRACTS the
 * shipped decision block out of the userscript source and executes it against a
 * simulated clock. If the block is edited, the extraction changes and these
 * expectations have to be re-checked.
 *
 * Run: node scripts/verify-settle-logic.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'dashboard', 'public', 'goparttime-auto.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n          expected ' + JSON.stringify(expected) + '\n          actual   ' + JSON.stringify(actual)));
}

// ── 1. Read the real constants out of the shipped source ────────────────────
function readConst(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)');
  const m = source.match(re);
  if (!m) throw new Error('constant not found in userscript: ' + name);
  return Number(m[1]);
}
const BURST_SETTLE_MS = readConst('BURST_SETTLE_MS');
const BURST_SETTLE_MAX_MS = readConst('BURST_SETTLE_MAX_MS');
const BURST_RETRY_MS = readConst('BURST_RETRY_MS');
const BURST_CHUNK_SIZE = readConst('BURST_CHUNK_SIZE');
const DROP_MONITOR_MS = readConst('DROP_MONITOR_MS');
const FIRST_TICK_DOM_WINDOW_MS = readConst('FIRST_TICK_DOM_WINDOW_MS');

console.log('='.repeat(78));
console.log(' shipped constants');
console.log('='.repeat(78));
console.log('  BURST_SETTLE_MS        =', BURST_SETTLE_MS);
console.log('  BURST_SETTLE_MAX_MS    =', BURST_SETTLE_MAX_MS);
console.log('  BURST_RETRY_MS         =', BURST_RETRY_MS);
console.log('  BURST_CHUNK_SIZE       =', BURST_CHUNK_SIZE);
console.log('  DROP_MONITOR_MS        =', DROP_MONITOR_MS);
console.log('  FIRST_TICK_DOM_WINDOW  =', FIRST_TICK_DOM_WINDOW_MS);
console.log('');
check('the old fixed 20s countdown is gone', /BURST_REPORT_DELAY_MS/.test(source), false);
check('settle is shorter than the 20s it replaces', BURST_SETTLE_MS < 20000, true);
check('the hard cap is shorter than the 20s it replaces', BURST_SETTLE_MAX_MS < 20000, true);
check('the hard cap still bounds a churning drop', BURST_SETTLE_MAX_MS > BURST_SETTLE_MS, true);
check('report chunking matches the server cap of 200', BURST_CHUNK_SIZE, 200);
check('no 20-task cap remains on the eligible set', /return out\.slice\(0, 20\)/.test(source), false);
check('no 20-task cap remains on the report set', /\.concat\(latchedRest\)\s*\.slice\(0, 20\)/.test(source), false);
check('no 20-task cap remains on the manual scan', /eligible\.concat\(rest\)\.slice\(0, 20\)/.test(source), false);
check('the parser no longer caps the field window at 12000', /Math\.min\(nextStart, idx \+ 12000\)/.test(source), false);
check('parser next-marker boundary is used instead', /nextStart = html\.length/.test(source), true);
check('an unreadable scan is not reported as an empty drop', /scanClass !== 'ok'/.test(source), true);
check('the hourly reload is still present', /window\.location\.reload\(\)/.test(source), true);
check('the tail-sweep empty report is still present', /emptyReportedHour/.test(source), true);
console.log('');

// ── 2. Extract the shipped decision block and execute it ────────────────────
const startIdx = lines.findIndex((l) => l.includes('let hasUnreported = false;'));
const endIdx = lines.findIndex((l) => l.includes('// Report (newest-first)'));
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error('FATAL: could not locate the decision block in the userscript.');
  process.exit(1);
}
const block = lines.slice(startIdx, endIdx).join('\n');
console.log('='.repeat(78));
console.log(' extracted decision block (' + (endIdx - startIdx) + ' lines from the shipped source)');
console.log('='.repeat(78));

/** Runs the shipped block and reports which branch it took. */
function decide(state) {
  const ctx = {
    reportSet: state.reportSet,
    reportedIds: state.reportedIds,
    burstConfirmed: state.burstConfirmed,
    reportedHour: state.hourKey,
    hourKey: state.hourKey,
    nowMs: state.nowMs,
    firstSeenAt: state.firstSeenAt,
    lastChangeAt: state.lastChangeAt,
    lastBurstPostAt: state.lastBurstPostAt,
    BURST_SETTLE_MS,
    BURST_SETTLE_MAX_MS,
    BURST_RETRY_MS,
    setStatus: () => {},
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(ctx), block + '\nreturn "REPORT";');
  try {
    fn(...Object.values(ctx));
    return 'REPORT';
  } catch (e) {
    if (e instanceof Error && e.message === 'EARLY') return String(e.message);
    if (e && e.message === 'EARLY') return String(e.message);
    throw e;
  }
}

// The shipped block uses `return;` for its early exits, which surfaces as a
// normal return from the Function body. Re-wrap with an explicit sentinel.
const wrapped = block
  .replace(/return;/g, "return 'WAIT';")
  .replace(/return 'WAIT';\s*\n\s*}/, "return 'WAIT';\n          }");
// eslint-disable-next-line no-new-func
const decideFn = new Function(
  'reportSet', 'reportedIds', 'burstConfirmed', 'reportedHour', 'hourKey', 'nowMs',
  'firstSeenAt', 'lastChangeAt', 'lastBurstPostAt',
  'BURST_SETTLE_MS', 'BURST_SETTLE_MAX_MS', 'BURST_RETRY_MS', 'setStatus',
  wrapped + '\nreturn "REPORT";',
);

function run(state) {
  return decideFn(
    state.reportSet, state.reportedIds, state.burstConfirmed, state.hourKey, state.hourKey,
    state.nowMs, state.firstSeenAt, state.lastChangeAt, state.lastBurstPostAt,
    BURST_SETTLE_MS, BURST_SETTLE_MAX_MS, BURST_RETRY_MS, () => {},
  );
}

const T0 = 1_000_000;
const post = (id) => ({ subTaskId: id, type: 'post', subreddit: 'S', title: null });

console.log('');
console.log('='.repeat(78));
console.log(' settle behaviour');
console.log('='.reflect === undefined ? '' : '='.repeat(78));

// First sighting: not settled yet, because the set only just changed.
check('a just-changed set is NOT reported immediately', run({
  reportSet: [post(1), post(2)], reportedIds: {}, burstConfirmed: false, hourKey: 'h1',
  nowMs: T0, firstSeenAt: T0, lastChangeAt: T0, lastBurstPostAt: 0,
}), 'WAIT');

// Still inside the quiet period.
check('not reported before the settle window elapses', run({
  reportSet: [post(1), post(2)], reportedIds: {}, burstConfirmed: false, hourKey: 'h1',
  nowMs: T0 + BURST_SETTLE_MS - 1, firstSeenAt: T0, lastChangeAt: T0, lastBurstPostAt: 0,
}), 'WAIT');

// Quiet period elapsed -> report.
check('reported once the set has been quiet for the settle window', run({
  reportSet: [post(1), post(2)], reportedIds: {}, burstConfirmed: false, hourKey: 'h1',
  nowMs: T0 + BURST_SETTLE_MS, firstSeenAt: T0, lastChangeAt: T0, lastBurstPostAt: 0,
}), 'REPORT');

// A churn-proof cap: the set keeps changing, but the max wait forces a report.
check('a continuously churning set still reports at the hard cap', run({
  reportSet: [post(1), post(2), post(3)], reportedIds: {}, burstConfirmed: false, hourKey: 'h1',
  nowMs: T0 + BURST_SETTLE_MAX_MS, firstSeenAt: T0, lastChangeAt: T0 + BURST_SETTLE_MAX_MS, lastBurstPostAt: 0,
}), 'REPORT');

console.log('');
console.log('='.repeat(78));
console.log(' re-report on a late arrival (the thing the 20s wait protected)');
console.log('='.repeat(78));

// Already reported, and nothing new has appeared -> stay quiet.
check('nothing new since the report: no second report', run({
  reportSet: [post(1), post(2)], reportedIds: { 1: 1, 2: 1 }, burstConfirmed: true, hourKey: 'h1',
  nowMs: T0 + 60000, firstSeenAt: T0, lastChangeAt: T0, lastBurstPostAt: T0 + BURST_SETTLE_MS,
}), 'WAIT');

// A late arrival appears -> must report again, even though the hour is settled.
// (lastBurstPostAt is old enough that the retry gate is not what stops it.)
check('a NEW task id after a confirmed report triggers a follow-up report', run({
  reportSet: [post(1), post(2), post(99)], reportedIds: { 1: 1, 2: 1 }, burstConfirmed: true, hourKey: 'h1',
  nowMs: T0 + 60000, firstSeenAt: T0, lastChangeAt: T0 + 59000, lastBurstPostAt: T0 + BURST_SETTLE_MS,
}), 'REPORT');

console.log('');
console.log('='.repeat(78));
console.log(' retry gate still throttles');
console.log('='.repeat(78));
check('a report inside the retry window is deferred', run({
  reportSet: [post(1)], reportedIds: {}, burstConfirmed: false, hourKey: 'h1',
  nowMs: T0 + BURST_SETTLE_MS, firstSeenAt: T0, lastChangeAt: T0, lastBurstPostAt: T0,
}), 'WAIT');

console.log('');
console.log('='.repeat(78));
if (failures === 0) {
  console.log(' ALL CHECKS PASSED');
} else {
  console.log(' ' + failures + ' CHECK(S) FAILED');
}
console.log('='.repeat(78));
process.exit(failures === 0 ? 0 : 1);
