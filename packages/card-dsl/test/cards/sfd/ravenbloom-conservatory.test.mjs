// Golden test for Ravenbloom Conservatory (sfd-215-221).
//
// The original body now executes through ordered zoneSlice/linked picks.
// Defend event production and the Battlefield's here filter remain blocked.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ravenbloom-conservatory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82";
const SOURCE_TEXT =
  "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.";

const [ability] = program.abilities;
const [revealInstruction, toHand, recycle] = ability.body;

/** A Battlefield plus an ordered Main Deck whose top card has the given types. */
function conservatoryWorld(topTypes) {
  const builder = world()
    .player("A")
    .player("B")
    .object("ravenbloom", {
      cardId: CANONICAL,
      types: ["battlefield"],
      energy: null,
      power: null,
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

/** Supplies only the ordered top slice; the branch pick resolves from the reveal receipt. */
function lockPicks(kernel) {
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map((object) => object.ref);
  kernel.setPicks("ravenbloom.revealed-card", ordered);
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
  // Only the remaining trigger gaps keep the card judge-required.
  assert.match(program.judgeReason, /defense-declared/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /466\.2/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /RIFT-358/);
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
    // "you" is the ability controller (190.6.d); PlayerSelector "self" is the
    // frozen vocabulary for "this trigger's controller".
    player: "self"
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
  assert.deepEqual(revealInstruction.picks, [{
    id: "ravenbloom.revealed-card", options: [], ordered: true, selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  }]);
  assert.deepEqual(toHand.picks, [{
    id: "ravenbloom.revealed-hand", options: [], ordered: true, selection: "all",
    linked: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
  }]);
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

  const outcome = resolveChainBody(ability.body, kernel);

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

  const outcome = resolveChainBody(ability.body, kernel);

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
    "start + designation transaction (CR 466.2), so the Defend Effect can enter the chain; combat/flow.ts " +
    "still throws combat-start-transaction and no module emits the timing point"
);
test.todo(
  "sfd-215-221 Ravenbloom Conservatory: the printed here referent (CR 053.3) needs EventPattern/ObjectFilter vocabulary " +
    "for a Battlefield's own identity; the merged card-program binding (RIFT-257) fails closed with " +
    "\"Unsupported filter field here\" and a static program cannot know details.battlefieldId"
);

test("sfd-215-221 Ravenbloom Conservatory: the published here placeholder is refused by the merged binding", () => {
  // Direct evidence for the second recorded gap: the printed Defend Effect
  // cannot register while the battlefield-relative anchor has no vocabulary.
  assert.deepEqual(ability.trigger.filter, { event: "defense-declared", here: true, player: "self" });
  // Even with the frozen PlayerSelector the placeholder is rejected: the
  // battlefield-relative anchor is the whole remaining trigger gap.
  const validation = validateTriggerSpec(ability.trigger);
  assert.equal(validation.ok, false);
  assert.deepEqual([...new Set(validation.issues.map((issue) => issue.path))], ["trigger.filter.here"]);
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "ravenbloom", "defense-declared"),
    (error) => error.code === "judge-required" && /Unsupported filter field here/.test(error.message)
  );
  // The body itself translates cleanly, which is why only the trigger keeps the
  // card judge-required.
  assert.equal(translateInstructionTargets(ability.body).length, 3);
});
test("sfd-215-221 Ravenbloom Conservatory: the original Expr reveal consumes the locked top card", () => {
  const kernel = conservatoryWorld(["spell"]);
  const ordered = lockPicks(kernel);
  const outcome = resolveChainBody([revealInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["ravenbloom.reveal.revealed"], ordered);
  assert.equal(outcome.linkedValues["ravenbloom.reveal.revealedCount"], 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card", "next-card"]);
});

// Exercise the supported body through real Finalize/Resolve, with no setPicks
// and no replacement reveal spelling. The unsupported Defend trigger is not
// synthesized; this draft isolates the card's effect sequence.
test("sfd-215-221 Ravenbloom Conservatory golden: Finalize locks the top card and Resolve executes both original branches", () => {
  for (const spell of [true, false]) {
    const kernel = conservatoryWorld(spell ? ["spell"] : ["unit"]);
    const choose = request => { throw new AwaitChoice(request); };
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose,
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
    });
    const engine = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
      cleanup: chain => {
        let changed = false;
        for (const object of kernel.objects) {
          if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
              (object.might <= 0 || object.damage >= object.might)) {
            changed = chain.commit({ type: "kill", object: object.ref }).status === "done" || changed;
          }
        }
        return changed;
      }
    });
    const top = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
    engine.execute({ id: "ravenbloom-body", source: kernel.getObject("ravenbloom"), controller: "A", kind: "activated", speed: "reaction", body: ability.body });
    assert.deepEqual(engine.items[0].pickPlans, [{ id: "ravenbloom.revealed-card", refs: top }]);
    assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 0);
    resolveAll(engine);
    assert.deepEqual(kernel.linked("ravenbloom.reveal.revealed"), top);
    assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), spell ? ["top-card"] : []);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), spell ? ["next-card"] : ["next-card", "top-card"]);
    assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 1);
    assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
  }
});
