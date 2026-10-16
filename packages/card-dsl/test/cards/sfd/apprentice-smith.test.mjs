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

const CARD_ID = "card.hash-3d95fd18b92dc4a0dc9393e066e851d61c9f5d05119ba24e56141fb10179c79f";

const [ability] = program.abilities;
const [revealInstruction, modeInstruction] = ability.body;
const [gearMode, otherMode] = modeInstruction.args.modes.value;
const [toHandInstruction] = gearMode.body;
const [recycleInstruction] = otherMode.body;

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

test("sfd-041-221 Apprentice Smith: judgeReason names the gear-discriminator and zone-order gaps", () => {
  assert.match(program.judgeReason, /gear/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-66/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-120/);
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
    "apprentice-smith.mode"
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
  assert.equal(modeInstruction.op, "choice.mode");
  assert.equal(modeInstruction.linkedTo, "apprentice-smith.reveal-top");
  assert.deepEqual(modeInstruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeInstruction.args.different, { kind: "constant", value: true });
  assert.deepEqual(modeInstruction.args.modes.value.map(entry => entry.id), [
    "apprentice-smith.gear-mode",
    "apprentice-smith.other-mode"
  ]);

  // "draw it" = add that card to the hand (414.1 takes a card from a zone and
  // adds it to a player's Hand); the revealed ref travels as a linked value and
  // the pick consumes it, so no TargetSpec is involved (never a target).
  assert.equal(toHandInstruction.op, "effect.zone");
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
});

test("sfd-041-221 Apprentice Smith golden: the gear branch returns the revealed card to its owner's hand", () => {
  // A one-card Main Deck makes the printed top card unambiguous for the
  // reference kernel (the zoneSlice ordering gap is recorded separately).
  const kernel = world().card("top-gear", { types: ["gear"], owner: "A", zone: "deck" }).build();
  kernel.setPicks("apprentice-smith.revealed-card", [kernel.ref("top-gear")]);
  kernel.setAnswers({ "apprentice-smith.mode/mode%3A0": "apprentice-smith.gear-mode" });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.id).sort(), [
    "apprentice-smith.draw-it",
    "apprentice-smith.mode",
    "apprentice-smith.reveal-top"
  ]);
  assert.equal(resultFor(outcome, "apprentice-smith.draw-it").result.status, "executed");
  assert.equal(kernel.getObject("top-gear").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-gear"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "return-to-hand"]);
});

test("sfd-041-221 Apprentice Smith golden: the otherwise branch recycles the revealed card to the deck bottom", () => {
  // A one-card Main Deck keeps the reveal well-defined on the reference
  // kernel: effect.reveal rejects a proper subset of a non-hand zone because
  // ordered refs must come from zoneSlice (recorded as a todo below).
  const kernel = world().card("top-spell", { types: ["spell"], owner: "A", zone: "deck" }).build();
  kernel.setAnswers({ "apprentice-smith.mode/mode%3A0": "apprentice-smith.other-mode" });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "apprentice-smith.recycle-it").result.status, "executed");
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

test.todo(
  "sfd-041-221 Apprentice Smith: 'If it's a gear' needs a condition that reads the type snapshot locked " +
    "at reveal time (contract 3.4 Show Off; Condition has no array-contains operator and effect.reveal " +
    "links refs only), so the printed result cannot be discriminated; the mode node above preserves the " +
    "two branches' shape and the goldens drive them explicitly as documented, merged " +
    "sfd/ravenbloom-conservatory does for the same printed pattern"
);

test.todo(
  "sfd-041-221 Apprentice Smith: 'the top card of your Main Deck' must be read through zoneSlice " +
    "(contract 3.6: query does not guarantee zone order) once effect.reveal consumes ordered upstream " +
    "refs, so the revealed card is guaranteed to be the actual top card — RIFT-66"
);

test.todo(
  "sfd-041-221 Apprentice Smith: the object-moved event must carry to/toKind payload and expose the moved " +
    "object's identity to the card registration so a Recall (458/458.1) does not trigger the ability " +
    "(CR 421.1, 449.1, 449.2) — RIFT-120"
);
