import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/nilah-joyful-ascetic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /RIFT-120/);
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
  // of this source (the payload gap is recorded in the judgeReason).
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
    "(CR 805.1.b, 805.2.b, 805.6; no card-program -> cost-plan/replacement wiring is merged — RIFT-86/RIFT-89)"
);
test.todo(
  "unl-115-219 Nilah, Joyful Ascetic: [Ganking] grants the battlefield-to-battlefield Standard Move permission " +
    "(CR 810.1.c; continuous.movement has no movement-system consumer) and the object-moved payload must carry the " +
    "from/to locations and exclude Recalls (449.1/449.2/458.1; RIFT-83, RIFT-120)"
);
