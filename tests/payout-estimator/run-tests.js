#!/usr/bin/env node
/**
 * Artist's Payout Estimator — acceptance tests.
 * Written fresh from the v2 spec + CEO rulings. Zero dependencies: `node run-tests.js`.
 *
 * The suite extracts the <script id="estimator-math"> block from the SHIPPED
 * page file and tests that exact source, including a wide-range fuzz proving
 * the numbers displayed on screen can never drift from the numbers the math
 * produced (every display string is asserted equal to fmtMoney(engine output)
 * on every fuzz case — the page writes the screen only through that pair).
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
// CEO ruling 2026-08-21: every performer rate defaults to $300 — musicians,
// background singers, and the artist's own slot (her own rate line).
const DEFAULTS = {
  guarantee: 2000, capacity: 150, ticketPrice: 30, ticketsSold: 90,
  split: 0.80, musicians: 5, musicianRate: 300, singers: 3,
  singerRate: 300, artistRate: 300, bookingFee: 200, promo: 150, houseCut: 0
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

console.log('\nStarting values — the story the defaults tell');
test('defaults: her estimated take-home is $1,410', () => {
  // others 5×300+3×300 = 2400 > guarantee 2000 → gap 400, her fee unpaid;
  // tickets 90×$30×80% = 2160; raw = −400 + 2160 − 150 − 200 = 1410.
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(M.summarize(r).payoutText, '$1,410');
  assert(near(r.payout, 1410), 'payout ' + r.payout);
});
test('defaults: guarantee covers 6 of her 9 players; the shortfall adds up', () => {
  // full band pay 2700 vs guarantee 2000 → $700 short: $400 made up out of
  // ticket money (the others' gap) + $300 the fee she forfeits.
  const r = M.estimate(DEFAULTS);
  const s = M.summarize(r);
  assert.strictEqual(r.players, 9);
  assert.strictEqual(r.covered, 6);
  assert(s.coverage.includes('covers 6 of your 9 players'));
  assert(s.bandShort === true);
  assert(s.bandNote.includes('$700 short of this total'), s.bandNote);
  assert(s.bandNote.includes('$400 gets made up out of ticket money'), s.bandNote);
  assert(s.bandNote.includes('$300 is the fee you forfeit'), s.bandNote);
});

console.log('\nPriority rules (§5)');
test('other players paid first: short guarantee pays her nothing', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1000 });
  assert(near(r.herFeePaid, 0));
  assert(near(r.ownerGap, 1400), 'owner covers 2400−1000');
});
test('she forfeits first: partial fee between others and full fee', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 2500 });
  assert(near(r.herFeePaid, 100));
  assert(near(r.guaranteeLeft, 0));
  assert(near(r.ownerGap, 0));
});
test('owner gap comes out of her ticket money', () => {
  const a = M.estimate({ ...DEFAULTS, guarantee: 2400 });
  const b = M.estimate({ ...DEFAULTS, guarantee: 2200 });
  assert(near(a.raw - b.raw, 200), 'a $200 shortfall costs her exactly $200');
});
test('rich guarantee: fee paid, surplus named, and it rides into her take-home', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 3000 });
  assert(near(r.herFeePaid, 300));
  assert(near(r.guaranteeLeft, 300));
  const s = M.summarize(r);
  assert(s.leftNote.includes('Guarantee surplus: $300'), s.leftNote);
  assert(s.leftNote.includes('rides into your take-home'), s.leftNote);
  // 300 fee + 300 surplus + 2160 tickets − 350 costs = 2410
  assert.strictEqual(s.payoutText, '$2,410');
});
test('no surplus line when the guarantee has nothing left', () => {
  assert.strictEqual(M.summarize(M.estimate(DEFAULTS)).leftNote, '');
});

console.log('\nHer fee under the guarantee — covered, partial, forfeited');
test('defaults: she forfeits her whole $300 fee and the screen says so', () => {
  const s = M.summarize(M.estimate(DEFAULTS));
  assert.strictEqual(s.feeState, 'forfeit');
  assert(s.feeNote.includes('you forfeit your $300 fee'), s.feeNote);
});
test('partial: the guarantee pays part, the forfeit amount is named', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2500 }));
  assert.strictEqual(s.feeState, 'partial');
  assert(s.feeNote.includes('$100 of your $300 fee'), s.feeNote);
  assert(s.feeNote.includes('you forfeit $200'), s.feeNote);
});
test('covered: her fee is safe and the screen says so', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2700 }));
  assert.strictEqual(s.feeState, 'covered');
  assert(s.feeNote.includes('Your $300 fee is covered'), s.feeNote);
});

console.log('\nThe three coaching states (§6)');
test('loss shows red and says the out-of-pocket number out loud', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 500, ticketsSold: 0, promo: 400 });
  assert.strictEqual(r.mood, 'loss');
  assert(near(r.payout, 0), 'floors at $0');
  assert(near(r.outOfPocket, 2500), 'raw = 500−2400+0−400−200 = −2500');
  assert(M.summarize(r).coach.includes('$2,500'));
  assert(M.summarize(r).coach.includes('out of pocket'));
});
test('amber when the band is covered but she nets under her full fee', () => {
  // guarantee covers everyone; her promo+fee eat into her own money
  const r = M.estimate({ ...DEFAULTS, guarantee: 2700, ticketsSold: 10, promo: 150 });
  // raw = 300 + 0 + 240 − 150 − 200 = 190 → between 0 and her $300 fee
  assert.strictEqual(r.mood, 'warn');
  assert(near(r.raw, 190));
  assert(M.summarize(r).coach.includes('Each added musician costs $300'));
});
test('green needs her full fee intact after every cost', () => {
  const g = M.estimate(DEFAULTS);
  assert(g.raw >= g.herFee && g.mood === 'good');
});
test('sold-out green uses the sold-out sentence', () => {
  const r = M.estimate({ ...DEFAULTS, ticketsSold: 150 });
  assert.strictEqual(r.mood, 'good');
  assert(M.summarize(r).coach.startsWith('Sold-out math'));
});
test('band shortfall names its parts and they sum to the total short', () => {
  // G 1000 vs pay 2700 → $1,700 short = $1,400 ticket money + $300 forfeit
  const short = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 1000 }));
  assert(short.bandShort === true);
  assert(short.bandNote.includes('$1,700 short of this total'), short.bandNote);
  assert(short.bandNote.includes('$1,400 gets made up out of ticket money'), short.bandNote);
  assert(short.bandNote.includes('$300 is the fee you forfeit'), short.bandNote);
  // partial-fee case: G 2500 → $200 short, all of it her forfeit
  const partial = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2500 }));
  assert(partial.bandNote.includes('$200 short of this total'), partial.bandNote);
  assert(partial.bandNote.includes('$200 is the fee you forfeit'), partial.bandNote);
  assert(!partial.bandNote.includes('ticket money'), partial.bandNote);
  const ok = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2700 }));
  assert(ok.bandShort === false);
  assert(ok.bandNote.includes('covers the band in full'), ok.bandNote);
});
test('band total includes her slot so the visible column adds up: $2,700', () => {
  assert.strictEqual(M.summarize(M.estimate(DEFAULTS)).bandText, '$2,700');
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, musicians: 6 })).bandText, '$3,000');
  // ticket sales never move the band's number
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 0 })).bandText, '$2,700');
  // her own rate moves it too — she is part of the total
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, artistRate: 400 })).bandText, '$2,800');
});
test('green copy frames the number as hers alone, never as the pot', () => {
  const g = M.summarize(M.estimate(DEFAULTS));
  assert(g.coach.includes('yours to take home'), g.coach);
  assert(!g.coach.includes('pays everybody'), 'pot framing is banned: ' + g.coach);
  const so = M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 150 }));
  assert(so.coach.includes('yours to take home'), so.coach);
});

console.log('\nBreak-even — where the show climbs out of the red, in tickets');
test('defaults: breaks even at 32 tickets and the 90 estimate clears it', () => {
  // showCost = 2400−2000+150+200 = 750; 750/0.8/30 = 31.25 → 32 tickets.
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(r.breakEven, 32);
  const s = M.summarize(r);
  assert(s.breakEvenNote.includes('Breaks even at 32 tickets'), s.breakEvenNote);
  assert(s.breakEvenNote.includes('your 90 estimate clears it'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'ok');
});
test('break-even is exact: 32 tickets is out of the red, 31 is not', () => {
  assert(M.estimate({ ...DEFAULTS, ticketsSold: 32 }).raw >= -1e-6);
  assert(M.estimate({ ...DEFAULTS, ticketsSold: 31 }).raw < 0);
});
test('estimating below break-even reads red', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 20 }));
  assert.strictEqual(s.breakEvenTone, 'red');
  assert(s.breakEvenNote.includes('below that this show is in the red'), s.breakEvenNote);
});
test('a rich guarantee is out of the red before a ticket sells', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2750 }));
  assert(s.breakEvenNote.includes('before a single ticket sells'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'ok');
});
test('a room too small to break even says so', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, capacity: 20, ticketsSold: 10 }));
  assert(s.breakEvenNote.includes('takes 32 tickets'), s.breakEvenNote);
  assert(s.breakEvenNote.includes('room holds 20'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'red');
});
test('no ticket money at all: break-even is honestly unreachable', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, ticketPrice: 0 }));
  assert(s.breakEvenNote.includes('can’t break even'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'red');
});

console.log('\nHouse cut (the venue\'s nut, off ticket money before her split)');
test('house cut comes off gross before the split', () => {
  // gross 90×$30 = 2700; house 500 → 2200; ×80% = 1760;
  // raw = −400 + 1760 − 150 − 200 = 1010.
  const r = M.estimate({ ...DEFAULTS, houseCut: 500 });
  assert(near(r.ticketShare, 1760));
  assert.strictEqual(M.summarize(r).payoutText, '$1,010');
});
test('house cut larger than gross zeroes the ticket money, never negative', () => {
  const r = M.estimate({ ...DEFAULTS, houseCut: 5000 });
  assert(near(r.ticketShare, 0));
});
test('house cut of zero changes nothing', () => {
  assert(near(M.estimate(DEFAULTS).payout, M.estimate({ ...DEFAULTS, houseCut: 0 }).payout));
});

console.log('\nCoverage sentence');
test('$2,100 guarantee covers 7 of her 9 players', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 2100 });
  assert.strictEqual(r.covered, 7);
  const c = M.summarize(r).coverage;
  assert(c.includes('covers 7 of your 9 players'));
  assert(c.includes('player 9'));
});
test('she is always the last player counted', () => {
  // covers everyone but her: needs others (2400) but not 2400+300
  const r = M.estimate({ ...DEFAULTS, guarantee: 2500 });
  assert.strictEqual(r.covered, 8);
});

console.log('\nEdges');
test('all zeros: $0, one player (her), no crash', () => {
  const r = M.estimate({ guarantee: 0, capacity: 0, ticketPrice: 0, ticketsSold: 0,
    split: 0, musicians: 0, musicianRate: 0, singers: 0, singerRate: 0,
    artistRate: 0, bookingFee: 0, promo: 0, houseCut: 0 });
  assert(near(r.payout, 0));
  assert.strictEqual(r.players, 1);
});
test('negative and junk inputs are treated as zero', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: -50, promo: 'abc' });
  assert(near(r.ownerGap, 2400));
  assert(!Number.isNaN(r.payout));
});
test('nothing is capped: huge values compute cleanly', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 250000, ticketPrice: 1000, capacity: 20000, ticketsSold: 20000 });
  assert(near(r.raw, 250000 - 2400 + 20000 * 1000 * 0.8 - 150 - 200));
});

console.log('\nFuzz — the screen can never drift from the math (2,000 cases)');
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
      artistRate: pick(2000), bookingFee: pick(5000), promo: pick(5000), houseCut: pick(8000)
    };
    const r = M.estimate(inp);
    const s = M.summarize(r);
    const ctx = ' [case ' + i + ' ' + JSON.stringify(inp) + ']';

    // 1. The screen's numbers ARE the math's numbers, formatted — nothing else.
    assert.strictEqual(s.payoutText, M.fmtMoney(r.payout), 'display drift' + ctx);
    assert.strictEqual(s.bandText, M.fmtMoney(r.others + r.herFee), 'band display drift' + ctx);
    assert(/^\$[\d,]+$/.test(s.payoutText), 'money format' + ctx);
    // 2. Floor at $0; the loss is reported, never hidden.
    assert(near(r.payout, Math.max(0, r.raw)), 'floor' + ctx);
    assert(near(r.outOfPocket, r.raw < 0 ? -r.raw : 0), 'out-of-pocket' + ctx);
    if (r.mood === 'loss') assert(s.coach.includes(M.fmtMoney(r.outOfPocket)), 'loss says its number' + ctx);
    // 3. The waterfall is linear in every branch; her fee is her own rate;
    //    the house cut comes off gross ticket money before the split.
    const others = inp.musicians * inp.musicianRate + inp.singers * inp.singerRate;
    assert(near(r.herFee, inp.artistRate), 'her fee is her rate' + ctx);
    assert(near(r.herFeePaid + r.guaranteeLeft - r.ownerGap, inp.guarantee - others), 'identity' + ctx);
    assert(near(r.ticketShare, Math.max(0, inp.ticketsSold * inp.ticketPrice - inp.houseCut) * inp.split), 'house cut' + ctx);
    assert(near(r.raw, inp.guarantee - others + r.ticketShare - inp.promo - inp.bookingFee), 'blend' + ctx);
    // 3b. Band-shortfall and fee-status notes always match the waterfall,
    //     and the shortfall's parts sum to the whole.
    const bandPay = others + r.herFee;
    assert.strictEqual(s.bandShort, inp.guarantee < bandPay - 1e-9, 'band short flag' + ctx);
    if (s.bandShort) {
      assert(s.bandNote.includes(M.fmtMoney(bandPay - inp.guarantee)), 'shortfall names the total short' + ctx);
      if (r.ownerGap > 0) assert(s.bandNote.includes(M.fmtMoney(r.ownerGap)), 'ticket-money part named' + ctx);
      const feeMissing = r.herFee - r.herFeePaid;
      if (feeMissing > 0) assert(s.bandNote.includes(M.fmtMoney(feeMissing)), 'forfeit part named' + ctx);
      assert(near(r.ownerGap + (r.herFee - r.herFeePaid), bandPay - inp.guarantee) || inp.guarantee > bandPay, 'parts sum to the short' + ctx);
    }
    const expectFee = r.herFee <= 0 ? 'covered'
      : (r.herFeePaid >= r.herFee ? 'covered' : (r.herFeePaid > 0 ? 'partial' : 'forfeit'));
    assert.strictEqual(s.feeState, expectFee, 'fee state' + ctx);
    if (r.guaranteeLeft > 0) assert(s.leftNote.includes(M.fmtMoney(r.guaranteeLeft)), 'surplus named' + ctx);
    else assert.strictEqual(s.leftNote, '', 'no phantom surplus' + ctx);
    if (s.feeState === 'partial') assert(s.feeNote.includes(M.fmtMoney(r.herFeePaid)), 'partial names paid amount' + ctx);
    if (s.feeState === 'forfeit' && r.herFee > 0) assert(s.feeNote.includes(M.fmtMoney(r.herFee)), 'forfeit names the fee' + ctx);
    // 3c. Break-even is minimal and its note matches the state.
    if (r.breakEven === 0) {
      assert(M.estimate({ ...inp, ticketsSold: 0 }).raw >= -1e-6, 'be=0 means out of the red at zero sales' + ctx);
    } else if (r.breakEven !== null) {
      assert(M.estimate({ ...inp, ticketsSold: r.breakEven }).raw >= -1e-6, 'raw at break-even' + ctx);
      assert(M.estimate({ ...inp, ticketsSold: r.breakEven - 1 }).raw < 1e-6, 'minimality' + ctx);
    }
    const expectTone = (r.breakEven === null || (r.breakEven > 0 && ((inp.capacity > 0 && r.breakEven > inp.capacity) || r.sold < r.breakEven))) ? 'red' : 'ok';
    assert.strictEqual(s.breakEvenTone, expectTone, 'break-even tone' + ctx);
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
