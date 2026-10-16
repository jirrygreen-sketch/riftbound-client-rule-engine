import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gentle-gemdragon.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-81788385a3c8b2f3d27d9a7a0b93c5b2d792ca36d504b883b637aa517713a9d5";
const SOURCE_TEXT = "When you play me or another Dragon, ready up to 2 runes.";

const [ability] = program.abilities;
const [readyRunes] = ability.body;

/** A Rune on the controller's Board (107.1 / 108.5: the Rune Zone). */
function rune(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ["rune"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "rune-zone",
    location: { type: "base", player: "A" },
    might: null,
    energy: null,
    power: null,
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

test("unl-104-219 Gentle Gemdragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-104-219 Gentle Gemdragon: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-104-219 Gentle Gemdragon: the printed union is one card-played trigger over Dragon units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  // 383.4.a.1 (Play Effect) plus 383.4.a.4 (“another object is played”): both
  // halves observe card-played; “me or another Dragon” is the Dragon unit being
  // played (this printing is itself a Dragon per the catalog tags).
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { type: "unit", tags: ["Dragon"], controller: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("unl-104-219 Gentle Gemdragon: 'ready up to 2 runes' is an up-to 0..2 target spec", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(readyRunes.id, "gentle-gemdragon.ready-runes");
  assert.equal(readyRunes.op, "effect.ready");
  assert.deepEqual(readyRunes.args, {
    objects: { kind: "constant", value: { kind: "target", id: "gentle-gemdragon.runes" } }
  });
  assert.equal(readyRunes.linkedTo, undefined);
  assert.equal(readyRunes.picks, undefined);
  assert.equal(readyRunes.condition, undefined);
  assert.equal(readyRunes.targets.length, 1);
  const [spec] = readyRunes.targets;
  assert.equal(spec.id, "gentle-gemdragon.runes");
  // 355.13: "up to" admits zero through the printed maximum; 355.5 / 355.7:
  // the runes are chosen while the ability is finalized.
  assert.deepEqual(spec.filter, { type: "rune", zone: "rune-zone", controller: "self" });
  assert.equal(spec.min, 0);
  assert.equal(spec.max, 2);
  assert.equal(spec.selection, "up-to");
});

test("unl-104-219 Gentle Gemdragon golden: the body readies exactly the two locked runes", () => {
  const kernel = world().build();
  kernel.addObject(rune("rune-1"));
  kernel.addObject(rune("rune-2"));
  kernel.addObject(rune("rune-3"));
  const controlled = kernel.objectsInZone("A", "rune-zone").map(ref => kernel.ref(ref.id));
  kernel.setTargets("gentle-gemdragon.runes", [controlled[0], controlled[1]]);

  const outcome = runAbilityBody(ability.body.map(({ targets, ...rest }) => rest), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready", "ready"]);
  assert.deepEqual(["rune-1", "rune-2", "rune-3"].map(id => kernel.getObject(id).exhausted), [
    false,
    false,
    true
  ]);
});

test("unl-104-219 Gentle Gemdragon golden: a locked rune that left its zone is dropped, the other is readied", () => {
  const kernel = world().build();
  kernel.addObject(rune("staying"));
  kernel.addObject(rune("leaving"));
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.setTargets("gentle-gemdragon.runes", [kernel.ref("staying"), stale]);

  const outcome = runAbilityBody(ability.body.map(({ targets, ...rest }) => rest), kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
  assert.equal(kernel.getObject("staying").exhausted, false);
  assert.equal(kernel.getObject("leaving").zone, "trash");
});

test("unl-104-219 Gentle Gemdragon golden: an already-ready rune is not readied again (416.1.b)", () => {
  const kernel = world().build();
  kernel.addObject(rune("ready-rune", { exhausted: false }));
  kernel.setTargets("gentle-gemdragon.runes", [kernel.ref("ready-rune")]);
  const run = runInstruction(
    ready,
    { objects: { kind: "target", id: "gentle-gemdragon.runes" } },
    { world: kernel, targets: { "gentle-gemdragon.runes": [kernel.ref("ready-rune")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-104-219 Gentle Gemdragon: subscribe the card-played trigger and resolve the {source: \"self\"} anchor in the production pipeline — no merged module turns a CardProgram triggered ability into a TriggerRegistration (engine batch 4 / RIFT-120 follow-up)"
);
test.todo(
  "unl-104-219 Gentle Gemdragon: Finalize-time target choice for 'up to 2 runes', the became-target notifications and the 355.13 zero-target legality belong to the target system (RIFT-90)"
);
test.todo(
  "unl-104-219 Gentle Gemdragon: resolving with zero chosen runes must be a legal no-op (355.13: 'up to' includes zero, so the ability can be played without targets) — the merged effect.ready reports an empty locked selection as ignored/mistargeted, which the golden does not treat as the printed behaviour; depends on the target plan's zero-target finalize path (RIFT-90) plus the card-program trigger adapter"
);
