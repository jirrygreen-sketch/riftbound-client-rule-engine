import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/apprentice-smith.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps the card's Expr arguments inside
// one literal envelope so each merged primitive validates and evaluates them
// itself. The goldens below run the raw card body through that same path.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-3d95fd18b92dc4a0dc9393e066e851d61c9f5d05119ba24e56141fb10179c79f";

const [ability] = program.abilities;
const [revealInstruction, toHandInstruction, recycleInstruction] = ability.body;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

test("sfd-041-221 Apprentice Smith: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-041-221 Apprentice Smith: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it."
  );
});

test("sfd-041-221 Apprentice Smith: judgeReason names the current zone-order and trigger gaps", () => {
  // The re-review after the continuous/replacement/keyword/producer batches: the
  // gear discriminator is executable, the zone-order and trigger gaps remain.
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.doesNotMatch(program.judgeReason, /array-contains|choice\.mode/);
});

test("sfd-041-221 Apprentice Smith: 'When I move' subscribes to object-moved scoped to this card", () => {
  // 421.1 / 449.1: a Move is a permanent changing locations; 458/458.1: a
  // Recall is not a Move. The merged ogn/traveling-merchant uses the same
  // subscription shape.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-041-221 Apprentice Smith: reveal reads one card of the Main Deck (425.1, 425.3.a)", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "apprentice-smith.reveal-top",
    "apprentice-smith.draw-it",
    "apprentice-smith.recycle-it"
  ]);
  assert.equal(revealInstruction.id, "apprentice-smith.reveal-top");
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.deepEqual(revealInstruction.args, {
    zone: { kind: "constant", value: "deck" },
    count: { kind: "constant", value: 1 }
  });
  assert.equal(revealInstruction.condition, undefined);
  assert.equal(revealInstruction.linkedTo, undefined);
});

test("sfd-041-221 Apprentice Smith: the result branches are gear -> hand and otherwise -> recycle", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "apprentice-smith.reveal-top",
    "apprentice-smith.draw-it",
    "apprentice-smith.recycle-it"
  ]);

  // "draw it" = add that card to the hand (414.1 takes a card from a zone and
  // adds it to a player's Hand); the revealed ref travels as a linked value and
  // the pick consumes it, so no TargetSpec is involved (never a target). The
  // instruction's own condition is the printed "If it's a gear".
  assert.equal(toHandInstruction.op, "effect.zone");
  assert.deepEqual(toHandInstruction.condition, {
    kind: "compare",
    left: { kind: "constant", value: "gear" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "apprentice-smith.reveal-top" },
      property: "types"
    }
  });
  assert.deepEqual(toHandInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(toHandInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(toHandInstruction.args.pick, {
    kind: "constant",
    value: "apprentice-smith.revealed-card"
  });
  assert.equal(toHandInstruction.targets, undefined);
  assert.equal(toHandInstruction.picks.length, 1);
  assert.deepEqual(toHandInstruction.picks[0], {
    id: "apprentice-smith.revealed-card",
    options: [
      {
        kind: "linked-value",
        instructionId: "apprentice-smith.reveal-top",
        key: "revealed"
      }
    ],
    min: 1,
    max: 1,
    selection: "one"
  });

  // "Otherwise, recycle it" = 417.1: the revealed card goes to the bottom of
  // its own Main Deck, driven by the linked reveal result.
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "apprentice-smith.reveal-top",
    key: "revealed"
  });
  assert.equal(recycleInstruction.targets, undefined);
  assert.equal(recycleInstruction.linkedTo, "apprentice-smith.reveal-top");
  // "Otherwise" is the negation of the same discriminator (contract 3.4 scope:
  // each instruction carries its own condition clause).
  assert.deepEqual(recycleInstruction.condition, {
    kind: "not",
    condition: toHandInstruction.condition
  });
});

test("sfd-041-221 Apprentice Smith golden: the gear branch returns the revealed card to its owner's hand", () => {
  // A one-card Main Deck makes the printed top card unambiguous for the
  // reference kernel (the zoneSlice ordering gap is recorded separately).
  const kernel = world().card("top-gear", { types: ["gear"], owner: "A", zone: "deck" }).build();
  kernel.setPicks("apprentice-smith.revealed-card", [kernel.ref("top-gear")]);

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["apprentice-smith.reveal-top", "executed", undefined],
    ["apprentice-smith.draw-it", "executed", undefined],
    // "Otherwise" does not fire for a gear.
    ["apprentice-smith.recycle-it", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("top-gear").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-gear"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "return-to-hand"]);
});

test("sfd-041-221 Apprentice Smith golden: the otherwise branch recycles the revealed card to the deck bottom", () => {
  // A one-card Main Deck keeps the reveal well-defined on the reference
  // kernel: effect.reveal rejects a proper subset of a non-hand zone because
  // ordered refs must come from zoneSlice (recorded as a todo below).
  const kernel = world().card("top-spell", { types: ["spell"], owner: "A", zone: "deck" }).build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["apprentice-smith.reveal-top", "executed", undefined],
    ["apprentice-smith.draw-it", "negated", "skipped"],
    ["apprentice-smith.recycle-it", "executed", undefined]
  ]);
  // Recycle keeps the card in its owner's Main Deck, at the bottom (417.1.a).
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-spell"]);
  assert.equal(kernel.getObject("top-spell").zone, "deck");
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "recycle"]);
});

test("sfd-041-221 Apprentice Smith golden: reveal reads the top of the Main Deck through the merged primitive", () => {
  const kernel = world().card("top-card", { owner: "A", zone: "deck" }).build();
  const run = runInstruction(reveal, revealInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["reveal"]);
});

test("sfd-041-221 Apprentice Smith golden: the recycle instruction places the linked card on the deck bottom", () => {
  // Two cards in the Main Deck: the revealed top card is handed to
  // effect.recycle as the linked value the card program produces, and the
  // recycled card lands at the bottom of its own Main Deck (CR 417.1).
  const kernel = world().deck(["recycled-card", "kept-card"]).build();
  const revealed = kernel.ref("recycled-card");
  const run = runInstruction(
    recycle,
    { objects: { kind: "linked-value", instructionId: "apprentice-smith.reveal-top", key: "revealed" } },
    // The reference kernel's evaluate() resolves a linked-value expression by
    // its `key` binding; the interpreter records the full per-instruction
    // binding when the whole body runs (see the otherwise-branch golden).
    { world: kernel, linked: { revealed: [revealed] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["kept-card", "recycled-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["recycle"]);
});

test("sfd-041-221 Apprentice Smith golden: the gear discriminator really drives the branch (425.2)", () => {
  // The two goldens above execute the same authored body and reach opposite
  // branches from the revealed card's own type; this test pins that the branch
  // is decided by the printed condition rather than by a test-supplied answer.
  assert.deepEqual(toHandInstruction.condition, {
    kind: "compare",
    left: { kind: "constant", value: "gear" },
    operator: "in",
    right: {
      kind: "object-property",
      object: { linked: "apprentice-smith.reveal-top" },
      property: "types"
    }
  });
  assert.deepEqual(recycleInstruction.condition, {
    kind: "not",
    condition: toHandInstruction.condition
  });
  // A unit is neither a gear nor a spell: it recycles like the spell case.
  const kernel = world().card("top-unit", { types: ["unit"], owner: "A", zone: "deck" }).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["apprentice-smith.reveal-top", "executed"],
    ["apprentice-smith.draw-it", "negated"],
    ["apprentice-smith.recycle-it", "executed"]
  ]);
  assert.equal(kernel.getObject("top-unit").zone, "deck");
});

test.todo(
  "Apprentice Smith: bind zoneSlice-ordered deck-top picks to effect.reveal (425.1/425.3.a; RIFT-358 is not merged at this HEAD)"
);

test.todo(
  "Apprentice Smith: accept object-moved in the event-pattern vocabulary, preserving real Move identity and excluding Recall (421.1/449.1/458.1)"
);


test("Apprentice Smith: a real Move emits the moved object and the merged translator binds the self anchor", () => {
  const f = fixture({ cards: [{ id: "smith", cardId: CARD_ID, types: ["unit"], might: 2 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("smith"), to: "board", location: { type: "base", player: "A" } });
  const ref = f.kernel.ref("smith");
  const result = f.host.execute({ type: "move-location", object: ref, to: { type: "battlefield", id: "field" } });
  assert.equal(result.outcome.status, "done");
  const moved = result.emissions.find(event => event.timingPoint === ability.trigger.at);
  assert.deepEqual(moved.object.ref, ref);
  assert.deepEqual(moved.object.location, { type: "battlefield", id: "field" });
  assert.deepEqual(translateTriggerFilter(ability.trigger.filter, ref.id, ability.trigger.at), {
    event: "object-moved", object: { objectId: "smith" }
  });
});
