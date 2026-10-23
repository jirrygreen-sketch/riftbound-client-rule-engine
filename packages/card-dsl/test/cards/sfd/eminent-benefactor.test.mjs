import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/eminent-benefactor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-817b13977c7d2a024cbbd611deceb4cb9fc4c925146ad3da8e575aee8d77325f";
const SOURCE_TEXT = "When I hold, play two Gold gear tokens exhausted.";

const [ability] = program.abilities;
const [playGold] = ability.body;

test("sfd-152-221 Eminent Benefactor: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-152-221 Eminent Benefactor: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /383\.4\.d\.2\.a/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-152-221 Eminent Benefactor: hold trigger whose body plays two Gold tokens exhausted", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d / 383.4.d.2.a: a Hold Effect on the hold timing point, filtered to
  // this unit through the symbolic source anchor.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(playGold.id, "eminent-benefactor.play-gold-tokens");
  assert.equal(playGold.op, "effect.token");
  // 187.5: the Gold gear token (with its own printed ability).
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 2 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  // 440.2.b.1: the effect names no location, so the permanent token is created
  // where it can be played — its controller's Base.
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldTokens" });
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.linkedTo, undefined);
});

test("sfd-152-221 Eminent Benefactor golden: the merged play path really creates+plays a supported token twice", () => {
  // Only the supported token play path is tested here: the merged play mode chains
  // create-token(to: chain) with the play hand-off (440.2.c / 185.2.a), so the
  // same amount/linkKey shape with an ability-free definition executes for real.
  const kernel = world().player("A").build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "recruit" },
      amount: { kind: "constant", value: 2 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "goldTokens" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["goldTokens.amount"], 2);
  // The chain-creation receipts survive the hand-off.
  assert.equal(run.linked["goldTokens.createdAmount"], 2);
  assert.equal(run.linked.goldTokens.objectsComplete, true);
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 2);
  assert.deepEqual(run.events.map((event) => event.action).filter((action) => action === "play").length, 2);
});

test.todo(
  "sfd-152-221 Eminent Benefactor: create and play two Gold gear tokens exhausted through the authored " +
    "hold-trigger body once the hold event carries this object's identity"
);

test.todo(
  "sfd-152-221 Eminent Benefactor: queue the original Gold body only when this unit is present at the held battlefield " +
    "(383.4.d.2.a); bind the hold player/battlefieldId to the unit's location instead of requiring event.object"
);

test("sfd-152-221 Eminent Benefactor: the merged token primitive executes the Gold entry stipulation and relative base", () => {
  const kernel = world().player("A").build();
  const run = runInstruction(token, playGold.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["goldTokens.amount"], 2);
  const gold = kernel.query({ type: "gear", zone: "board" }).filter(object => object.isToken);
  assert.equal(gold.length, 2);
  assert.equal(gold.every(object => object.name === "Gold"), true);
  assert.equal(gold.every(object => object.exhausted === true), true);
  assert.equal(gold.every(object => object.location?.type === "base" && object.location.player === "A"), true);
  assert.equal(gold.every(object => object.energy === null && object.power === null), true);
});

test("sfd-152-221 Eminent Benefactor: the merged hold payload still carries no object for the source:self filter", () => {
  // 383.4.d.2.a: a real Hold must identify this unit at the held battlefield.
  assert.equal(
    matchesTriggerEvent(
      { event: "hold", filter: { source: "self" } },
      { timingPoint: "hold", kind: "scoring", player: "A", details: { battlefieldId: "bf-1" } },
      "A"
    ),
    false
  );
});
