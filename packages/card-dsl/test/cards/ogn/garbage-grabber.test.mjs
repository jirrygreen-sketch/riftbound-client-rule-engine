import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/garbage-grabber.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { runInstruction } = await import(new URL("effects/testing/run-instruction.js", ENGINE));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", ENGINE));

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("garbage-grabber: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("garbage-grabber: identity, ruleset, status and specific judgeReason", () => {
  assert.equal(program.canonicalCardId, "card.hash-00d819e309a473483d8a8fe1f5b4cd6332aed4778597aa7272e310eba60023c8");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Recycle 3 from your trash, :rb_energy_1:, :rb_exhaust:: Draw 1.");
  assert.match(program.judgeReason, /417\.6/);
  assert.match(program.judgeReason, /ObjectRef/);
  assert.match(program.judgeReason, /有效.*费用|费用/);
});

test("garbage-grabber: the printed cost is one activated ability with three components (CR 404.1.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  // energy 1 (404.2's printed numeric cost) plus the recycle and exhaust
  // payments, in printed order.
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.equal(ability.cost.payments.length, 2);
  const [recycle, exhaust] = ability.cost.payments;
  assert.equal(recycle.kind, "recycle");
  assert.deepEqual(recycle.amount, { kind: "constant", value: 3 });
  // 417.6: "Recycle 3 from your trash" is a non-targeting choice, so it is a
  // cost pick, never a TargetSpec.
  assert.equal(recycle.choice.id, "garbage-grabber.recycled-cards");
  assert.equal(recycle.choice.selection, "up-to");
  assert.equal(recycle.choice.min, 3);
  assert.equal(recycle.choice.max, 3);
  assert.equal(recycle.choice.zone, "trash");
  assert.equal(recycle.choice.owner, "controller");
  assert.equal(exhaust.kind, "exhaust");
});

test("garbage-grabber: body is an independent Draw 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("garbage-grabber golden: Draw 1 takes the top card of the controller's deck (CR 414.3)", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    // Array form is top-to-bottom: index 0 is the deck top (CR 414.1.a).
    .deck(["top-card", "deeper-card"], { owner: "A" })
    .build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(
    kernel.zone("A", "hand").map((ref) => ref.id),
    ["top-card"]
  );
  assert.equal(run.linked.drawn, 1);
});
