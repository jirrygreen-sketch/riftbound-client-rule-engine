import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/wages-of-pain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c";

const play = program.abilities.find((ability) => ability.kind === "play");
const dealInstruction = play.body[0];
const tokenInstruction = play.body[1];
const targetSpec = dealInstruction.targets[0];

test("sfd-070-221 Wages of Pain: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-070-221 Wages of Pain: judge-required only because of the Gold gear token entry state", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual, current gaps (contract 3.1).
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.sourceText, /Deal 3 to a unit at a battlefield./);
  assert.match(program.sourceText, /Play a Gold gear token exhausted./);
});

test("sfd-070-221 Wages of Pain structure: Hidden + Action keywords, damage then token instructions", () => {
  const keywords = program.abilities.filter((ability) => ability.kind === "keyword");
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);

  assert.equal(play.body.length, 2);
  assert.equal(dealInstruction.id, "deal-3");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 3 });
  assert.equal(dealInstruction.linkedTo, undefined);

  // "a unit at a battlefield": exactly one unit pinned to a battlefield.
  assert.equal(dealInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "damaged-unit");
  assert.equal(targetSpec.selection, "one");
  assert.deepEqual(targetSpec.filter, { type: "unit", location: "battlefield" });

  // The token half uses the merged token primitive with the entry-stipulation
  // argument that the primitive's schema rejects instead of a fake opcode.
  assert.equal(tokenInstruction.id, "play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(tokenInstruction.linkedTo, undefined);
  // Every opcode the program uses really exists in the merged registry (no
  // placeholder op such as the former effect.play-gold-token-exhausted).
  for (const instruction of [dealInstruction, tokenInstruction]) {
    assert.equal(instructionDefinitionsById.has(instruction.op), true, instruction.op);
  }
});

test("sfd-070-221 Wages of Pain golden execution: the damage half deals 3 to the locked battlefield unit", () => {
  const kernel = world().unit("battlefield-unit").build();
  const locked = kernel.ref("battlefield-unit");
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 3);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 3);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("sfd-070-221 Wages of Pain golden execution: a stale battlefield target is ignored, not redirected", () => {
  const kernel = world().unit("battlefield-unit").build();
  const stale = kernel.ref("battlefield-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "sfd-070-221 Wages of Pain: play a Gold gear token exhausted once the Gold definition (187.5) and the entry " +
    "stipulation (184.1 / 185.2.d) are merged; the chain-create + play handoff is already merged (RIFT-62)."
);

test.todo(
  "sfd-070-221 Wages of Pain: play a Gold gear token exhausted (CR 187.5 definition plus 184.1 / 185.2.d entry " +
    "state). The card's own args record the real request (effect.token, token \"gold\", mode \"play\", " +
    "entersExhausted true); the merged primitive cannot yet resolve the Gold definition or the entry override."
);

test.todo(
  "sfd-070-221 Wages of Pain: playing from facedown must restrict the damage target to the battlefield " +
    "it was hidden at (811.1.d.2) - enforcement belongs to Hidden's expansion consumer (RIFT-89) and the target " +
    "system (RIFT-90)."
);
