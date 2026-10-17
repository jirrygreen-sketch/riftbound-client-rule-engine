import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/defiant-dance.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-b159649107e1268bfb45d5d2c64def273ae76898db17907192d8e25e1d7526ef";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit +2 :rb_might: this turn and another unit -2 :rb_might: this turn.";

const [reactionKeyword, play] = program.abilities;
const [buffUnit, debuffAnotherUnit] = play.body;
const buffSpec = buffUnit.targets[0];
const debuffSpec = debuffAnotherUnit.targets[0];

/** The resolving effect's own registrations, shaped for the real layer engine. */
const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("sfd-196-221 Defiant Dance: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-196-221 Defiant Dance structure: [Reaction] keyword plus two independent Might targets", () => {
  assert.equal(program.abilities.length, 2);
  // 813: the keyword is a pure permission and carries no value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(keywordDefinitionsById.has("Reaction"), true);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["defiant-dance.buff-unit", "continuous.might"],
    ["defiant-dance.debuff-another-unit", "continuous.might"]
  ]);
  // The declared primitive really is the merged registry entry (RIFT-258).
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);

  // "Give a unit +2 Might this turn": one chosen Board unit (355.7/355.9.b).
  assert.deepEqual(buffUnit.args, {
    objects: { kind: "constant", value: { kind: "target", id: "defiant-dance.unit" } },
    amount: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.deepEqual(buffSpec, {
    id: "defiant-dance.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and another unit -2 Might this turn": a second chosen unit that is not the
  // first one; "another" is a targeting restriction (355.9.b) expressed with the
  // merged exclude anchor over the first target. No printed floor is recorded.
  assert.deepEqual(debuffAnotherUnit.args, {
    objects: { kind: "constant", value: { kind: "target", id: "defiant-dance.another-unit" } },
    amount: { kind: "constant", value: -2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.deepEqual(debuffSpec, {
    id: "defiant-dance.another-unit",
    filter: {
      type: "unit",
      zone: "board",
      exclude: { target: "defiant-dance.unit" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(debuffAnotherUnit.args.minimum, undefined);
  assert.equal(debuffAnotherUnit.linkedTo, undefined);
  assert.equal(debuffAnotherUnit.picks, undefined);
});

test("sfd-196-221 Defiant Dance golden: +2 on one unit and -2 on another register in the arithmetic layer", () => {
  // 143.2.a: "Might" means Effective Might. 478/478.1.a: the modifications live
  // in the arithmetic layer, registered per object through addContinuous.
  const kernel = world()
    .unit("buffed-unit", { owner: "A", controller: "A", might: 3 })
    .unit("debuffed-unit", { owner: "B", controller: "B", might: 4 })
    .build();
  kernel.setTargets(buffSpec.id, [kernel.ref("buffed-unit")]);
  kernel.setTargets(debuffSpec.id, [kernel.ref("debuffed-unit")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["defiant-dance.buff-unit", "executed"],
      ["defiant-dance.debuff-another-unit", "executed"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 2);
  assert.equal(effectiveMight(kernel, "buffed-unit"), 5);
  assert.equal(effectiveMight(kernel, "debuffed-unit"), 2);

  const [buffRegistration, debuffRegistration] = kernel.continuousEffects;
  assert.equal(buffRegistration.effect.layer, "arithmetic");
  assert.equal(buffRegistration.effect.effect.kind, "continuous.might");
  assert.equal(buffRegistration.effect.effect.amount, 2);
  assert.deepEqual(buffRegistration.effect.filter.objectId, "buffed-unit");
  assert.equal(debuffRegistration.effect.effect.amount, -2);
  assert.deepEqual(debuffRegistration.effect.filter.objectId, "debuffed-unit");
});

test("sfd-196-221 Defiant Dance golden: both modifications expire together at cleanup (317.2.c)", () => {
  const kernel = world()
    .unit("buffed-unit", { owner: "A", might: 3 })
    .unit("debuffed-unit", { owner: "B", might: 4 })
    .build();
  kernel.setTargets(buffSpec.id, [kernel.ref("buffed-unit")]);
  kernel.setTargets(debuffSpec.id, [kernel.ref("debuffed-unit")]);
  resolveChainBody(play.body, kernel);

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("buffed-unit")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("debuffed-unit")).might, 2);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 2);
  assert.equal(engine.evaluate(kernel.ref("buffed-unit")).might, 3);
  assert.equal(engine.evaluate(kernel.ref("debuffed-unit")).might, 4);
});

test("sfd-196-221 Defiant Dance golden: the 'another unit' filter really excludes the first target (355.9.b)", () => {
  // Lock the +2 unit as the first target: the second target's exclude anchor
  // drops it, so the -2 falls on the other unit only.
  const kernel = world()
    .unit("first-unit", { owner: "A", might: 3 })
    .unit("second-unit", { owner: "A", might: 3 })
    .build();
  const first = kernel.ref("first-unit");
  const second = kernel.ref("second-unit");
  kernel.setTargets(buffSpec.id, [first]);
  kernel.setTargets(debuffSpec.id, [second]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(effectiveMight(kernel, "first-unit"), 5);
  assert.equal(effectiveMight(kernel, "second-unit"), 1);

  // Locking the first unit again as the "another" target fails the exclude
  // restriction: the second instruction finds no legal object and is ignored,
  // while the independent first instruction still applies (359.3.e.11).
  const same = world().unit("only-unit", { owner: "A", might: 3 }).build();
  same.setTargets(buffSpec.id, [same.ref("only-unit")]);
  same.setTargets(debuffSpec.id, [same.ref("only-unit")]);
  const sameOutcome = resolveChainBody(play.body, same);
  assert.equal(sameOutcome.status, "partial");
  assert.deepEqual(
    sameOutcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["defiant-dance.buff-unit", "executed"],
      ["defiant-dance.debuff-another-unit", "ignored"]
    ]
  );
  assert.equal(same.continuousEffects.length, 1);
  assert.equal(effectiveMight(same, "only-unit"), 5);
});

test("sfd-196-221 Defiant Dance golden: a target that left the Board is ignored (359.3.e.6)", () => {
  const kernel = world()
    .unit("buffed-unit", { owner: "A", might: 3 })
    .unit("debuffed-unit", { owner: "B", might: 4 })
    .build();
  const stale = kernel.ref("buffed-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(buffSpec.id, [stale]);
  kernel.setTargets(debuffSpec.id, [kernel.ref("debuffed-unit")]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["defiant-dance.buff-unit", "ignored"],
      ["defiant-dance.debuff-another-unit", "executed"]
    ]
  );
  // Only the surviving unit's modification is registered.
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].effect.filter.objectId, "debuffed-unit");
  assert.equal(effectiveMight(kernel, "debuffed-unit"), 2);
});

test.todo(
  "sfd-196-221 Defiant Dance: [Reaction] admission in a Closed State on another player's turn " +
    "(CR 813.1.b/813.1.c) belongs to the chain's canAct check plus the continuous.timing consumer " +
    "(contract 3.5 / RIFT-91) — a whole-card timing gap, not a card instruction; the card's own " +
    "instructions execute on merged primitives."
);
