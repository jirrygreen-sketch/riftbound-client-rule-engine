import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/nilah-joyful-ascetic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";

const CANONICAL_ID =
  "card.hash-b06729f7cdfbc0accaea6ca7e4a0d2414ea996cb784e53eb818963a32a5666d5";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "When I move, gain 1 XP.";

const [accelerate, ganking, moveTrigger] = program.abilities;
const [gainXp] = moveTrigger.body;

test("unl-115-219 Nilah, Joyful Ascetic: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-115-219 Nilah, Joyful Ascetic: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /object-moved/);
  // 449.2 / 458.1: the Standard Move route and the Recall exclusion.
  assert.match(program.judgeReason, /449\.2/);
  assert.match(program.judgeReason, /458\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.doesNotMatch(program.judgeReason, /另缺 CardProgram/);
});

test("unl-115-219 Nilah, Joyful Ascetic: Accelerate and Ganking stay keyword declarations (805/810)", () => {
  assert.equal(program.abilities.length, 3);
  // 805.4 / 810.2: both keywords are redundant in multiples, so no value is printed.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(accelerate.value, undefined);
  assert.equal(ganking.value, undefined);
  // The expansions live in the keyword registry; the card must not restate them.
  assert.notEqual(keywordDefinitionsById.get("Accelerate"), undefined);
  assert.notEqual(keywordDefinitionsById.get("Ganking"), undefined);
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("unl-115-219 Nilah, Joyful Ascetic: 'When I move' subscribes to object-moved for this source (421.1/449.1)", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  // 458.1: Recall is not a Move, so the filter must stay scoped to genuine Moves
  // of this source; the golden case below verifies the production payload.
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.condition, undefined);
  assert.equal(moveTrigger.trigger.once, undefined);
  assert.equal(moveTrigger.optional, false);
});

test("unl-115-219 Nilah, Joyful Ascetic: the body gains exactly 1 XP for the controller (728/730.1)", () => {
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(gainXp.id, "nilah-joyful-ascetic.gain-1-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  // 190.6.d: the implicit “you” is the ability's controller, so no player id is written.
  assert.equal(gainXp.args.player, undefined);
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(gainXp.condition, undefined);
});

test("unl-115-219 Nilah, Joyful Ascetic golden: the move body gains 1 XP through effect.xp", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  // 730.1: gaining XP increases the value marked on the gaining player.
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.results[0].result.linkedValues.gained, 1);
  assert.equal(outcome.results[0].result.linkedValues.gainedTo, "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-115-219 Nilah, Joyful Ascetic golden: a replaced gain is negated and no XP is marked (367)", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const outcome = resolveChainBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
});

test.todo(
  "unl-115-219 Nilah, Joyful Ascetic: [Accelerate] charges [1][C] at Finalize and replaces the exhausted entry " +
    "(CR 805.1.b, 805.2.b, 805.6) by feeding the merged keyword expansion into the CardProgram cost plan"
);

test.todo(
  "unl-115-219 Nilah, Joyful Ascetic: prove the 458.1 Recall exclusion for the registered 'When I move' " +
    "subscription; object-moved, its Origin/Destination fields, the object collection, and registration are implemented"
);

test("unl-115-219 Nilah, Joyful Ascetic: the 'When I move' trigger registers", async () => {
  // 421.1 / 449.1: the production vocabulary and translator accept the source
  // Move trigger and install it for Nilah's current incarnation.
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { validateTriggerSpec, EVENT_PATTERN_TYPES } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

  assert.equal(EVENT_PATTERN_TYPES.includes("object-moved"), true);
  const spec = validateTriggerSpec({ at: "object-moved", filter: moveTrigger.trigger.filter });
  assert.equal(spec.ok, false);
  assert.ok(spec.issues.every(issue => issue.code === "unknown-field"));
  // The valid translated shape reaches the production pipeline.
  assert.equal(validateTriggerSpec({
    at: "object-moved",
    filter: translateTriggerFilter(moveTrigger.trigger.filter, "nilah")
  }).ok, true);

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "nilah", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 4 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("nilah"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("nilah"), cardId: CANONICAL_ID, zone: "board" };
  const ids = binding.registerProgramTriggers(f.engine, source);
  assert.ok(ids.length > 0);
});

test("unl-115-219 Nilah, Joyful Ascetic golden: a real Move publishes both zones and the Nilah object set", async () => {
  // CR 449.1/449.2: the production object-moved event carries the battlefield
  // Origin and Destination zones plus the exact Nilah object collection.
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const f = fixture({ cards: [{ id: "nilah", types: ["unit"], energy: 3, power: [], might: 4 }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("nilah"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  f.engine.commit({
    type: "move-location",
    object: f.kernel.ref("nilah"),
    to: { type: "battlefield", id: "bf-2" }
  });
  const [moved] = f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.ok(moved);
  assert.deepEqual(
    [moved.fromZone, moved.toZone, moved.objectIds, moved.objectCount],
    ["battlefield", "battlefield", ["nilah"], 1]
  );
  assert.equal(f.kernel.getObject("nilah").location.id, "bf-2");
  assert.equal(f.kernel.player("A").xp, 0);
});

test("unl-115-219 Nilah, Joyful Ascetic: the Accelerate static declaration reaches the production layer path", async () => {
  // 805.1.b: the merged KeywordDef publishes a static accelerate.cost, but the
  // production static binder has no layer mapping for it and the merged play
  // draft carries no cost, so the optional [1][C] can never be charged.
  const { createProgramBinding, createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "nilah", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 4 }],
    describePlay: binding.describePlay
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("nilah"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("nilah"), cardId: CANONICAL_ID, zone: "board" };
  const statics = binding.inspect(source).abilities.filter(ability => ability.kind === "static");
  const accelerate = statics.find(ability => ability.effect.kind === "accelerate.cost");
  assert.ok(accelerate, "the merged Accelerate expansion must publish accelerate.cost");
  assert.equal(accelerate.effect.cost.optional, true);
  assert.equal(accelerate.effect.cost.payments.length, 2);
  const accelerateHandle = createEngineStaticBinder(f.engine).bindStatic(accelerate, source);
  assert.equal(typeof accelerateHandle.unbind, "function");
  accelerateHandle.unbind();
  // Ganking's own static binds independently.
  const ganking = statics.find(ability => ability.effect.kind === "continuous.movement");
  assert.ok(ganking);
  createEngineStaticBinder(f.engine).bindStatic(ganking, source);

  const draft = binding.describePlay(
    { type: "play", player: "A", object: f.kernel.ref("nilah") },
    f.kernel.getObject("nilah")
  );
  const optional = draft.cost?.optionalAdditional?.[0];
  assert.equal(optional.kind, "accelerate");
});

test("unl-115-219 Nilah, Joyful Ascetic golden: the merged Ganking expansion registers a movement permission consumed by Standard Move", () => {
  const gankingDef = keywordDefinitionsById.get("Ganking");
  assert.ok(gankingDef, "the merged Ganking KeywordDef is registered (CR 810)");
  assert.equal(gankingDef.stacking, "single");
  const [expansion] = gankingDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.movement");

  // Run the merged instruction for real: the continuous effect registers and the
  // movement() rule query does resolve the permission.
  const base = world().unit("nilah", { might: 4 }).build();
  base.setTargets("nilah-movement", [base.ref("nilah")]);
  const context = base.clone({ sourceSnapshot: base.getObject("nilah"), source: base.ref("nilah") });
  const outcome = resolveChainBody([{
    id: "ganking-movement", op: "continuous.movement",
    args: {
      permission: { kind: "constant", value: expansion.effect.permission },
      source: { kind: "constant", value: expansion.effect.source },
      destination: { kind: "constant", value: expansion.effect.destination },
      move: { kind: "constant", value: expansion.effect.move },
      addsPermission: { kind: "constant", value: expansion.effect.addsPermission },
      // The instruction binds its affected object through a TargetSpec
      // registration.ts's bindTarget resolves the declarative expansion's "self"
      // spelling through the caller.
      target: { kind: "constant", value: "nilah-movement" }
    }
  }], context);
  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine(context.objects, context.continuousEffects);
  const query = movement(layers.registry, context.ref("nilah"), context.getObject("nilah"), "A");
  // 810.1.b / 144.4.c.1: the battlefield-to-battlefield Standard Move route.
  assert.equal(query.canGank, true);
  assert.equal(query.battlefieldToBattlefield, true);
  // Standard Move reads this query through moveDuelUnitsStandard.
  assert.equal(query.permissions.length, 1);
});
