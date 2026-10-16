import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jae-medarda.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-41956626d8e2085aa462cfe2ee446c4b1d4f6fed16272a0a937256f92f5d68bb";
const SOURCE_TEXT = "When you choose me with a spell, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("sfd-142-221 Jae Medarda: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-142-221 Jae Medarda: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /became-target/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-142-221 Jae Medarda: a Targeting Effect on became-target whose body draws 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);

  // 383.4.b / 383.4.b.3: a Targeting Effect subscribes to the became-target
  // timing point; 355.6 makes the printed "choose" equal to Targeting. "me" is
  // the host through the symbolic "self" target anchor, and the source must be
  // a spell (383.4.b.3).
  assert.equal(ability.trigger.at, "became-target");
  assert.deepEqual(ability.trigger.filter, {
    event: "became-target",
    target: { object: "self" },
    source: { type: "spell" },
    player: "any"
  });

  // 414.1 / 414.3: draw 1 for the ability's controller (190.6.d's implicit "you").
  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "jae-medarda.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("sfd-142-221 Jae Medarda golden: the body really draws 1 for the ability controller", () => {
  // The array form sets an explicit top-to-bottom deck order (testing README).
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
  // 414.1.a: the draw takes the top card of the Main Deck into Hand.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["second"]);
});

test("sfd-142-221 Jae Medarda golden: an empty Main Deck draws zero without faking a card (414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "sfd-142-221 Jae Medarda: the became-target payload must discriminate a spell source from an ability source " +
    "(383.4.b.3) — chain/engine.ts emits became-target with object/target/source/player but no playable source " +
    "type field, and effects/keywords are consumed by no card-program trigger registration yet (RIFT-64 / RIFT-120)"
);

test.todo(
  "sfd-142-221 Jae Medarda: register the card's triggered ability as a TriggerRegistration and match the " +
    "target anchor (355.7 / 383.4.b.2) against this unit once the card-program trigger pipeline exists (RIFT-120)"
);
