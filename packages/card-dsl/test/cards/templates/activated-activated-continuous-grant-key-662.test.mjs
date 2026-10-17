// RIFT-662 template-level parameterized golden (README §4.1).
//
// One row per card carries its own canonical identity, printed cost, world,
// operation and card-specific expected assertions. The three programs stay
// judge-required: each row's scenario.run() needs an executable status, so
// each row builds a transient execution slice (validation metadata only;
// abilities, costs, targets and sourceText stay exactly as printed). Passing
// a row is evidence for its supported path only - never for promotion.
//
// This file is additive execution evidence: the per-card layer 1 (validation
// and identity), layer 2 (structure), negative-evidence and boundary
// assertions stay in each card's own test file.
import assert from "node:assert/strict";
import test from "node:test";

import temporalPortal from "../../../dist/cards/sfd/temporal-portal.js";
import megatusk from "../../../dist/cards/unl/megatusk.js";
import eyeOfTwilight from "../../../dist/cards/ven/eye-of-twilight.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

function executionSlice(program) {
  const { judgeReason: _judgeReason, ...identity } = program;
  return { ...identity, status: "executable" };
}

const temporalPortalSlice = executionSlice(temporalPortal);
const megatuskSlice = executionSlice(megatusk);
const eyeOfTwilightSlice = executionSlice(eyeOfTwilight);

const portalObject = (overrides = {}) => ({
  id: "temporal-portal",
  cardId: temporalPortal.canonicalCardId,
  types: ["gear"],
  zone: "board",
  location: { type: "base", player: "A" },
  energy: 3,
  power: null,
  ...overrides,
});

const megatuskObject = (overrides = {}) => ({
  id: "megatusk",
  cardId: megatusk.canonicalCardId,
  types: ["unit"],
  zone: "board",
  location: { type: "battlefield", id: "bf-1" },
  might: 6,
  energy: 6,
  power: null,
  ...overrides,
});

const eyeObject = (overrides = {}) => ({
  id: "eye-of-twilight",
  cardId: eyeOfTwilight.canonicalCardId,
  types: ["legend"],
  zone: "board",
  location: { type: "base", player: "A" },
  might: null,
  energy: null,
  power: null,
  ...overrides,
});

const rows = [
  {
    name: "sfd-078-221 Temporal Portal: printed :rb_rune_rainbow: + :rb_exhaust: activation",
    canonicalCardId: temporalPortal.canonicalCardId,
    program: temporalPortalSlice,
    scenario: {
      players: { A: { power: ["Body"] } },
      objects: [portalObject()],
      operations: [{ type: "activate", object: "temporal-portal", player: "A" }],
      expect: {
        // 135.2.e.5.a / 415.5: the printed [A] and Exhaust really resolve; the
        // Gear keeps its printed energy 3 / power null (never rewritten to 0).
        objects: { "temporal-portal": { zone: "board", energy: 3, power: null, exhausted: true } },
        events: {
          includes: [
            { timingPoint: "object-exhausted", action: { type: "exhaust", object: { id: "temporal-portal" } } },
            { timingPoint: "chain-item-finalize", object: { ref: "temporal-portal" } },
          ],
        },
      },
    },
    verify: (result) => {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.costPlan.total.energy, 0);
      assert.deepEqual(item.costPlan.total.power, [{ amount: 1, allowedDomains: ALL_SIX_DOMAINS }]);
      assert.deepEqual(item.payment.actions.map(entry => [entry.action.type, entry.status]), [
        ["pay", "done"],
        ["exhaust", "done"],
      ]);
      assert.deepEqual(item.payment.power.power, [{ requirementIndex: 0, from: "Body", amount: 1 }]);
    },
  },
  {
    name: "unl-126-219 Megatusk: Spend 3 XP grants [Ganking] to your units here this turn",
    canonicalCardId: megatusk.canonicalCardId,
    program: megatuskSlice,
    scenario: {
      players: { A: { xp: 5 } },
      objects: [
        megatuskObject(),
        { id: "ally-here", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
        { id: "ally-elsewhere", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-2" }, might: 3 },
        { id: "enemy-here", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 },
      ],
      operations: [
        { type: "activate", object: "megatusk", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        // 730.2: Spend 3 XP really reduces the marked XP.
        players: { A: { xp: 2 } },
        objects: {
          // 359.3.f 'here' + controller scope: only the source and your units
          // at the source's battlefield get the granted characteristic (810.3).
          megatusk: { keywords: [{ id: "Ganking" }] },
          "ally-here": { keywords: [{ id: "Ganking" }] },
          "ally-elsewhere": { keywords: [] },
          "enemy-here": { keywords: [] },
        },
      },
    },
    verify: (result) => {
      assert.deepEqual(
        result.links["megatusk.grant-ganking.granted.objects"].map(ref => ref.id),
        ["ally-here", "megatusk"],
      );
      // Gap evidence: the granted characteristic does not become a movement
      // permission (810.1.c / 144.4.c); the consumer gap is asserted below.
      const byId = new Map(result.state.objects.map(object => [object.ref.id, object]));
      assert.deepEqual(byId.get("megatusk").movement, { allowed: true, canMove: true, canGank: false, restrictions: [] });
      assert.deepEqual(byId.get("ally-here").keywords.map(keyword => keyword.id), ["Ganking"]);
    },
  },
  {
    name: "ven-147-166 Eye of Twilight: Exhaust grants [Tank] to a friendly unit this turn",
    canonicalCardId: eyeOfTwilight.canonicalCardId,
    program: eyeOfTwilightSlice,
    scenario: {
      objects: [
        eyeObject(),
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "other-ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      answers: { "target:eye-of-twilight.unit": ["ally"] },
      operations: [
        { type: "activate", object: "eye-of-twilight", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          // 204.1.b / 415.5 + 355.9: the Exhaust cost resolves and only the
          // chosen friendly unit carries the granted [Tank] (815.3).
          "eye-of-twilight": { zone: "board", energy: null, power: null, exhausted: true },
          ally: { keywords: [{ id: "Tank" }] },
          "other-ally": { keywords: [] },
          enemy: { keywords: [] },
        },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: "ally" } },
            { timingPoint: "object-exhausted", action: { type: "exhaust", object: { id: "eye-of-twilight" } } },
          ],
        },
      },
    },
    verify: (result) => {
      assert.deepEqual(result.links["eye-of-twilight.grant-tank.granted.objects"].map(ref => ref.id), ["ally"]);
      const byId = new Map(result.state.objects.map(object => [object.ref.id, object]));
      assert.deepEqual(byId.get("ally").keywords.map(keyword => keyword.id), ["Tank"]);
      assert.deepEqual(byId.get("other-ally").keywords, []);
      assert.deepEqual(byId.get("enemy").keywords, []);
    },
  },
];

const templateCases = defineTemplateSuite("RIFT-662 activated || continuous.grant-keyword", rows);
for (const [index, templateCase] of templateCases.entries()) {
  test(templateCase.name, () => {
    const result = templateCase.run();
    rows[index].verify(result);
  });
}

test("RIFT-662 boundary: Temporal Portal without any Power cannot pay its printed [A]", () => {
  assert.throws(
    () => runCardScenario(temporalPortalSlice, {
      players: { A: { power: [] } },
      objects: [portalObject()],
      operations: [{ type: "activate", object: "temporal-portal", player: "A" }],
    }),
    error => error?.reason === "cannot-pay-cost",
  );
});

test("RIFT-662 boundary: Temporal Portal pays its printed \"any domain Power\" with every one of the six domains", () => {
  // 135.2.e.5.a / 163.2.b: [A] is one Power of any Domain, so each domain must
  // be able to pay it through the real Finalize plan and payment pipeline.
  for (const domain of ALL_SIX_DOMAINS) {
    const result = runCardScenario(temporalPortalSlice, {
      players: { A: { power: [domain] } },
      objects: [portalObject()],
      operations: [{ type: "activate", object: "temporal-portal", player: "A" }],
      expect: {},
    });
    const [item] = result.state.chain;
    assert.equal(item.status, "finalized", domain);
    assert.deepEqual(item.payment.power.power, [{ requirementIndex: 0, from: domain, amount: 1 }], domain);
    assert.deepEqual(item.payment.actions.map(entry => [entry.action.type, entry.status]), [
      ["pay", "done"],
      ["exhaust", "done"],
    ], domain);
    assert.equal(result.state.objects[0].exhausted, true, domain);
  }
});

test("RIFT-662 boundary: an already-exhausted source cannot pay an Exhaust cost (415.4)", () => {
  // 415.4: an Exhaust cost must be completable; the merged cost pipeline
  // refuses instead of paying partially.
  assert.throws(
    () => runCardScenario(eyeOfTwilightSlice, {
      objects: [
        eyeObject({ exhausted: true }),
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      answers: { "target:eye-of-twilight.unit": ["ally"] },
      operations: [{ type: "activate", object: "eye-of-twilight", player: "A" }],
    }),
    error => error?.reason === "cannot-pay-cost" && /ready controlled object/.test(error.message),
  );
});

test("RIFT-662 boundary: Eye of Twilight without a friendly unit has no legal target", () => {
  assert.throws(
    () => runCardScenario(eyeOfTwilightSlice, {
      objects: [
        eyeObject(),
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      operations: [{ type: "activate", object: "eye-of-twilight", player: "A" }],
    }),
    error => error?.code === "no-legal-targets",
  );
});

test("RIFT-662 boundary: Megatusk with fewer than 3 XP is refused, not partially paid", () => {
  assert.throws(
    () => runCardScenario(megatuskSlice, {
      players: { A: { xp: 2 } },
      objects: [megatuskObject()],
      operations: [{ type: "activate", object: "megatusk", player: "A" }],
    }),
    error => error?.reason === "cannot-pay-cost" && /Insufficient XP/.test(error.message),
  );
});
