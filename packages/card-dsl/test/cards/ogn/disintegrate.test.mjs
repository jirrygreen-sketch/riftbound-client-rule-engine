import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/disintegrate.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const damageInstruction = play.body[0];
const drawInstruction = play.body[1];

test("Disintegrate program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap: no if-killed result binding.
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /359\.3\.e\.14/);
});

test("Disintegrate identity and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-59023abea680c1ec0358c2f407d08193931447ee6c2b18ad3f0a0588b4f6501f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Deal 3 to a unit at a battlefield. If this kills it, draw 1."
  );
});

test("Disintegrate structure: [Action], one battlefield target, linked conditional draw", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Printed cost is 4 Energy and this printing has no Power value (null in the
  // catalog), so only the Energy component is declared.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 }
  });
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["disintegrate.deal-3", "effect.damage"],
      ["disintegrate.draw-if-killed", "effect.draw"]
    ]
  );

  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 3 });
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "disintegrate.unit-at-battlefield");
  assert.deepEqual(damageInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.deepEqual(damageInstruction.targets[0].location, { type: "battlefield" });
  assert.equal(damageInstruction.targets[0].selection, "one");

  // "If this kills it" references the kill performed by the damage instruction,
  // so the draw is linked (359.3.e.14.b) and gated on the missing result
  // binding rather than running unconditionally.
  assert.equal(drawInstruction.linkedTo, "disintegrate.deal-3");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawInstruction.condition, {
    kind: "expression",
    value: {
      kind: "linked-value",
      instructionId: "disintegrate.deal-3",
      key: "killed"
    }
  });
});

test("Disintegrate golden execution: the damage half deals 3 to the locked unit", () => {
  const kernel = world().unit("victim", { owner: "B", might: 5 }).deck("top-card").build();
  kernel.setTargets("disintegrate.unit-at-battlefield", [kernel.ref("victim")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.dealt, 3);
  assert.equal(kernel.getObject("victim").damage, 3);
});

test("Disintegrate golden execution: the if-killed gate fails closed, never drawing unconditionally", () => {
  // 3 damage does not kill a 3-Might unit by itself in the reference kernel
  // (lethal-damage cleanup belongs to the kernel/cleanup pipeline), and even a
  // killed unit would not be reported: the condition reads an unavailable linked
  // value, which the interpreter treats as missing information and ignores
  // (contract 3.4). The guard is what keeps the card from drawing for free.
  const kernel = world().unit("victim", { owner: "B", might: 3 }).deck("top-card").build();
  kernel.setTargets("disintegrate.unit-at-battlefield", [kernel.ref("victim")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("Disintegrate golden execution: a stale target ignores the damage and the linked draw", () => {
  const kernel = world().unit("victim", { owner: "B", might: 5 }).deck("top-card").build();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("disintegrate.unit-at-battlefield", [stale]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "Disintegrate: the 'If this kills it' gate needs the lethal-damage to kill " +
    "attribution (429.5.c) plus a condition.result / if-killed result binding " +
    "(RIFT-9) and the survey's proposed reflexive trigger, so a real kill draws " +
    "1 while a replaced death does not."
);
