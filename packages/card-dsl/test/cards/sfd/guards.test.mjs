import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/guards.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";

const CANONICAL = "card.hash-96f6071389124163d72b59b25dca5a642f1cd93402158c5237be9ba305f9dd44";

const [, play] = program.abilities;
const tokenInstruction = play.body[0];
const choiceInstruction = play.body[1];

// The card's own argument shape, with only the unwired "choose a legal
// location at Finalize" placeholder replaced by one concrete location (the
// golden proves the merged chain-creation + play handoff, not the missing
// location provider).
const concreteArgs = {
  ...tokenInstruction.args,
  locations: { kind: "constant", value: [{ type: "base", player: "A" }] }
};

test("Guards! program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
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

test("Guards! golden: the merged token primitive creates the Sand Soldier on the Chain and plays it", () => {
  // The card's own shape minus the unwired location placeholder: the merged
  // play mode creates on the Chain and hands the new ObjectRef to the play
  // action (440.2.c / 185.2.a / 350.2 / 354).
  const kernel = world().player("A", { energy: 10 }).player("B", { energy: 10 }).build();
  const run = runInstruction(token, concreteArgs, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Sand Soldier");
  assert.equal(created[0].might, 2);
  // 185.3.a: a token carries null Energy / Power, never zero.
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.deepEqual(run.linked["sandSoldier.createdAmount"], 1);
  assert.equal(run.linked["sandSoldier.objects"].length, 1);
});

test("Guards! the token instruction declares the Finalize-time location placeholder (355.2.a)", () => {
  // The legal destinations are runtime data: the authored argument is the
  // documented placeholder, and the golden above executes the same shape with
  // a concrete location.
  assert.deepEqual(tokenInstruction.args.locations, {
    kind: "constant",
    value: ["dynamic:legal-unit-locations"]
  });
  assert.equal(tokenInstruction.args.location, undefined);
});

test("Guards! golden: declining the optional ready leaves the played Sand Soldier exhausted", () => {
  // The whole printed body runs through the production adapter with the card's
  // own instructions: the token is really created and played, and the optional
  // decision is answered as declined through the interpreter.
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .base("guards-source", { owner: "A" })
    .build();
  const bound = kernel.clone({
    source: kernel.ref("guards-source"),
    sourceSnapshot: kernel.getObject("guards-source")
  });
  bound.setAnswers({ "guards.may-ready/optional": false });
  const body = [{ ...tokenInstruction, args: concreteArgs }, choiceInstruction];
  const outcome = resolveChainBody(body, bound);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["guards.play-sand-soldier", "executed", undefined],
      ["guards.may-ready", "negated", "skipped"]
    ]
  );
  const created = bound.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  // Without the payment the token keeps the entry state; the paid ready is the
  // part whose cost.pay primitive is still unmerged (judgeReason).
  assert.equal(outcome.events.filter(event => event.action === "play").length, 1);
});

test.todo(
  "Guards! full play: resolve \"dynamic:legal-unit-locations\" into the 355.2.a legal locations at Finalize " +
    "(the Battlefield/Base set the playing player may choose) once a target/location provider exists"
);
test.todo(
  "Guards! paid ready: pay one Order rune inside the resolving body (204.3 Cost within Instructions) and ready " +
    "the linked Sand Soldier through cost.pay — depends on RIFT-261 (cost.pay / cost.modify) and the " +
    "cost-payment batch"
);
