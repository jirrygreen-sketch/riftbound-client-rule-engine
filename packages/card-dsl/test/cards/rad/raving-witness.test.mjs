import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/raving-witness.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-5100d228a6eda08c0fbbe5b5f17f74b70f6df76adde914277019866a34ba54b2";

const [triggered] = program.abilities;
const [revealTop, drawIfMighty, recycleOtherwise] = triggered.body;

test("rad-074-167 Raving Witness: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /if\/otherwise/);
});

test("rad-074-167 Raving Witness: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. " +
      "Otherwise, recycle it. (A unit is Mighty while it has 5+ :rb_might:.)"
  );
});

test("rad-074-167 Raving Witness: 'When I move' subscribes to the successful move timing point (449 / object-moved)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 3);
});

test("rad-074-167 Raving Witness: the reveal reads the deck top through an ordered pick (425.1 / RIFT-66)", () => {
  assert.equal(revealTop.id, "raving-witness.reveal-top");
  assert.equal(revealTop.op, "effect.reveal");
  // A single card from a non-hand zone must arrive as a pick; zone+count would approximate
  // "the top card" from an unordered query (effect.reveal's documented boundary).
  assert.equal(revealTop.args.pick.value, "raving-witness.top-card");
  assert.equal(revealTop.args.zone, undefined);
  assert.equal(revealTop.args.count, undefined);
  assert.equal(revealTop.picks.length, 1);
  assert.equal(revealTop.picks[0].min, 1);
  assert.equal(revealTop.picks[0].max, 1);
  assert.equal(revealTop.picks[0].selection, "one");
});

test("rad-074-167 Raving Witness: the Mighty branch moves the revealed card to hand (707/708/711)", () => {
  assert.equal(drawIfMighty.id, "raving-witness.draw-mighty");
  assert.equal(drawIfMighty.op, "effect.zone");
  assert.equal(drawIfMighty.linkedTo, "raving-witness.reveal-top");
  assert.deepEqual(drawIfMighty.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawIfMighty.args.pick, {
    kind: "constant",
    value: "raving-witness.revealed-card"
  });
  // 707/708: Mighty is Might >= 5; 711: a card in a non-board zone is judged by its printed Might.
  assert.deepEqual(drawIfMighty.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "raving-witness.reveal-top" },
      property: "might"
    },
    operator: "gte",
    right: { kind: "constant", value: 5 }
  });
});

test("rad-074-167 Raving Witness: the otherwise branch recycles the same revealed card to the deck bottom (417.1.a)", () => {
  assert.equal(recycleOtherwise.id, "raving-witness.recycle-not-mighty");
  assert.equal(recycleOtherwise.op, "effect.recycle");
  assert.equal(recycleOtherwise.linkedTo, "raving-witness.reveal-top");
  assert.deepEqual(recycleOtherwise.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { linked: "raving-witness.reveal-top" },
      property: "might"
    },
    operator: "lt",
    right: { kind: "constant", value: 5 }
  });
  assert.deepEqual(recycleOtherwise.args.objects, {
    kind: "linked-value",
    instructionId: "raving-witness.reveal-top",
    key: "revealed"
  });
  // The two branches are gated on complementary conditions over one locked object, so neither
  // can silently move a card the other already handled.
  assert.equal(drawIfMighty.condition.left.object.linked, recycleOtherwise.condition.left.object.linked);
});

test("rad-074-167 Raving Witness: effect.reveal publicly reveals the picked top card without moving it (425.1.a.2)", () => {
  const kernel = world().unit("raving-witness", { might: 3 }).deck(["mighty-card", "second"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    reveal,
    { pick: "raving-witness.top-card" },
    { world: kernel, picks: { "raving-witness.top-card": [top] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed, [top]);
  assert.equal(kernel.getObject("mighty-card").zone, "deck");
  assert.equal(kernel.player("A").deckSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test("rad-074-167 Raving Witness: the revealed card can be drawn to hand by effect.zone (414.1)", () => {
  const kernel = world().deck(["mighty-card", "second"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    zone,
    {
      pick: "raving-witness.revealed-card",
      to: { kind: "constant", value: "hand" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, picks: { "raving-witness.revealed-card": [top] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("mighty-card").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  // The kernel routes a move to hand through the closed return-to-hand action.
});

test("rad-074-167 Raving Witness: the otherwise branch recycles the revealed card to the bottom of its owner's deck (417.1.a)", () => {
  const kernel = world().deck(["not-mighty", "second", "third"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [top] } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.equal(kernel.player("A").deckSize, 3);
  const deckIds = kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
  assert.equal(deckIds.at(-1), "not-mighty", "recycle always lands on the deck bottom");
  assert.deepEqual(run.events.map(event => event.action), ["recycle"]);
});

test.todo(
  "rad-074-167 Raving Witness: branch on the revealed card's Mighty predicate — keywords/Mighty.ts " +
    "expands to a condition.value/predicate continuous effect, but layers and condition evaluation " +
    "have no consumer for it (RIFT-359); no object predicate operator exists in Condition"
);

test.todo(
  "rad-074-167 Raving Witness: if/otherwise control structure — contract 3.9 has only sequence / " +
    "repeat / choice.optional / choice.mode, so two complementary instruction conditions cannot " +
    "guarantee the exclusive branch (contract change request in the task reply)"
);

test.todo(
  "rad-074-167 Raving Witness: object-moved is not in the engine EVENT_PATTERN_TYPES — " +
    "validateTriggerSpec reports invalid-event-type (the timing point itself exists), so the " +
    "event vocabulary needs the move event before this trigger can register"
);
