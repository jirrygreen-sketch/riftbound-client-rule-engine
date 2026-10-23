import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/yeti-brawler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-372a2d2a0b9116fc9b30d8a6f4899848963d12a45cf804935f7f8f9d355c80be";
const SOURCE_TEXT =
  "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
  '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [ability] = program.abilities;
const [base, playGold] = ability.body;

test("unl-018-219 Yeti Brawler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-018-219 Yeti Brawler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /excess damage/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  // The refreshed reason names the observed quantity/definition gaps instead of
  // merged task numbers; the destination half is now the merged binding shape.
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /Invalid effect.token argument/);
  assert.match(program.judgeReason, /condition\.value/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-018-219 Yeti Brawler: 'When I conquer' trigger with the excess-damage clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c / 383.4.c.1: "When I conquer" is a Conquer Effect; "self" is the
  // conquering unit's controller.
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquered", filter: { source: "self" }, player: "self" });
  // 383.2.a.1: the "if you assigned 3 or more excess damage" clause follows the
  // trigger condition directly and belongs to it; the count shape names the
  // damage-assignment ledger that has no merged evaluation (judgeReason).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "excess-damage-assigned-this-combat");
  assert.equal(ability.optional, false);
});

test("unl-018-219 Yeti Brawler: two Gold gear tokens are created on the Chain and played", () => {
  assert.equal(playGold.op, "effect.token");
  // 187.5: the printed "Gold gear token" is a defined token, so the definition id
  // is the printed name rather than invented statistics.
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 2 });
  // 350.2 / 440.2.c / 185.2.a: a played token is created on the Chain first;
  // creating it on the Board then playing would add a wrong Board entry.
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  // 440.4 / 107.1.c: the destination is the ability controller's Base, read
  // through the merged location selector and linked to the token primitive
  // (a literal { type: "base", player: "controller" } value is refused by
  // effect.token, which requires a concrete PlayerId).
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "yeti-brawler.base",
    "yeti-brawler.play-gold"
  ]);
  assert.equal(base.args.value.kind, "location");
  assert.equal(base.args.value.value, "ability-controller-base");
  assert.deepEqual(playGold.args.location, {
    kind: "linked-value",
    instructionId: "yeti-brawler.base",
    key: "value"
  });
  assert.equal(playGold.linkedTo, "yeti-brawler.base");
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldTokens" });
  // The "exhausted" entry override (143.4 / 184.1 / 185.2.d) has no IR argument;
  // it is recorded in judgeReason and never faked by create-then-exhaust.
  assert.deepEqual(Object.keys(playGold.args).sort(), [
    "amount", "linkKey", "location", "mode", "token"
  ]);
  // The destination is bound by the preceding condition.value instruction, not
  // written into the token argument as a symbolic seat name.
  assert.equal(playGold.targets, undefined);
});

test("unl-018-219 Yeti Brawler: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-018-219 Yeti Brawler: the conquer subscription binds the host unit in the engine event vocabulary", () => {
  const filter = translateTriggerFilter(ability.trigger.filter, "yeti-brawler", ability.trigger.at);
  assert.deepEqual(filter, {
    event: "conquered",
    object: { objectId: "yeti-brawler" },
    player: "self"
  });
  const validated = validateTriggerSpec({ ...ability.trigger, filter });
  assert.equal(validated.ok, true, JSON.stringify(validated.issues));
  assert.deepEqual(validated.issues, []);

  // Test only event matching, not a fabricated conquest or condition receipt.
  // CR 383.4.c.2.a: another friendly unit's conquest is not this unit's trigger.
  const kernel = world().unit("yeti-brawler").unit("other-unit").build();
  const event = { timingPoint: "conquer", player: "A", object: kernel.getObject("yeti-brawler") };
  assert.equal(matchesTriggerEvent(filter, event, "A"), true);
  assert.equal(matchesTriggerEvent(filter, { ...event, object: kernel.getObject("other-unit") }, "A"), false);
  assert.equal(matchesTriggerEvent(filter, { ...event, player: "B" }, "A"), false);
});

test("unl-018-219 Yeti Brawler golden: the controller Base resolves for either controller before the token primitive runs", () => {
  // 440.4 / 107.1.c: the created tokens belong to the ability controller. The
  // card now reads that Base with the merged location selector; assert the real
  // value for both players instead of the retired symbolic seat name.
  for (const controller of ["A", "B"]) {
    const kernel = world().build();
    const context = kernel.clone({ controller });
    const outcome = resolveChainBody([base], context);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["yeti-brawler.base.value"], {
      type: "base",
      player: controller
    });
  }
});

test("unl-018-219 Yeti Brawler: the token half creates and plays two canonical Golds", () => {
  // 187.5 is present, so the linked Base feeds two real token plays. The other
  // condition and entry-state gaps remain covered separately below.
  const kernel = world().build();
  const context = kernel.clone({ controller: "A" });
  const outcome = resolveChainBody(ability.body, context);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["yeti-brawler.base", "executed"],
    ["yeti-brawler.play-gold", "executed"]
  ]);
  // Reproduce the same instruction through the primitive with the concrete Base
  // the preceding instruction produced.
  const baseRun = runInstruction(
    token,
    {
      token: { kind: "constant", value: "gold" },
      amount: playGold.args.amount,
      mode: playGold.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel, controller: "A" }
  );
  assert.equal(baseRun.result.status, "executed");
  assert.equal(baseRun.linked.token.blockedReason, undefined);
  assert.equal(baseRun.linked.token.amount, 2);
  assert.equal(baseRun.linked.token.createdAmount, 2);
  const createdGolds = baseRun.world.objects.filter(object => object.isToken && object.name === "Gold");
  assert.equal(createdGolds.length, 2);
  assert.deepEqual(createdGolds.map(gold => gold.location), [
    { type: "base", player: "A" },
    { type: "base", player: "A" }
  ]);
  // An independent definition also plays through the same handoff.
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 2 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel, controller: "A" }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 2);
});

test("unl-018-219 Yeti Brawler gap: the exhausted entry override is not an effect.token argument", () => {
  // 184.1 / 185.2.d: the tokens enter exhausted. The primitive's argument set has
  // no entry-state override, and a create-then-exhaust sequence would add an
  // extra "becomes exhausted" event, so the card keeps the gap rather than faking
  // it. The rejection is pinned here.
  assert.throws(
    () => token.argsSchema.parse({
      token: { kind: "constant", value: "gold" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      exhausted: { kind: "constant", value: true }
    }),
    /Invalid effect\.token argument: exhausted/
  );
});

test("unl-018-219 Yeti Brawler gap: the excess-damage condition over-satisfies from unrelated objects", () => {
  // 467.2.c.2/.c.4: the clause reads how much excess damage the player assigned
  // this combat. No merged expression can read that amount, and the retained
  // count shape only counts objects, so it flips from false to true purely by
  // adding unrelated units. Pinned so the placeholder can never be presented as
  // a working condition.
  const condition = ability.trigger.condition;
  const empty = world().build();
  const threeObjects = world().unit("a").unit("b").unit("c").build();
  assert.equal(empty.test(condition), false);
  assert.equal(threeObjects.test(condition), true);
  assert.equal(threeObjects.test(condition), true);
});

test("unl-018-219 Yeti Brawler gap: the conquer emission carries no unit, so the self filter does not match it", () => {
  // 383.4.c.2.a: the Hold/Conquer Effect binds the unit present during the
  // action. turn/flow.ts publishes { player, details: { battlefieldId } }, so the
  // registered subscription stays silent until the payload carries the unit.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, judgeReason: undefined, status: "executable" }]
  });
  const f = fixture({ describePlay: binding.describePlay });
  const registered = binding.registerProgramTriggers(f.engine, {
    ...f.kernel.getObject("source"),
    cardId: CANONICAL_ID,
    name: "Yeti Brawler"
  });
  assert.equal(registered.length, 1);
  const emission = f.engine.pipeline.emit({
    timingPoint: "conquer",
    player: "A",
    details: { battlefieldId: "bf-1" }
  });
  assert.equal(emission.object, undefined);
  assert.equal(f.engine.items.some(item => item.kind === "triggered"), false);
});
test.todo(
  "unl-018-219 Yeti Brawler: bind the actual conquering unit and evaluate assigned excess damage >= 3 from " +
    "the combat assignment receipt (CR 383.4.c.2.a / 467.2.c.1–c.4; RIFT-359 condition read)"
);

test.todo(
  "unl-018-219 Yeti Brawler: carry the card's exhausted entry stipulation through the production token/Chain handoff"
);

test.todo(
  "unl-018-219 Yeti Brawler: carry the exhausted entry modification on both Gold tokens without a separate " +
    "becomes-exhausted action (CR 184.1 / 185.2.d)"
);

test.todo(
  "unl-018-219 Yeti Brawler: resolve the controller-relative Base destination to a concrete PlayerId " +
    "before effect.token executes, without hardcoding a fixture player's identity"
);
