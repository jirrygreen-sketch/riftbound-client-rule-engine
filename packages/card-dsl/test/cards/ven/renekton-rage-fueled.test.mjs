// RIFT-664 template execution evidence (trigger condition true/false on the
// real chain, non-target set damage gap) is in
// ../templates/keyword-triggered-attack-declared-effect-664.test.mjs. This
// card stays judge-required for the printed gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/renekton-rage-fueled.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import accelerateKeyword from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "When I attack, if you control 4 or fewer runes, deal 2 to all enemy units here.";

const [accelerate, attackTrigger] = program.abilities;
const [dealTwo] = attackTrigger.body;

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" controller selector of the trigger condition is bound to the acting
 * player for the execution check (the same convention as ven/protective-sands).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map((item) => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** 133.5.a.1 / 431.1: a channeled rune sits in the controller's Rune Zone. */
function runeWorld(runesTotal) {
  const ids = Array.from({ length: runesTotal }, (_, index) => `r${index + 1}`);
  const kernel = world().rune(ids).build();
  if (runesTotal > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: runesTotal }).status, "done");
  }
  return kernel;
}

const predicateBody = (condition) => [
  {
    id: "renekton.rune-gate",
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: condition } }
  }
];

test("ven-019-166 Renekton, Rage Fueled: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-019-166 Renekton: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ven-019-166 Renekton: unvalued [Accelerate] with the merged 805 expansion", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the cost is fixed [1] + one domain-matched Power, so the keyword
  // carries no value; 805.4 keeps multiple instances redundant.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.equal(accelerate.value, undefined);
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.ok(definition, "the Accelerate KeywordDef is merged");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "single");
});

test("ven-019-166 Renekton: attack trigger with the 4-or-fewer-runes trigger condition", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.optional, false);
  // 383.4.e: "When I attack" is an Attack Trigger on the closed attack-declared
  // timing point; 383.4.e.2.a checks the condition once per combat.
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.trigger.once, "per-combat");
  // 383.2.a.1: the following clause is part of the Trigger Condition itself.
  const condition = attackTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes-you-control");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    zone: "rune-zone",
    controller: "self"
  });
});

test("ven-019-166 Renekton: body is one non-target set damage of exactly 2", () => {
  assert.deepEqual(attackTrigger.body.map((instruction) => instruction.id), [
    "renekton.deal-2-to-enemy-units-here"
  ]);
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  // 355.10.d: "all enemy units here" is a characteristic-selected set, never a
  // target — no TargetSpec may stand in for it, because that would fire
  // "become a target" for every unit (355.7/754).
  assert.equal(dealTwo.targets, undefined);
  assert.equal(dealTwo.picks, undefined);
  assert.equal(dealTwo.linkedTo, undefined);
  assert.deepEqual(dealTwo.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: "self"
      }
    }
  });
});

test("ven-019-166 Renekton golden: the 4-or-fewer-runes trigger condition really evaluates", () => {
  const condition = substituteController(attackTrigger.trigger.condition, "A");

  // Exactly 4 runes: "4 or fewer runes" holds.
  const four = runeWorld(4);
  const accepted = runAbilityBody(predicateBody(condition), four);
  assert.equal(accepted.status, "executed");
  assert.deepEqual(accepted.results[0].result.linkedValues, { value: true });

  // Five runes: the trigger condition is not fulfilled, so the ability would
  // not even be put on the chain.
  const five = runeWorld(5);
  const rejected = runAbilityBody(predicateBody(condition), five);
  assert.equal(rejected.status, "executed");
  assert.deepEqual(rejected.results[0].result.linkedValues, { value: false });
});

test.todo(
  "ven-019-166 Renekton: deal 2 to every enemy unit here (418.1.b/418.1.d with the 355.10.d " +
    "non-target set) needs the merged effect.damage to accept a query/set selector instead of only " +
    "ctx.targets(specId) — effect.damage still lacks a query/set selector for non-target groups"
);

test("ven-019-166 Renekton gap: the non-target set descriptor is rejected by effect.damage", () => {
  // Measured evidence for judgeReason point 1: the merged primitive reads its
  // target set from a Finalize-locked TargetSpec id, so handing it the card's
  // own query descriptor throws rather than dealing 2 to every enemy unit.
  const kernel = world()
    .unit("renekton", { might: 6, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const bound = kernel.clone({ controller: "A", source: kernel.ref("renekton"), sourceSnapshot: kernel.getObject("renekton") });

  assert.throws(
    () => resolveChainBody([dealTwo], bound),
    error => error instanceof Error && /args\.target must be a TargetSpec id string/.test(error.message)
  );
  assert.equal(bound.getObject("enemy").damage, 0);
});

test("ven-019-166 Renekton gap: a committed Move emits object-moved and never attack-declared", () => {
  // Measured evidence for judgeReason point 2: the production action adapter
  // emits the movement timing point only; no module emits attack-declared, and
  // the combat flow refuses to open a staged Combat, so the printed trigger
  // cannot be reached by real play.
  const builder = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .unit("renekton", { might: 6, location: { type: "base", player: "A" } });
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", cleanup: () => false });
  const seen = [];
  const original = engine.pipeline.emit.bind(engine.pipeline);
  engine.pipeline.emit = (emission, action) => {
    seen.push(emission.timingPoint);
    return original(emission, action);
  };

  assert.equal(engine.commit({ type: "move-location", object: kernel.ref("renekton"), location: { type: "battlefield", id: "bf-1" } }).status, "done");
  assert.ok(seen.includes("object-moved"));
  assert.equal(seen.includes("attack-declared"), false, "no producer emits attack-declared");
});

test("ven-019-166 Renekton gap: the [Accelerate] static ability has no layer mapping", () => {
  // Measured evidence for judgeReason point 3: the keyword expansion exists and
  // declares the printed optional cost plus the ready-entry replacement, but
  // the production static binder cannot install its cost declaration, and no
  // producer turns a card keyword into a Finalize cost component.
  const kernel = world().player("A", { energy: 20 }).unit("renekton", { cardId: CANONICAL_ID, might: 6, location: { type: "base", player: "A" } }).build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", cleanup: () => false });
  const source = kernel.getObject("renekton");
  const [costAbility] = accelerateKeyword.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "accelerate.cost");
  assert.deepEqual(costAbility.effect.cost.payments.map(payment => [payment.kind, payment.amount.value]), [
    ["energy", 1],
    ["power", 1]
  ]);
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(costAbility, source),
    error => error.code === "judge-required" && /accelerate\.cost has no layer mapping/.test(error.message)
  );
});

test.todo(
  "ven-019-166 Renekton: the attack-declared timing point needs its combat emitter and the " +
    "engine batch 4–5 combat transaction; CardProgram → TriggerRegistration binding is already merged"
);

test.todo(
  "ven-019-166 Renekton: [Accelerate]'s cost/entry rewrite (805.1.b.1 Fury money, 805.6 ready " +
    "entry) needs a card-program → cost-plan/entry-replacement wiring — the cost planner accepts " +
    "optional additional costs, but no producer turns accelerate.cost on a card program into that plan"
);
