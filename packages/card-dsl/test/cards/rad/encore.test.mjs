import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/encore.js";
// The production chain adapter wraps the card DSL's Expr arguments for the
// registered primitive schemas (chain/interpreter-adapter.ts), so the golden
// execution goes through the same path the chain engine uses.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [play] = program.abilities;
const [chooseTwo] = play.body;
const modes = chooseTwo.args.modes.value;
const [
  damageMode,
  tokenMode,
  mightMode,
  lookMode
] = modes;

const MODE_CHOICE = "encore.choose-two";
// Choice request ids are the URI-encoded execution path (interpreter README).
const slot = (index) => `${MODE_CHOICE}/mode%3A${index}`;
const DAMAGED_UNIT = "encore.damaged-unit";

/**
 * Replay helper: the spell's Finalize-locked target (355.8) is supplied by the
 * kernel, then the card's own body executes with the mode answers supplied.
 */
const runWithAnswers = (kernel, answers) => {
  kernel.setTargets(DAMAGED_UNIT, [kernel.ref("victim")]);
  kernel.setAnswers(answers);
  return resolveChainBody(play.body, kernel);
};

test("rad-152-167 Encore: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-3812004b1ace905a5750f12683fd2ae066128769b8d39d3a460ea8a2bce04b99"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Choose two —\n" +
      "Deal 2 to a unit.Play two 1 :rb_might: Recruit unit tokens." +
      "Give up to two units each +1 :rb_might: this turn." +
      "Look at the top 2 cards of your Main Deck, draw 1 and recycle the other."
  );
});

test("rad-152-167 Encore: judgeReason names the two unresolved modes and the executed ones", () => {
  assert.match(program.judgeReason, /187\.1/);
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /补集/);
  // The resolved mode 3 must not be described as a missing dependency.
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
});

test("rad-152-167 Encore: structure — Choose two with four modes in printed order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), ["encore.choose-two"]);

  // "Choose two —" (355.3): one mode node, two distinct selections, bodies
  // executing in declaration order (contract 3.9).
  assert.equal(chooseTwo.op, "choice.mode");
  assert.deepEqual(chooseTwo.args.count, { kind: "constant", value: 2 });
  assert.deepEqual(chooseTwo.args.different, { kind: "constant", value: true });
  assert.equal(chooseTwo.args.modes.kind, "constant");
  assert.deepEqual(modes.map(mode => mode.id), [
    "encore.deal-two-mode",
    "encore.recruit-tokens-mode",
    "encore.grant-might-mode",
    "encore.look-and-recycle-mode"
  ]);
  for (const mode of modes) assert.equal(Array.isArray(mode.body), true);

  // Mode 1: "Deal 2 to a unit" — a target, one unit, merged effect.damage.
  const [dealTwo] = damageMode.body;
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.equal(dealTwo.targets.length, 1);
  assert.equal(dealTwo.targets[0].id, "encore.damaged-unit");
  assert.deepEqual(dealTwo.targets[0].filter, { type: "unit" });
  assert.equal(dealTwo.targets[0].min, 1);
  assert.equal(dealTwo.targets[0].max, 1);
  assert.equal(dealTwo.targets[0].selection, "one");

  // Mode 2: "Play two 1 Might Recruit unit tokens" — CR 187.1 Recruit, played
  // to the controller's base (355.2.a); the destination is the open part.
  const [recruits] = tokenMode.body;
  assert.equal(recruits.op, "effect.token");
  assert.deepEqual(recruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(recruits.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(recruits.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(recruits.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });

  // Mode 3: "Give up to two units each +1 Might this turn" — zero allowed
  // (355.13), end-of-turn expiry (317.2.c), arithmetic-layer continuous.might
  // reading the Finalize-locked TargetSpec through the symbolic target selector.
  const [grantMight] = mightMode.body;
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "encore.buffed-units" }
  });
  assert.equal(grantMight.targets.length, 1);
  assert.equal(grantMight.targets[0].id, "encore.buffed-units");
  assert.equal(grantMight.targets[0].min, 0);
  assert.equal(grantMight.targets[0].max, 2);
  assert.equal(grantMight.targets[0].selection, "up-to");

  // Mode 4: look at the top 2, draw 1, recycle the other.
  assert.deepEqual(lookMode.body.map(instruction => instruction.id), [
    "encore.look-top-two",
    "encore.draw-one",
    "encore.recycle-other"
  ]);
  const [look] = lookMode.body;
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.equal(look.picks.length, 1);
  assert.equal(look.picks[0].id, "encore.top-two");
  assert.deepEqual(look.picks[0].options, ["dynamic:top-2-of-main-deck"]);
  const [drawOne, recycleOther] = lookMode.body.slice(1);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(recycleOther.op, "effect.recycle");
  assert.equal(recycleOther.linkedTo, "encore.look-top-two");
});

test("rad-152-167 Encore: choosing Deal 2 plus Recruit tokens runs both mode bodies through the interpreter", () => {
  const kernel = world().player("A").unit("victim", { owner: "B", might: 4 }).build();
  const answers = {
    [slot(0)]: damageMode.id,
    [slot(1)]: tokenMode.id
  };
  const outcome = runWithAnswers(kernel, answers);
  assert.equal(outcome.status, "partial");
  // The damage mode executes; the Recruit mode's base destination cannot be
  // resolved by the merged token primitive (see judgeReason), so that mode is
  // negated and no token is created.
  assert.deepEqual(outcome.results.map(result => result.id), [
    "encore.deal-two",
    "encore.recruit-tokens",
    "encore.choose-two"
  ]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "impossible");
  // The container reports the executed child (aggregate: at least one child
  // executed) while the outcome as a whole stays partial.
  assert.equal(outcome.results[2].result.status, "executed");
  assert.equal(kernel.getObject("victim").damage, 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test("rad-152-167 Encore: the same two-mode selection executes in printed declaration order", () => {
  // Select the Recruit mode first and the damage mode second; declaration
  // order (not selection order) governs which body runs first (158.1).
  const kernel = world().player("A").unit("victim", { owner: "B", might: 4 }).build();
  const outcome = runWithAnswers(kernel, {
    [slot(0)]: tokenMode.id,
    [slot(1)]: damageMode.id
  });
  assert.deepEqual(outcome.results.map(result => result.id), [
    "encore.deal-two",
    "encore.recruit-tokens",
    "encore.choose-two"
  ]);
  assert.equal(kernel.getObject("victim").damage, 2);
});

test("rad-152-167 Encore: a selected mode with no merged dependency does not stop the executable mode", () => {
  const kernel = world().player("A").unit("victim", { owner: "B", might: 4 }).build();
  const outcome = runWithAnswers(kernel, {
    [slot(0)]: damageMode.id,
    [slot(1)]: tokenMode.id
  });
  // The Recruit mode's destination cannot be resolved, so that mode is negated;
  // the damage mode still dealt 2 (359.3.e.11: resolve as much as possible).
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(kernel.getObject("victim").damage, 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["damage"]);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});

test.todo(
  "rad-152-167 Encore: 'Play two 1 [M] Recruit unit tokens' (CR 187.1 / 440.2.c / 185.2.a) needs a " +
    "resolvable play destination — a base LocationRef must name a resolved PlayerId, and no card-side " +
    "expression yields the controller's id; effect.token rejects a literal \"controller\" base (RIFT-90)"
);

test("rad-152-167 Encore: the +1 Might mode registers an end-of-turn arithmetic effect for the chosen units", () => {
  const kernel = world().unit("u1", { might: 3 }).unit("u2", { might: 3 }).unit("u3", { might: 3 }).build();
  kernel.setTargets("encore.buffed-units", [kernel.ref("u1"), kernel.ref("u2")]);

  const outcome = resolveChainBody(mightMode.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["encore.grant-might", "executed"]]
  );
  // CR 143.2.a / 475-478: the merged layers engine really applies the +1 in the
  // arithmetic layer, and the effect carries the printed end-of-turn duration
  // (317.2.c). The third unit was not chosen and keeps its printed Might.
  const engine = createLayerEngine(
    kernel.query({}),
    kernel.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.deepEqual(
    engine.evaluateAll().map(object => [object.ref.id, object.might]),
    [["u1", 4], ["u2", 4], ["u3", 3]]
  );
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.duration), [
    { type: "end-of-turn" },
    { type: "end-of-turn" }
  ]);
});

test("rad-152-167 Encore: choosing zero units is a legal no-op for the Might mode (CR 355.13)", () => {
  const kernel = world().unit("u1", { might: 3 }).build();
  kernel.setTargets("encore.buffed-units", []);

  const outcome = resolveChainBody(mightMode.body, kernel);

  // "up to two" allows choosing none: the locked set is empty, so the merged
  // primitive reports the selection as mistargeted (the same zero-selection
  // convention the merged effect.damage/bilgewater-tracker path uses), and no
  // continuous effect may be registered.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.snapshot().continuous.length, 0);
  assert.equal(kernel.getObject("u1").might, 3);
});

test("rad-152-167 Encore: a unit that left the board before resolution cancels only the Might mode", () => {
  const kernel = world().unit("u1", { might: 3 }).build();
  const stale = kernel.ref("u1");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("encore.buffed-units", [stale]);

  const outcome = resolveChainBody(mightMode.body, kernel);

  // 359.3.e.6: every target ref is stale, so the instruction is ignored and no
  // effect is registered.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.snapshot().continuous.length, 0);
});

test.todo(
  "rad-152-167 Encore: 'Look at the top 2 cards of your Main Deck, draw 1 and recycle the other' needs " +
    "an ordered deck-top selection (effect.inspect top scope takes a PickSpec, whose options are static " +
    "data; query() does not guarantee zone order) plus a complement selection for recycle (RIFT-64 / RIFT-90)"
);
