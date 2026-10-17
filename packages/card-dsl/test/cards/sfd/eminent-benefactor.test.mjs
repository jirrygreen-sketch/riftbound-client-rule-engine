import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/eminent-benefactor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
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
  assert.match(program.judgeReason, /RIFT-257/);
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
  // The Gold entry is the only blocked part: the merged play mode chains
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
  "sfd-152-221 Eminent Benefactor: create and play two Gold gear tokens exhausted once the Gold definition " +
    "(CR 187.5) and the exhausted entry stipulation (184.1 / 185.2.d) are merged (token primitive task); " +
    "the chain-creation + play hand-off itself is merged and covered by the supported-definition run above"
);

test.todo(
  "sfd-152-221 Eminent Benefactor: the hold trigger reaches this ability through the trigger -> chain pipeline " +
    "with the held unit's identity exposed to card registration (383.4.d / 383.4.d.2.a) — RIFT-257"
);
