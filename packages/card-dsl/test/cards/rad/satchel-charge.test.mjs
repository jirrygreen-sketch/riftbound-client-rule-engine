import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/satchel-charge.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-2e3a1c21d595d016a01ef7ca0dac47ff84bd3742a4ce60df418cdaed35983366";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Move a friendly unit, then play a Bomb gear token to a battlefield. (It has [Deploy]. " +
  "When it dies, deal 2 to an enemy there and kill your other Bombs there.)";

const [keyword, play] = program.abilities;
const [moveInstruction, tokenInstruction] = play.body;

test("Satchel Charge program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Satchel Charge identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Satchel Charge structure: [Action], targeted Move, then the Bomb token clause", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });

  // "Move a friendly unit": the moved unit is a target (355.10 / 355.9.a.1).
  assert.equal(moveInstruction.id, "satchel-charge.move-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "satchel-charge.friendly-unit" }
  });
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "satchel-charge.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "then play a Bomb gear token to a battlefield": a NEW token is played
  // through the chain (440.2.c / 185.2.a); the Bomb definition (187.12) is the gap.
  assert.equal(tokenInstruction.id, "satchel-charge.play-bomb-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  // "then" is a sequencing word, not a condition: no linkedTo between the two.
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.equal(tokenInstruction.linkedTo, undefined);
});

test("Satchel Charge golden: the Move half moves one friendly unit through the merged primitive", () => {
  const second = { type: "battlefield", id: "battlefield-2" };
  const kernel = world()
    .unit("friendly", { owner: "A", exhausted: true, might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  // The printed destination is a runtime choice (355.4 / 451.1) that has no IR
  // selector yet, so the golden supplies a concrete second battlefield.
  const run = runInstruction(
    move,
    { ...moveInstruction.args, to: { kind: "constant", value: second } },
    { world: kernel, targets: { "satchel-charge.friendly-unit": [kernel.ref("friendly")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(kernel.getObject("friendly").location, second);
  // An effect Move is not the Standard Move: no exhaust cost, statuses kept.
  assert.equal(kernel.getObject("friendly").exhausted, true);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "battlefield-1" });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

test("Satchel Charge golden: the merged token play path really plays a defined token", () => {
  // effect.token's play path (440.2.c / 185.2.a: create on the Chain, then play)
  // is the merged half this card relies on. Recruit stands in for the Bomb so the
  // play handoff itself has execution evidence; the Bomb definition (187.12) is
  // the part named in judgeReason.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
  assert.equal(kernel.query({ type: "unit", zone: "board" }).filter((object) => object.isToken).length, 1);
});

test.todo(
  "Satchel Charge: the Bomb gear token definition (CR 187.12, [Deploy] + its Deathknell ability) " +
    "must be added to effect.token before 'play a Bomb gear token' can execute — tokens carrying " +
    "their own abilities stay blocked with receipts naming the missing definition"
);

test.todo(
  "Satchel Charge: the printed destination is a runtime location choice ('to a battlefield', 355.4 / 451.1) " +
    "and needs an IR channel that evaluates the legal destinations (effect.move 'to' and effect.token " +
    "'location' only accept static LocationRefs or static candidate lists)"
);
