#!/usr/bin/env node
/**
 * Artist's Payout Estimator — acceptance tests.
 * Written fresh from the v2 spec + CEO rulings. Zero dependencies: `node run-tests.js`.
 *
 * The suite extracts the <script id="estimator-math"> block from the SHIPPED
 * page file and tests that exact source, including a wide-range fuzz proving
 * the numbers displayed on screen can never drift from the numbers the math
 * produced (every display string is asserted equal to the formatter applied
 * to engine output on every fuzz case — the page writes the screen only
 * through that pair).
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
  typeof M.fmtMoney === 'function' && typeof M.fmtSigned === 'function',
  'math block must export estimate/summarize/fmtMoney/fmtSigned');

// Both inline scripts must parse as valid JS (catches a broken deploy early).
const wiring = html.match(/<script>\s*\(function \(\) \{\s*'use strict';([\s\S]*?)<\/script>\s*<\/body>/);
assert(wiring, 'page must contain the wiring script');
new Function(wiring[1].replace(/\}\)\(\);\s*$/, ''));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
// CEO defaults of 2026-08-21: guarantee 2,500; musicians 300; singers 125;
// artist 300; sales estimate 50% of the room; house nut 1,200; ads 500;
// misc 200. Band pay = 5×300 + 3×125 + 300 = 2,175.
const DEFAULTS = {
  guarantee: 2500, capacity: 150, ticketPrice: 30, ticketsSold: 75,
  split: 0.80, musicians: 5, musicianRate: 300, singers: 3,
  singerRate: 125, artistRate: 300, bookingFee: 200, promo: 500,
  misc: 200, houseCut: 1200
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

console.log('\nStarting values — the story the defaults tell');
test('defaults: her estimated take-home is $565', () => {
  // fee 300 + surplus 325 + tickets (75×30−1200)×80% = 840, minus 900 costs.
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(M.summarize(r).payoutText, '$565');
  assert(near(r.payout, 565), 'payout ' + r.payout);
});
test('defaults: guarantee pays all 9 players with a green +$325 balance', () => {
  const r = M.estimate(DEFAULTS);
  const s = M.summarize(r);
  assert.strictEqual(r.players, 9);
  assert.strictEqual(r.covered, 9);
  assert(s.coverage.includes('pays all 9'));
  assert(s.bandShort === false);
  assert.strictEqual(s.surplusText, '+$325');
  assert.strictEqual(s.surplusTone, 'pos');
  assert(s.bandNote.includes('the extra $325 rides into your take-home'), s.bandNote);
});

console.log('\nPriority rules (§5)');
test('other players paid first: short guarantee pays her nothing', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1000 });
  assert(near(r.herFeePaid, 0));
  assert(near(r.ownerGap, 875), 'owner covers 1875−1000');
});
test('her rate auto-lowers to what the guarantee affords', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 2000 });
  assert(near(r.herFee, 125), 'shown rate lowered to the affordable 125');
  assert(near(r.herFeeWanted, 300), 'her intended rate is remembered');
  assert(near(r.herFeePaid, 125));
  assert(near(r.guaranteeLeft, 0));
  assert(near(r.ownerGap, 0));
});
test('owner gap comes out of her ticket money', () => {
  const a = M.estimate({ ...DEFAULTS, guarantee: 1875 });
  const b = M.estimate({ ...DEFAULTS, guarantee: 1675 });
  assert(near(a.raw - b.raw, 200), 'a $200 shortfall costs her exactly $200');
});
test('rich guarantee: fee paid, +$825 surplus rides into her take-home', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 3000 });
  assert(near(r.herFeePaid, 300));
  assert(near(r.guaranteeLeft, 825));
  const s = M.summarize(r);
  assert.strictEqual(s.surplusText, '+$825');
  // 300 fee + 825 surplus + 840 tickets − 900 costs = 1065
  assert.strictEqual(s.payoutText, '$1,065');
});

console.log('\nHer rate under the guarantee — one visible number, always earned');
test('defaults: her $300 rate is covered and the screen says so', () => {
  const s = M.summarize(M.estimate(DEFAULTS));
  assert.strictEqual(s.feeState, 'covered');
  assert(s.feeNote.includes('Your $300 rate is covered'), s.feeNote);
});
test('lowered: the note names the usual rate and what is afforded', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2000 }));
  assert.strictEqual(s.feeState, 'lowered');
  assert(s.feeNote.includes('Lowered from your usual $300'), s.feeNote);
  assert(s.feeNote.includes('affords $125 after the band'), s.feeNote);
});
test('lowered to zero when nothing is left after the band', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 1500 }));
  assert.strictEqual(s.feeState, 'lowered');
  assert(s.feeNote.includes('Lowered to $0'), s.feeNote);
});
test('the visible rate auto-adjusts with the numbers and is restored later', () => {
  assert(near(M.estimate(DEFAULTS).herFee, 300));
  assert(near(M.estimate({ ...DEFAULTS, guarantee: 2000 }).herFee, 125));
  assert(near(M.estimate({ ...DEFAULTS, guarantee: 1500 }).herFee, 0));
  // growing the lineup at the same guarantee pulls her rate down
  assert(near(M.estimate({ ...DEFAULTS, musicians: 7 }).herFee, 25));
  assert(near(M.estimate({ ...DEFAULTS, musicians: 8 }).herFee, 0));
  // intended rate remembered: raise the guarantee back → rate returns
  assert(near(M.estimate({ ...DEFAULTS, guarantee: 2500 }).herFee, 300));
});

console.log('\nThe three coaching states (§6)');
test('loss shows red and says the out-of-pocket number out loud', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1500, ticketsSold: 0, promo: 400 });
  assert.strictEqual(r.mood, 'loss');
  assert(near(r.payout, 0), 'floors at $0');
  assert(near(r.outOfPocket, 1175), 'raw = (1500−1875) − 400 − 200 − 200 = −1175');
  assert(M.summarize(r).coach.includes('$1,175'));
  assert(M.summarize(r).coach.includes('out of pocket'));
});
test('amber when the show holds up but she nets under her full set fee', () => {
  // paid fee 125; tickets (79×30−1200)×0.8 = 936; raw = 125+936−900 = 161 —
  // no loss (the flexible money covers the costs), but under her $300.
  const r = M.estimate({ ...DEFAULTS, guarantee: 2000, ticketsSold: 79 });
  assert.strictEqual(r.mood, 'warn');
  assert(near(r.raw, 161));
  assert(M.summarize(r).coach.includes('Each added musician costs $300'));
});
test('GUARANTEED FEE FLOOR: a losing show can never touch her paid fee', () => {
  // zero tickets sold: surplus 325 − costs 900 → the show loses $575,
  // but her guarantee-paid $300 is untouchable — she walks with it.
  const r = M.estimate({ ...DEFAULTS, ticketsSold: 0 });
  assert.strictEqual(r.mood, 'loss');
  assert(near(r.payout, 300), 'floors at her paid fee, not $0');
  assert(near(r.outOfPocket, 575));
  const c = M.summarize(r).coach;
  assert(c.includes('loses $575'), c);
  assert(c.includes('guaranteed $300 is safe'), c);
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
test('band shortfall: with the rate auto-lowered, the short is pure ticket money', () => {
  // G 1000: her rate lowers to $0, so the total is the members' 1875 —
  // $875 short, all of it made up out of ticket money.
  const short = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 1000 }));
  assert(short.bandShort === true);
  assert(short.bandNote.includes('$875 short of this total'), short.bandNote);
  assert(short.bandNote.includes('$875 gets made up out of ticket money'), short.bandNote);
  assert(!short.bandNote.includes('forfeit'), short.bandNote);
  // G 2000: her rate lowers to 125 → the guarantee exactly covers the total
  const exact = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2000 }));
  assert(exact.bandShort === false);
  assert(exact.bandNote.includes('covers the band in full'), exact.bandNote);
});
test('band total includes her (auto-lowered) slot so the column adds up', () => {
  assert.strictEqual(M.summarize(M.estimate(DEFAULTS)).bandText, '$2,175');
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, musicians: 6 })).bandText, '$2,475');
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 0 })).bandText, '$2,175');
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, artistRate: 400 })).bandText, '$2,275');
  // lowered rate lowers the displayed total too — the column stays true
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2000 })).bandText, '$2,000');
});
test('balance figure is signed: +$325 default, $0 when capped, −$375 short of the band', () => {
  assert.strictEqual(M.summarize(M.estimate(DEFAULTS)).surplusText, '+$325');
  const exact = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 2000 }));
  assert.strictEqual(exact.surplusText, '$0');
  assert.strictEqual(exact.surplusTone, 'zero');
  const neg = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 1500 }));
  assert.strictEqual(neg.surplusText, '−$375');
  assert.strictEqual(neg.surplusTone, 'neg');
});
test('green copy frames the number as hers alone, never as the pot', () => {
  const g = M.summarize(M.estimate(DEFAULTS));
  assert(g.coach.includes('yours to take home'), g.coach);
  assert(!g.coach.includes('pays everybody'), 'pot framing is banned: ' + g.coach);
});

console.log('\nMiscellaneous cost');
test('misc comes straight out of her take-home, dollar for dollar', () => {
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, misc: 300 })).payoutText, '$465');
  assert(near(M.estimate(DEFAULTS).payout - M.estimate({ ...DEFAULTS, misc: 450 }).payout, 250));
});
test('misc moves the break-even line', () => {
  // cost 575 + 100 = 675 → (675/0.8 + 1200)/30 = 68.1 → 69 tickets
  assert.strictEqual(M.estimate({ ...DEFAULTS, misc: 300 }).breakEven, 69);
});

console.log('\nBreak-even — where the show climbs out of the red, in tickets');
test('defaults: breaks even at 64 tickets (her guaranteed fee untouched) and 75 clears it', () => {
  // costs 900 + gap 0 − surplus 325 = 575 → (575/0.8 + 1200)/30 = 64
  const r = M.estimate(DEFAULTS);
  assert.strictEqual(r.breakEven, 64);
  const s = M.summarize(r);
  assert(s.breakEvenNote.includes('Breaks even at 64 tickets'), s.breakEvenNote);
  assert(s.breakEvenNote.includes('your 75 estimate clears it'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'ok');
});
test('break-even is exact: 64 tickets keeps the show whole, 63 does not', () => {
  const at = M.estimate({ ...DEFAULTS, ticketsSold: 64 });
  const under = M.estimate({ ...DEFAULTS, ticketsSold: 63 });
  assert(at.flexible >= -1e-6);
  assert(under.flexible < 0);
});
test('estimating below break-even reads red', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, ticketsSold: 40 }));
  assert.strictEqual(s.breakEvenTone, 'red');
  assert(s.breakEvenNote.includes('below that this show is in the red'), s.breakEvenNote);
});
test('a surplus bigger than the costs is out of the red before a ticket sells', () => {
  // G 3100 → surplus 925 covers the 900 costs with room to spare
  const s = M.summarize(M.estimate({ ...DEFAULTS, guarantee: 3100 }));
  assert(s.breakEvenNote.includes('before a single ticket sells'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'ok');
});
test('a room too small to break even says so', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, capacity: 20, ticketsSold: 10 }));
  assert(s.breakEvenNote.includes('takes 64 tickets'), s.breakEvenNote);
  assert(s.breakEvenNote.includes('room holds 20'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'red');
});
test('no ticket money at all: break-even is honestly unreachable', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, ticketPrice: 0 }));
  assert(s.breakEvenNote.includes('can’t break even'), s.breakEvenNote);
  assert.strictEqual(s.breakEvenTone, 'red');
});

console.log('\nThe venue must earn the guarantee back out of ticket money too');
test('defaults: this room can never pay the $2,500 guarantee back', () => {
  const r = M.estimate(DEFAULTS);
  // venue needs gross 1200 + 1300/0.2 = 7700 → 257 tickets > 150 seats;
  // sold out it collects 1200 + 20% × 3300 = 1860.
  assert.strictEqual(r.venueBreakEven, 257);
  assert(near(r.venueTakeAtCap, 1860));
  const s = M.summarize(r);
  assert.strictEqual(s.venueTone, 'red');
  assert(s.venueNote.includes('Even sold out, the venue collects $1,860'), s.venueNote);
  assert(s.venueNote.includes('$2,500 guarantee'), s.venueNote);
});
test('a higher ticket price makes the venue whole inside the room', () => {
  const r = M.estimate({ ...DEFAULTS, ticketPrice: 60 });
  assert.strictEqual(r.venueBreakEven, 129);
  const below = M.summarize(r);
  assert.strictEqual(below.venueTone, 'warn');
  assert(below.venueNote.includes('back at 129 tickets'), below.venueNote);
  assert(below.venueNote.includes('estimating 75'), below.venueNote);
  const above = M.summarize(M.estimate({ ...DEFAULTS, ticketPrice: 60, ticketsSold: 130 }));
  assert.strictEqual(above.venueTone, 'ok');
  assert(above.venueNote.includes('your 130 estimate covers it'), above.venueNote);
});
test('a guarantee inside the house nut is earned back fast', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 1000 });
  assert.strictEqual(r.venueBreakEven, 34);
  assert.strictEqual(M.summarize(r).venueTone, 'ok');
});
test('a 100% artist split above the nut can never pay the venue back', () => {
  const s = M.summarize(M.estimate({ ...DEFAULTS, split: 1.0 }));
  assert.strictEqual(s.venueTone, 'red');
  assert(s.venueNote.includes('can never pay the venue back'), s.venueNote);
});
test('no guarantee, no earn-back line', () => {
  assert.strictEqual(M.summarize(M.estimate({ ...DEFAULTS, guarantee: 0 })).venueNote, '');
});

console.log('\nHouse cut (the venue\'s nut, off ticket money before her split)');
test('house cut comes off gross before the split: share is exactly $840', () => {
  const r = M.estimate(DEFAULTS);
  assert(near(r.ticketShare, 840));
});
test('no house cut: her share jumps to $1,800 and payout to $1,525', () => {
  const r = M.estimate({ ...DEFAULTS, houseCut: 0 });
  assert(near(r.ticketShare, 1800));
  assert.strictEqual(M.summarize(r).payoutText, '$1,525');
});
test('house cut larger than gross zeroes the ticket money, never negative', () => {
  assert(near(M.estimate({ ...DEFAULTS, houseCut: 5000 }).ticketShare, 0));
});

console.log('\nVisible totals — costs and ticket revenue');
test('total costs: $900 at defaults, moves with each cost', () => {
  assert(near(M.estimate(DEFAULTS).costsTotal, 900));
  assert(near(M.estimate({ ...DEFAULTS, misc: 500 }).costsTotal, 1200));
});
test('ticket revenue chain: $2,250 sales, $1,200 kept, $840 share', () => {
  const r = M.estimate(DEFAULTS);
  assert(near(r.ticketGross, 2250));
  assert(near(r.houseKept, 1200));
  assert(near(r.ticketShare, 840));
});
test('a gross below the nut: the venue keeps it all, her share is $0', () => {
  const r = M.estimate({ ...DEFAULTS, ticketsSold: 30 });
  assert(near(r.ticketGross, 900));
  assert(near(r.houseKept, 900));
  assert(near(r.ticketShare, 0));
});

console.log('\nEdges');
test('all zeros: $0, one player (her), no crash', () => {
  const r = M.estimate({ guarantee: 0, capacity: 0, ticketPrice: 0, ticketsSold: 0,
    split: 0, musicians: 0, musicianRate: 0, singers: 0, singerRate: 0,
    artistRate: 0, bookingFee: 0, promo: 0, misc: 0, houseCut: 0 });
  assert(near(r.payout, 0));
  assert.strictEqual(r.players, 1);
  assert.strictEqual(M.summarize(r).venueNote, '');
});
test('negative and junk inputs are treated as zero', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: -50, promo: 'abc' });
  assert(near(r.ownerGap, 1875));
  assert(!Number.isNaN(r.payout));
});
test('nothing is capped: huge values compute cleanly', () => {
  const r = M.estimate({ ...DEFAULTS, guarantee: 250000, ticketPrice: 1000, capacity: 20000, ticketsSold: 20000 });
  assert(near(r.raw, 250000 - 1875 + r.ticketShare - 500 - 200 - 200));
  assert(near(r.ticketShare, (20000 * 1000 - 1200) * 0.8));
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
      artistRate: pick(2000), bookingFee: pick(5000), promo: pick(5000),
      misc: pick(5000), houseCut: pick(8000)
    };
    const r = M.estimate(inp);
    const s = M.summarize(r);
    const ctx = ' [case ' + i + ' ' + JSON.stringify(inp) + ']';

    // 1. The screen's numbers ARE the math's numbers, formatted — nothing else.
    assert.strictEqual(s.payoutText, M.fmtMoney(r.payout), 'display drift' + ctx);
    assert.strictEqual(s.bandText, M.fmtMoney(r.others + r.herFee), 'band display drift' + ctx);
    assert(/^\$[\d,]+$/.test(s.payoutText), 'money format' + ctx);
    // 2. The guaranteed-fee floor; the loss is reported, never hidden.
    assert(near(r.flexible, r.raw - r.herFeePaid), 'flexible split' + ctx);
    assert(near(r.payout, r.herFeePaid + Math.max(0, r.flexible)), 'guaranteed-fee floor' + ctx);
    assert(r.payout >= r.herFeePaid - 1e-6, 'paid fee never lost' + ctx);
    assert(near(r.outOfPocket, r.flexible < 0 ? -r.flexible : 0), 'show loss' + ctx);
    if (r.mood === 'loss') {
      assert(s.coach.includes(M.fmtMoney(r.outOfPocket)), 'loss says its number' + ctx);
      if (r.herFeePaid > 0) assert(s.coach.includes('guaranteed'), 'protected fee named in loss' + ctx);
    }
    // 3. The waterfall is linear in every branch; her fee is her own rate;
    //    the house cut comes off gross ticket money before the split.
    const others = inp.musicians * inp.musicianRate + inp.singers * inp.singerRate;
    const affordable = Math.max(0, inp.guarantee - others);
    assert(near(r.herFee, Math.min(inp.artistRate, affordable)), 'shown rate = min(wanted, affordable)' + ctx);
    assert(near(r.herFeeWanted, inp.artistRate), 'intended rate remembered' + ctx);
    assert(near(r.herFeePaid, r.herFee), 'shown rate is always fully paid' + ctx);
    assert(r.herFee <= affordable + 1e-9, 'rate can never sit above the guarantee' + ctx);
    assert(near(r.herFeePaid + r.guaranteeLeft - r.ownerGap, inp.guarantee - others), 'identity' + ctx);
    assert(near(r.ticketShare, Math.max(0, inp.ticketsSold * inp.ticketPrice - inp.houseCut) * inp.split), 'house cut' + ctx);
    assert(near(r.costsTotal, inp.promo + inp.bookingFee + inp.misc), 'costs total' + ctx);
    assert(near(r.ticketGross, inp.ticketsSold * inp.ticketPrice), 'ticket gross' + ctx);
    assert(near(r.houseKept, Math.min(inp.houseCut, r.ticketGross)), 'house kept' + ctx);
    assert(near(r.raw, inp.guarantee - others + r.ticketShare - inp.promo - inp.bookingFee - inp.misc), 'blend' + ctx);
    // 3b. Band-shortfall and fee-status notes always match the waterfall,
    //     and the shortfall's parts sum to the whole.
    const bandPay = others + r.herFee;
    assert.strictEqual(s.bandShort, inp.guarantee < bandPay - 1e-9, 'band short flag' + ctx);
    if (s.bandShort) {
      assert(s.bandNote.includes(M.fmtMoney(bandPay - inp.guarantee)), 'shortfall names the total short' + ctx);
      assert(near(r.ownerGap, bandPay - inp.guarantee), 'a short total is pure ticket money now' + ctx);
      assert(!s.bandNote.includes('forfeit'), 'no forfeit language in the band note' + ctx);
    }
    const expectFee = r.herFeeWanted <= 0 ? 'covered'
      : (r.herFee >= r.herFeeWanted ? 'covered' : 'lowered');
    assert.strictEqual(s.feeState, expectFee, 'fee state' + ctx);
    if (s.feeState === 'lowered') {
      assert(s.feeNote.includes('Lowered'), 'lowered note' + ctx);
      if (r.herFee > 0) assert(s.feeNote.includes(M.fmtMoney(r.herFee)), 'lowered names the afforded rate' + ctx);
    }
    assert.strictEqual(s.surplusText, M.fmtSigned(inp.guarantee - bandPay), 'balance figure drift' + ctx);
    const sv = inp.guarantee - bandPay;
    assert.strictEqual(s.surplusTone, sv < -1e-9 ? 'neg' : (sv > 1e-9 ? 'pos' : 'zero'), 'balance tone' + ctx);
    if (s.surplusTone === 'pos') assert(s.bandNote.includes('rides into your take-home'), 'pos balance explained' + ctx);
    // 3c. Break-even is minimal (in the fee-floor economics) and its note
    //     matches the state.
    if (r.breakEven === 0) {
      assert(M.estimate({ ...inp, ticketsSold: 0 }).flexible >= -1e-6, 'be=0 means out of the red at zero sales' + ctx);
    } else if (r.breakEven !== null) {
      assert(M.estimate({ ...inp, ticketsSold: r.breakEven }).flexible >= -1e-6, 'whole at break-even' + ctx);
      assert(M.estimate({ ...inp, ticketsSold: r.breakEven - 1 }).flexible < 1e-6, 'minimality' + ctx);
    }
    const expectTone = (r.breakEven === null || (r.breakEven > 0 && ((inp.capacity > 0 && r.breakEven > inp.capacity) || r.sold < r.breakEven))) ? 'red' : 'ok';
    assert.strictEqual(s.breakEvenTone, expectTone, 'break-even tone' + ctx);
    // 3d. The venue's earn-back line matches its own arithmetic.
    const vt = (n) => { const g = n * inp.ticketPrice; return g <= inp.houseCut ? g : inp.houseCut + (1 - inp.split) * (g - inp.houseCut); };
    assert(near(r.venueTakeAtCap, vt(inp.capacity)), 'venue take at cap' + ctx);
    if (inp.guarantee <= 0) assert.strictEqual(s.venueNote, '', 'no earn-back line without a guarantee' + ctx);
    else if (r.venueBreakEven !== null && r.venueBreakEven > 0) {
      assert(vt(r.venueBreakEven) >= inp.guarantee - 1e-6, 'venue whole at its break-even' + ctx);
      assert(vt(r.venueBreakEven - 1) < inp.guarantee + 1e-6, 'venue break-even minimality' + ctx);
    }
    if (inp.guarantee > 0) {
      const vExpect = (r.venueBreakEven === null || (inp.capacity > 0 && r.venueBreakEven > inp.capacity)) ? 'red'
        : (r.sold >= r.venueBreakEven ? 'ok' : 'warn');
      assert.strictEqual(s.venueTone, vExpect, 'venue tone' + ctx);
    }
    // 4. Mood: show loss beats amber beats green — amber measured against
    //    the rate she WANTS, not the lowered one.
    const expect = r.flexible < 0 ? 'loss' : (r.payout < r.herFeeWanted ? 'warn' : 'good');
    assert.strictEqual(r.mood, expect, 'mood' + ctx);
    // 5. Coverage stays inside the lineup.
    assert(r.covered >= 0 && r.covered <= r.players, 'coverage bounds' + ctx);
    assert.strictEqual(r.players, inp.musicians + inp.singers + 1, 'she is +1' + ctx);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
