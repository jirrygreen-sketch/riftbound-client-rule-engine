import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/wages-of-pain.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const play = program.abilities.find(ability => ability.kind === "play");
const dealInstruction = play.body[0];
const tokenInstruction = play.body[1];
const targetSpec = dealInstruction.targets[0];

test("Wages of Pain program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Wages of Pain is judge-required only because of the Gold gear token", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1).
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187.5/);
  assert.match(program.judgeReason, /440.2.c/);
  assert.match(program.sourceText, /Deal 3 to a unit at a battlefield./);
  assert.match(program.sourceText, /Play a Gold gear token exhausted./);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Wages of Pain structure: Hidden + Action keywords, damage then token instructions", () => {
  const keywords = program.abilities.filter(ability => ability.kind === "keyword");
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
  assert.deepEqual(targetSpec.filter, { types: "unit", location: { type: "battlefield" } });

  // The token half references the missing primitive explicitly instead of
  // approximating it; the two instructions are independent (no linkedTo).
  assert.equal(tokenInstruction.id, "play-gold-token");
  assert.equal(tokenInstruction.op, "effect.play-gold-token-exhausted");
  assert.deepEqual(tokenInstruction.args, {});
  assert.equal(tokenInstruction.linkedTo, undefined);
});

test("Wages of Pain golden execution: the damage half deals 3 to the locked battlefield unit", () => {
  const kernel = world().unit("battlefield-unit").build();
  const locked = kernel.ref("battlefield-unit");
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 3);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 3);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("Wages of Pain golden execution: a stale battlefield target is ignored, not redirected", () => {
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
  "Wages of Pain: the Gold gear token needs create-token's chain destination plus the " +
    "effect.play handoff (440.2.c / 185.2.a, contract changelog RIFT-62), a Gold token " +
    "definition carrying its granted ability (187.5), and an entry-exhaustion override " +
    "(143.4 / 185.2.d) in effect.token (RIFT-63 follow-up)."
);

test.todo(
  "Wages of Pain: playing from facedown must restrict the damage target to the battlefield " +
    "it was hidden at (811.1.d.2); enforcement belongs to Hidden's expansion (RIFT-84) and " +
    "the target system (RIFT-90)."
);
