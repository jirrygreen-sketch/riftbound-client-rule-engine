import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/disintegrate.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";

const [speed, play] = program.abilities;
const damageInstruction = play.body[0];
const drawInstruction = play.body[1];

const c = value => ({ kind: "constant", value });
const victimWorld = (might = 5) => {
  const kernel = world().unit("victim", { owner: "B", might }).deck("top-card").build();
  kernel.setTargets("disintegrate.unit-at-battlefield", [kernel.ref("victim")]);
  return kernel;
};

test("Disintegrate program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap: no producer for the killed result.
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /killed/);
  assert.match(program.judgeReason, /429\.5\.c/);
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

  assert.deepEqual(damageInstruction.args.amount, c(3));
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "disintegrate.unit-at-battlefield");
  assert.deepEqual(damageInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.deepEqual(damageInstruction.targets[0].location, { type: "battlefield" });
  assert.equal(damageInstruction.targets[0].selection, "one");

  // "If this kills it" references the kill performed by the damage instruction,
  // so the draw is linked (359.3.e.14.b) and gated on the missing result
  // binding rather than running unconditionally.
  assert.equal(drawInstruction.linkedTo, "disintegrate.deal-3");
  assert.deepEqual(drawInstruction.args.amount, c(1));
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
  const kernel = victimWorld(5);

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
  const kernel = victimWorld(3);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("Disintegrate golden execution: a stale target ignores the damage and the linked draw", () => {
  const kernel = victimWorld(5);
  const stale = kernel.ref("victim");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("disintegrate.unit-at-battlefield", [stale]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.player("A").handSize, 0);
});

test("Disintegrate current gap: effect.damage links dealt/dealtTo/dealtCount and never reports a kill", () => {
  // 429.1.a.2 / 429.5.c: a kill caused by lethal damage is a passive kill
  // attributed during a Cleanup. The primitive itself links only the damage,
  // and the reference kernel leaves the 3-Might unit on the board with damage 3,
  // so no kill ever reaches the condition.
  const kernel = victimWorld(3);
  const run = runInstruction(
    damage,
    { amount: c(3), target: "disintegrate.unit-at-battlefield" },
    { world: kernel, targets: { "disintegrate.unit-at-battlefield": [kernel.ref("victim")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(Object.keys(run.result.linkedValues).sort(), ["dealt", "dealtCount", "dealtTo"]);
  assert.equal(run.result.linkedValues.dealt, 3);
  assert.deepEqual(run.result.linkedValues.dealtTo, [{ target: { id: "victim", zoneEntryId: 1 }, amount: 3 }]);
  assert.equal(run.result.linkedValues.killed, undefined);
  const victim = kernel.getObject("victim");
  assert.equal(victim.zone, "board");
  assert.equal(victim.damage, 3);
});

test("Disintegrate current gap: the merged condition.result predicate works for produced keys and misses only killed", () => {
  // RIFT-359's result predicate is merged and resolves an instruction's link by
  // id + key. Swapping the card's condition for the `dealt` key makes the draw
  // execute, which isolates the remaining gap to the missing `killed` producer.
  const produced = victimWorld(5);
  const outcome = resolveChainBody([
    damageInstruction,
    { ...drawInstruction, condition: { kind: "result", result: "disintegrate.deal-3", key: "dealt" } }
  ], produced);
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(produced.player("A").handSize, 1);

  // The same predicate spelling with `killed` throws MissingInformation, which
  // the interpreter converts into the fail-closed ignore the card relies on.
  const missing = victimWorld(3);
  const closed = resolveChainBody([
    damageInstruction,
    { ...drawInstruction, condition: { kind: "result", result: "disintegrate.deal-3", key: "killed" } }
  ], missing);
  assert.deepEqual(closed.results[1].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(missing.player("A").handSize, 0);
});

test.todo(
  "Disintegrate: produce the \"killed\" result for the damage instruction by attributing lethal-damage kills " +
    "during the cleanup (429.1.a.2, 429.5.c) so a real kill draws 1 while a replaced death does not"
);

