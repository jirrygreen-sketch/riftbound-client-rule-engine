import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/mushroom-pouch.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { runInstruction } = await import(new URL("effects/testing/run-instruction.js", ENGINE));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", ENGINE));

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("mushroom-pouch: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("mushroom-pouch: identity, ruleset, status and specific judgeReason", () => {
  assert.equal(program.canonicalCardId, "card.hash-689c116add3b0f95eb8a9545f336509a3e539abe5b910af8fb28caba8512f6ad");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1."
  );
  // The reason must name the missing zone spelling and the timing owner.
  assert.match(program.judgeReason, /Facedown/);
  assert.match(program.judgeReason, /ZoneId/);
  assert.match(program.judgeReason, /beginning-start/);
  // Re-sweep after RIFT-270: the point now has a producer (turn/flow.ts), so
  // the remaining trigger-side gap is the CardProgram binding (RIFT-257).
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-270/);
});

test("mushroom-pouch: one mandatory beginning-start trigger (CR 315.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("mushroom-pouch: the intervening 'if you control a facedown card' clause is a condition, not a target", () => {
  // 355.10.c: "if …" is a condition; nothing is chosen, so the trigger carries
  // no target and the instruction has no TargetSpec.
  assert.deepEqual(ability.trigger.filter, {});
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  // The facedown-card count the condition needs (107.3.a/107.3.e, 355.9.a.3).
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    controller: "controller",
    zone: "battlefield",
    states: "face-down"
  });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("mushroom-pouch: body is an unlinked Draw 1 for the ability controller", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("mushroom-pouch golden: the Draw 1 half draws one card (CR 414.3)", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    // Array form is top-to-bottom: index 0 is the deck top (CR 414.1.a).
    .deck(["top-card", "second-card"], { owner: "A" })
    .build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
});

test.todo(
  "mushroom-pouch: evaluating 'if you control a facedown card at a battlefield' needs a Facedown Zone scope (107.3.a/107.3.e: a battlefield sub-zone, not a location; ZoneId has no facedown member, and states: 'face-down' cannot be limited to it)."
);

test.todo(
  "mushroom-pouch: the turn structure now emits beginning-start for the turn player's Beginning Phase (turn/flow.ts, RIFT-270); the trigger still needs the CardProgram registration path to bind this card's ability (RIFT-257)."
);
