// RIFT-662 / packages/card-dsl/src/cards/README.md §4.1: template-level
// parameterized golden for the activated+activated || continuous.grant-keyword
// signature (Temporal Portal, Megatusk, Eye of Twilight).
//
// One independent row per card carries its own canonical identity, printed
// cost, setup, operation and expected assertion. Every row executes the
// original ability body through the real ProgramBinding / ChainEngine /
// EventPipeline path (effects/testing/scenario); nothing is settled by a
// fixture or a hand-made frame/zone/resource change.
//
// All three programs still carry a documented rule gap outside this path
// (granted-keyword consumers, one-shot next-spell window / dynamic Repeat
// cost), so they stay judge-required. runCardScenario deliberately refuses
// judge-required programs; executionSlice() below swaps validation metadata
// only - abilities, costs, targets and sourceText stay exactly as printed.
// Passing a row is therefore partial execution evidence for the supported
// path, never evidence for promotion.
import assert from "node:assert/strict";
import test from "node:test";

import temporalPortal from "../../../dist/cards/sfd/temporal-portal.js";
import megatusk from "../../../dist/cards/unl/megatusk.js";
import eyeOfTwilight from "../../../dist/cards/ven/eye-of-twilight.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement as movementQuery } from "../../../../engine-core/dist/layers/rules/index.js";

const ALL_SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

/**
 * The production chain context normalizes relative player selectors before it
 * queries (chain/engine.ts resolves controller:"self" to the ability
 * controller). Direct body execution in the reference kernel must go through
 * the same normalization, otherwise the printed { controller: "self" } filter
 * matches nothing.
 */
function bodyContext(base, controller = "A") {
  return bindResolveContext(base, {
    query: filter => base.query({
      ...filter,
      ...(filter.controller === "self" ? { controller } : {}),
      ...(filter.owner === "self" ? { owner: controller } : {}),
    }),
  });
}

function executionSlice(program) {
  // Validation metadata only: the harness rejects judge-required programs, and
  // each card's real gap lives outside the path exercised below.
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
        // Gear keeps its printed energy 3 / power null (no rewriting to 0).
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
          // 359.3.f "here" + controller scope: only the source and your units
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

test("RIFT-662 guard: all three originals are judge-required and the harness refuses them", () => {
  for (const program of [temporalPortal, megatusk, eyeOfTwilight]) {
    assert.equal(program.status, "judge-required");
    assert.throws(() => runCardScenario(program, {}), {
      message: `Scenario program ${program.canonicalCardId} is judge-required`,
    });
  }
});

test("RIFT-662 boundary: the grant is ignored, not applied, when the selected unit left the Board", () => {
  // 359.3.e.7: a target that left the Board before resolution is mistargeted;
  // the merged primitive must not lock a stale ref and register a grant.
  const kernel = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board", might: null })
    .unit("ally", { owner: "A", controller: "A" })
    .build();
  const stale = kernel.ref("ally");
  kernel.setTargets("eye-of-twilight.unit", [stale]);
  kernel.perform({ type: "kill", object: stale });

  const outcome = resolveChainBody(eyeOfTwilight.abilities[0].body, bodyContext(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result), [{ status: "ignored", reason: "mistargeted" }]);
  assert.equal(kernel.continuousEffects.length, 0);
});

test("RIFT-662 boundary: the granted keyword carries the printed end-of-turn duration", () => {
  // 317.1.a / 468.7.c: Eye of Twilight's "this turn" grant expires at the end
  // of the turn through the merged ability-layer duration, not permanently.
  const kernel = world()
    .unit("eye-of-twilight", { types: ["legend"], zone: "board", might: null })
    .unit("ally", { owner: "A", controller: "A" })
    .build();
  kernel.setTargets("eye-of-twilight.unit", [kernel.ref("ally")]);
  const outcome = resolveChainBody(eyeOfTwilight.abilities[0].body, bodyContext(kernel));
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.duration), [{ type: "end-of-turn" }]);

  const registrations = kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }));
  const layers = createLayerEngine(kernel.objects, registrations);
  assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords.map(keyword => keyword.id), ["Tank"]);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords, []);
});

test("RIFT-662 gap evidence: the granted keywords still have no production consumer", () => {
  // Ganking (810.1.b / 810.1.c): the keyword expansion writes the permission as
  // a string while layers/rules/query.ts movement() reads permission.routes, so
  // even a registered printed expansion reports canGank:false for the Standard
  // Move consumer in zones/movement.ts (144.4.c).
  const [gankingExpansion] = keywordDefinitionsById.get("Ganking").expand({
    host: { canonicalCardId: megatusk.canonicalCardId },
  });
  assert.equal(gankingExpansion.kind, "static");
  assert.equal(gankingExpansion.effect.kind, "continuous.movement");
  assert.equal(gankingExpansion.effect.permission, "battlefield-to-battlefield");
  const sourceRef = { id: "ganker", zoneEntryId: 1 };
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "rift-662-ganking-shape",
    layer: "ability",
    source: sourceRef,
    filter: { objectId: sourceRef.id, zoneEntryId: sourceRef.zoneEntryId, zone: "board" },
    effect: gankingExpansion.effect,
  }, { type: "permanent" });
  assert.equal(movementQuery(registry, sourceRef, { ref: sourceRef, zone: "board" }, "A").canGank, false);

  // Tank (815.1.b / 815.1.c.2): the expansion is continuous.combat, and the
  // merged primitive fails closed while layers/engine.ts has no branch for it
  // and combat/base-combat-allocation.ts still requires keywordPriority
  // "proven-none". A granted [Tank] therefore cannot reorder lethal damage yet.
  const [tankExpansion] = keywordDefinitionsById.get("Tank").expand({
    host: { canonicalCardId: eyeOfTwilight.canonicalCardId },
  });
  assert.equal(tankExpansion.kind, "static");
  assert.equal(tankExpansion.effect.kind, "continuous.combat");
  const tankKernel = world().unit("tank-unit", { might: 3 }).build();
  const tankContext = tankKernel.clone({ sourceSnapshot: tankKernel.getObject("tank-unit") });
  const probe = runAbilityBody([{
    id: "rift-662.tank-probe",
    op: "continuous.combat",
    args: {
      flags: { kind: "constant", value: ["tank"] },
      objects: { kind: "constant", value: { kind: "source" } },
      duration: { kind: "constant", value: "this-turn" },
    },
  }], tankContext);
  assert.deepEqual(probe.results.map(result => [result.result.status, result.result.reason]), [["negated", "impossible"]]);
  assert.equal(tankContext.continuousEffects.length, 0);
});

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
    // The printed Power stays on the player; only the paid rune is returned to
    // the pool in the reference kernel, and the Gear keeps printed energy 3.
    assert.deepEqual(result.state.players.A.power, [domain], domain);
    assert.equal(result.state.objects[0].energy, 3, domain);
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

test("RIFT-662 gap evidence: the merged Repeat definition is still the printed self-hosted instance", () => {
  // 820.1.c.2 / 820.1.d.1: the merged Repeat KeywordDef declares one optional
  // additional cost per instance on the source itself. Temporal Portal needs a
  // grant that lands this instance on a future spell instead, which is the
  // one-shot window recorded in its judgeReason.
  const repeat = keywordDefinitionsById.get("Repeat");
  assert.ok(repeat, "the merged Repeat KeywordDef must be registered");
  assert.equal(repeat.valued, false);
  assert.equal(repeat.stacking, "separate");
  const [expansion] = repeat.expand({ host: { canonicalCardId: temporalPortal.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "repeat.cost");
  assert.equal(expansion.effect.appliesTo, "self");
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

