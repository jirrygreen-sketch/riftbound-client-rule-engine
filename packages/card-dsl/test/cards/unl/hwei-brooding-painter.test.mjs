import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/hwei-brooding-painter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { TriggerSpecValidationError } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL =
  "card.hash-ffb82a1c4cfcf34e538fde6b389b55d4affeceb3cdb2ba50ada212c3237fe8f2";
const SOURCE_TEXT =
  "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type:\n" +
  "Spell — Draw 1.Gear — Ready up to 2 runes.Unit — Give me +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [drawOne, discardOne, spellBranch, gearBranch, unitBranch] = ability.body;
const [spellDraw] = spellBranch.args.body.value;
const [gearReady] = gearBranch.args.body.value;
const [unitModifier] = unitBranch.args.body.value;

const branchCondition = (type) => ({
  kind: "compare",
  left: { kind: "constant", value: type },
  operator: "in",
  right: {
    kind: "object-property",
    object: { linked: "hwei.discard-1" },
    property: "types"
  }
});

/**
 * The reference kernel compares filters by value and does not run finalize-time
 * placeholder resolution. The production chain normalizes the rune pick's
 * owner: "self" to the ability controller, so the golden applies the same
 * caller normalization without changing the card IR (merged precedents use the
 * same pattern).
 */
const prepareCallerBody = (body, controller) => {
  const clone = structuredClone(body);
  const visit = (instructions) => {
    for (const instruction of instructions) {
      if (instruction.op === "effect.ready") {
        instruction.args.objects.value.filter.owner = controller;
      }
      if (instruction.op === "sequence" && Array.isArray(instruction.args.body.value)) {
        visit(instruction.args.body.value);
      }
    }
  };
  visit(clone);
  return clone;
};

const hweiWorld = () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .hand("hand-card", { types: ["spell"] })
    .unit("hwei", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .deck(["deck-top", "deck-two"])
    .object("rune-ready", { types: ["rune"], zone: "rune-zone", exhausted: false })
    .object("rune-one", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .object("rune-two", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .object("rune-three", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("hwei") });
};

test("unl-080-219 Hwei, Brooding Painter: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("unl-080-219 Hwei, Brooding Painter: identity, ruleset, judge-required status, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /388\.1\.b/);
  assert.match(program.judgeReason, /389\.1/);
  assert.match(program.judgeReason, /待定 Chain item/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-080-219 Hwei, Brooding Painter: 'When I move' subscribes to object-moved (449.1/449.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-080-219 Hwei, Brooding Painter: draw 1 then discard 1, in printed order", () => {
  assert.deepEqual(
    ability.body.map((entry) => [entry.id, entry.op]),
    [
      ["hwei.draw-1", "effect.draw"],
      ["hwei.discard-1", "effect.discard"],
      ["hwei.spell-branch", "sequence"],
      ["hwei.gear-branch", "sequence"],
      ["hwei.unit-branch", "sequence"]
    ]
  );
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discardOne.args.amount, { kind: "constant", value: 1 });
  // The discarder is the ability controller (190.6.d); effect.discard's ordinary
  // private Hand choice needs no pick when the whole hand is in scope (355.10.a).
  assert.equal(discardOne.args.player, undefined);
  assert.equal(discardOne.args.pick, undefined);
  assert.equal(discardOne.picks, undefined);
  assert.equal(discardOne.linkedTo, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-080-219 Hwei, Brooding Painter: the three type branches are mutually exclusive sequences", () => {
  assert.deepEqual(spellBranch.condition, branchCondition("spell"));
  assert.deepEqual(gearBranch.condition, branchCondition("gear"));
  assert.deepEqual(unitBranch.condition, branchCondition("unit"));
  for (const branch of [spellBranch, gearBranch, unitBranch]) {
    assert.equal(branch.op, "sequence");
    assert.equal(branch.linkedTo, undefined);
  }

  // Spell — Draw 1.
  assert.equal(spellDraw.op, "effect.draw");
  assert.deepEqual(spellDraw.args.amount, { kind: "constant", value: 1 });

  // Gear — Ready up to 2 runes: at-most-two non-targeting set choice (min 0).
  assert.equal(gearReady.op, "effect.ready");
  assert.deepEqual(gearReady.args.objects.value, {
    kind: "choose",
    id: "hwei-runes",
    filter: { zone: "rune-zone", type: "rune", owner: "self" },
    min: 0,
    max: 2
  });

  // Unit — Give me +3 :rb_might: this turn: a continuous layer modifier whose
  // "me" anchor travels through the sequence args (appliesTo: self).
  assert.equal(unitModifier.op, "continuous.might");
  assert.deepEqual(unitModifier.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(unitModifier.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(unitBranch.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(unitModifier.args.target, undefined);
  assert.equal(unitModifier.targets, undefined);
});

test("unl-080-219 Hwei, Brooding Painter golden: a discarded spell draws 1 in its branch", () => {
  const kernel = hweiWorld();
  const hand = kernel.zoneSlice("A", "hand", "top");
  assert.deepEqual(hand.map((object) => object.ref.id), ["hand-card"]);

  // effect.discard with a 2-card hand asks which card leaves; the answer key is
  // the choice-id path with the player suffix URL-encoded by pathId.
  kernel.setAnswers({
    "hwei.discard-1/effect.discard%3AA": [kernel.ref("hand-card")]
  });
  const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["hwei.draw-1", "executed"],
      ["hwei.discard-1", "executed"],
      ["hwei.spell-draw-1", "executed"],
      ["hwei.spell-branch", "executed"],
      ["hwei.gear-branch", "negated"],
      ["hwei.unit-branch", "negated"]
    ]
  );
  // The discarded card reaches Trash; draw 1 and the Spell branch's draw 1 each
  // commit a draw action, and the discard receipt links the pre-discard ref.
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["hand-card"]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-top", "deck-two"]);
  assert.equal(outcome.events.filter((event) => event.action === "draw").length, 2);
  assert.equal(outcome.linkedValues["hwei.discard-1.discarded"].count, 1);
});

test("unl-080-219 Hwei, Brooding Painter golden: a discarded gear readies up to 2 runes", () => {
  const base = hweiWorld();
  const kernel = base;
  // The gear branch requires a discarded gear card; addObject returns the new
  // ObjectRef, so keep the kernel reference stable and ignore the returned ref.
  kernel.addObject(
    { ...base.getObject("hand-card"), types: ["gear"], ref: { id: "gear-card", zoneEntryId: 1 } },
    "hand"
  );
  const runeOne = kernel.ref("rune-one");
  const runeTwo = kernel.ref("rune-two");
  kernel.setAnswers({
    "hwei.discard-1/effect.discard%3AA": [kernel.ref("gear-card")],
    "hwei.gear-branch/hwei.gear-ready-runes/hwei-runes": [runeOne, runeTwo]
  });
  const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);

  const gearEntry = outcome.results.find((entry) => entry.id === "hwei.gear-ready-runes");
  assert.equal(gearEntry.result.status, "executed");
  assert.equal(kernel.getObject("rune-one").exhausted, false);
  assert.equal(kernel.getObject("rune-two").exhausted, false);
  // Up to 2: the third rune stays exhausted; an already-ready rune is not counted.
  assert.equal(kernel.getObject("rune-three").exhausted, true);
  assert.equal(kernel.getObject("rune-ready").exhausted, false);
  // The discard receipt keeps the chosen gear card for the branch condition.
  assert.equal(outcome.linkedValues["hwei.discard-1.discarded"].count, 1);
  assert.deepEqual(
    outcome.linkedValues["hwei.discard-1.discarded"].objects.map((ref) => ref.id),
    ["gear-card"]
  );
  // The interpreter writes linked values as "path.key"; the path contains the
  // sequence branch id.
  assert.equal(
    outcome.linkedValues["hwei.gear-branch/hwei.gear-ready-runes.readied"].count,
    2
  );

  const branchStatuses = Object.fromEntries(
    outcome.results
      .filter((entry) => entry.id.endsWith("-branch"))
      .map((entry) => [entry.id, entry.result.status])
  );
  assert.deepEqual(branchStatuses, {
    "hwei.spell-branch": "negated",
    "hwei.gear-branch": "executed",
    "hwei.unit-branch": "negated"
  });
});

test("unl-080-219 Hwei, Brooding Painter golden: the type readout selects exactly one branch", () => {
  for (const [type, expectedBranch] of [
    ["spell", "hwei.spell-branch"],
    ["gear", "hwei.gear-branch"],
    ["unit", "hwei.unit-branch"]
  ]) {
    const base = hweiWorld();
    // addObject returns the new ObjectRef, not the kernel; keep the kernel
    // reference stable and ignore the returned ref.
    const kernel = base;
    kernel.addObject(
      { ...base.getObject("hand-card"), types: [type], ref: { id: "typed-card", zoneEntryId: 1 } },
      "hand"
    );
    kernel.setAnswers({
      "hwei.discard-1/effect.discard%3AA": [kernel.ref("typed-card")],
      "hwei.gear-branch/hwei.gear-ready-runes/hwei-runes": [kernel.ref("rune-one")]
    });
    const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);
    const executed = outcome.results
      .filter((entry) => entry.id.endsWith("-branch") && entry.result.status === "executed")
      .map((entry) => entry.id);
    assert.deepEqual(executed, [expectedBranch], type);
    assert.deepEqual(
      outcome.linkedValues["hwei.discard-1.discarded"].objects.map((ref) => ref.id),
      ["typed-card"]
    );
  }
});

test("unl-080-219 Hwei, Brooding Painter golden: the Unit branch registers +3 Might for this turn", () => {
  const base = hweiWorld();
  const kernel = base;
  kernel.addObject(
    { ...base.getObject("hand-card"), types: ["unit"], ref: { id: "unit-card", zoneEntryId: 1 } },
    "hand"
  );
  kernel.setAnswers({ "hwei.discard-1/effect.discard%3AA": [kernel.ref("unit-card")] });

  // The full body executes through the merged interpreter path; the continuous
  // effect lands on the resolving source via args.appliesTo: self.
  const outcome = resolveChainBody(prepareCallerBody(ability.body, "A"), kernel);
  assert.equal(outcome.status, "partial");
  const unitEntry = outcome.results.find((entry) => entry.id === "hwei.unit-give-plus-3");
  assert.equal(unitEntry.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("hwei")).might, 8);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("hwei")).might, 5);
});

test("unl-080-219 Hwei, Brooding Painter: the object-moved trigger registers", () => {
  // Lift only the status for the binding probe. This makes ProgramRegistry
  // reach trigger translation; the production card remains judge-required.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const registry = new ProgramRegistry([lifted]);
  const f = fixture({
    cards: [{ id: "hwei", cardId: CANONICAL, types: ["unit"], owner: "A", controller: "A" }]
  });
  const [ability] = program.abilities;
  const source = f.kernel.getObject("hwei");
  assert.deepEqual(
    translateTriggerFilter(ability.trigger.filter, source.ref.id, ability.trigger.at),
    { event: "object-moved", object: { objectId: "hwei" } }
  );
  const ids = registerProgramTriggers(registry, f.engine, source);
  assert.ok(ids.length > 0);
});

test("unl-080-219 Hwei, Brooding Painter regression: ChainEngine keeps the type branch inline", () => {
  const f = fixture({
    cards: [
      { id: "hwei", cardId: CANONICAL, types: ["unit"], owner: "A", controller: "A", might: 5 },
      { id: "spell-card", types: ["spell"], owner: "A", controller: "A" }
    ]
  });
  const board = f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("hwei"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  assert.equal(board.status, "done");
  f.answers.set("hwei.discard-1/effect.discard%3AA", [f.kernel.ref("spell-card")]);
  f.engine.enqueue({
    id: "hwei-trigger-probe",
    controller: "A",
    source: f.kernel.getObject("hwei"),
    kind: "triggered",
    body: ability.body
  });
  f.engine.advance();
  while (f.engine.items.length) f.engine.pass(f.engine.priority);

  const chainSteps = f.engine.trace.filter(step => step.step === "pending" || step.step === "resolved");
  assert.deepEqual(chainSteps.map(step => step.step), ["pending", "resolved"]);
  assert.equal(f.kernel.events.filter(event => event.action === "draw").length, 2);
});

