#!/usr/bin/env node
/**
 * Artist's Payout Estimator — acceptance tests.
 * Written fresh from the v2 spec. Zero dependencies: `node run-tests.js`.
 *
 * The suite extracts the <script id="estimator-math"> block from the SHIPPED
 * page file and tests that exact source, including a wide-range fuzz proving
 * the number displayed on screen can never drift from the number the math
 * produced (display text is asserted equal to fmtMoney(engine output) on
 * every fuzz case — the page writes the screen only through that pair).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PAGE = process.env.ESTIMATOR_PAGE ||
  path.join(__dirname, '..', '..', 'dev', 'payout-estimator.html');

// ── extract and load the shipped math block ─────────────────────────────
const html = fs.readFileSync(PAGE, 'utf8');
const mathMatch = html.match(/<script id="estimator-math">([\s\S]*?)<\/script>/);
assert(mathMatch, 'page must contain the estimator-math script block');
const sandbox = { module: { exports: {} }, self: undefined };
vm.runInNewContext(mathMatch[1], sandbox, { filename: 'estimator-math.js' });
const M = sandbox.module.exports;
assert(typeof M.estimate === 'function' && typeof M.summarize === 'function' &&
  typeof M.fmtMoney === 'function', 'math block must export estimate/summarize/fmtMoney');

// Both inline scripts must parse as valid JS (catches a broken deploy early).
const wiring = html.match(/<script>\s*\(function \(\) \{\s*'use strict';([\s\S]*?)<\/script>\s*<\/body>/);
assert(wiring, 'page must contain the wiring script');
new Function(wiring[1].replace(/\}\)\(\);\s*$/, ''));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const DEFAULTS = {
  guarantee: 2000, capacity: 150, ticketPrice: 30, ticketsSold: 90,
  split: 0.80, musicians: 5, musicianRate: 200, singers: 3,
  singerRate: 125, bookingFee: 200, promo: 150, houseCut: 0
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

console.log('\nSpec worked example — the starting values');
test('defaults: her estimated take is $2,435', () => {
  // others 5×200+3×125=1375; her fee 200 paid; remainder 425;
  // tickets 90×$30×80%=2160; minus promo 150 and fee 200 → 2435.
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(M.summarize(r).payoutText, '$2,435');
  assert(near(r.payout, 2435), 'payout ' + r.payout);
});
test('defaults: guarantee pays all 9 players, mood is green', () => {
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(r.players, 9);
  assert.strictEqual(r.covered, 9);
  assert.strictEqual(r.mood, 'good');
  assert(M.summarize(r).coverage.includes('pays all 9'));
});

console.log('\nPriority rules (§5)');
test('other players paid first: short guarantee pays her nothing', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1000 });
  assert(near(r.herFeePaid, 0));
  assert(near(r.ownerGap, 375), 'owner covers 1375−1000');
});
test('she forfeits first: partial fee between others and full fee', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1500 });
  assert(near(r.herFeePaid, 125));
  assert(near(r.guaranteeLeft, 0));
  assert(near(r.ownerGap, 0));
});
test('owner gap comes out of her ticket money', () => {
  const a = M.estimate({ ...DEFAULTS, guarantee: 1375 });
  const b = M.estimate({ ...DEFAULTS, guarantee: 1175 });
  assert(near(a.raw - b.raw, 200), 'a $200 shortfall costs her exactly $200');
});
test('rich guarantee: fee paid and remainder is hers', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 3000 });
  assert(near(r.herFeePaid, 200));
  assert(near(r.guaranteeLeft, 1425));
});

console.log('\nThe three coaching states (§6)');
test('loss shows red and says the out-of-pocket number out loud', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 500, ticketsSold: 0, promo: 400 });
  assert.strictEqual(r.mood, 'loss');
  assert(near(r.payout, 0), 'floors at $0');
  assert(near(r.outOfPocket, 1475), 'raw = 500−1375+0−400−200 = −1475');
  assert(M.summarize(r).coach.includes('$1,475'));
  assert(M.summarize(r).coach.includes('out of pocket'));
});
test('amber when the band is covered but she nets under her full fee', () => {
  // guarantee exactly covers everyone; her promo+fee eat into her own money
  const r = M.estimate({ ...DEFAULTS, guarantee: 1575, ticketsSold: 10, promo: 150 });
  // raw = 200 + 0 + 240 − 150 − 200 = 90 → between 0 and her $200 fee
  assert.strictEqual(r.mood, 'warn');
  assert(near(r.raw, 90));
  assert(M.summarize(r).coach.includes('Each added player costs $200'));
});
test('green needs her full fee intact after every cost', () => {
  const g = M.estimate(DEFAULTS);
  assert(g.raw >= g.herFee && g.mood === 'good');
});
test('band collective take-home: $1,375 at defaults, moves with the lineup', () => {
  assert.strictEqual(M.summarize(M.estimate(DEFAULTS)).bandText, '$1,375');
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, musicians: 6 })).bandText, '$1,575');
  // ticket sales never move the band's number — the deal makes them whole
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 0 })).bandText, '$1,375');
});
test('green copy frames the number as hers alone, never as the pot', () => {
  // CEO ruling: the big number is her personal take-home. The words must
  // never suggest the displayed number is what pays the band.
  const g = M.summarize(M.estimate(DEFAULTS));
  assert(g.coach.includes('yours to take home'), g.coach);
  assert(!g.coach.includes('pays everybody'), 'pot framing is banned: ' + g.coach);
  const so = M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 150 }));
  assert(so.coach.includes('yours to take home'), so.coach);
});
test('sold-out green uses the sold-out sentence', () => {
  const r = M.estimate({ ...DEFAULTS, ticketsSold: 150 });
  assert.strictEqual(r.mood, 'good');
  assert(M.summarize(r).coach.startsWith('Sold-out math'));
});

console.log('\nHouse cut (the venue\'s nut, off ticket money before her split)');
test('house cut comes off gross before the split', () => {
  // gross 90×$30 = 2700; house 500 → 2200; ×80% = 1760;
  // raw = 200 + 425 + 1760 − 150 − 200 = 2035.
  const r = M.estimate({ ...DEFAULTS, houseCut: 500 });
  assert(near(r.ticketShare, 1760));
  assert.strictEqual(M.summarize(r).payoutText, '$2,035');
});
test('house cut larger than gross zeroes the ticket money, never negative', () => {
  const r = M.estimate({ ...DEFAULTS, houseCut: 5000 });
  assert(near(r.ticketShare, 0));
});
test('house cut of zero changes nothing', () => {
  assert(near(M.estimate(DEFAULTS).payout, M.estimate({ ...DEFAULTS, houseCut: 0 }).payout));
});

console.log('\nCoverage sentence');
test('$1,300 guarantee covers 7 of her 9 players', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1300 });
  assert.strictEqual(r.covered, 7);
  const c = M.summarize(r).coverage;
  assert(c.includes('covers 7 of your 9 players'));
  assert(c.includes('player 9'));
});
test('she is always the last player counted', () => {
  // covers everyone but her: needs others (1375) but not 1375+200
  const r = M.estimate({ ...DEFAULTS, guarantee: 1400 });
  assert.strictEqual(r.covered, 8);
});

console.log('\nEdges');
test('all zeros: $0, one player (her), no crash', () => {
  const r = M.estimate({ guarantee: 0, capacity: 0, ticketPrice: 0, ticketsSold: 0,
    split: 0, musicians: 0, musicianRate: 0, singers: 0, singerRate: 0, bookingFee: 0, promo: 0 });
  assert(near(r.payout, 0));
  assert.strictEqual(r.players, 1);
});
test('negative and junk inputs are treated as zero', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: -50, promo: 'abc' });
  assert(near(r.ownerGap, 1375));
  assert(!Number.isNaN(r.payout));
});
test('nothing is capped: huge values compute cleanly', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 250000, ticketPrice: 1000, capacity: 20000, ticketsSold: 20000 });
  assert(near(r.raw, 250000 - 1375 + 20000 * 1000 * 0.8 - 150 - 200));
});

console.log('\nFuzz — display can never drift from the math (2,000 cases)');
test('fuzz holds every invariant', () => {
  let seed = 0x5eed;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (max) => Math.floor(rand() * max);
  for (let i = 0; i < 2000; i++) {
    const cap = pick(5000);
    const inp = {
      guarantee: pick(50000), capacity: cap, ticketPrice: rand() * 500,
      ticketsSold: pick(cap + 1), split: rand(), musicians: pick(30),
      musicianRate: pick(2000), singers: pick(20), singerRate: pick(1500),
      bookingFee: pick(5000), promo: pick(5000), houseCut: pick(8000)
    };
    const r = M.estimate(inp);
    const s = M.summarize(r);
    const ctx = ' [case ' + i + ' ' + JSON.stringify(inp) + ']';

    // 1. The screen's numbers ARE the math's numbers, formatted — nothing else.
    assert.strictEqual(s.payoutText, M.fmtMoney(r.payout), 'display drift' + ctx);
    assert.strictEqual(s.bandText, M.fmtMoney(r.others), 'band display drift' + ctx);
    assert(/^\$[\d,]+$/.test(s.payoutText), 'money format' + ctx);
    // 2. Floor at $0; the loss is reported, never hidden.
    assert(near(r.payout, Math.max(0, r.raw)), 'floor' + ctx);
    assert(near(r.outOfPocket, r.raw < 0 ? -r.raw : 0), 'out-of-pocket' + ctx);
    if (r.mood === 'loss') assert(s.coach.includes(M.fmtMoney(r.outOfPocket)), 'loss says its number' + ctx);
    // 3. The waterfall is linear in every branch, and the house cut comes
    //    off gross ticket money before the split.
    const others = inp.musicians * inp.musicianRate + inp.singers * inp.singerRate;
    assert(near(r.herFeePaid + r.guaranteeLeft - r.ownerGap, inp.guarantee - others), 'identity' + ctx);
    assert(near(r.ticketShare, Math.max(0, inp.ticketsSold * inp.ticketPrice - inp.houseCut) * inp.split), 'house cut' + ctx);
    assert(near(r.raw, inp.guarantee - others + r.ticketShare - inp.promo - inp.bookingFee), 'blend' + ctx);
    // 4. Mood is a total ordering on raw vs her fee.
    const expect = r.raw < 0 ? 'loss' : (r.raw < r.herFee ? 'warn' : 'good');
    assert.strictEqual(r.mood, expect, 'mood' + ctx);
    // 5. Coverage stays inside the lineup.
    assert(r.covered >= 0 && r.covered <= r.players, 'coverage bounds' + ctx);
    assert.strictEqual(r.players, inp.musicians + inp.singers + 1, 'she is +1' + ctx);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
