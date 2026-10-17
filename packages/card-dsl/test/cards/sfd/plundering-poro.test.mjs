// Golden test for Plundering Poro (sfd-069-221).
//
// The card keeps judge-required: the printed body cannot be executed yet.
// - The Gold gear token definition is still absent from effect.token's frozen
//   table (CR 187.5 gives it a printed activated ability), and the primitive
//   supports no "enters exhausted" entry override (CR 143.4 / 185.2.d).
// - The conquer timing point carries no Unit/Battlefield identity, so a
//   unit-relative Conquer Effect (CR 383.4.c.2.a) cannot match its source.
// The golden pins both facts as current evidence, and exercises the merged
// halves (token play mode reaching the definition table, the conquer payload
// shape) instead of pretending the card runs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/plundering-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const SOURCE_TEXT = "When I conquer, play a Gold gear token exhausted.";

const [ability] = program.abilities;
const [playGold] = ability.body;

test("sfd-069-221 Plundering Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-069-221 Plundering Poro: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  // The refreshed reason names the two real current gaps: the missing Gold
  // definition/entry override and the identity-less conquer payload.
  assert.match(program.judgeReason, /Gold/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /entry override|entry-state/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /383\.4\.c\.2\.a/);
  assert.ok(!/RIFT-120/.test(program.judgeReason), "the stale RIFT-120 chain/gating claim must be gone");
});

test("sfd-069-221 Plundering Poro structure: conquer trigger filtered to this unit, one Gold token body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  assert.equal(playGold.id, "play-gold");
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: "play a … token" creates on the Chain, then plays it.
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 143.4 / 185.2.d: "exhausted" is the entry stipulation, not a later exhaust.
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
});

test("sfd-069-221 Plundering Poro golden: the merged token play pipeline really creates and plays a supported token", () => {
  // RIFT-62's play mode is merged: a NEW token is created on the Chain and then
  // handed to `play`. The card's own body is blocked on the Gold definition
  // (which carries a printed ability, CR 187.5), so the golden exercises the
  // merged half with a definition that is in the frozen table and keeps the
  // Gold gap in the judgeReason / TODO instead of asserting a refusal.
  const kernel = world()
    .player("A", { energy: 0, power: [] })
    .player("B")
    .build();

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
  // 440.2.c / 185.2.a: the token was created on the Chain and then played to the
  // controller's Base, so the receipt keeps both the creation and the current ref.
  assert.equal(run.linked.token.createdAmount, 1);
  assert.deepEqual(
    kernel.objects.filter((object) => object.isToken).map((object) => [object.types, object.zone, object.location]),
    [[["unit"], "board", { type: "base", player: "A" }]]
  );
  // The card's body reaches the same instruction definition; the difference is
  // the definition it names (Gold vs. a frozen-table entry).
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
});

test("sfd-069-221 Plundering Poro: the source:self Conquer filter needs a Unit payload the Score wave does not carry", () => {
  // turn/flow.ts's Score wave emits `conquer` with { player, details:
  // { battlefieldId } } only, while CR 383.4.c.2.a attaches a unit-relative
  // Conquer Effect to the Unit that was present. The merged matcher can only
  // match an object-carrying event, which is what the golden demonstrates.
  const scoreWavePayload = { kind: "conquer", timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } };
  assert.equal(
    matchesTriggerEvent({ event: "conquer", object: { objectId: "plundering-poro" } }, scoreWavePayload, "A"),
    false
  );
  const carryingUnit = {
    ...scoreWavePayload,
    object: {
      ref: { id: "plundering-poro", zoneEntryId: 1 },
      cardId: CARD_ID,
      types: ["unit"],
      tags: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    }
  };
  assert.equal(
    matchesTriggerEvent({ event: "conquer", object: { objectId: "plundering-poro" } }, carryingUnit, "A"),
    true
  );
});

test.todo(
  "sfd-069-221 Plundering Poro: a Gold gear token definition with its printed \"[Reaction][>] Kill this, [E]: [Add] [A]\" " +
    "ability (CR 187.5) plus an exhausted entry override (CR 143.4 / 185.2.d) must land in effect.token / the entry " +
    "pipeline before the body executes"
);
test.todo(
  "sfd-069-221 Plundering Poro: the conquer producer must carry the conquering Unit and Battlefield so the " +
    "source:self Conquer Effect filter (CR 383.4.c.2.a, RIFT-270 producers) can match"
);

