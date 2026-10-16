import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/zaun-punk.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5433b0927a4bc2a2f4e5d52590d57b1bec38882780434c5aed6ac38f5eb85c16";
const [costAbility, playTrigger] = program.abilities;
const [killInstruction] = playTrigger.body;

test("sfd-160-221 Zaun Punk: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(
    program.sourceText,
    "You may kill a friendly gear as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, kill a gear."
  );
});

test("sfd-160-221 Zaun Punk: optional additional cost kills one friendly gear", () => {
  // 356.2.b / 356.2.b.1: Optional Additional Cost imposed by a passive ability
  // of the card being played; the merge is a cost component (355.10.c), never a
  // target choice.
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "cost.additional");
  assert.equal(costAbility.effect.id, "zaun-punk.additional-cost");
  assert.equal(costAbility.effect.appliesTo, "self");
  assert.equal(costAbility.effect.optional, true);
  assert.equal(costAbility.effect.stage, "optional-additional");
  assert.equal(costAbility.effect.payments.length, 1);
  const [payment] = costAbility.effect.payments;
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "zaun-punk.friendly-gear");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.filter.type, "gear");
  assert.equal(payment.choice.filter.controller, "controller");
});

test("sfd-160-221 Zaun Punk: card-played self trigger kills one gear", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(killInstruction.id, "zaun-punk.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "zaun-punk.gear"
  });
  assert.deepEqual(killInstruction.targets, [
    {
      id: "zaun-punk.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(killInstruction.linkedTo, undefined);
});

test("sfd-160-221 Zaun Punk: the merged kill primitive kills a gear at its location", () => {
  const kernel = world()
    .unit("punk", { zone: "board" })
    .player("A")
    .unit("friendly-gear", { zone: "board", types: ["gear"], location: { type: "base", player: "A" } })
    .player("B")
    .unit("enemy-gear", { zone: "board", types: ["gear"], owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { target: "zaun-punk.gear" },
    { world: kernel, targets: { "zaun-punk.gear": [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "enemy-gear", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
});

test.todo(
  "sfd-160-221 Zaun Punk: charge the optional additional cost through the cost pipeline and gate the " +
    "kill on the 356.4.f.1 paid receipt (cost.additional / cost.sacrifice + cost-plan wiring, RIFT-89)"
);
