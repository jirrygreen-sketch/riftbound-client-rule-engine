import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/zero-point-inflection.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-8947b1c8eec76f1d8d4743f57a95e59af4015eec80d3c6b3ba999b7ad2611d3d";
const [playTrigger, drawTrigger] = program.abilities;

test("rad-069-167 Zero Point Inflection: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play a card, draw 2.\n" +
      "When you draw 1 or more cards with 9 or more other cards in your hand, " +
      "discard your hand, kill this, and choose an opponent. They score 1 point."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-069-167 Zero Point Inflection: judgeReason names the hand-size gate and the printing's type mismatch", () => {
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /hand/);
  assert.match(program.judgeReason, /programs\/triggers/);
  assert.match(program.judgeReason, /per-event/);
  // The catalog types this printing as a Spell while the text is a permanent.
  assert.match(program.judgeReason, /Spell/);
  assert.match(program.judgeReason, /157/);
});

test("rad-069-167 Zero Point Inflection: structure — play trigger draws 2 on another card being played", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { event: "card-played", player: "controller" });
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.body.length, 1);
  assert.deepEqual(playTrigger.body[0], {
    id: "zero-point-inflection.draw",
    op: "effect.draw",
    args: { amount: { kind: "constant", value: 2 } }
  });
});

test("rad-069-167 Zero Point Inflection: structure — the draw trigger's 9-other-cards gate", () => {
  assert.equal(drawTrigger.kind, "triggered");
  assert.equal(drawTrigger.optional, false);
  assert.equal(drawTrigger.trigger.at, "card-drawn");
  assert.deepEqual(drawTrigger.trigger.filter, { event: "card-drawn", player: "controller" });
  const condition = drawTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-cards-in-hand-after-this-draw");
  assert.deepEqual(condition.left.filter, { zone: "hand", owner: "controller", exclude: "source" });
  assert.deepEqual(condition.right, { kind: "constant", value: 9 });
  // No uses-per-turn counter: the trigger is not limited by TriggerSpec.once.
  assert.equal(drawTrigger.trigger.once, undefined);
});

test("rad-069-167 Zero Point Inflection: structure — discard all, then kill this, then score the chosen opponent", () => {
  assert.equal(drawTrigger.body.length, 3);
  const [discardInstruction, killInstruction, scoreInstruction] = drawTrigger.body;

  assert.equal(discardInstruction.id, "zero-point-inflection.discard-hand");
  assert.equal(discardInstruction.op, "effect.discard");
  assert.deepEqual(discardInstruction.args, { amount: { kind: "constant", value: "all" } });
  assert.equal(discardInstruction.targets, undefined);
  assert.equal(discardInstruction.linkedTo, undefined);

  assert.equal(killInstruction.id, "zero-point-inflection.kill-self");
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.linkedTo, "zero-point-inflection.discard-hand");
  assert.deepEqual(killInstruction.args.self, { kind: "constant", value: true });
  assert.equal(killInstruction.targets, undefined);

  assert.equal(scoreInstruction.id, "zero-point-inflection.score");
  assert.equal(scoreInstruction.op, "effect.score");
  assert.equal(scoreInstruction.linkedTo, "zero-point-inflection.kill-self");
  assert.deepEqual(scoreInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(scoreInstruction.args.player, {
    kind: "constant",
    value: { kind: "pick", id: "chosen-opponent" }
  });
  // "choose an opponent" is a non-targeting player selection (355.10.f).
  assert.equal(scoreInstruction.targets, undefined);
  assert.deepEqual(scoreInstruction.picks, [
    { id: "chosen-opponent", options: ["opponent"], min: 1, max: 1, selection: "one" }
  ]);
});

test("rad-069-167 Zero Point Inflection: each instruction of the second ability executes for real", () => {
  // The 9-other-cards gate uses an unmerged hand-size condition
  // (judgeReason), so the gate itself stays TODO. Everything the ability does
  // once the gate holds uses merged primitives; each authored instruction is
  // executed here with the real primitive and the reference kernel.
  const [discardInstruction, killInstruction, scoreInstruction] = drawTrigger.body;

  // "discard your hand"
  // The reference kernel's default source is a synthetic object, so the
  // self-kill below needs the real source snapshot supplied through clone().
  const discardKernel = world().hand("hand-card-1").hand("hand-card-2").build();
  const discarded = runInstruction(discard, discardInstruction.args, { world: discardKernel });
  assert.equal(discarded.result.status, "executed");
  assert.equal(discardKernel.player("A").handCount, 0);
  assert.equal(discardKernel.objectsInZone("A", "trash").length, 2);
  assert.deepEqual(discarded.events.map(event => event.action), ["discard", "discard"]);

  // "kill this"
  const killKernel = world().unit("zero-point-inflection", { zone: "board" }).build();
  const killScoped = killKernel.clone({ sourceSnapshot: killKernel.getObject("zero-point-inflection") });
  const killed = runInstruction(kill, { self: true, reason: "rad-069-167 zero-point-inflection" }, { world: killScoped });
  assert.equal(killed.result.status, "executed");
  assert.equal(killScoped.getObject("zero-point-inflection").zone, "trash");
  assert.deepEqual(killed.events.map(event => event.action), ["kill"]);

  // "choose an opponent. They score 1 point."
  const scoreKernel = world().build();
  scoreKernel.addPlayer("B");
  const scored = runInstruction(
    score,
    { amount: scoreInstruction.args.amount, player: scoreInstruction.args.player },
    { world: scoreKernel, picks: { "chosen-opponent": ["B"] } }
  );
  assert.equal(scored.result.status, "executed");
  assert.equal(scoreKernel.player("B").score, 1);
  assert.deepEqual(scored.linked.scored, [{ player: "B", amount: 1 }]);
});

test("rad-069-167 Zero Point Inflection: the authored discard/kill/score body really resolves end to end", () => {
  // The 9-other-cards gate is unmerged (judgeReason), but the ability's own
  // body is real data the merged primitives execute: discard the whole hand,
  // kill this, then award 1 point to the chosen opponent (423.1/423.5, 429.6,
  // 194.1.c, 470).
  const kernel = world().unit("zero-point-inflection", { zone: "board" }).hand("h1").hand("h2").build();
  kernel.addPlayer("B");
  kernel.setPicks("chosen-opponent", ["B"]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("zero-point-inflection") });

  const outcome = resolveChainBody(drawTrigger.body, scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["zero-point-inflection.discard-hand", "executed"],
      ["zero-point-inflection.kill-self", "executed"],
      ["zero-point-inflection.score", "executed"]
    ]
  );
  assert.equal(scoped.player("A").handCount, 0);
  assert.deepEqual(
    scoped.zone("A", "trash").map(ref => ref.id).sort(),
    ["h1", "h2", "zero-point-inflection"]
  );
  assert.equal(scoped.getObject("zero-point-inflection").zone, "trash");
  assert.equal(scoped.player("B").score, 1);
  assert.deepEqual(
    outcome.events.map(event => event.action),
    ["discard", "discard", "kill", "score"]
  );
});

test("rad-069-167 Zero Point Inflection: the second ability's instructions keep their authored order", () => {
  // The body is a 3-step ordered list and each later instruction links to the
  // one before it, so "discard your hand, kill this, and choose an opponent"
  // is program data rather than interpreter-imposed order. The body itself
  // resolves end to end (see the execution test above).
  assert.deepEqual(
    drawTrigger.body.map(instruction => instruction.id),
    [
      "zero-point-inflection.discard-hand",
      "zero-point-inflection.kill-self",
      "zero-point-inflection.score"
    ]
  );
  assert.equal(drawTrigger.body[0].linkedTo, undefined);
  assert.equal(drawTrigger.body[1].linkedTo, drawTrigger.body[0].id);
  assert.equal(drawTrigger.body[2].linkedTo, drawTrigger.body[1].id);
});

test("rad-069-167 Zero Point Inflection: discard and kill are separate instructions (359.3.e.14.b)", () => {
  // The kill's linkedTo keeps the authored order (discard, then kill) while a
  // replaced kill must not undo the discard: these are two independent
  // instructions, not one compound effect.
  const [discardInstruction, killInstruction] = drawTrigger.body;
  assert.notEqual(discardInstruction.id, killInstruction.id);
  assert.equal(killInstruction.linkedTo, discardInstruction.id);

  // A discarded-then-killed sequence: the discard links its result, and a
  // discarded-ignored discard would leave the kill to run on its own (the
  // interpreter's linked-ignored rule only stops linked instructions when the
  // referenced instruction was *ignored*, and discard returns executed).
  const kernel = world().unit("zero-point-inflection", { zone: "board" }).hand("hand-card").build();
  const discarded = runInstruction(discard, discardInstruction.args, { world: kernel });
  assert.equal(discarded.result.status, "executed");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("zero-point-inflection") });
  const killed = runInstruction(kill, { self: true }, { world: scoped, linked: { discarded: discarded.linked.discarded } });
  assert.equal(killed.result.status, "executed");
  assert.equal(scoped.player("A").handCount, 0);
  assert.equal(scoped.getObject("zero-point-inflection").zone, "trash");
});

test("rad-069-167 Zero Point Inflection: primitives match the program's instruction ops", () => {
  const [discardInstruction, killInstruction, scoreInstruction] = drawTrigger.body;
  assert.equal(discardInstruction.op, discard.op);
  assert.equal(killInstruction.op, kill.op);
  assert.equal(scoreInstruction.op, score.op);

  // A stale hand (already empty) discards nothing and still links a zero count.
  const empty = runInstruction(discard, { amount: { kind: "constant", value: "all" } }, { world: world().build() });
  assert.equal(empty.result.status, "executed");
  assert.equal(empty.linked.discarded.count, 0);
});

test("rad-069-167 Zero Point Inflection: scoring to an invalid opponent pick is impossible, not silently skipped", () => {
  // effect.score requires at least one recipient; an empty pick set is
  // "impossible" (contract 3.6 primitive rule 2), never a silent no-op.
  const kernel = world().build();
  const run = runInstruction(
    score,
    { amount: { kind: "constant", value: 1 }, player: { kind: "constant", value: { kind: "pick", id: "chosen-opponent" } } },
    { world: kernel, picks: { "chosen-opponent": [] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
});


test.todo(
  "rad-069-167 Zero Point Inflection: evaluating 'when you draw 1 or more cards with 9 or more other " +
    "cards in your hand' still needs a per-event drawn-card payload and a post-draw hand re-read; " +
    "the merged card-drawn payload (actionId/batchId/playerId/cardId/fromZone/drawIndexThisTurn) has no " +
    "per-event drawn-card set, HistoryQuery's exclude/objectFilter fields do not add one, and its exclude " +
    "source anchor points at the card program's source object, not the card(s) drawn by this event. " +
    "Trigger registration itself is merged."
);

test.todo(
  "rad-069-167 Zero Point Inflection: the ongoing triggers and 'kill this' require the printing to be " +
    "a board permanent; the catalog types it as Spell (CR 1.5 157/351.2 trash the spell after resolving). " +
    "Card-data issue report, not a card-program change."
);
