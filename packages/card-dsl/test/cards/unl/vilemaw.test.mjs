import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vilemaw.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2b655c9a9276c875f358aa5f0d210f00af256c6ead948f0a83c749f11739dcce";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "Enemy units here with less Might than me don't deal combat damage.\n" +
  "When I hold, draw 1.";

const [ambush, noCombatDamage, holdTrigger] = program.abilities;
const [drawOne] = holdTrigger.body;

test("unl-060-219 Vilemaw: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-060-219 Vilemaw: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /mightLt/);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  // The refreshed reason cites the observed blocked surfaces, not merged tasks.
  assert.match(program.judgeReason, /relative-player query/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-060-219 Vilemaw: [Ambush] is declared as a keyword only (822.1)", () => {
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
});

test("unl-060-219 Vilemaw: the merged Ambush definition expands its two static permissions", () => {
  const definition = keywordDefinitionsById.get("Ambush");
  assert.ok(definition);
  assert.equal(definition.valued, false);
  const expansion = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "static"]);
  assert.equal(expansion[0].effect.kind, "play-location-permission");
  assert.equal(expansion[1].effect.kind, "continuous.timing");
  assert.deepEqual(expansion[1].effect.grants, ["showdown", "closed-state"]);
});

test("unl-060-219 Vilemaw: the merged trigger adapter registers the hold declaration", () => {
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "vilemaw", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Vilemaw", types: ["unit"],
    tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "battlefield", id: "bf-1" }, might: 8, energy: 8, power: 2, exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  const registrations = triggerRegistrations(binding.registry, source);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.at, "hold");
  // The event vocabulary spells the matched event "held" (the timing point id is
  // "hold"); the previous "hold" filter was rejected by validateTriggerSpec.
  assert.deepEqual(registrations[0].spec.filter, { event: "held", object: { objectId: "vilemaw" } });
});

test("unl-060-219 Vilemaw gap: the combat-damage static cannot even be registered", () => {
  // programs/statics.ts resolves source-relative anchors while binding and rejects
  // the opponent controller outright, so the denial never reaches a layer
  // registration — one of the three gaps in judgeReason.
  const f = fixture({ cards: [{ id: "vilemaw", cardId: CANONICAL_ID, types: ["unit"], might: 8 }] });
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(noCombatDamage, f.kernel.getObject("vilemaw")),
    /Static controller:opponent filter needs a relative-player query/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("unl-060-219 Vilemaw gap: the layers matcher ignores the mightLt predicate", () => {
  // The printed restriction must compare each candidate with the source. The
  // filter vocabulary has no such comparison and the matcher silently ignores the
  // placeholder key: both a 9-Might and a 1-Might unit match, so this is not a
  // decidable restriction.
  const kernel = world().unit("big", { might: 9 }).unit("small", { might: 1 }).build();
  const filter = { type: "unit", zone: "board", controller: "A", mightLt: { kind: "self" } };
  assert.equal(matchesObjectFilter(filter, kernel.getObject("big")), true);
  assert.equal(matchesObjectFilter(filter, kernel.getObject("small")), true);
});

test("unl-060-219 Vilemaw gap: the real scoring payload carries no participating unit", () => {
  // 383.4.d.2/.2.a requires the Hold Effect to bind the unit present at the
  // battlefield. turn/flow.ts emits { player, details: { battlefieldId } }, so the
  // registered subscription does not match; only an artificial object on the
  // event would match. Pinned so the gap stays visible.
  const holdFilter = { event: "held", object: { objectId: "vilemaw" } };
  const emission = {
    type: "task-resolved",
    seq: 1,
    eventId: 1,
    turnNumber: 1,
    activePlayerId: "A",
    taskId: "pipeline:1",
    sourceCardId: "",
    reason: "hold",
    autoResolved: true,
    timingPoint: "hold",
    player: "A",
    details: { battlefieldId: "bf-1" }
  };
  assert.equal(matchesTriggerEvent(holdFilter, emission, "A"), false);
  const object = {
    ref: { id: "vilemaw", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Vilemaw",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 8,
    energy: 8,
    power: 2,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    combatRole: null
  };
  assert.equal(matchesTriggerEvent(holdFilter, { ...emission, object }, "A"), true);
});

test("unl-060-219 Vilemaw: the combat-damage denial keeps the here/less-Might filter shape (467.2.c, 355.9.b)", () => {
  assert.equal(noCombatDamage.kind, "static");
  assert.equal(noCombatDamage.effect.kind, "continuous.combat");
  assert.equal(noCombatDamage.effect.forbidden, "combat-damage");
  assert.deepEqual(noCombatDamage.effect.filter, {
    // 355.9.a.1/355.9.b/359.3.f.1: "Enemy units here"; 758.2.a uses this card as
    // its example of the relational restriction changing dynamically.
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source",
    // "with less Might than me": the merged matcher reads no such key, so this is
    // a predicate name pending the relational filter vocabulary.
    mightLt: { kind: "self" }
  });
  assert.equal(noCombatDamage.condition, undefined);
});

test("unl-060-219 Vilemaw: 'When I hold, draw 1.' is a hold trigger drawing one card (383.4.d, 414.3)", () => {
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.equal(isTimingPointId("hold"), true);
  // The matched event name is the closed-vocabulary spelling "held"; "hold" is
  // only the timing-point id (validateTriggerSpec rejects the old filter).
  assert.deepEqual(holdTrigger.trigger.filter, {
    event: "held",
    filter: { source: "self" }
  });
  assert.equal(holdTrigger.optional, false);
  assert.equal(holdTrigger.body.length, 1);

  assert.equal(drawOne.id, "vilemaw.draw-one");
  assert.equal(drawOne.op, "effect.draw");
  // The drawer defaults to the ability controller (190.6.d); no target or pick.
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-060-219 Vilemaw golden: the hold body's effect.draw takes the top card (414.1/414.3)", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-060-219 Vilemaw golden: an empty Main Deck draws 0 without inventing a card (414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  // The primitive submits the draw action; an empty Main Deck leaves it with
  // nothing to move, so no card is invented (the reference kernel records the
  // attempted action as its own event).
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "unl-060-219 Vilemaw: stop enemy units here with less Might than Vilemaw from contributing combat damage " +
    "(CR 467.2.a/b/467.2.c) — the closed GameAction set has no combat-damage denial and combat flow has no " +
    "continuous.combat consumer"
);

test.todo(
  "unl-060-219 Vilemaw: evaluate 'with less Might than me' as a relational restriction that follows Might and " +
    "location changes (CR 355.9.b, 758.2.a) — ObjectFilter values are static and cannot compare against the source"
);

test.todo(
  "unl-060-219 Vilemaw: expand [Ambush] (CR 822.1.b: the battlefield-with-your-units play permission and the " +
    "Reaction timing while being played there) — Ambush.ts publishes both declarations, but the production static " +
    "binder rejects both kinds (no layer mapping / unsupported appliesTo) and chain canAct does not read them"
);

test.todo(
  "unl-060-219 Vilemaw: fire 'When I hold' when Vilemaw is the unit present at the held battlefield " +
    "(CR 383.4.d.2/383.4.d.2.a) — the trigger adapter is present, but the hold payload carries only the " +
    "battlefield and player, so it cannot bind the participating unit"
);
