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
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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

test("Zaun Warrens program validates and remains judge-required for the current here binding gap", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /359\.3\.e\.11/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /383\.4\.c/);
  assert.match(program.judgeReason, /unknown-field/);
  assert.match(program.judgeReason, /190\.6/);
  assert.match(program.judgeReason, /control-established/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357/);
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
  // the CardProgram's source-location here binding, not the emission itself.
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

test("Zaun Warrens: production trigger binding still rejects the unresolved here anchor", () => {
  // 053.3 / 383.4.c: the printed "here" is this Battlefield. The closed
  // EventPattern vocabulary has no battlefield-relative field, so the validator
  // rejects the placeholder and the program binder refuses to translate it.
  const validated = validateTriggerSpec({ at: ability.trigger.at, filter: ability.trigger.filter });
  assert.equal(validated.ok, false);
  assert.deepEqual(
    validated.issues.map(issue => [issue.path, issue.code]),
    [["trigger.filter.here", "unknown-field"]]
  );
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, abilitySource.ref.id, ability.trigger.at),
    /Unsupported filter field here/
  );
});

test("Zaun Warrens: the production program binding cannot even register the trigger", () => {
  // Programs/triggers.ts routes the card filter through translateTriggerFilter,
  // so the unresolved "here" aborts registration for the shipped program; the
  // card never reaches the EventPipeline at all.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const { engine, kernel } = fixture({
    cards: [{ id: "zaun-warrens", cardId: CANONICAL, types: ["battlefield"], energy: null, power: [] }]
  });
  assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("zaun-warrens"), to: "board" }).status, "done");
  assert.throws(
    () => triggerRegistrations(binding.registry, kernel.getObject("zaun-warrens")),
    /Unsupported filter field here/
  );
  assert.equal(engine.pipeline.triggers.size, 0);
});

test("Zaun Warrens: the real conquer emission carries only player and details.battlefieldId", () => {
  // turn/flow.ts's Score wave is the only producer of the conquer timing point;
  // it publishes { player, details: { battlefieldId } } and no Battlefield
  // snapshot. events/pipeline-match.ts compares details entries as literal
  // scalars, so the runtime id cannot be compared with the ability source's own
  // Location; a source-anchored spelling would need a new filter vocabulary.
  const conqueredByA = { eventId: 1, timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent({ event: "conquered", player: "self" }, conqueredByA, "A"), true);
  assert.equal(matchesTriggerEvent({ event: "conquered", player: "self" }, conqueredByA, "B"), false);
  // Matching the id is only a literal comparison with a value the static IR
  // cannot know: the source's own battlefield id is a runtime fact.
  assert.equal(matchesTriggerEvent({ event: "conquered", details: { battlefieldId: "bf-1" } }, conqueredByA, "A"), true);
  assert.equal(matchesTriggerEvent({ event: "conquered", details: { battlefieldId: "bf-2" } }, conqueredByA, "A"), false);
});

test.todo(
  "Zaun Warrens trigger: bind the source Battlefield's 053.3 here referent to the emitted details.battlefieldId " +
    "and resolve 190.6's controller of the Battlefield ability; the current EventPattern/ObjectFilter " +
    "contract has no runtime source-location comparison"
);

test.todo(
  "Zaun Warrens 359.3.e.11 end-to-end: a replacement effect that negates the discard leaves the unlinked draw " +
    "resolving inside a real chain Resolve (the golden drives the interpreter path; production chain resolution " +
    "needs the trigger binding above)"
);
