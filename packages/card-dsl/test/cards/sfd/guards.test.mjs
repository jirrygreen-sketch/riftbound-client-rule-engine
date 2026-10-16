import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/guards.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [, play] = program.abilities;
const tokenInstruction = play.body[0];
const choiceInstruction = play.body[1];

test("Guards! program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "Play a 2 :rb_might: Sand Soldier unit token. You may pay :rb_rune_order: to ready it."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Guards! structure: Hidden keyword, chain-played Sand Soldier, optional paid ready", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "hidden" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["guards.play-sand-soldier", "effect.token"],
      ["guards.may-ready", "choice.optional"]
    ]
  );

  // "Play a 2 [M] Sand Soldier unit token": the CR 187.3 definition, played
  // through the chain (440.2.c / 185.2.a).
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  // 355.2.a: the legal locations are chosen at Finalize; the list is runtime
  // data that no static-IR filter can enumerate.
  assert.deepEqual(tokenInstruction.args.locations.value, ["dynamic:legal-unit-locations"]);
  assert.deepEqual(tokenInstruction.args.choiceId, { kind: "constant", value: "guards-token-location" });
  assert.equal(tokenInstruction.linkedTo, undefined);
  assert.equal(tokenInstruction.targets, undefined);

  // "You may pay :rb_rune_order: to ready it": one optional decision whose
  // chosen instructions live in the body (contract 3.9), linked to the token
  // instruction ("it" = the played Sand Soldier).
  assert.equal(choiceInstruction.linkedTo, "guards.play-sand-soldier");
  assert.equal(choiceInstruction.args.body.kind, "constant");
  const [pay, ready] = choiceInstruction.args.body.value;
  assert.equal(pay.id, "guards.pay-order-rune");
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.power, { kind: "constant", value: ["Order"] });
  assert.equal(ready.id, "guards.ready-sand-soldier");
  assert.equal(ready.op, "effect.ready");
  assert.equal(ready.linkedTo, "guards.pay-order-rune");
  assert.deepEqual(ready.args.objects, {
    kind: "linked-value",
    instructionId: "guards.play-sand-soldier",
    key: "sandSoldier.objects"
  });
});

test("Guards! golden: the unmerged chain-play path is negated, not silently created on the Board", () => {
  // The merged create-token action only creates directly on the Board, so
  // mode "play" must be refused with the documented blockedReason; a silent
  // Board creation would be a different card text.
  const kernel = world().build();
  const run = runInstruction(token, tokenInstruction.args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.query({ zone: "board" }).length, 0);
});

test.todo(
  "Guards! full play: the Sand Soldier token is created on the Chain and played to a legal " +
    "location chosen at Finalize (440.2.c / 185.2.a / 350.2 / 354 / 355.2.a), then the optional " +
    ":rb_rune_order: payment readies it (依赖 cost.pay 与链上 token 创建/打出管线、目标位置提供方)"
);
