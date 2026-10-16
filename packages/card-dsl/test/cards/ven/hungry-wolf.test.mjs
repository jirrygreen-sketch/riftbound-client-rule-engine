import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/hungry-wolf.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-c57951db37608d30432354f25a074c018c9b41aa44a03a6ee3b5b4be3ec93ad1";
const SOURCE_TEXT =
  ":rb_rune_order:: Ready me and give me +1 :rb_might: this turn. " +
  "Use only if you've chosen an enemy unit this turn and only once each turn.";

const [ability] = program.abilities;
const [readyMe, mightThisTurn] = ability.body;

const wolfWorld = (exhausted) =>
  world()
    .player("controller")
    .unit("hungry-wolf", { controller: "controller", exhausted, might: 4 })
    .build();

const wolfKernel = (exhausted) => {
  const base = wolfWorld(exhausted);
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("hungry-wolf") });
};

test("ven-125-166 Hungry Wolf: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-125-166 Hungry Wolf: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-87/);
  assert.match(program.judgeReason, /386\.1/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ven-125-166 Hungry Wolf: one Action-speed activated ability costing an Order Power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 404.1.a: the printed ":rb_rune_order:" before the ':' separator is the cost.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    power: { kind: "constant", value: ["Order"] }
  });
  // “only once each turn” (386.1) and “use only if you've chosen an enemy unit
  // this turn” have no executable modelling field; recorded as printed limits.
  assert.deepEqual(ability.restriction, {
    kind: "printed-use-limit",
    value: { kind: "constant", value: "once-each-turn-chosen-enemy-unit-this-turn" }
  });
});

test("ven-125-166 Hungry Wolf: body is 'ready me' plus the temporary Might grant", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "hungry-wolf.ready-me",
    "hungry-wolf.might-this-turn"
  ]);
  assert.equal(readyMe.op, "effect.ready");
  // No args: effect.ready defaults to the ability source, and 827.1.b-style
  // “me” is never a target (355.10.g).
  assert.deepEqual(readyMe.args, {});
  assert.equal(readyMe.targets, undefined);
  assert.equal(readyMe.linkedTo, undefined);

  // “give me +1 [M] this turn” must NOT be authored as a Buff counter
  // (effect.buff documents that temporary Might belongs to continuous.might);
  // RIFT-258 merged the continuous.might instruction primitive, so the program
  // uses the real op with the end-of-turn duration.
  assert.equal(mightThisTurn.op, "continuous.might");
  assert.deepEqual(mightThisTurn.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightThisTurn.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightThisTurn.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightThisTurn.condition, undefined);
});

test("ven-125-166 golden: the merged 'Ready me' half readies the exhausted host", () => {
  const kernel = wolfKernel(true);
  assert.equal(kernel.getObject("hungry-wolf").exhausted, true);

  const outcome = runAbilityBody([readyMe], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hungry-wolf.ready-me", "executed"]
  ]);
  assert.equal(kernel.getObject("hungry-wolf").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(outcome.linkedValues["hungry-wolf.ready-me.readied"].count, 1);
});

test("ven-125-166 golden: an already-ready host is a no-op, not an error (CR 416.1.b)", () => {
  const kernel = wolfKernel(false);
  const outcome = runAbilityBody([readyMe], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(outcome.events, []);
});

test("ven-125-166 golden: the printed body readies the host and registers an end-of-turn +1 Might", () => {
  const kernel = wolfKernel(true);
  const outcome = runAbilityBody(ability.body, kernel, undefined, { host: kernel.ref("hungry-wolf") });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["hungry-wolf.ready-me", "executed"],
    ["hungry-wolf.might-this-turn", "executed"]
  ]);
  assert.equal(kernel.getObject("hungry-wolf").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);

  // 478.1.a: the +1 lands in the arithmetic layer through ctx.addContinuous;
  // 317.1.a / 468.7.c: the "this turn" lifetime expires at turn-end.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.effect.filter.objectId, "hungry-wolf");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("hungry-wolf")).might, 5);
  assert.deepEqual(layers.expireAt("turn-end"), [registration.effect.id]);
  assert.equal(layers.evaluate(kernel.ref("hungry-wolf")).might, 4);
});

test("ven-125-166 golden: the Might half alone hits only the host (355.10.g 'me' is not a target)", () => {
  const base = world()
    .player("controller")
    .unit("hungry-wolf", { controller: "controller", might: 4 })
    .unit("other-unit", { controller: "controller", might: 4 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 4 })
    .build();
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("hungry-wolf")
  });

  const outcome = runAbilityBody([mightThisTurn], kernel, undefined, { host: kernel.ref("hungry-wolf") });
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("hungry-wolf")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("other-unit")).might, 4);
  assert.equal(layers.evaluate(kernel.ref("enemy-unit")).might, 4);
});

test.todo(
  "ven-125-166 Hungry Wolf: 'Use only if you've chosen an enemy unit this turn' needs a " +
    "choose-history predicate (355.7) — the closed HistoryQuery has no 'chosen' action (RIFT-87)"
);

test.todo(
  "ven-125-166 Hungry Wolf: 'only once each turn' (CR 386.1) needs a per-turn activation " +
    "limit on the activated ability (Finalize-side consumer)"
);
