// Golden test for Ravenbloom Conservatory (sfd-215-221).
//
// The card keeps judge-required: defense-declared has no producer (the combat
// start transaction is still blocked), the printed "here" referent has no
// EventPattern/ObjectFilter vocabulary, and effect.reveal's "pick" spelling is
// inconsistent between the IR validator (requires an Expr) and the merged chain
// adapter (unwraps it before the primitive, which then rejects the object).
// The golden still exercises the merged halves for real: the ordered deck-top
// pick drives effect.reveal directly, and both branches of the "if it's a spell"
// discriminator (compare "spell" in object-property(types)) genuinely move the
// revealed card to hand or to the bottom of the deck.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ravenbloom-conservatory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82";
const SOURCE_TEXT =
  "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.";

const [ability] = program.abilities;
const [revealInstruction, toHand, recycle] = ability.body;

/**
 * The card's real ability body, with the reveal instruction swapped for the
 * spelling the merged chain adapter currently accepts (see the judgeReason's
 * third gap and the TODO). Everything else — link structure, conditions and
 * both branch instructions — is the card's own data, so the two branches are
 * exercised exactly as written.
 */
const executableBody = [
  { ...revealInstruction, args: { pick: 'ravenbloom.revealed-card' } },
  { ...toHand, picks: undefined },
  { ...recycle, picks: undefined }
];

/** A Battlefield plus an ordered Main Deck whose top card has the given types. */
function conservatoryWorld(topTypes) {
  const builder = world()
    .player("A")
    .player("B")
    .object("ravenbloom", {
      cardId: CANONICAL,
      types: ["battlefield"],
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      owner: "A",
      controller: "A"
    })
    .card("next-card", { cardId: "card-next", name: "Next Card", types: ["unit"], zone: "deck", owner: "A", controller: "A" })
    // .deck([...]) stacks the array in order: the first entry is the deck top,
    // so top-card ends up on top of next-card.
    .deck(["top-card"], { cardId: "card-top", name: "Top Card", types: topTypes, owner: "A", controller: "A" });
  const base = builder.build();
  return base.clone({ sourceSnapshot: base.getObject("ravenbloom") });
}

/** Reads the real deck top through zoneSlice and reveals it through the primitive. */
function revealTopCard(kernel) {
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map((object) => object.ref);
  const run = runInstruction(
    reveal,
    { pick: "ravenbloom.revealed-card" },
    { world: kernel, picks: { "ravenbloom.revealed-card": ordered } }
  );
  assert.equal(run.result.status, "executed");
  return { kernel, revealed: ordered, linked: run.linked };
}

/** Locks the ordered deck top and the two branch picks the production chain would own. */
function lockPicks(kernel) {
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map((object) => object.ref);
  kernel.setPicks("ravenbloom.revealed-card", ordered);
  kernel.setPicks("ravenbloom.revealed-hand", ordered);
  return ordered;
}

test("sfd-215-221 Ravenbloom Conservatory: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-215-221 Ravenbloom Conservatory: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // The refreshed reason names the three real current gaps.
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /RIFT-124/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /effect\.reveal/);
  assert.match(program.judgeReason, /pick/);
});

test("sfd-215-221 Ravenbloom Conservatory structure: defend trigger, ordered reveal, two exclusive branches", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "defense-declared",
    // 053.3 "here": descriptive placeholder — the field has no merged vocabulary
    // (judgeReason). The trigger is not registered in production yet.
    here: true,
    player: "controller"
  });
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "ravenbloom.reveal",
    "ravenbloom.to-hand",
    "ravenbloom.recycle"
  ]);

  // The deck top is a real position: reveal must read an ordered upstream pick
  // (contract 3.6), never a query.
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.deepEqual(revealInstruction.args.pick, {
    kind: "constant",
    value: "ravenbloom.revealed-card"
  });
  assert.deepEqual(revealInstruction.picks[0].filter, { zone: "deck", owner: "self" });
  assert.equal(revealInstruction.picks[0].min, 1);
  assert.equal(revealInstruction.picks[0].max, 1);
});

test("sfd-215-221 Ravenbloom Conservatory: the spell branch is a type-membership condition, not a player choice", () => {
  const spellCondition = {
    kind: "compare",
    left: { kind: "constant", value: "spell" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "ravenbloom.reveal" },
      property: "types"
    }
  };
  assert.deepEqual(toHand.condition, spellCondition);
  assert.deepEqual(recycle.condition, { kind: "not", condition: spellCondition });
  assert.equal(toHand.linkedTo, "ravenbloom.reveal");
  assert.equal(recycle.linkedTo, "ravenbloom.reveal");
  // effect.zone to hand is the return-to-hand action (owner-routed, 056.1/056.2).
  assert.equal(toHand.op, "effect.zone");
  assert.deepEqual(toHand.args.to, { kind: "constant", value: "hand" });
  // effect.recycle returns the rest to the owner's Main Deck bottom (417.1.a).
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "ravenbloom.reveal",
    key: "revealed"
  });
});

test("sfd-215-221 Ravenbloom Conservatory golden: the ordered deck-top pick really reveals the top card (425.1/425.2.a)", () => {
  const kernel = conservatoryWorld(["spell"]);
  const { revealed, linked } = revealTopCard(kernel);

  assert.deepEqual(revealed.map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(linked.revealed, revealed);
  assert.equal(linked.revealedCount, 1);
  // 425.1.a.2: the revealed card stays in its zone; nothing moved yet.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["top-card", "next-card"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test("sfd-215-221 Ravenbloom Conservatory golden: a revealed spell really goes to hand and the other branch is skipped", () => {
  const kernel = conservatoryWorld(["spell"]);
  lockPicks(kernel);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["ravenbloom.reveal", "executed"],
    ["ravenbloom.to-hand", "executed"],
    ["ravenbloom.recycle", "negated"]
  ]);
  // 056.1/056.2: the revealed spell went to its owner's hand.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["next-card"]);
});

test("sfd-215-221 Ravenbloom Conservatory golden: a revealed non-spell really recycles to the deck bottom instead", () => {
  const kernel = conservatoryWorld(["unit"]);
  lockPicks(kernel);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["ravenbloom.reveal", "executed"],
    ["ravenbloom.to-hand", "negated"],
    ["ravenbloom.recycle", "executed"]
  ]);
  // 417.1.a / 417.1.c: the non-spell card went to the bottom of the deck.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["next-card", "top-card"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "sfd-215-221 Ravenbloom Conservatory: combat/flow.ts must produce defense-declared after the atomic combat " +
    "start + designation transaction (CR 466.2; RIFT-124 follow-up), so the Defend Effect can enter the chain"
);
test.todo(
  "sfd-215-221 Ravenbloom Conservatory: the printed here referent (CR 053.3) needs EventPattern/ObjectFilter vocabulary " +
    "for a Battlefield's own identity; the merged trigger-spec validator rejects the placeholder field and the " +
    "card-program binding (RIFT-257) fails closed on unknown filter fields"
);
test.todo(
  "sfd-215-221 Ravenbloom Conservatory: effect.reveal pick must accept the contract's Expr spelling through the " +
    "merged chain adapter (contract 3.2 vs chain/interpreter-adapter.ts LITERAL_FIELDS) before the card's own " +
    "reveal instruction can run inside its ability body"
);

