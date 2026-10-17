import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/zaun-warrens.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";

const CANONICAL = "card.hash-7eb7c2878a687bba1f5053f3c775d1f55e01679f4a8124757d2bb0a70b15ad88";
const SOURCE_TEXT = "When you conquer here, discard 1, then draw 1.";

const [ability] = program.abilities;
const [discard, draw] = ability.body;

/** A minimal board host snapshot for the direct pipeline registration test. */
const abilitySource = {
  ref: { id: "zaun-warrens", zoneEntryId: 1 },
  cardId: CANONICAL,
  name: "Zaun Warrens",
  types: ["battlefield"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
};

test("Zaun Warrens program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /359\.3\.e\.11/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Zaun Warrens structure: conquer trigger, then discard 1 and draw 1 unlinked", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  // The evaluable parts use the closed EventPattern vocabulary: "conquered"
  // is the closed event name, "self" the ability controller. "here" is the
  // documented 053.3 placeholder still awaiting binding-layer normalization.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    here: true,
    player: "self"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "zaun-warrens.discard",
    "zaun-warrens.draw"
  ]);

  // 423.1.a / 423.4: the controller discards 1 and chooses the card; no
  // target/pick is locked at Finalize.
  assert.equal(discard.op, "effect.discard");
  assert.deepEqual(discard.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(discard.targets, undefined);
  assert.equal(discard.picks, undefined);
  assert.equal(discard.linkedTo, undefined);

  // "then draw 1" is a separate instruction: 359.3.e.11's official example
  // ("Discard 2, then draw 2") draws even when the discard is negated, so the
  // draw must not be linked to the discard.
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
});

test("Zaun Warrens golden: an empty hand negates the discard and still draws 1 (CR 359.3.e.11)", () => {
  const kernel = world().deck("deck-card").build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["zaun-warrens.discard", "negated"],
    ["zaun-warrens.draw", "executed"]
  ]);
  assert.equal(outcome.results[0].result.reason, "impossible");
  // 423.4: nothing to discard; 414.3: the draw still happens.
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["deck-card"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Zaun Warrens golden: a single card in hand is discarded and then replaced by the draw", () => {
  const kernel = world().deck("deck-card").hand("hand-card").build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["zaun-warrens.discard", "executed"],
    ["zaun-warrens.draw", "executed"]
  ]);
  assert.equal(outcome.results[0].result.linkedValues.discarded.count, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "draw"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-card"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["deck-card"]);
});

test("Zaun Warrens golden: the discarding player chooses which card leaves a multi-card hand (CR 423.1.a)", () => {
  const kernel = world().deck("deck-card").hand("hand-a").hand("hand-b").build();

  // Without an answer the primitive suspends and the world is untouched.
  assert.throws(
    () => resolveChainBody(ability.body, kernel),
    error => error.request?.id === "zaun-warrens.discard/effect.discard%3AA" &&
      error.request?.type === "select-objects" &&
      error.request?.min === 1 && error.request?.max === 1 &&
      error.request?.options.map(option => option.id).join(",") === "hand-a,hand-b"
  );
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["hand-a", "hand-b"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);

  // Replaying the whole body with the answer discards exactly the chosen card.
  const chosen = kernel.ref("hand-b");
  kernel.setAnswers({ "zaun-warrens.discard/effect.discard%3AA": [chosen] });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "draw"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-b"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["hand-a", "deck-card"]);
});

test("Zaun Warrens: the conquer timing point is emitted by the merged Score wave and reaches a registered trigger", () => {
  // turn/flow.ts emits "conquer" inside the Score wave and carries the
  // conquered battlefield as details.battlefieldId; the merged pipeline
  // delivers it to registrations whose spec matches. The card-side gaps are
  // the CardProgram trigger binding (RIFT-257) and the 053.3 here anchor, not
  // the emission itself.
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [abilitySource],
    choose: () => { throw new Error("unexpected choose"); }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = snapshot => seen.push(snapshot);
  // The closed EventPattern vocabulary names this event "conquered"; the
  // matcher maps it to the "conquer" timing point (events/pipeline-match.ts
  // EVENT_NAMES). PlayerSelector "self" is the ability controller.
  pipeline.registerTrigger({
    id: "test.conquer.plain",
    source: abilitySource,
    controller: "A",
    spec: { at: "conquer", filter: { event: "conquered", player: "self" } },
    body: []
  });
  pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "battlefield-1");
});

test.todo(
  "Zaun Warrens trigger: bind this CardProgram's triggered ability through the card-program layer (RIFT-257), " +
    "normalize the 053.3 here referent to the emitted details.battlefieldId, and resolve 190.6's controller " +
    "of the Battlefield ability"
);

test.todo(
  "Zaun Warrens 359.3.e.11 end-to-end: a replacement effect that negates the discard leaves the unlinked draw " +
    "resolving inside a real chain Resolve (the golden drives the interpreter path; production chain resolution " +
    "needs the trigger binding above)"
);
