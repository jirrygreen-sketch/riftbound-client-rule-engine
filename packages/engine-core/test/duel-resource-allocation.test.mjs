// Independent restricted exhaustive oracle for payDuelRuneCost (duel resource kernel CR v1.4),
// promoted into the engine-core test suite. This test exercises the real compiled kernel
// (../dist/duel/resources.js) and keeps a per-requirement DFS feasibility oracle that is
// independent of the source's amount-capacity max-flow, so the kernel is validated against a
// different method (no source max-flow is copied here).
//
// Scope: two domains Fury/Calm plus universal Power `any`; three Power sources each 0..2;
// pool energy fixed 0; requirements 0/1/2 slots, each allowedDomains in {{Fury},{Calm},{Fury,Calm}}
// with amount 1..2.
//
// Trusted boundary: this is an internal pure-primitive test context. The pool snapshot is built
// from a real createDuelResources(...) result and restored through restoreDuelResources (trusted
// engine state), never client input. `cost`/`timing` are trusted test scaffolding, not a public
// room API. No card/effect/actor authority is invented here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelResources, restoreDuelResources, payDuelRuneCost,
} from '../dist/duel/resources.js';

const DOMAINS_RESTRICTED = [['Fury'], ['Calm'], ['Fury', 'Calm']];
const AMOUNTS = [1, 2];
const POWER_SOURCES = ['Fury', 'Calm', 'any'];
const ALL_POWER_KEYS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'any'];

const locs = [{ playerId: 'p1', locationId: 'base:p1' }, { playerId: 'p2', locationId: 'base:p2' }];
const ACTOR = 'p1';
const OTHER = 'p2';
// Trusted internal context: actor is the resource-payment player (429.3 / 357.1.a path).
const timing = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: ACTOR };

// Real legal setup: 2 players, 2 bases, empty Rune Decks.
const EMPTY_SNAPSHOT = createDuelResources({ playerIds: [ACTOR, OTHER], baseLocations: locs, runeDecks: [[], []] });

function withPool(fury, calm, any) {
  const raw = structuredClone(EMPTY_SNAPSHOT);
  raw.players[0].runePool.energy = 0;
  raw.players[0].runePool.power.Fury = fury;
  raw.players[0].runePool.power.Calm = calm;
  raw.players[0].runePool.power.any = any;
  return restoreDuelResources(raw, locs);
}

// ---- Independent feasibility oracle: DFS over requirement slots ----
function feasible(fury, calm, anyPower, reqs) {
  const avail = { Fury: fury, Calm: calm, any: anyPower };
  const slots = reqs.map(r => ({
    allowed: r.allowedDomains,
    amount: r.amount,
    sources: POWER_SOURCES.filter(s => s === 'any' || r.allowedDomains.includes(s)),
  }));

  function fillSlot(slotIndex) {
    if (slotIndex === slots.length) return true;
    const slot = slots[slotIndex];
    // Assign this slot's whole amount across its allowed sources (any split allowed).
    function assign(sourceIndex, remaining) {
      if (remaining === 0) return fillSlot(slotIndex + 1);
      if (sourceIndex === slot.sources.length) return false;
      const s = slot.sources[sourceIndex];
      const maxUse = Math.min(avail[s], remaining);
      for (let use = maxUse; use >= 0; use--) {
        avail[s] -= use;
        if (assign(sourceIndex + 1, remaining - use)) { avail[s] += use; return true; }
        avail[s] += use;
      }
      return false;
    }
    return assign(0, slot.amount);
  }
  return fillSlot(0);
}

// ---- Cost enumeration ----
function reqShapes() {
  const out = [];
  for (const allowedDomains of DOMAINS_RESTRICTED) for (const amount of AMOUNTS) out.push({ allowedDomains, amount });
  return out;
}
const REQ_SHAPES = reqShapes(); // 6
const costs = [{ energy: 0, power: [] }];
for (const a of REQ_SHAPES) costs.push({ energy: 0, power: [a] });
for (const a of REQ_SHAPES) for (const b of REQ_SHAPES) costs.push({ energy: 0, power: [a, b] }); // 43 total

// ---- Assertions on a successful payment ----
function assertPlanValid(plan, reqs, poolPower) {
  const spent = { Fury: 0, Calm: 0, any: 0 };
  const perReq = reqs.map(() => 0);
  const seen = new Set();
  for (const entry of plan.power) {
    assert.ok(Number.isSafeInteger(entry.amount) && entry.amount > 0, 'allocation amount positive safe integer');
    assert.ok(entry.requirementIndex >= 0 && entry.requirementIndex < reqs.length, 'requirement index in range');
    const key = `${entry.requirementIndex}:${entry.from}`;
    assert.ok(!seen.has(key), 'no duplicate (requirement, from) pair');
    seen.add(key);
    if (entry.from !== 'any') {
      assert.ok(reqs[entry.requirementIndex].allowedDomains.includes(entry.from), 'from domain is allowed');
    }
    perReq[entry.requirementIndex] += entry.amount;
    spent[entry.from] += entry.amount;
  }
  reqs.forEach((r, i) => assert.equal(perReq[i], r.amount, 'requirement fully covered'));
  for (const s of POWER_SOURCES) assert.ok(spent[s] <= poolPower[s], `source ${s} within capacity`);
  return spent;
}

test('restricted exhaustive oracle: 1161 cost/pool cases, DFS feasibility, 0 mismatches, greedy trap retained', () => {
  let cases = 0;
  let feasibleCases = 0;
  let infeasibleCases = 0;
  const mismatches = [];

  for (let fury = 0; fury <= 2; fury++) {
    for (let calm = 0; calm <= 2; calm++) {
      for (let anyPower = 0; anyPower <= 2; anyPower++) {
        for (const cost of costs) {
          cases++;
          const state = withPool(fury, calm, anyPower);
          const frozen = structuredClone(state);
          const poolPower = { Fury: fury, Calm: calm, any: anyPower };
          const expectFeasible = feasible(fury, calm, anyPower, cost.power);

          if (expectFeasible) {
            feasibleCases++;
            const result = payDuelRuneCost(state, ACTOR, cost, timing);
            const spent = assertPlanValid(result.plan, cost.power, poolPower);

            // Input snapshot untouched.
            assert.deepEqual(state, frozen, 'input state unchanged after success');

            // Energy stays 0; remaining Power is exactly pool minus spent; other domains 0.
            const outPool = result.resources.players[0].runePool;
            assert.equal(outPool.energy, 0, 'energy stays 0');
            for (const d of ALL_POWER_KEYS) {
              const expected = POWER_SOURCES.includes(d) ? poolPower[d] - spent[d] : 0;
              assert.equal(outPool.power[d], expected, `remaining ${d}`);
            }

            // Other player and shared state completely unchanged.
            assert.deepEqual(result.resources.players[1], state.players[1], 'other player unchanged');
            assert.deepEqual(result.resources.bases, state.bases, 'bases unchanged');
            assert.deepEqual(result.resources.retiredGoldUids, state.retiredGoldUids, 'retired unchanged');

            // No aliasing into the input.
            assert.notStrictEqual(result.resources, state);
            assert.notStrictEqual(result.resources.players[0].runePool.power, state.players[0].runePool.power);
            assert.notStrictEqual(result.plan, cost);

            // Explicit replay of the returned plan on the original snapshot reproduces balances.
            const explicit = payDuelRuneCost(state, ACTOR, cost, timing, result.plan);
            assert.deepEqual(explicit.resources.players[0].runePool, outPool, 'explicit plan reproduces balances');
            assert.deepEqual(explicit.plan, result.plan, 'explicit plan echoed');
          } else {
            infeasibleCases++;
            assert.throws(() => payDuelRuneCost(state, ACTOR, cost, timing), (e) => e instanceof TypeError);
            assert.deepEqual(state, frozen, 'infeasible input unchanged field-by-field');
          }
        }
      }
    }
  }

  assert.equal(cases, 1161, '1161 exhaustive cases');
  assert.equal(feasibleCases + infeasibleCases, cases, 'every case classified');
  assert.deepEqual(mismatches, [], 'independent DFS oracle agrees with kernel: 0 mismatches');

  // ---- Explicit greedy trap: flexible Calm|Fury requirement then strict Fury requirement ----
  const trapState = withPool(1, 1, 0); // Calm 1, Fury 1, any 0
  const trapCost = { energy: 0, power: [
    { allowedDomains: ['Calm', 'Fury'], amount: 1 },
    { allowedDomains: ['Fury'], amount: 1 },
  ] };
  assert.equal(feasible(1, 1, 0, trapCost.power), true, 'trap is feasible by oracle');
  const r = payDuelRuneCost(trapState, ACTOR, trapCost, timing);
  const byReq = r.plan.power.map(a => [a.requirementIndex, a.from, a.amount]).sort();
  assert.deepEqual(byReq, [[0, 'Calm', 1], [1, 'Fury', 1]], 'flexible takes Calm, strict keeps Fury');
  assert.equal(r.resources.players[0].runePool.power.Calm, 0);
  assert.equal(r.resources.players[0].runePool.power.Fury, 0);
});
