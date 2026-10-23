import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/apprentice-smith.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";

import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-3d95fd18b92dc4a0dc9393e066e851d61c9f5d05119ba24e56141fb10179c79f";

const [ability] = program.abilities;
const [revealInstruction, toHandInstruction, recycleInstruction] = ability.body;

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
  // The re-review after the ordered-pick batch: the reveal/top-card and branch
  // halves are executable, and only the closed trigger event vocabulary remains.
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /validateTriggerSpec/);
  assert.doesNotMatch(program.judgeReason, /RIFT-358/);
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

test("sfd-041-221 Apprentice Smith: reveal reads one ordered card of the Main Deck (425.1, 425.3.a)", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "apprentice-smith.reveal-top",
    "apprentice-smith.draw-it",
    "apprentice-smith.recycle-it"
  ]);
  assert.equal(revealInstruction.id, "apprentice-smith.reveal-top");
  assert.equal(revealInstruction.op, "effect.reveal");
  // 425.1/425.3.a + contract 3.6: the deck top is a real ordered source, never a
  // set query — the pick binds it and the primitive consumes the actual result.
  assert.deepEqual(revealInstruction.args, {
    pick: { kind: "constant", value: "apprentice-smith.revealed-card" }
  });
  assert.deepEqual(revealInstruction.picks, [
    {
      id: "apprentice-smith.revealed-card",
      options: [],
      ordered: true,
      selection: "all",
      zoneSlice: {
        zone: "deck",
        from: "top",
        count: { kind: "constant", value: 1 }
      }
    }
  ]);
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
  // adds it to a player's Hand); the revealed refs travel as the reveal result
  // and the pick consumes that linked list in result order, so no TargetSpec is
  // involved (never a target). The instruction's own condition is the printed
  // "If it's a gear".
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
    value: "apprentice-smith.revealed-card-into-hand"
  });
  assert.equal(toHandInstruction.targets, undefined);
  assert.equal(toHandInstruction.picks.length, 1);
  assert.deepEqual(toHandInstruction.picks[0], {
    id: "apprentice-smith.revealed-card-into-hand",
    options: [],
    ordered: true,
    selection: "all",
    linked: {
      kind: "linked-value",
      instructionId: "apprentice-smith.reveal-top",
      key: "revealed"
    }
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
  // The whole authored body runs through the production chain: Finalize locks
  // the real deck-top reference, reveal consumes it, and the gear branch moves
  // the actual revealed card to hand.
  const f = fixture({ cards: [{ id: "top-gear", types: ["gear"] }] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("top-gear"), to: "deck-top" }).status, "done");
  f.engine.advance();

  const locked = f.kernel.zoneSlice("A", "deck", "top", 3).map(object => object.ref.id);
  assert.equal(locked[0], "top-gear");
  f.engine.execute(f.draft("apprentice-smith", { body: ability.body, kind: "triggered", speed: "normal" }));
  assert.deepEqual(f.engine.items[0].pickPlans.map(plan => [plan.id, plan.refs.map(ref => ref.id)]), [
    ["apprentice-smith.revealed-card", ["top-gear"]]
  ]);
  resolveAll(f.engine);

  // Only the gear branch ran: the card is in hand, never recycled.
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["top-gear"]);
  assert.equal(f.kernel.getObject("top-gear").zone, "hand");
  assert.deepEqual(f.engine.pipeline.events.filter(event => ["card-revealed", "card-recycled"].includes(event.timingPoint)).map(event => event.timingPoint), ["card-revealed"]);
});

test("sfd-041-221 Apprentice Smith golden: the otherwise branch recycles the revealed card to the deck bottom", () => {
  // A non-gear deck top takes the negated "Otherwise" branch through the same
  // authored body: the revealed card is recycled to its owner's deck bottom.
  const f = fixture({ cards: [{ id: "top-spell", types: ["spell"] }] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("top-spell"), to: "deck-top" }).status, "done");
  f.engine.advance();
  const rest = f.kernel.zoneSlice("A", "deck", "top", 5).map(object => object.ref.id).slice(1);

  f.engine.execute(f.draft("apprentice-smith", { body: ability.body, kind: "triggered", speed: "normal" }));
  resolveAll(f.engine);

  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), []);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), [...rest, "top-spell"]);
  assert.equal(f.kernel.getObject("top-spell").zone, "deck");
  assert.deepEqual(f.engine.pipeline.events.filter(event => ["card-revealed", "card-recycled"].includes(event.timingPoint)).map(event => event.timingPoint), ["card-revealed", "card-recycled"]);
});

test("sfd-041-221 Apprentice Smith golden: reveal reads the top of the Main Deck through the merged primitive", () => {
  // Finalize is what supplies the ordered refs; this scenario drives the same
  // authored body so the evidence covers the real source binding, not a
  // test-supplied pick.
  const f = fixture({ cards: [{ id: "top-card" }] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("top-card"), to: "deck-top" }).status, "done");
  f.engine.advance();

  f.engine.execute(f.draft("apprentice-smith", { body: [revealInstruction], kind: "triggered", speed: "normal" }));
  assert.deepEqual(f.engine.items[0].pickPlans.map(plan => plan.refs.map(ref => ref.id)), [["top-card"]]);
  resolveAll(f.engine);

  // 425.3.a: the revealed card stays in the Main Deck until a later instruction
  // moves it.
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id).slice(0, 1), ["top-card"]);
  // 425.1 links the actual revealed references and their count under the
  // instruction's own scope, which is what the branch instructions read back.
  assert.equal(f.kernel.linked("apprentice-smith.reveal-top.revealedCount"), 1);
  assert.deepEqual(f.kernel.linked("apprentice-smith.reveal-top.revealed"), [f.kernel.ref("top-card")]);
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").map(event => event.object.ref.id), ["top-card"]);
});

test("sfd-041-221 Apprentice Smith golden: the recycle instruction places the linked card on the deck bottom", () => {
  // The recycled card is handed to effect.recycle as the linked reveal result
  // the card program produces; it lands at the bottom of its own Main Deck.
  const f = fixture({ cards: [{ id: "recycled-card", types: ["spell"] }] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("recycled-card"), to: "deck-top" }).status, "done");
  f.engine.advance();
  const kernel = f.kernel;
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
  // 417.1.a: the recycled card lands at the bottom of its owner's Main Deck,
  // keeping the rest of the deck above it.
  const deck = kernel.zone("A", "deck").map(ref => ref.id);
  assert.equal(deck.at(-1), "recycled-card");
  assert.equal(deck.length, 5);
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
  const f = fixture({ cards: [{ id: "top-unit", types: ["unit"] }] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("top-unit"), to: "deck-top" }).status, "done");
  f.engine.advance();
  f.engine.execute(f.draft("apprentice-smith", { body: ability.body, kind: "triggered", speed: "normal" }));
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), []);
  assert.equal(f.kernel.getObject("top-unit").zone, "deck");
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === "card-recycled").map(event => event.object.ref.id), ["top-unit"]);
});

test("sfd-041-221 Apprentice Smith: the translated object-moved trigger is admitted by the production validator (421.1/449.1)",
  () => {
    // The authored subscription cannot be registered: the translator produces
    // the right pattern, but the closed EventPattern vocabulary refuses the
    // event name, so programs/triggers.ts never reaches registerTrigger.
    const translated = translateTriggerFilter(ability.trigger.filter, "smith", ability.trigger.at);
    assert.deepEqual(translated, { event: "object-moved", object: { objectId: "smith" } });
    const result = validateTriggerSpec({ at: ability.trigger.at, filter: translated });
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });


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
