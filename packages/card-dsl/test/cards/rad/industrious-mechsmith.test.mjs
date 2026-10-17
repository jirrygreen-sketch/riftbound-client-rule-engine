import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/industrious-mechsmith.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fd4d12013cc7cd7178ca0dc066919c845a2ca4cf3a00d76ebd6d1532e7fff561";
const SOURCE_TEXT = "When you play me, play a 3 :rb_might: Mech unit token here.";

const [triggered] = program.abilities;
const [readHere, playMech] = triggered.body;

function fixture(location = { type: "battlefield", id: "bf1" }) {
  return world()
    .unit("industrious-mechsmith", { owner: "A", controller: "A", might: 1, location })
    .build();
}

test("rad-049-167 Industrious Mechsmith: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-049-167 Industrious Mechsmith: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-049-167 Industrious Mechsmith: card-played self trigger reads 'here' then plays the Mech token", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 2);

  // "here" = the resolving source's current location. Static IR cannot write a
  // runtime LocationRef, so the referent is read at resolution (420.3.b /
  // 359.3.f.1) and handed on as a linked value.
  assert.equal(readHere.id, "industrious-mechsmith.read-here");
  assert.equal(readHere.op, "condition.value");
  assert.deepEqual(readHere.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(readHere.args.key, { kind: "constant", value: "here" });

  assert.equal(playMech.id, "industrious-mechsmith.play-mech-token");
  assert.equal(playMech.op, "effect.token");
  assert.deepEqual(playMech.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(playMech.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a token that is "played" is created on the Chain and then
  // handed to the play action.
  assert.deepEqual(playMech.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playMech.args.location, {
    kind: "linked-value",
    instructionId: "industrious-mechsmith.read-here",
    key: "here"
  });
  assert.deepEqual(playMech.args.linkKey, { kind: "constant", value: "mechToken" });
  assert.equal(playMech.targets, undefined);
  assert.equal(playMech.linkedTo, undefined);
});

test("rad-049-167 Industrious Mechsmith golden: the 3 Might Mech is really created and played here", () => {
  const base = fixture();
  const kernel = base.clone({ sourceSnapshot: base.getObject("industrious-mechsmith") });

  const outcome = resolveChainBody(triggered.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["industrious-mechsmith.read-here", "executed"],
      ["industrious-mechsmith.play-mech-token", "executed"]
    ]
  );
  assert.deepEqual(outcome.linkedValues["industrious-mechsmith.read-here.here"], {
    type: "battlefield",
    id: "bf1"
  });

  // CR 187.4: the Mech is a domainless 3 Might unit token with the Mech tag.
  const tokens = kernel.objects.filter((object) => object.isToken);
  assert.equal(tokens.length, 1);
  const [mech] = tokens;
  assert.equal(mech.name, "Mech");
  assert.equal(mech.might, 3);
  assert.deepEqual(mech.tags, ["Mech"]);
  assert.deepEqual(mech.types, ["unit"]);
  assert.deepEqual(mech.location, { type: "battlefield", id: "bf1" });
  assert.equal(mech.controller, "A");
  assert.equal(mech.owner, "A");
  // 185.3: tokens have no printed cost, and null is never turned into 0.
  assert.equal(mech.cardId, null);
  assert.equal(mech.energy, null);
  assert.equal(mech.power, null);
  assert.equal(outcome.linkedValues["industrious-mechsmith.play-mech-token.mechToken.amount"], 1);

  // 440.2.c / 185.2.a: the real action order is create-token (Chain) then play.
  assert.deepEqual(outcome.events.map((event) => event.action), ["create-token", "play"]);
});

test("rad-049-167 Industrious Mechsmith golden: 'here' also follows the source to its base", () => {
  const base = fixture({ type: "base", player: "A" });
  const kernel = base.clone({ sourceSnapshot: base.getObject("industrious-mechsmith") });

  const outcome = resolveChainBody(triggered.body, kernel);

  assert.equal(outcome.status, "executed");
  const [mech] = kernel.objects.filter((object) => object.isToken);
  assert.deepEqual(mech.location, { type: "base", player: "A" });
});

test("rad-049-167 Industrious Mechsmith golden: a replaced play keeps the earlier Chain creation and adds no token", () => {
  const base = fixture();
  const kernel = base.clone({ sourceSnapshot: base.getObject("industrious-mechsmith") });
  kernel.addReplacement((action) => (action.type === "play" ? "replaced" : null));

  const outcome = resolveChainBody(triggered.body, kernel);

  // 359.3.e.11 / contract 3.3: the play is replaced, so the instruction is
  // negated; the Chain creation that really happened is still reported.
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "replaced");
  // The new object exists on the Chain and is still pending play; it never
  // reaches the board, so no Mech was "played".
  assert.deepEqual(kernel.zone("A", "board").map((ref) => ref.id), ["industrious-mechsmith"]);
  assert.deepEqual(kernel.zone("A", "chain").map((ref) => ref.id), ["token-1"]);
  assert.deepEqual(kernel.pendingItems.map((item) => item.object.id), ["token-1"]);
  assert.equal(outcome.linkedValues["industrious-mechsmith.play-mech-token.mechToken.createdAmount"], 1);
  assert.equal(outcome.linkedValues["industrious-mechsmith.play-mech-token.mechToken.amount"], 0);
});

test("rad-049-167 Industrious Mechsmith: CardProgram trigger binds to card-played", () => {
  const source = world()
    .unit("industrious-mechsmith", {
      cardId: CANONICAL,
      owner: "A",
      controller: "A",
      might: 1,
      location: { type: "battlefield", id: "bf1" }
    })
    .build()
    .getObject("industrious-mechsmith");
  const registrations = triggerRegistrations(new ProgramRegistry([program]), source);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.at, "card-played");
  assert.deepEqual(registrations[0].spec.filter, {
    event: "card-played",
    object: { objectId: "industrious-mechsmith" },
    player: "self"
  });
  assert.equal(registrations[0].activeZones[0], "board");
});
